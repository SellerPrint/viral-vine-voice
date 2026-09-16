import { transcribeAudio } from "@/lib/ai.functions";
import { LIMITS } from "@/lib/ai.schemas";
import { arrayBufferToBase64, exactArrayBuffer } from "@/lib/base64";
import { getFfmpeg, writeFileSafe } from "@/lib/video/ffmpeg-client";
import { groupWordsToSegments } from "@/lib/video/subtitles/cues";

/**
 * Auto sous-titres — le chemin court du doublage.
 *
 * On extrait l'audio dans l'onglet, on le transcrit, et on s'arrête là : pas de
 * traduction, pas de voix off, pas d'encodage. C'est le geste CapCut « Auto
 * captions » : la parole du plan devient des blocs sur la piste Texte.
 */

/** WAV 16 kHz mono ~ 32 ko/s ; le plafond du schéma tient ~3 min. */
const MAX_WAV_BYTES = Math.floor(LIMITS.audioBase64 * 0.74);

export type CaptionSegment = {
  text: string;
  start: number;
  end: number;
  speakerId: string;
};

export async function extractMonoWav(
  bytes: Uint8Array,
  onProgress?: (ratio: number) => void,
): Promise<Uint8Array> {
  const ff = await getFfmpeg(undefined, onProgress);
  await writeFileSafe(ff, "captions-input.mp4", bytes);
  try {
    await ff.exec([
      "-y",
      "-i",
      "captions-input.mp4",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "captions-audio.wav",
    ]);
    const wav = (await ff.readFile("captions-audio.wav")) as Uint8Array;
    return wav;
  } finally {
    for (const name of ["captions-input.mp4", "captions-audio.wav"]) {
      try {
        await ff.deleteFile(name);
      } catch {
        /* le fichier peut ne jamais avoir été écrit */
      }
    }
  }
}

export async function transcribePlan(input: {
  bytes: Uint8Array;
  languageCode: string;
  turnstileToken?: string;
  signal?: AbortSignal;
  onProgress: (message: string) => void;
}): Promise<CaptionSegment[]> {
  input.signal?.throwIfAborted();
  input.onProgress("Extraction de l'audio…");
  const wav = await extractMonoWav(input.bytes);

  if (wav.byteLength > MAX_WAV_BYTES) {
    throw new Error(
      "L'audio dépasse ~3 min : coupe le plan (ou exporte un extrait) puis relance Auto sous-titres.",
    );
  }
  if (wav.byteLength < 4000) {
    throw new Error("Aucune piste audio utilisable : le plan est muet ou illisible.");
  }

  input.signal?.throwIfAborted();
  input.onProgress("Transcription de la parole…");
  const { words } = await transcribeAudio({
    signal: input.signal,
    data: {
      audioBase64: arrayBufferToBase64(exactArrayBuffer(wav)),
      mime: "audio/wav",
      sourceLanguage: input.languageCode,
      turnstileToken: input.turnstileToken,
    },
  });

  const segments = groupWordsToSegments(words);
  if (segments.length === 0) {
    throw new Error("Aucune parole détectée dans ce plan.");
  }
  return segments;
}
