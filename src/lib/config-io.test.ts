import { describe, expect, it } from "vitest";

import {
  applyConfig,
  configFileName,
  CONFIG_VERSION,
  exportConfig,
  MAX_CONFIG_BYTES,
  parseConfig,
  type ConfigPayload,
} from "./config-io";
import { DEFAULT_MASKS } from "./video/presets";
import { DEFAULT_RENDER_OPTIONS } from "./video/render-options";

function payload(overrides: Partial<ConfigPayload> = {}): ConfigPayload {
  return {
    presetId: "discret",
    sourceLanguage: "fra",
    targetLanguage: "en",
    options: { ...DEFAULT_RENDER_OPTIONS },
    masks: DEFAULT_MASKS.map((m) => ({
      id: m.id,
      x: m.x,
      y: m.y,
      w: m.w,
      h: m.h,
      enabled: m.enabled,
    })),
    ...overrides,
  };
}

describe("exportConfig", () => {
  it("produit un JSON relisable par parseConfig", () => {
    const result = parseConfig(exportConfig(payload()));
    expect(result.ok).toBe(true);
  });

  it("n'exporte JAMAIS l'identifiant de voix clonee", () => {
    // C'est un identifiant lie au compte ai33.pro de l'utilisateur : partager
    // un preset ne doit pas partager son compte.
    const json = exportConfig(
      payload({ options: { ...DEFAULT_RENDER_OPTIONS, clonedVoiceId: "voix-privee-42" } }),
    );

    expect(json).not.toContain("voix-privee-42");
    expect(json).not.toContain("clonedVoiceId");
  });

  it("marque l'application et la version", () => {
    const config = JSON.parse(exportConfig(payload())) as Record<string, unknown>;
    expect(config.app).toBe("viraldub");
    expect(config.version).toBe(CONFIG_VERSION);
  });
});

