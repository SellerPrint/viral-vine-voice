import { describe, expect, it } from "vitest";

import {
  buildTicks,
  clamp,
  dragRange,
  findActive,
  formatClock,
  keptRanges,
  normalizeRanges,
  outputDuration,
  overlaps,
  pushApart,
  rangeAt,
  snapTime,
  sourceToTimeline,
  splitRange,
  subtractRange,
  timelineToSource,
  unionRanges,
  type Range,
} from "./edl";

const range = (start: number, end: number): Range => ({ start, end });

describe("normalizeRanges", () => {
  it("écarte les plages vides ou inversées", () => {
    // Tri par début ensuite : la piste de coupes doit rester lisible en ordre
    // chronologique quel que soit l'ordre dans lequel on les a ajoutées.
    expect(normalizeRanges([range(4, 2), range(1, 1), range(0, 0.5)])).toEqual([
      { start: 0, end: 0.5 },
      { start: 2, end: 4 },
    ]);
  });

  it("fusionne ce qui se touche", () => {
    expect(normalizeRanges([range(0, 1), range(1, 2), range(4, 5)])).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 5 },
    ]);
  });
});

describe("keptRanges", () => {
  it("sans coupe, conserve la source entière", () => {
    expect(keptRanges(10, [])).toEqual([{ start: 0, end: 10 }]);
  });

  it("retire les plages et recolle de part et d'autre", () => {
    expect(keptRanges(10, [range(2, 3), range(6, 7)])).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 6 },
      { start: 7, end: 10 },
    ]);
  });

  it("ignore une coupe qui mordreait hors du média", () => {
    // Une coupe « à 9 s » de deux secondes ne doit pas faire disparaître le
    // dernier segment conservé ni en créer un de longueur négative.
    expect(keptRanges(10, [range(9, 30)])).toEqual([{ start: 0, end: 9 }]);
  });

  it("jette les confettis trop courts pour être encodés", () => {
    expect(keptRanges(10, [range(0, 5), range(5.02, 10)])).toEqual([]);
  });
});

describe("projection source ↔ sortie", () => {
  const keeps = keptRanges(10, [range(2, 3), range(6, 7)]);

  it("reprojette un instant source sur la timeline montée", () => {
    expect(sourceToTimeline(1, keeps)).toBe(1);
    expect(sourceToTimeline(2.5, keeps)).toBe(2); // dans une coupe : bord du segment
    expect(sourceToTimeline(4, keeps)).toBe(3);
    expect(sourceToTimeline(9, keeps)).toBe(7);
  });

  it("revient à l'heure source sans perdre de temps", () => {
    for (const time of [0.5, 1.9, 3.1, 5.4, 7.2, 9.8]) {
      const forward = sourceToTimeline(time, keeps);
      expect(timelineToSource(forward, keeps)).toBeCloseTo(time, 2);
    }
  });

  it("reste dans le cadre aux bords", () => {
    expect(timelineToSource(0, keeps)).toBe(0);
    expect(timelineToSource(outputDuration(10, [range(2, 3), range(6, 7)]), keeps)).toBe(10);
  });

  it("la durée de sortie est la somme des segments conservés", () => {
    expect(outputDuration(10, [range(2, 3), range(6, 7)])).toBe(8);
  });
});

describe("snapTime", () => {
  it("aimante sous le seuil et seulement sous le seuil", () => {
    expect(snapTime(1.02, [1, 5], 0.05)).toEqual({ time: 1, target: 1 });
    expect(snapTime(1.2, [1, 5], 0.05)).toEqual({ time: 1.2, target: null });
  });

  it("choisit la cible la plus proche", () => {
    expect(snapTime(2.6, [2, 3], 0.5).target).toBe(3);
  });

  it("désactivé par tolérance nulle", () => {
    expect(snapTime(1.001, [1], 0)).toEqual({ time: 1.001, target: null });
  });
});

describe("dragRange", () => {
  it("déplace en gardant la durée et bute en début de média", () => {
    const result = dragRange(range(1, 3), -5, "move", { min: 0, max: 10 });
    expect(result).toEqual({ start: 0, end: 2, constrainedBy: "début" });
  });

  it("bute en fin de média", () => {
    expect(dragRange(range(8, 10), 5, "move", { min: 0, max: 10 }).constrainedBy).toBe("fin");
  });

  it("le trim gauche garde la fin fixe", () => {
    expect(dragRange(range(2, 4), 0.5, "trim-left", { min: 0, max: 10 })).toEqual({
      start: 2.5,
      end: 4,
      constrainedBy: null,
    });
  });

  it("un trim ne peut pas inverser un clip", () => {
    // Tirer la poignée droite au-delà du début laisserait une durée négative,
    // donc un clip invisible et impossible à rattraper à la souris.
    const result = dragRange(range(2, 4), -10, "trim-right", { min: 0, max: 10 });
    expect(result.end - result.start).toBeGreaterThanOrEqual(0.08);
  });
});

