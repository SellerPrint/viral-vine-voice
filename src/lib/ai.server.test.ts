import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  requestTranslations,
  resolveTranslationProvider,
  TRANSLATION_BATCH_SIZE,
} from "./ai.server";

const PROVIDER = { apiKey: "k", baseUrl: "https://example.test/v1", model: "test-model" };

/** Réponse Gemini valide pour `count` segments. */
const okResponse = (count: number) => ({
  ok: true,
  json: async () => ({
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  results: Array.from({ length: count }, (_, i) => ({
                    translation: `translated ${i}`,
                    direction: "neutral",
                  })),
                }),
              },
            },
          ],
        },
      },
    ],
  }),
});

const segments = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ text: `segment ${i}`, start: i, end: i + 1 }));

afterEach(() => vi.unstubAllGlobals());

describe("requestTranslations — découpage en lots", () => {
  it("n'émet qu'un appel sous la taille de lot", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(10));
    vi.stubGlobal("fetch", fetchMock);

    const { results, failed } = await requestTranslations(
      PROVIDER,
      segments(10),
      "French",
      "English",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(10);
    expect(failed).toBe(0);
  });

  it("découpe au-delà de la taille de lot", async () => {
    const total = TRANSLATION_BATCH_SIZE * 2 + 3;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(TRANSLATION_BATCH_SIZE))
      .mockResolvedValueOnce(okResponse(TRANSLATION_BATCH_SIZE))
      .mockResolvedValueOnce(okResponse(3));
    vi.stubGlobal("fetch", fetchMock);

    const { results } = await requestTranslations(PROVIDER, segments(total), "French", "English");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(total);
  });

  it("isole l'échec d'un lot au lieu de tout perdre", async () => {
    const total = TRANSLATION_BATCH_SIZE * 2;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(TRANSLATION_BATCH_SIZE))
      // Le modèle renvoie un résultat de trop : ce lot échoue.
      .mockResolvedValueOnce(okResponse(TRANSLATION_BATCH_SIZE + 1));
    vi.stubGlobal("fetch", fetchMock);

    const { results, failed } = await requestTranslations(PROVIDER, segments(total), "fr", "en");

    expect(results).toHaveLength(total);
    expect(failed).toBe(TRANSLATION_BATCH_SIZE);
    // Le premier lot est bien traduit...
    expect(results[0].text).toBe("translated 0");
    // ...et le lot en échec retombe sur le texte source.
    expect(results[TRANSLATION_BATCH_SIZE].text).toBe(`segment ${TRANSLATION_BATCH_SIZE}`);
    expect(results[TRANSLATION_BATCH_SIZE].direction).toBe("neutral");
  });

  it("lève si absolument tous les lots échouent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, text: async () => "boom" }));

    await expect(requestTranslations(PROVIDER, segments(5), "fr", "en")).rejects.toThrow(
      /ensemble des segments/,
    );
  });

  it("propage l'annulation sans la traiter comme un échec de lot", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(5)));

    await expect(
      requestTranslations(PROVIDER, segments(5), "fr", "en", controller.signal),
    ).rejects.toThrow();
  });

  it("nettoie les retours à la ligne des traductions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      arguments: JSON.stringify({
                        results: [{ translation: "ligne\nsuivante   ici", direction: "neutral" }],
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      }),
    );

    const { results } = await requestTranslations(PROVIDER, segments(1), "fr", "en");
    expect(results[0].text).toBe("ligne suivante ici");
  });
});

describe("resolveTranslationProvider", () => {
  const KEYS = [
    "TRANSLATION_API_KEY",
    "TRANSLATION_BASE_URL",
    "TRANSLATION_MODEL",
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
    "OPENROUTER_API_KEY",
    "LOVABLE_API_KEY",
  ];
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("retourne null si aucune clé n'est définie", () => {
    expect(resolveTranslationProvider()).toBeNull();
  });

  it("préfère Gemini quand plusieurs clés coexistent", () => {
    process.env.LOVABLE_API_KEY = "lov";
    process.env.GROQ_API_KEY = "groq";
    process.env.GEMINI_API_KEY = "gem";
    const p = resolveTranslationProvider();
    expect(p?.apiKey).toBe("gem");
    expect(p?.baseUrl).toContain("generativelanguage.googleapis.com");
  });

  it("retombe sur Groq si Gemini est absent", () => {
    process.env.GROQ_API_KEY = "groq";
    expect(resolveTranslationProvider()?.baseUrl).toContain("api.groq.com");
  });

  it("reste compatible avec LOVABLE_API_KEY seul", () => {
    process.env.LOVABLE_API_KEY = "lov";
    const p = resolveTranslationProvider();
    expect(p?.apiKey).toBe("lov");
    expect(p?.baseUrl).toContain("ai.gateway.lovable.dev");
  });

  it("permet de surcharger l'URL et le modèle", () => {
    process.env.GEMINI_API_KEY = "gem";
    process.env.TRANSLATION_MODEL = "gemini-2.5-flash";
    expect(resolveTranslationProvider()?.model).toBe("gemini-2.5-flash");
  });

  it("accepte un fournisseur libre via TRANSLATION_API_KEY", () => {
    process.env.TRANSLATION_API_KEY = "libre";
    process.env.TRANSLATION_BASE_URL = "https://mon-proxy.test/v1";
    process.env.TRANSLATION_MODEL = "mon-modele";
    expect(resolveTranslationProvider()).toEqual({
      apiKey: "libre",
      baseUrl: "https://mon-proxy.test/v1",
      model: "mon-modele",
    });
  });
});

describe("compatibilité du schéma d'outil avec Gemini", () => {
  /** Collecte tous les sous-schémas du payload envoyé au fournisseur. */
  function collectNodes(node: unknown, out: Record<string, unknown>[] = []) {
    if (Array.isArray(node)) {
      for (const item of node) collectNodes(item, out);
    } else if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if ("type" in record || "enum" in record || "properties" in record) out.push(record);
      for (const value of Object.values(record)) collectNodes(value, out);
    }
    return out;
  }

  async function captureToolSchema() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify({
                      results: [{ translation: "hi", direction: "neutral" }],
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await requestTranslations(PROVIDER, [{ text: "salut", start: 0, end: 1 }], "French", "English");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    return body.tools[0].function.parameters;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("n'utilise ni minItems ni maxItems (rejetés par Gemini)", async () => {
    const schema = await captureToolSchema();
    const serialized = JSON.stringify(schema);
    expect(serialized).not.toContain("minItems");
    expect(serialized).not.toContain("maxItems");
  });

  it("déclare un type explicite sur chaque nœud, y compris les enum", async () => {
    const schema = await captureToolSchema();
    for (const node of collectNodes(schema)) {
      expect(node.type, `nœud sans type : ${JSON.stringify(node)}`).toBeDefined();
      if ("enum" in node) expect(node.type).toBe("string");
    }
  });

  it("n'utilise aucun mot-clé JSON Schema non supporté par Gemini", async () => {
    const serialized = JSON.stringify(await captureToolSchema());
    for (const keyword of [
      "additionalProperties",
      "patternProperties",
      "const",
      "$ref",
      "oneOf",
      "allOf",
      "exclusiveMinimum",
      "exclusiveMaximum",
    ]) {
      expect(serialized, `mot-clé interdit : ${keyword}`).not.toContain(keyword);
    }
  });
});
