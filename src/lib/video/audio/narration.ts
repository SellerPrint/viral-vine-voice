import { synthesizeSpeech } from "@/lib/ai.functions";
import { base64ToBytes, exactArrayBuffer } from "@/lib/base64";
import { mapLimit } from "@/lib/concurrency";
import { DEFAULT_AI33_VOICE, resolveSpeakerVoice } from "@/lib/voices";

import { planNarrationClips, planOvershoot } from "./narration-plan";
import { encodeWav } from "./wav";
import type { Segment } from "../subtitles/cues";
import type { TtsProvider } from "../presets";

export type NarrationProgress = (index: number, total: number) => void;

export type NarrationResult = {
  wav: Uint8Array | null;
  /** Nombre de segments dont la synthèse a échoué. */
  failed: number;
  /** Nombre de segments traités. */
  total: number;
  /**
   * Secondes de parole qui ne tiennent pas dans la durée de la vidéo, même
   * après accélération maximale. Au-delà de zéro, la fin serait tronquée.
   */
  overshoot: number;
};

/** Concurrence des appels TTS : au-delà, le fournisseur limite le débit. */
const TTS_CONCURRENCY = 4;

/** Débit de référence pour estimer la vitesse de lecture (mots/seconde). */
const WORDS_PER_SECOND = 2.8;

type VoiceConfig = {
  provider: TtsProvider;
  clonedVoiceId?: string;
  turnstileToken?: string;
};

/**
 * Génère et mixe la voix off sur la timeline d'origine.
 *
 * Les appels sont parallélisés avec une concurrence bornée : ils étaient
 * auparavant séquentiels, soit ~1,5 s × N segments.
 */
export async function composeNarrationWav(
  segments: Segment[],
  duration: number,
  onProgress: NarrationProgress,
  voice: VoiceConfig,
  signal?: AbortSignal,
): Promise<NarrationResult> {
  const usable = segments.filter((s) => s.textEn.trim().length > 1);
  if (!usable.length || !duration) return { wav: null, failed: 0, total: 0, overshoot: 0 };

  const resolveVoiceId = (segment: Segment) =>
    voice.provider === "ai33"
      ? (voice.clonedVoiceId || "").trim() || DEFAULT_AI33_VOICE
      : resolveSpeakerVoice(segment.speakerId);

  let completed = 0;

  const synthesized = await mapLimit(usable, TTS_CONCURRENCY, async (segment, index) => {
    signal?.throwIfAborted();

    const slot = Math.max(0.4, segment.end - segment.start);
    const wordCount = segment.textEn.trim().split(/\s+/).filter(Boolean).length;
    // Le serveur borne la vitesse à [0.7, 1.2] : rester dans la même plage
    // évite qu'un segment dense fasse échouer toute la narration.
    const speed = Math.min(1.2, Math.max(0.75, wordCount / slot / WORDS_PER_SECOND));

    try {
      const { audioBase64 } = await synthesizeSpeech({
        signal,
        data: {
          text: segment.textEn.trim(),
          speed,
          direction: segment.direction || "neutral",
          provider: voice.provider,
          voiceId: resolveVoiceId(segment),
          previousText: usable[index - 1]?.textEn,
          nextText: usable[index + 1]?.textEn,
          turnstileToken: voice.turnstileToken,
        },
      });
      return { ok: true as const, index, audioBase64, start: segment.start, slot };
    } catch (error) {
      if (signal?.aborted) throw error;
      console.error(`Synthèse vocale échouée sur le segment ${index + 1}`, error);
      return { ok: false as const, index };
    } finally {
      onProgress(++completed, usable.length);
    }
  });

  const successes = synthesized.filter((r) => r.ok);
  const failed = synthesized.length - successes.length;

  if (!successes.length) return { wav: null, failed, total: usable.length, overshoot: 0 };

  // Décodage après coup : un seul AudioContext, correctement fermé.
  const decodeCtx = new AudioContext();
  const clips: { buffer: AudioBuffer; start: number; slot: number }[] = [];
  let decodeFailures = 0;

  try {
    for (const result of successes) {
      signal?.throwIfAborted();
      try {
        const bytes = base64ToBytes(result.audioBase64);
        const buffer = await decodeCtx.decodeAudioData(exactArrayBuffer(bytes));
        clips.push({ buffer, start: result.start, slot: result.slot });
      } catch (error) {
        decodeFailures++;
        console.error(`Décodage audio échoué sur le segment ${result.index + 1}`, error);
      }
    }
  } finally {
    void decodeCtx.close();
  }

  if (!clips.length) {
    return { wav: null, failed: failed + decodeFailures, total: usable.length, overshoot: 0 };
  }

  const sampleRate = 24000;

  // Placement calcule : sans cela, un clip plus long que son segment mordait
  // sur le suivant, decalait toute la suite, et la fin de la narration sortait
  // de la video — d'ou des sous-titres sans voix off sur les derniers plans.
  const plan = planNarrationClips(
    clips.map((clip) => ({
      start: clip.start,
      end: clip.start + clip.slot,
      duration: clip.buffer.duration,
    })),
    duration,
  );

  const overshoot = planOvershoot(plan, duration);
  const tail = Math.max(duration, ...plan.map((p) => p.start + p.playedDuration));
  const offline = new OfflineAudioContext(1, Math.ceil((tail + 1) * sampleRate), sampleRate);

  clips.forEach((clip, index) => {
    const placement = plan[index];
    const source = offline.createBufferSource();
    source.buffer = clip.buffer;
    source.playbackRate.value = placement.rate;
    source.connect(offline.destination);
    source.start(placement.start);
  });

  const rendered = await offline.startRendering();

  return {
    wav: encodeWav(rendered.getChannelData(0), sampleRate),
    failed: failed + decodeFailures,
    total: usable.length,
    overshoot,
  };
}
