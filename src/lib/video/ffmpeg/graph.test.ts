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

  it("incruste les sous-titres APRES le miroir, pour qu'ils restent lisibles", () => {
    // `hflip` retourne l'image entiere. Si `drawtext` s'appliquait avant, nos
    // propres sous-titres sortiraient ecrits a l'envers. Seul le texte deja
    // incruste dans la video source est retourne, ce qui est inevitable.
    const graph = buildGraph(baseInputs({ mirror: true }), allOn);
    expect(graph.indexOf("hflip")).toBeLessThan(graph.indexOf("drawtext"));
  });

  it("mixe la voix off avec l'ambiance d'origine", () => {
    const graph = buildGraph(baseInputs({ hasAudio: true, hasVoice: true }), allOn);
    expect(graph).toContain("amix=inputs=2");
    // Defaut a 0.25 : l'ancien 0.15 rendait le fond inaudible sur telephone.
    expect(graph).toContain("volume=0.25");
    expect(graph).toContain("[aout]");
  });

  it("applique le ducking : l'ambiance baisse quand la voix parle", () => {
    // Sans `sidechaincompress`, il fallait choisir entre un fond audible et
    // une voix intelligible. La chaine laterale resout le conflit.
    const graph = buildGraph(baseInputs({ hasAudio: true, hasVoice: true }), allOn);
    expect(graph).toContain("sidechaincompress");
    // La voix est dupliquee : une copie pour le mixage, une comme declencheur.
    expect(graph).toContain("asplit=2[voicemix][voicekey]");
  });

  it("respecte le niveau d'ambiance demande", () => {
    const graph = buildGraph(
      baseInputs({ hasAudio: true, hasVoice: true, ambienceLevel: 0.6 }),
      allOn,
    );
    expect(graph).toContain("volume=0.60");
  });

  it("borne un niveau d'ambiance aberrant plutot que de saturer", () => {
    const trop = buildGraph(
      baseInputs({ hasAudio: true, hasVoice: true, ambienceLevel: 9 }),
      allOn,
    );
    expect(trop).toContain("volume=1.00");

    const negatif = buildGraph(
      baseInputs({ hasAudio: true, hasVoice: true, ambienceLevel: -3 }),
      allOn,
    );
    expect(negatif).toContain("volume=0.00");
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

describe("masquage du sous-titre d'origine (régressions)", () => {
  const cover: MaskZone = {
    id: "bottom",
    label: "bas",
    x: 0,
    y: 0.8,
    w: 1,
    h: 0.15,
    enabled: true,
  };

  it("dessine la plaque de recouvrement même quand le preset a useBox=false", () => {
    const preset = { ...SUBTITLE_PRESETS[0], useBox: false };
    const graph = buildGraph(baseInputs({ preset, coverMask: cover }), allOn);
    expect(graph).toContain("drawbox=");
  });

  it("exprime la plaque en `ih` et jamais en `h` (auto-référence drawbox)", () => {
    const graph = buildGraph(baseInputs({ coverMask: cover }), allOn);
    const box = graph.match(/drawbox=[^,;]*(?:\\,[^,;]*)*/g) ?? [];
    expect(box.length).toBeGreaterThan(0);
    for (const filter of box) {
      expect(filter).not.toMatch(/[:=]h\*/);
      expect(filter).toMatch(/y=ih\*/);
    }
  });

  it("floute la zone masquée sans l'aplatir par défaut", () => {
    // Le comportement precedent — `boxblur=40:3` suivi d'une plaque noire a
    // 55 % — transformait la zone en dalle uniforme et detruisait l'image.
    // Le defaut « medium » rend le texte illisible en gardant la scene
    // reconnaissable ; l'assombrissement est reserve a « strong ».
    const graph = buildGraph(
      baseInputs({ activeMasks: [{ x: 0, y: 1574, w: 1080, h: 268 }] }),
      allOn,
    );

    expect(graph).toContain("boxblur=");
    expect(graph).not.toContain("black@0.55");
    expect(graph).not.toMatch(/boxblur=[^[]*drawbox/);
  });

  it("assombrit la zone uniquement en intensité forte", () => {
    const graph = buildGraph(
      baseInputs({ activeMasks: [{ x: 0, y: 1574, w: 1080, h: 268 }], maskStrength: "strong" }),
      allOn,
    );
    expect(graph).toMatch(/boxblur=[^[]*drawbox=[^[]*t=fill/);
  });
});

describe("durée de la piste de voix off", () => {
  const base = {
    cues: [],
    subtitleFiles: [],
    preset: SUBTITLE_PRESETS[0],
    coverMask: undefined,
    subYAnchor: 0.8,
    activeMasks: [],
    keeps: [{ start: 0, end: 10 }],
    mirror: false,
    remap: (t: number) => t,
  };
  const toggles = { masks: false, text: false, voice: true, cuts: false };

  it("ne tronque plus la voix off quand elle dépasse l'audio d'origine", () => {
    // `duration=first` calait le mixage sur l'audio source : une voix off plus
    // longue (traduction plus verbeuse) voyait sa fin supprimée.
    const graph = buildGraph({ ...base, hasAudio: true, hasVoice: true } as never, toggles);
    expect(graph).toContain("amix=inputs=2:duration=longest");
    expect(graph).not.toContain("duration=first");
  });

  it("produit bien une piste de sortie quand l'audio d'origine est supprimé", () => {
    // Cas par défaut de l'application : removeOriginalAudio = true.
    const graph = buildGraph({ ...base, hasAudio: false, hasVoice: true } as never, toggles);
    expect(graph).toContain("[aout]");
  });
});

describe("échappement du texte des sous-titres", () => {
  it("désactive l'expansion, sinon un « % » efface le sous-titre", () => {
    // `drawtext` traite `%` comme le début d'une séquence strftime. Sans
    // `expansion=none`, « Déjà 100 % » ne s'affichait pas du tout — panne
    // silencieuse, fréquente sur des vidéos promotionnelles.
    const graph = buildGraph(baseInputs({}), allOn);
    expect(graph).toContain("expansion=none");
  });

  it("place expansion=none avant le style, donc avant tout texte", () => {
    const graph = buildGraph(baseInputs({}), allOn);
    const drawtext = graph.slice(graph.indexOf("drawtext="));
    expect(drawtext.indexOf("expansion=none")).toBeLessThan(drawtext.indexOf("fontsize"));
  });
});
