import { describe, expect, it } from "vitest";

import { generateCSSOnlyComposition, HYPERFRAMES_PRESETS } from "./composition";
import { getAvailablePresets, getPresetById } from "./renderer";
import type { Cue } from "../subtitles/cues";

/**
 * Ce que l'aperçu du monteur affiche, et rien de plus : une composition HTML/CSS
 * autonome, sans script, qui porte le texte des repères.
 */

const cues: Cue[] = [
  { start: 0.4, end: 2.2, text: "tu veux doubler tes vidéos" },
  { start: 3, end: 5.2, text: "sans quitter <ton> navigateur" },
];

describe("presets HyperFrames", () => {
  it("offre plusieurs entrées, aux identifiants distincts", () => {
    expect(HYPERFRAMES_PRESETS.length).toBeGreaterThan(1);
    expect(getAvailablePresets()).toHaveLength(HYPERFRAMES_PRESETS.length);
    const ids = HYPERFRAMES_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getPresetById(ids[0])?.id).toBe(ids[0]);
    expect(getPresetById("inexistant")).toBeUndefined();
  });
});

describe("generateCSSOnlyComposition", () => {
  it("écrit chaque repère, dans l'ordre, avec son texte", () => {
    const preset = HYPERFRAMES_PRESETS[0];
    const html = generateCSSOnlyComposition(cues, preset, { width: 1080, height: 1920 });
    expect(html).toContain("doubler");
    expect(html).toContain("@keyframes");
    // Le texte passe échappé : `<ton>` doit rester du texte, pas une balise.
    expect(html).not.toContain("<ton>");
    expect(html).toContain("&lt;ton&gt;");
  });

  it("ne charge rien de l'extérieur : ni script, ni police, ni CDN", () => {
    // La scène affiche cette page dans un cadre `sandbox=""`, sous une CSP qui
    // n'autorise rien hors du périmètre. Un lien de police ou un <script> externe
    // ne serait pas un détail : ce serait un aperçu amputé, et une ouverture
    // que personne n'a demandée.
    const html = generateCSSOnlyComposition(cues, HYPERFRAMES_PRESETS[0], {});
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html.toLowerCase()).not.toContain("cdn.");
    expect(html.toLowerCase()).not.toContain("https://");
  });

  it("donne à chaque repère sa propre fenêtre de lecture, sur la durée du cycle", () => {
    const html = generateCSSOnlyComposition(cues, HYPERFRAMES_PRESETS[0], {});
    const partitions = html.match(/@keyframes cue-\d+ \{[\s\S]*?\n {4}\}/g) ?? [];
    expect(partitions).toHaveLength(cues.length);
    // 0,4 s sur un cycle de 5,2 s = 7,69 % d'attente avant la première ligne.
    expect(partitions[0]).toContain("7.69%");
    expect(partitions[1]).toContain("57.69%");
  });

  it("borne la durée à la fin du dernier repère", () => {
    const html = generateCSSOnlyComposition(cues, HYPERFRAMES_PRESETS[0], {});
    expect(html).toContain("5.2");
  });

  it("ne lève pas le nez sur une liste vide", () => {
    const html = generateCSSOnlyComposition([], HYPERFRAMES_PRESETS[0], {});
    expect(typeof html).toBe("string");
    expect(html).not.toContain("NaN");
  });
});
