import { describe, expect, it } from "vitest";

import { planAttempts, RENDER_ATTEMPTS } from "./render";
import type { GraphInputs } from "./graph";
import { SUBTITLE_PRESETS } from "../presets";

/**
 * Le ladder de repli, testé sans WebAssembly.
 *
 * Ces tentatives décident de ce qui est *perdu* quand un graphe est refusé.
 * Deux bugs vécus s'y logent : une option absente du projet traitée comme une
 * dégradation à lâcher (et le rendu repartait sur une variante amputée des
 * masques et du filtre), et des doublons qui faisaient encoder deux fois le même
 * graphe.
 */

const base: GraphInputs = {
  cues: [{ text: "bonjour", start: 0, end: 2 }],
  subtitleFiles: ["subtitle_0.txt"],
  preset: SUBTITLE_PRESETS[0],
  coverMask: undefined,
  subYAnchor: 0.8,
  activeMasks: [],
  keeps: [],
  hasAudio: true,
  hasVoice: false,
  mirror: false,
  remap: (t) => t,
};

describe("planAttempts", () => {
  it("conserve masques et filtre quand aucune voix off n'est mélangée", () => {
    const attempts = planAttempts({
      ...base,
      activeMasks: [{ x: 0, y: 100, w: 200, h: 60 }],
      filterId: "vivid",
    });
    const first = attempts[0];
    expect(first).toMatchObject({ masks: true, text: true, voice: false, cuts: false, look: true });
    expect(first.note).toBe("complet");
  });

  it("ne propose pas une variante sans voix quand il n'y a pas de voix", () => {
    const attempts = planAttempts(base);
    // « sans voix off » et « coupes prioritaires » ne veulent rien dire sans
    // piste de doublage : ils se confondent avec les variantes voisines.
    expect(attempts.filter((a) => a.voice).length).toBe(0);
    expect(attempts.length).toBeLessThan(RENDER_ATTEMPTS.length);
  });

  it("déduplique les tentatives équivalentes", () => {
    const keys = planAttempts(base).map(
      (a) => `${a.masks}|${a.text}|${a.voice}|${a.cuts}|${a.look}|${a.transitions}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("garde la variante minimale en dernier recours", () => {
    const attempts = planAttempts(base);
    const last = attempts[attempts.length - 1];
    // Deux entrées suffisent ici : le projet sans masque, sans coupe, sans
    // filtre et sans voix ne présente qu'un seul graphe utile, plus le repli
    // « texte abandonné » si le premier est refusé.
    expect(attempts).toHaveLength(2);
    expect(attempts[0].text).toBe(true);
    expect(last).toMatchObject({ text: false, cuts: false, look: false, masks: false });
  });

  it("propose une variante par segment quand les coupes existent", () => {
    const attempts = planAttempts({
      ...base,
      keeps: [
        { start: 0, end: 3 },
        { start: 4, end: 7 },
      ],
      transition: "fade",
      transitionDuration: 0.3,
    });
    expect(attempts[0].transitions).toBe(true);
    expect(attempts.some((a) => a.transitions === false)).toBe(true);
    expect(attempts.some((a) => a.cuts)).toBe(true);
  });
});
