import { afterEach, describe, expect, it, vi } from "vitest";

import { requestTranslations, TRANSLATION_BATCH_SIZE } from "./ai.server";

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

    const { results, failed } = await requestTranslations("k", segments(10), "French", "English");

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

    const { results } = await requestTranslations("k", segments(total), "French", "English");

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

    const { results, failed } = await requestTranslations("k", segments(total), "fr", "en");

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

    await expect(requestTranslations("k", segments(5), "fr", "en")).rejects.toThrow(
      /ensemble des segments/,
    );
  });

  it("propage l'annulation sans la traiter comme un échec de lot", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(5)));

    await expect(
      requestTranslations("k", segments(5), "fr", "en", controller.signal),
    ).rejects.toThrow();
  });

  it("nettoie les retours à la ligne des traductions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
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
    }));

    const { results } = await requestTranslations("k", segments(1), "fr", "en");
    expect(results[0].text).toBe("ligne suivante ici");
  });
});
