import { describe, expect, it } from "vitest";

import { encodeWav } from "@/lib/video/audio/wav";

import {
  getSfx,
  mixProjectSfx,
  peaksOf,
  SFX_LIBRARY,
  SFX_RATE,
  synthesizeSfx,
} from "./sfx";
import type { Clip } from "./types";

function clip(partial: Partial<Clip> & { sfxId: string; start: number }): Clip {
  const def = getSfx(partial.sfxId);
  return {
    id: partial.id ?? `sfx-${partial.sfxId}`,
    track: "sfx",
    start: partial.start,
    duration: partial.duration ?? def.duration,
    label: def.name,
    sfxId: partial.sfxId,
  };
}

describe("SFX CapCut", () => {
  it("synthétise chaque entrée à la durée annoncée, sans silence total", () => {
    const ids = SFX_LIBRARY.map((item) => item.id);
    expect(ids.length).toBeGreaterThan(40);
    expect(new Set(ids).size).toBe(ids.length);

    for (const def of SFX_LIBRARY) {
      const samples = synthesizeSfx(def.id);
      expect(samples.length).toBe(Math.round(def.duration * SFX_RATE));
      let energy = 0;
      for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
      expect(energy).toBeGreaterThan(0.0001);
      expect(peaksOf(samples).length).toBe(28);
      expect(peaksOf(samples).some((p) => p > 0.05)).toBe(true);
    }
  });

  it("est déterministe : deux appels du même id sont identiques", () => {
    const a = synthesizeSfx("impact");
    const b = synthesizeSfx("impact");
    expect(a).toEqual(b);
    expect(synthesizeSfx("whoosh")[10]).not.toBe(synthesizeSfx("boom")[10]);
  });

  it("mixe deux SFX sur la durée du plan, et ignore une piste vide", () => {
    expect(mixProjectSfx([], 4)).toBeNull();
    expect(mixProjectSfx([clip({ sfxId: "click", start: 0 })], 0)).toBeNull();

    const wav = mixProjectSfx(
      [
        clip({ sfxId: "click", start: 0.2 }),
        clip({ sfxId: "boom", start: 1 }),
        { ...clip({ sfxId: "whoosh", start: 0 }), track: "dub", id: "voix" },
      ],
      2,
    );
    expect(wav).toBeInstanceOf(Uint8Array);
    expect(wav!.length).toBeGreaterThan(44);

    const silence = encodeWav(new Float32Array(SFX_RATE * 2), SFX_RATE);
    expect(wav!.length).toBe(silence.length);
  });
});
