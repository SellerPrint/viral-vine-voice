import { exactArrayBuffer } from "@/lib/base64";

/** Encode des échantillons mono flottants en WAV PCM 16 bits. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return bytes;
}

export type Silence = { start: number; end: number };

/** Détecte les plages silencieuses par énergie RMS sur fenêtres de 20 ms. */
export async function detectSilences(wavBytes: Uint8Array): Promise<Silence[]> {
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(exactArrayBuffer(wavBytes));
    const data = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const windowSize = Math.floor(0.02 * sampleRate);
    const threshold = 0.008;
    const minSilence = 0.4;

    const silences: Silence[] = [];
    let silenceStart: number | null = null;

    for (let i = 0; i < data.length; i += windowSize) {
      let sum = 0;
      const end = Math.min(i + windowSize, data.length);
      for (let j = i; j < end; j++) sum += data[j] * data[j];
      const rms = Math.sqrt(sum / (end - i));
      const time = i / sampleRate;

      if (rms < threshold) {
        if (silenceStart === null) silenceStart = time;
      } else if (silenceStart !== null) {
        if (time - silenceStart >= minSilence) silences.push({ start: silenceStart, end: time });
        silenceStart = null;
      }
    }
    if (silenceStart !== null) {
      silences.push({ start: silenceStart, end: data.length / sampleRate });
    }
    return silences;
  } finally {
    // Libère le contexte même si le décodage échoue : chaque AudioContext
    // fuité consomme un slot matériel (limite ~6 par page).
    void ctx.close();
  }
}

/**
 * Intervalles conservés après retrait des silences.
 *
 * `padding` réduit chaque silence de part et d'autre pour éviter les coupes
 * trop sèches aux frontières de la parole.
 */
export function keptIntervals(
  duration: number,
  silences: Silence[],
  padding = 0.1,
): { start: number; end: number }[] {
  const trimmed = silences
    .map((s) => ({ start: s.start + padding, end: s.end - padding }))
    .filter((s) => s.end - s.start > 0.2);

  const kept: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const silence of trimmed) {
    if (silence.start > cursor) kept.push({ start: cursor, end: silence.start });
    cursor = silence.end;
  }
  if (cursor < duration) kept.push({ start: cursor, end: duration });

  return kept.filter((k) => k.end - k.start > 0.15);
}

/**
 * Reprojette un instant de la timeline d'origine vers la timeline coupée.
 *
 * Sans cela, les sous-titres restent calés sur les timings d'avant coupe et
 * toute la vidéo se désynchronise.
 */
export function remapTime(time: number, keeps: { start: number; end: number }[]): number {
  if (!keeps.length) return time;
  let accumulated = 0;
  for (const keep of keeps) {
    if (time <= keep.start) return accumulated;
    if (time <= keep.end) return accumulated + (time - keep.start);
    accumulated += keep.end - keep.start;
  }
  return accumulated;
}
