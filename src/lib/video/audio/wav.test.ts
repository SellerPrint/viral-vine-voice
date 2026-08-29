import { describe, expect, it } from "vitest";

import { encodeWav, keptIntervals, remapTime } from "./wav";

describe("keptIntervals", () => {
  it("retourne la vidéo entière sans silence", () => {
    expect(keptIntervals(10, [], 0)).toEqual([{ start: 0, end: 10 }]);
  });

  it("retire un silence central", () => {
    expect(keptIntervals(10, [{ start: 4, end: 6 }], 0)).toEqual([
      { start: 0, end: 4 },
      { start: 6, end: 10 },
    ]);
  });

  it("gère un silence en fin de vidéo", () => {
    expect(keptIntervals(10, [{ start: 8, end: 10 }], 0)).toEqual([{ start: 0, end: 8 }]);
  });

  it("gère un silence en début de vidéo", () => {
    expect(keptIntervals(10, [{ start: 0, end: 2 }], 0)).toEqual([{ start: 2, end: 10 }]);
  });

  it("ignore un silence réduit à néant par le padding", () => {
    expect(keptIntervals(10, [{ start: 4, end: 4.1 }], 0.1)).toEqual([{ start: 0, end: 10 }]);
  });

  it("écarte les fragments conservés trop courts", () => {
    const result = keptIntervals(10, [{ start: 0.05, end: 5 }], 0);
    expect(result.every((r) => r.end - r.start > 0.15)).toBe(true);
  });

  it("gère plusieurs silences consécutifs", () => {
    expect(
      keptIntervals(
        20,
        [
          { start: 3, end: 5 },
          { start: 10, end: 12 },
          { start: 16, end: 18 },
        ],
        0,
      ),
    ).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 10 },
      { start: 12, end: 16 },
      { start: 18, end: 20 },
    ]);
  });

  it("ne produit jamais d'intervalle inversé", () => {
    const result = keptIntervals(10, [{ start: 2, end: 8 }], 0.5);
    expect(result.every((r) => r.end > r.start)).toBe(true);
  });

  it("applique le padding symétriquement", () => {
    expect(keptIntervals(10, [{ start: 4, end: 6 }], 0.5)).toEqual([
      { start: 0, end: 4.5 },
      { start: 5.5, end: 10 },
    ]);
  });
});

describe("remapTime", () => {
  const keeps = [
    { start: 0, end: 4 },
    { start: 6, end: 10 },
  ];

  it("retourne le temps inchangé sans coupe", () => {
    expect(remapTime(5, [])).toBe(5);
  });

  it("conserve les instants situés avant la coupe", () => {
    expect(remapTime(2, keeps)).toBe(2);
    expect(remapTime(0, keeps)).toBe(0);
  });

  it("décale les instants situés après la coupe", () => {
    // Le silence 4→6 disparaît : t=7 devient 4 + (7-6) = 5
    expect(remapTime(7, keeps)).toBe(5);
    expect(remapTime(10, keeps)).toBe(8);
  });

  it("ramène un instant tombant dans un silence au bord de la coupe", () => {
    expect(remapTime(5, keeps)).toBe(4);
  });

  it("plafonne au-delà du dernier intervalle conservé", () => {
    expect(remapTime(999, keeps)).toBe(8);
  });

  it("est monotone croissante", () => {
    let previous = -Infinity;
    for (let t = 0; t <= 12; t += 0.1) {
      const value = remapTime(t, keeps);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("préserve la durée totale conservée", () => {
    const total = keeps.reduce((sum, k) => sum + (k.end - k.start), 0);
    expect(remapTime(10, keeps)).toBeCloseTo(total, 5);
  });
});

describe("encodeWav", () => {
  it("produit un en-tête RIFF/WAVE valide", () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5]), 24000);
    const text = new TextDecoder().decode(wav.subarray(0, 4));
    expect(text).toBe("RIFF");
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe("WAVE");
  });

  it("dimensionne le tampon à 44 octets d'en-tête + 2 octets par échantillon", () => {
    expect(encodeWav(new Float32Array(100), 24000).byteLength).toBe(44 + 200);
  });

  it("écrit la fréquence d'échantillonnage demandée", () => {
    const wav = encodeWav(new Float32Array(10), 44100);
    const view = new DataView(wav.buffer);
    expect(view.getUint32(24, true)).toBe(44100);
  });

  it("borne les échantillons hors plage sans déborder", () => {
    const wav = encodeWav(new Float32Array([2, -2]), 24000);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });
});
