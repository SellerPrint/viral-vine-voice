import { describe, expect, it } from "vitest";

import { remapTime } from "./audio/wav";
import {
  buildAcrossfadeChain,
  buildXfadeChain,
  effectiveTransitionDuration,
  remapTimeWithTransitions,
  totalDuration,
  transitionDurations,
} from "./transitions";

const KEEPS = [
  { start: 0, end: 3 },
  { start: 5, end: 9 },
  { start: 12, end: 15 },
];

describe("durée effective des transitions", () => {
  it("est nulle si aucune transition n'est demandée", () => {
    expect(effectiveTransitionDuration(0, KEEPS[0], KEEPS[1])).toBe(0);
  });

  it("bride la durée à un tiers du segment le plus court", () => {
    const court = { start: 0, end: 0.6 };
    // 0.6 / 3 = 0.2, donc 0.5 demandé doit être ramené à 0.2.
    expect(effectiveTransitionDuration(0.5, court, KEEPS[1])).toBeCloseTo(0.2, 3);
  });

  it("renonce plutôt que de produire un fondu imperceptible", () => {
    const minuscule = { start: 0, end: 0.15 };
    expect(effectiveTransitionDuration(0.3, minuscule, KEEPS[1])).toBe(0);
  });

  it("n'applique jamais de transition avant le premier segment", () => {
    expect(transitionDurations(KEEPS, 0.3)[0]).toBe(0);
  });
});

describe("remappage temporel avec transitions", () => {
  it("reste identique à remapTime quand il n'y a aucune transition", () => {
    const zero = transitionDurations(KEEPS, 0);
    for (const t of [0, 1.5, 3, 4, 5, 7, 9, 12, 14, 15]) {
      expect(remapTimeWithTransitions(t, KEEPS, zero)).toBeCloseTo(remapTime(t, KEEPS), 9);
    }
  });

  it("compense le recouvrement introduit par chaque fondu", () => {
    const d = transitionDurations(KEEPS, 0.3);
    // Sans compensation, la fin resterait à 10 s alors que la vidéo dure 9,4 s.
    expect(remapTime(15, KEEPS)).toBeCloseTo(10, 3);
    expect(remapTimeWithTransitions(15, KEEPS, d)).toBeCloseTo(9.4, 3);
  });

  it("reste cohérent avec la durée finale réelle", () => {
    const d = transitionDurations(KEEPS, 0.3);
    expect(remapTimeWithTransitions(15, KEEPS, d)).toBeCloseTo(totalDuration(KEEPS, d), 6);
  });

  it("ne renvoie jamais de temps négatif", () => {
    const d = transitionDurations(KEEPS, 0.9);
    for (const t of [0, 0.01, 1, 5, 12]) {
      expect(remapTimeWithTransitions(t, KEEPS, d)).toBeGreaterThanOrEqual(0);
    }
  });

  it("la dérive s'accumulerait sans compensation sur de nombreuses coupes", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ start: i * 4, end: i * 4 + 3 }));
    const d = transitionDurations(many, 0.3);
    const naive = remapTime(many[11].end, many);
    const exact = remapTimeWithTransitions(many[11].end, many, d);
    // 11 transitions x 0,3 s = 3,3 s de dérive évitée.
    expect(naive - exact).toBeCloseTo(3.3, 2);
  });
});

describe("chaînes de filtres", () => {
  it("produit une chaîne xfade avec des offsets croissants", () => {
    const d = transitionDurations(KEEPS, 0.3);
    const chain = buildXfadeChain(["tv0", "tv1", "tv2"], KEEPS, d, "fade", "vcut");
    expect(chain).toContain("xfade=transition=fade");
    expect(chain).toContain("[vcut]");
    const offsets = [...chain.matchAll(/offset=([\d.]+)/g)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(2);
    expect(offsets[1]).toBeGreaterThan(offsets[0]);
  });

  it("normalise la cadence avant chaque xfade", () => {
    // Sans `fps=`, FFmpeg refuse le graphe : « The inputs needs to be a
    // constant frame rate ». Verifie sur un rendu reel avec ffmpeg 7.0.2.
    const d = transitionDurations(KEEPS, 0.3);
    const chain = buildXfadeChain(["tv0", "tv1", "tv2"], KEEPS, d, "fade", "vcut");
    expect(chain).toContain("fps=");
    // Chaque segment doit etre normalise, pas seulement le premier.
    expect([...chain.matchAll(/fps=/g)]).toHaveLength(3);
    // Et le xfade doit consommer les labels normalises, pas les bruts.
    expect(chain).toContain("[xn0]");
    expect(chain).not.toMatch(/\[tv1\]xfade/);
  });

  it("ne produit rien pour une transition « none »", () => {
    expect(buildXfadeChain(["a", "b"], KEEPS, [0, 0.3], "none", "vcut")).toBe("");
  });

  it("utilise les mêmes durées côté audio que côté vidéo", () => {
    const d = transitionDurations(KEEPS, 0.3);
    const audio = buildAcrossfadeChain(["ta0", "ta1", "ta2"], d, "acut");
    const video = buildXfadeChain(["tv0", "tv1", "tv2"], KEEPS, d, "fade", "vcut");
    const aDur = [...audio.matchAll(/acrossfade=d=([\d.]+)/g)].map((m) => Number(m[1]));
    const vDur = [...video.matchAll(/duration=([\d.]+)/g)].map((m) => Number(m[1]));
    expect(aDur).toEqual(vDur);
  });
});