describe("parseConfig — entrees hostiles", () => {
  it("refuse un JSON malforme sans lever", () => {
    const result = parseConfig("{ pas du json");
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/JSON/i) });
  });

  it("refuse un fichier d'une autre application", () => {
    const result = parseConfig(JSON.stringify({ app: "autre", version: 1 }));
    expect(result.ok).toBe(false);
  });

  it("refuse un fichier demesure avant meme de l'analyser", () => {
    const huge = JSON.stringify({ app: "viraldub", version: 1 }) + " ".repeat(MAX_CONFIG_BYTES);
    const result = parseConfig(huge);
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/volumineux/i) });
  });

  it("refuse une valeur hors liste blanche, meme bien formee", () => {
    // Cœur du modele de menace : `filterId` finit dans une chaine de filtres
    // ffmpeg. Une valeur libre pourrait detourner le graphe.
    const result = parseConfig(
      JSON.stringify({
        app: "viraldub",
        version: 1,
        options: { filterId: "none,drawtext=text='pwned'" },
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/filterId/);
  });

  it("refuse une cle inconnue plutot que de l'ignorer", () => {
    const result = parseConfig(
      JSON.stringify({ app: "viraldub", version: 1, commandeArbitraire: "rm -rf" }),
    );
    expect(result.ok).toBe(false);
  });

  it("refuse une cle inconnue DANS options, y compris clonedVoiceId", () => {
    // `strict()` sur le sous-objet : sans lui, un fichier pourrait glisser un
    // `clonedVoiceId` que la fusion aurait pu propager.
    for (const options of [{ clonedVoiceId: "voix-injectee" }, { champInconnu: 1 }]) {
      const result = parseConfig(JSON.stringify({ app: "viraldub", version: 1, options }));
      expect(result.ok).toBe(false);
    }

    // `__proto__` doit etre ecrit a la main : `JSON.stringify` d'un litteral
    // ne l'emet pas, il est traite comme l'accesseur du prototype.
    const forged = parseConfig(
      '{"app":"viraldub","version":1,"options":{"__proto__":{"pollue":true}}}',
    );
    expect(forged.ok).toBe(false);
  });

  it("refuse une opacite hors de [0, 1]", () => {
    for (const subtitleOpacity of [-1, 2, Number.POSITIVE_INFINITY, Number.NaN]) {
      const result = parseConfig(
        JSON.stringify({ app: "viraldub", version: 1, options: { subtitleOpacity } }),
      );
      expect(result.ok).toBe(false);
    }
  });

  it("refuse une duree de transition negative ou demesuree", () => {
    for (const transitionDuration of [-1, 0, 60]) {
      const result = parseConfig(
        JSON.stringify({ app: "viraldub", version: 1, options: { transitionDuration } }),
      );
      expect(result.ok).toBe(false);
    }
  });

  it("refuse un masque aux coordonnees hors cadre", () => {
    const result = parseConfig(
      JSON.stringify({
        app: "viraldub",
        version: 1,
        masks: [{ id: "bottom", x: 0, y: 0, w: 99, h: 1, enabled: true }],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("refuse un tableau de masques demesure", () => {
    const masks = Array.from({ length: 500 }, () => ({
      id: "bottom",
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      enabled: true,
    }));
    const result = parseConfig(JSON.stringify({ app: "viraldub", version: 1, masks }));
    expect(result.ok).toBe(false);
  });

  it("ne propage pas une pollution de prototype", () => {
    const result = parseConfig(
      '{"app":"viraldub","version":1,"__proto__":{"pollue":true},"options":{"mirror":true}}',
    );

    // Zod ne recopie que les champs declares : la cle hostile disparait.
    expect(({} as Record<string, unknown>).pollue).toBeUndefined();
    if (result.ok) {
      expect(Object.hasOwn(result.config, "__proto__")).toBe(false);
    }
  });

  it("refuse une version future qu'il ne saurait pas interpreter", () => {
    const result = parseConfig(JSON.stringify({ app: "viraldub", version: 999 }));
    expect(result.ok).toBe(false);
  });
});

describe("applyConfig", () => {
  it("conserve l'identifiant de voix clonee de la session", () => {
    const current = payload({
      options: { ...DEFAULT_RENDER_OPTIONS, clonedVoiceId: "ma-voix" },
    });

    const merged = applyConfig({ app: "viraldub", version: 1, options: { mirror: true } }, current);

    expect(merged.options.clonedVoiceId).toBe("ma-voix");
    expect(merged.options.mirror).toBe(true);
  });

  it("resiste a un objet hostile qui contournerait le schema", () => {
    // Defense en profondeur : `parseConfig` refuserait deja ce contenu, mais
    // `applyConfig` ne doit pas dependre de cette seule barriere. On lui passe
    // donc directement un objet forge, comme si la validation avait ete
    // contournee.
    const current = payload({
      options: { ...DEFAULT_RENDER_OPTIONS, clonedVoiceId: "ma-voix" },
    });

    const hostile = {
      app: "viraldub" as const,
      version: 1,
      options: { mirror: true, clonedVoiceId: "voix-volee" },
    } as Parameters<typeof applyConfig>[0];

    const merged = applyConfig(hostile, current);

    expect(merged.options.clonedVoiceId).toBe("ma-voix");
  });

  it("garde les valeurs courantes pour les champs absents", () => {
    const current = payload();
    const merged = applyConfig({ app: "viraldub", version: 1 }, current);
    expect(merged).toEqual(current);
  });

  it("applique les champs presents", () => {
    const merged = applyConfig(
      {
        app: "viraldub",
        version: 1,
        targetLanguage: "fr",
        options: { ambienceLevel: 0.5, cutSilences: false },
      },
      payload(),
    );

    expect(merged.targetLanguage).toBe("fr");
    expect(merged.options.ambienceLevel).toBe(0.5);
    expect(merged.options.cutSilences).toBe(false);
  });

  it("ignore un masque dont l'identifiant n'existe pas", () => {
    const current = payload();
    const merged = applyConfig(
      {
        app: "viraldub",
        version: 1,
        masks: [{ id: "zone-inventee", x: 0, y: 0, w: 1, h: 1, enabled: true }],
      },
      current,
    );

    expect(merged.masks).toEqual(current.masks);
  });

  it("met a jour un masque connu", () => {
    const current = payload();
    const merged = applyConfig(
      {
        app: "viraldub",
        version: 1,
        masks: [{ id: "bottom", x: 0.1, y: 0.2, w: 0.3, h: 0.4, enabled: true }],
      },
      current,
    );

    const bottom = merged.masks.find((m) => m.id === "bottom");
    expect(bottom).toMatchObject({ x: 0.1, y: 0.2, w: 0.3, h: 0.4, enabled: true });
  });
});

describe("aller-retour", () => {
  it("preserve les reglages a l'identique, hors secret", () => {
    const original = payload({
      options: {
        ...DEFAULT_RENDER_OPTIONS,
        mirror: true,
        ambienceLevel: 0.4,
        subtitleOpacity: 0.65,
        transition: "fade",
        transitionDuration: 0.5,
        clonedVoiceId: "secret",
      },
      targetLanguage: "fr",
    });

    const result = parseConfig(exportConfig(original));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const restored = applyConfig(result.config, payload());

    expect(restored.options.mirror).toBe(true);
    expect(restored.options.ambienceLevel).toBe(0.4);
    expect(restored.options.subtitleOpacity).toBe(0.65);
    expect(restored.options.transition).toBe("fade");
    expect(restored.targetLanguage).toBe("fr");
    // Le secret n'a pas survecu a l'aller-retour, c'est voulu.
    expect(restored.options.clonedVoiceId).toBe("");
  });
});

describe("configFileName", () => {
  it("date le fichier pour distinguer plusieurs exports", () => {
    expect(configFileName(new Date("2026-09-03T10:00:00Z"))).toBe(
      "viraldub-config-2026-09-03.json",
    );
  });
});