describe("splitRange", () => {
  it("partage en deux à l'instant demandé", () => {
    expect(splitRange(range(0, 4), 1.5)).toEqual([
      { start: 0, end: 1.5 },
      { start: 1.5, end: 4 },
    ]);
  });

  it("refuse un fragment trop court plutôt que de créer un clip fantôme", () => {
    expect(splitRange(range(0, 4), 0.05)).toBeNull();
    expect(splitRange(range(0, 4), 4)).toBeNull();
  });
});

describe("pushApart", () => {
  const clips = [
    { id: "a", start: 0, duration: 2 },
    { id: "b", start: 3, duration: 2 },
    { id: "c", start: 6, duration: 2 },
  ];

  it("pousse les suivants quand un bloc atterrit sur eux", () => {
    const moved = [{ ...clips[0], start: 2.5 }, clips[1], clips[2]];
    const result = pushApart(moved, "a");
    expect(result.find((c) => c.id === "a")?.start).toBe(2.5);
    expect(result.find((c) => c.id === "b")?.start).toBeCloseTo(4.52, 2);
    expect(result.find((c) => c.id === "c")?.start).toBeCloseTo(6.54, 2);
  });

  it("ne touche à rien sans chevauchement", () => {
    expect(pushApart(clips, "a")).toBe(clips);
  });
});

describe("buildTicks", () => {
  it("choisit un pas « rond » selon le zoom", () => {
    const zoomedIn = buildTicks(20, 400); // 90 px / 400 px·s⁻¹ ≈ 0,22 s → pas 0,25 s
    const step = zoomedIn[1].time - zoomedIn[0].time;
    expect([0.05, 0.1, 0.2, 0.25, 0.5]).toContain(Number(step.toFixed(3)));

    const zoomedOut = buildTicks(600, 2); // 45 s par graduation → pas 50 s
    const majors = zoomedOut.filter((tick) => tick.major).map((tick) => tick.time);
    expect(majors).toEqual([0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600]);
    expect(zoomedOut.find((tick) => tick.time === 30)?.label).toBeUndefined();
  });

  it("ne plante pas sur un média vide", () => {
    expect(buildTicks(0, 40)).toEqual([]);
    expect(buildTicks(10, 0)).toEqual([]);
  });

  it("termine par une graduation quand la durée tombe juste", () => {
    const ticks = buildTicks(2, 100);
    expect(ticks[ticks.length - 1].time).toBe(2);
  });
});

describe("lecture d'échelle", () => {
  it("formate en minutes:secondes.centèmes", () => {
    expect(formatClock(0)).toBe("0:00.00");
    expect(formatClock(7.4)).toBe("0:07.40");
    expect(formatClock(75.5)).toBe("1:15.50");
  });

  it("désigne le bloc visible", () => {
    const clips = [
      { start: 0, duration: 2 },
      { start: 3, duration: 1 },
    ];
    expect(findActive(clips, 3.5)?.duration).toBe(1);
    expect(findActive(clips, 2.5)).toBeNull();
    expect(rangeAt(2.5, [range(0, 2), range(3, 4)])).toBeNull();
  });
});

describe("unionRanges / subtractRange", () => {
  it("ajouter une coupe la fusionne avec la voisine", () => {
    expect(unionRanges([range(0, 1)], range(1, 2))).toEqual([{ start: 0, end: 2 }]);
  });

  it("retirer une partie d'une coupe la scinde en deux", () => {
    expect(subtractRange([range(0, 10)], range(4, 6))).toEqual([
      { start: 0, end: 4 },
      { start: 6, end: 10 },
    ]);
  });

  it("deux plages qui se touchent à peine se chevauchent", () => {
    expect(overlaps(range(0, 2), range(2, 4))).toBe(false);
    expect(overlaps(range(0, 2.01), range(2, 4))).toBe(true);
  });
});

describe("clamp", () => {
  it("bornes incluses", () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
  });
});
