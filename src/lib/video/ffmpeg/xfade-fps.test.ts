import { describe, expect, it } from "vitest";

import { buildXfadeChain } from "../transitions";

const keeps = [
  { start: 0, end: 3 },
  { start: 3.5, end: 6 },
];

describe("buildXfadeChain — cadence", () => {
  it("normalise chaque entrée : xfade refuse une cadence variable", () => {
    const chain = buildXfadeChain(["tv0", "tv1"], keeps, [0.3, 0], "fade", "vcut", 30);
    // Sans `fps=`, ffmpeg échoue : « The inputs needs to be a constant frame
    // rate; current rate of 1/0 is invalid » — reproduit sur ffmpeg 7.0.2.
    expect(chain).toContain("fps=30");
    expect(chain).toContain("setsar=1");
    expect((chain.match(/fps=30/g) ?? []).length).toBe(2);
  });

  it("respecte la cadence de la source au lieu d'imposer 30", () => {
    const chain = buildXfadeChain(["tv0", "tv1"], keeps, [0.3, 0], "fade", "vcut", 60);
    // Régression visée : une source 60 fps était ramenée à 30, divisant la
    // fluidité par deux sans que rien ne le signale.
    expect(chain).toContain("fps=60");
    expect(chain).not.toContain("fps=30");
  });

  it("retombe sur 30 quand la cadence n'est pas fournie", () => {
    const chain = buildXfadeChain(["tv0", "tv1"], keeps, [0.3, 0], "fade", "vcut");
    expect(chain).toContain("fps=30");
  });
});

describe("buildGraph — câblage de la cadence", () => {
  // Le test précédent valide `buildXfadeChain` isolément ; il passait encore
  // avec le 30 codé en dur réintroduit dans `buildGraph`. Ce cas vérifie que
  // la cadence traverse réellement le graphe.
  const baseInputs = {
    cues: [],
    subtitleFiles: [],
    preset: { boxColor: "black@0", boxOpacity: 0, useBox: false } as never,
    coverMask: undefined,
    subYAnchor: 0.8,
    activeMasks: [],
    keeps: [
      { start: 0, end: 3 },
      { start: 3.5, end: 6 },
    ],
    hasAudio: false,
    hasVoice: false,
    mirror: false,
    remap: (t: number) => t,
    transition: "fade" as const,
    transitionDuration: 0.3,
  };

  it("propage la cadence de la source jusqu'à xfade", async () => {
    const { buildGraph } = await import("./graph");
    const graph = buildGraph({ ...baseInputs, fps: 60 } as never, {
      masks: false,
      text: false,
      voice: false,
      cuts: true,
      transitions: true,
    });
    expect(graph).toContain("fps=60");
  });

  it("retombe sur 30 si la sonde n'a pas trouvé la cadence", async () => {
    const { buildGraph } = await import("./graph");
    const graph = buildGraph({ ...baseInputs, fps: 0 } as never, {
      masks: false,
      text: false,
      voice: false,
      cuts: true,
      transitions: true,
    });
    expect(graph).toContain("fps=30");
  });
});
