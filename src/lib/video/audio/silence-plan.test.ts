import { describe, expect, it } from "vitest";

import { planSilenceCuts } from "./silence-plan";

/**
 * Régression : la coupe des silences ne se déclenchait jamais.
 *
 * Un silence détecté commence à l'instant exact où la parole s'arrête. Le
 * filtre d'origine testait `seg.start - 0.1 < s.end && seg.end + 0.1 > s.start`
 * et déclarait donc un chevauchement pour chaque silence, quelle que soit sa
 * durée.
 */
describe("planSilenceCuts", () => {
  const speech = [
    { start: 0.2, end: 2.2 },
    { start: 3.5, end: 6.0 },
    { start: 7.8, end: 9.5 },
    { start: 10.5, end: 11.8 },
  ];
  const silences = [
    { start: 2.2, end: 3.4 },
    { start: 6.0, end: 7.6 },
    { start: 9.5, end: 10.4 },
  ];

  it("coupe les silences adjacents à la parole", () => {
    const cuts = planSilenceCuts(silences, speech);
    expect(cuts.length).toBeGreaterThan(0);
  });

  it("ne recouvre jamais la parole élargie de sa marge", () => {
    for (const cut of planSilenceCuts(silences, speech)) {
      for (const span of speech) {
        const blockedStart = span.start - 0.1;
        const blockedEnd = span.end + 0.1;
        const overlaps = cut.start < blockedEnd - 1e-9 && cut.end > blockedStart + 1e-9;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("rogne le silence au lieu de l'écarter", () => {
    // 2.2→3.4 borde la parole des deux côtés : il reste 2.3→3.4
    const [first] = planSilenceCuts([silences[0]], speech);
    expect(first.start).toBeCloseTo(2.3, 5);
    expect(first.end).toBeCloseTo(3.4, 5);
  });

  it("écarte un silence entièrement couvert par la marge", () => {
    const tiny = [{ start: 2.2, end: 2.35 }];
    expect(planSilenceCuts(tiny, speech)).toEqual([]);
  });

  it("respecte la durée minimale de coupe", () => {
    for (const cut of planSilenceCuts(silences, speech, { minCut: 0.25 })) {
      expect(cut.end - cut.start).toBeGreaterThanOrEqual(0.25);
    }
  });

  it("découpe un silence traversé par de la parole", () => {
    const cuts = planSilenceCuts([{ start: 0, end: 10 }], [{ start: 4, end: 5 }]);
    expect(cuts).toHaveLength(2);
    expect(cuts[0].end).toBeCloseTo(3.9, 5);
    expect(cuts[1].start).toBeCloseTo(5.1, 5);
  });

  it("retourne une liste vide sans silence", () => {
    expect(planSilenceCuts([], speech)).toEqual([]);
  });

  it("coupe tout quand il n'y a aucune parole", () => {
    const cuts = planSilenceCuts([{ start: 0, end: 5 }], []);
    expect(cuts).toEqual([{ start: 0, end: 5 }]);
  });

  it("plafonne le nombre de coupes", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ start: i * 2, end: i * 2 + 1 }));
    expect(planSilenceCuts(many, [], { maxCuts: 40 })).toHaveLength(40);
  });

  it("priorise les silences les plus longs", () => {
    const mixed = [
      { start: 0, end: 0.5 },
      { start: 2, end: 8 },
      { start: 10, end: 10.6 },
    ];
    const cuts = planSilenceCuts(mixed, [], { maxCuts: 1 });
    expect(cuts[0]).toEqual({ start: 2, end: 8 });
  });

  it("retourne les coupes en ordre chronologique", () => {
    const cuts = planSilenceCuts(silences, speech);
    for (let i = 1; i < cuts.length; i++) {
      expect(cuts[i].start).toBeGreaterThanOrEqual(cuts[i - 1].end);
    }
  });
});
