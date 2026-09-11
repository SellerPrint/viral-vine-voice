/**
 * Formes d'onde et sondes de médias, côté client.
 *
 * Un éditeur qui n'affiche pas le son est un éditeur à l'aveugle : c'est la
 * crête d'amplitude qui dit si une coupe tombe sur une syllabe. Tout est calculé
 * par échantillonnage RMS, jamais par lecture du fichier complet affiché — une
 * piste de 60 s à 44,1 kHz fait cinq millions d'échantillons, et la timeline n'a
 * besoin que d'une valeur par pixel.
 */

/** Crêtes RMS par seau, normalisées sur le maximum (0 → 1). */
export function peaksFromSamples(samples: Float32Array, buckets: number): number[] {
  if (samples.length === 0 || buckets <= 0) return [];
  const size = Math.max(1, Math.floor(samples.length / buckets));
  const peaks: number[] = [];
  let globalMax = 0;

  for (let i = 0; i < buckets; i++) {
    const start = i * size;
    if (start >= samples.length) {
      peaks.push(0);
      continue;
    }
    const end = Math.min(samples.length, start + size);
    let sum = 0;
    let local = 0;
    for (let j = start; j < end; j++) {
      const v = samples[j];
      sum += v * v;
      const abs = Math.abs(v);
      if (abs > local) local = abs;
    }
    const value = Math.sqrt(sum / (end - start)) * 1.6 + local * 0.35;
    globalMax = Math.max(globalMax, value);
    peaks.push(value);
  }

  return globalMax > 0 ? peaks.map((p) => Math.min(1, p / globalMax)) : peaks;
}

export type WavData = { samples: Float32Array; sampleRate: number };

/**
 * Lit un WAV (PCM 16 bits ou IEEE float 32) sans dépendre du décodeur audio.
 *
 * Le `encodeWav` du moteur produit du 16 bits mono : c'est le cas courant ici.
 * Les chunk inconnus sont sautés plutôt que de faire échouer la lecture, parce
 * qu'une forme d'onde absente est un détail, une exception en plein rendu ne
 * doit pas l'être.
 */
export function readWav(bytes: Uint8Array): WavData | null {
  // `slice()` isole une copie : le buffer d'origine appartient au moteur de
  // rendu, qui peut le détacher (transfert au worker) pendant la lecture.
  const copy = bytes.slice();
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  if (view.byteLength < 44 || view.getUint32(0, false) !== 0x52494646) return null;

  let offset = 12;
  let format = 1;
  let channels = 1;
  let sampleRate = 44100;
  let bits = 16;
  let dataStart = -1;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const id = view.getUint32(offset, false);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 0x666d7420) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true) || 1;
      sampleRate = view.getUint32(body + 4, true) || 44100;
      bits = view.getUint16(body + 14, true) || 16;
    } else if (id === 0x64617461) {
      dataStart = body;
      dataSize = Math.min(size, view.byteLength - body);
    }
    offset = body + size + (size % 2);
  }

  if (dataStart < 0 || dataSize <= 0) return null;

  const bytesPerSample = bits / 8;
  const frameSize = bytesPerSample * channels;
  const frames = Math.floor(dataSize / frameSize);
  const samples = new Float32Array(frames);

  for (let i = 0; i < frames; i++) {
    let value = 0;
    for (let ch = 0; ch < channels; ch++) {
      const at = dataStart + i * frameSize + ch * bytesPerSample;
      value +=
        format === 3
          ? view.getFloat32(at, true)
          : bits === 8
            ? view.getUint8(at) / 128 - 1
            : view.getInt16(at, true) / 32768;
    }
    samples[i] = value / channels;
  }

  return { samples, sampleRate };
}

/**
 * Décodage audio complet d'une URL média, pour la forme d'onde de la source.
 *
 * `decodeAudioData` est le seul décodeur mp4/aac présent partout dans le
 * navigateur. Un échec (codec exotique, fichier tronqué) rend un tableau vide :
 * la timeline affiche alors ses pistes sans relief, sans message d'erreur.
 */
export async function decodeMediaPeaks(url: string, buckets = 320): Promise<number[]> {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return [];
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const buffer = await response.arrayBuffer();
    const ctx = new AudioContext();
    try {
      const audio = await ctx.decodeAudioData(buffer);
      return peaksFromSamples(audio.getChannelData(0), buckets);
    } finally {
      // Chaque AudioContext non fermé consomme un slot matériel (limite ~6).
      await ctx.close().catch(() => {});
    }
  } catch {
    return [];
  }
}

/** Seuls les points de coupe comptent : on garde une résolution utile. */
export function peaksForRanges(
  ranges: { start: number; duration: number }[],
  all: number[],
  duration: number,
): number[][] {
  if (!all.length || duration <= 0) return ranges.map(() => []);
  const perSecond = all.length / duration;
  return ranges.map((range) => {
    const from = Math.max(0, Math.floor(range.start * perSecond));
    const to = Math.min(all.length, Math.ceil((range.start + range.duration) * perSecond));
    return all.slice(from, Math.max(from + 1, to));
  });
}
