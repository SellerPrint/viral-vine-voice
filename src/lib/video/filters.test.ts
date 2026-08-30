import { describe, expect, it } from "vitest";

import { buildStyleBits, withOpacity } from "./ffmpeg/graph";
import { VIDEO_FILTERS, buildLookFilters, buildUpscaleFilter, getFilter } from "./filters";
import { SUBTITLE_PRESETS } from "./presets";

describe("filtres visuels", () => {
  it("expose un équivalent CSS pour chaque filtre FFmpeg", () => {
    for (const f of VIDEO_FILTERS) {
      expect(f.css, `filtre ${f.id}`).toBeTruthy();
      expect(f.name, `filtre ${f.id}`).toBeTruthy();
    }
  });

  it("le filtre « none » n'ajoute aucune chaîne FFmpeg", () => {
    expect(getFilter("none").ffmpeg).toBe("");
    expect(getFilter(undefined).ffmpeg).toBe("");
    expect(getFilter("inconnu").id).toBe("none");
  });

  it("n'utilise aucune virgule en fin de chaîne (graphe invalide)", () => {
    for (const f of VIDEO_FILTERS) {
      expect(f.ffmpeg.endsWith(","), `filtre ${f.id}`).toBe(false);
      expect(f.ffmpeg.startsWith(","), `filtre ${f.id}`).toBe(false);
    }
  });
});

describe("mise à l'échelle", () => {
  it("ne fait rien en mode « none »", () => {
    expect(buildUpscaleFilter("none", 1080, 1920)).toBe("");
  });

  it("ne dégrade jamais une vidéo déjà plus grande que la cible", () => {
    expect(buildUpscaleFilter("1440", 2160, 3840)).toBe("");
  });

  it("agrandit le plus grand côté en préservant le ratio", () => {
    // Portrait : la hauteur est le grand côté.
    expect(buildUpscaleFilter("2160", 1080, 1920)).toContain("scale=-2:2160");
    // Paysage : la largeur devient le grand côté.
    expect(buildUpscaleFilter("2160", 1920, 1080)).toContain("scale=2160:-2");
  });

  it("utilise -2 pour garantir une dimension paire (exigence de libx264)", () => {
    expect(buildUpscaleFilter("1440", 720, 1280)).toMatch(/-2/);
  });

  it("ne fait rien sans dimensions connues", () => {
    expect(buildUpscaleFilter("2160", 0, 0)).toBe("");
  });

  it("combine filtre et upscale par une virgule", () => {
    const look = buildLookFilters("vivid", "1440", 720, 1280);
    expect(look).toContain("eq=");
    expect(look).toContain("scale=");
    expect(look).not.toContain(",,");
  });
});

describe("opacité des sous-titres", () => {
  it("applique l'opacité demandée sans écraser la valeur", () => {
    expect(withOpacity("black", 0.5)).toBe("black@0.50");
    expect(withOpacity("black@0.9", 0.2)).toBe("black@0.20");
    expect(withOpacity("#FF0050@0.8", 1)).toBe("#FF0050@1.00");
  });

  it("borne l'opacité entre 0 et 1", () => {
    expect(withOpacity("black", -5)).toBe("black@0.00");
    expect(withOpacity("black", 42)).toBe("black@1.00");
  });

  it("respecte l'opacité du preset au lieu de forcer 0.95", () => {
    const discret = SUBTITLE_PRESETS.find((p) => p.id === "discret")!;
    const bits = buildStyleBits(discret);
    // Le preset discret ne doit pas produire de bandeau opaque.
    expect(bits).toContain("box=0");
    expect(bits).not.toContain("@0.95");
  });

  it("désactive la boîte quand l'opacité est nulle", () => {
    const base = SUBTITLE_PRESETS.find((p) => p.useBox)!;
    expect(buildStyleBits({ ...base, boxOpacity: 0 })).toContain("box=0");
  });

  it("conserve un fond visible quand l'opacité est élevée", () => {
    const base = SUBTITLE_PRESETS.find((p) => p.useBox)!;
    const bits = buildStyleBits({ ...base, boxOpacity: 0.7 });
    expect(bits).toContain("box=1");
    expect(bits).toContain("@0.70");
  });

  it("propose un preset discret en premier choix", () => {
    expect(SUBTITLE_PRESETS[0].id).toBe("discret");
    expect(SUBTITLE_PRESETS[0].useBox).toBe(false);
  });
});
