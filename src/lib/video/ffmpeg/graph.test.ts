import { describe, expect, it } from "vitest";

import { buildGraph, resolveMasks, type GraphInputs } from "./graph";
import { SUBTITLE_PRESETS, type MaskZone } from "../presets";

const baseInputs = (overrides: Partial<GraphInputs> = {}): GraphInputs => ({
  cues: [{ text: "hello", start: 0, end: 1 }],
  subtitleFiles: ["subtitle_0.txt"],
  preset: SUBTITLE_PRESETS[0],
  coverMask: undefined,
  subYAnchor: 0.78,
  activeMasks: [],
  keeps: [],
  hasAudio: false,
  hasVoice: false,
  mirror: false,
  remap: (t) => t,
  ...overrides,
});

const allOn = { masks: true, text: true, voice: true, cuts: true };

describe("resolveMasks", () => {
  const mask = (over: Partial<MaskZone> = {}): MaskZone => ({
    id: "bottom",
    label: "bas",
    x: 0,
    y: 0.8,
    w: 1,
    h: 0.15,
    enabled: true,
    ...over,
  });

  it("retourne une liste vide sans dimensions connues", () => {
    expect(resolveMasks([mask()], 0, 0)).toEqual([]);
  });

  it("ignore les masques désactivés", () => {
    expect(resolveMasks([mask({ enabled: false })], 1080, 1920)).toEqual([]);
  });

  it("convertit les coordonnées normalisées en pixels", () => {
    const [rect] = resolveMasks([mask({ x: 0, y: 0.5, w: 1, h: 0.5 })], 1080, 1920);
    expect(rect).toEqual({ x: 0, y: 960, w: 1080, h: 960 });
  });

  it("produit uniquement des dimensions paires", () => {
    const rects = resolveMasks([mask({ x: 0.111, y: 0.333, w: 0.517, h: 0.239 })], 1081, 1921);
    for (const rect of rects) {
      expect(rect.x % 2).toBe(0);
      expect(rect.y % 2).toBe(0);
      expect(rect.w % 2).toBe(0);
      expect(rect.h % 2).toBe(0);
    }
  });

  it("garde les rectangles dans le cadre", () => {
    // Un rectangle hors bornes fait échouer tout le graphe de filtres.
    const rects = resolveMasks([mask({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 })], 1080, 1920);
    for (const rect of rects) {
      expect(rect.x + rect.w).toBeLessThanOrEqual(1080);
      expect(rect.y + rect.h).toBeLessThanOrEqual(1920);
    }
  });

  it("plafonne à quatre masques", () => {
    const many = Array.from({ length: 8 }, (_, i) => mask({ id: `m${i}`, y: i * 0.1, h: 0.05 }));
    expect(resolveMasks(many, 1080, 1920).length).toBeLessThanOrEqual(4);
  });
});

describe("buildGraph", () => {
  it("expose toujours une sortie vidéo étiquetée", () => {
    expect(buildGraph(baseInputs(), allOn)).toContain("[vout]");
  });

  it("n'expose pas de sortie audio sans piste ni voix", () => {
    expect(buildGraph(baseInputs(), allOn)).not.toContain("[aout]");
  });

  it("ajoute le miroir avant tout le reste", () => {
    const graph = buildGraph(baseInputs({ mirror: true }), allOn);
    expect(graph.startsWith("[0:v]hflip[vflip];")).toBe(true);
  });

  it("mixe la voix off avec l'audio d'origine atténué", () => {
    const graph = buildGraph(baseInputs({ hasAudio: true, hasVoice: true }), allOn);
    expect(graph).toContain("amix=inputs=2");
    expect(graph).toContain("volume=0.15");
    expect(graph).toContain("[aout]");
  });

  it("utilise la voix seule quand l'audio d'origine est retiré", () => {
    const graph = buildGraph(baseInputs({ hasAudio: false, hasVoice: true }), allOn);
    expect(graph).toContain("volume=1.4");
    expect(graph).not.toContain("amix");
  });

  it("génère trim et concat pour les coupes", () => {
    const keeps = [
      { start: 0, end: 4 },
      { start: 6, end: 10 },
    ];
    const graph = buildGraph(baseInputs({ keeps }), allOn);
    expect(graph).toContain("trim=start=0.000:end=4.000");
    expect(graph).toContain("concat=n=2:v=1:a=0");
  });

  it("n'applique pas les coupes avec un seul intervalle conservé", () => {
    const graph = buildGraph(baseInputs({ keeps: [{ start: 0, end: 10 }] }), allOn);
    expect(graph).not.toContain("concat");
  });

  it("remappe les timings des sous-titres quand les coupes sont actives", () => {
    const keeps = [
      { start: 0, end: 4 },
      { start: 6, end: 10 },
    ];
    const graph = buildGraph(
      baseInputs({
        keeps,
        cues: [{ text: "hi", start: 7, end: 8 }],
        remap: (t) => (t >= 6 ? t - 2 : t),
      }),
      allOn,
    );
    expect(graph).toContain("between(t\\,5.000\\,6.000)");
  });

  it("chaîne les superpositions de flou par masque", () => {
    const activeMasks = [
      { x: 0, y: 100, w: 200, h: 50 },
      { x: 300, y: 400, w: 100, h: 60 },
    ];
    const graph = buildGraph(baseInputs({ activeMasks }), allOn);
    expect(graph).toContain("boxblur");
    expect(graph).toContain("[masked]");
    expect((graph.match(/overlay=/g) ?? []).length).toBe(2);
  });

  it("bascule sur un passe-plat quand le texte est désactivé", () => {
    const graph = buildGraph(baseInputs(), { ...allOn, text: false });
    expect(graph).toContain("null[vout]");
    expect(graph).not.toContain("drawtext");
  });

  it("référence le texte par fichier et jamais en ligne", () => {
    // Apostrophes et deux-points interpolés casseraient le graphe.
    const graph = buildGraph(
      baseInputs({ cues: [{ text: "it's 3:30, right?", start: 0, end: 1 }] }),
      allOn,
    );
    expect(graph).toContain("textfile=subtitle_0.txt");
    expect(graph).not.toContain("it's");
  });

  it("échappe les virgules des expressions enable", () => {
    const graph = buildGraph(baseInputs(), allOn);
    expect(graph).toContain("enable=between(t\\,");
  });

  it("reste déterministe pour des entrées identiques", () => {
    const inputs = baseInputs({ hasVoice: true, hasAudio: true });
    expect(buildGraph(inputs, allOn)).toBe(buildGraph(inputs, allOn));
  });
});
