import { describe, expect, it } from "vitest";

import { MAX_CUES, type Cue } from "@/lib/video/subtitles/cues";

import { activeCue, clipsToCues } from "./cues";
import type { Clip } from "./types";

const sub = (start: number, end: number, text: string, id = `s${start}`): Clip => ({
  id,
  track: "subs",
  start,
  duration: end - start,
  text,
  label: text,
});

describe("clipsToCues", () => {
  it("ignore les blocs vides et les pistes autres que sous-titres", () => {
    const clips: Clip[] = [
      sub(0, 2, "  "),
      { ...sub(2, 4, "coupe"), track: "cuts" },
      sub(4, 6, "ok"),
    ];
    expect(clipsToCues(clips)).toEqual([{ text: "ok", start: 4, end: 6 }]);
  });

  it("tronque un bloc qui déborderait du média", () => {
    expect(clipsToCues([sub(9, 14, "fin")], { duration: 12 })).toEqual([
      { text: "fin", start: 9, end: 12 },
    ]);
  });

  it("coupe un bloc au début du suivant : jamais deux phrases ensemble", () => {
    const cues = clipsToCues([sub(0, 3, "première"), sub(2, 5, "seconde")]);
    expect(cues[0].end).toBeLessThan(2);
    expect(cues[1].start).toBe(2);
  });

  it("en mode mot par mot, un cue par mot, à l'intérieur du bloc", () => {
    const cues = clipsToCues([sub(1, 3, "trois mots ici")], { wordByWord: true });
    expect(cues.map((c) => c.text)).toEqual(["trois", "mots", "ici"]);
    expect(cues[0].start).toBe(1);
    expect(cues[cues.length - 1].end).toBe(3);
    cues.reduce((previous: Cue | null, cue) => {
      if (previous) expect(cue.start).toBeGreaterThanOrEqual(previous.end - 0.001);
      return cue;
    }, null);
  });

  it("répartit la durée au poids des mots", () => {
    const cues = clipsToCues([sub(0, 4, "a trèslongmot")], { wordByWord: true });
    expect(cues[1].end - cues[1].start).toBeGreaterThan(cues[0].end - cues[0].start);
  });

  it("retombe sur les phrases quand le mot à mot explosait la limite", () => {
    const words = Array.from({ length: 40 }, (_, i) => `mot${i}`).join(" ");
    const clips = Array.from({ length: 12 }, (_, i) => sub(i * 2, i * 2 + 2, words));
    const cues = clipsToCues(clips, { wordByWord: true });
    expect(cues.length).toBeLessThanOrEqual(MAX_CUES);
    // 12 phrases × 40 mots = 480 cues : au-dessus de la borne, le graphe de
    // filtres deviendrait ingérable, on incruste donc les phrases entières.
    expect(cues.length).toBe(12);
    expect(cues[0].text.split(" ")).toHaveLength(40);
  });
});

describe("activeCue", () => {
  const cues = [
    { text: "un", start: 0, end: 2 },
    { text: "deux", start: 3, end: 5 },
  ];

  it("trouve le cue visible", () => {
    expect(activeCue(cues, 1)?.text).toBe("un");
    expect(activeCue(cues, 2)?.text).toBe("un");
    expect(activeCue(cues, 2.5)).toBeNull();
  });
});
