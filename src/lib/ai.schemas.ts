import { z } from "zod";

import { VOICE_DIRECTIONS } from "./ai.constants";
import { SOURCE_LANGUAGE_CODES, DEFAULT_SOURCE_LANGUAGE } from "./languages";
import { AI33_VOICE_PATTERN, ALLOWED_ELEVENLABS_VOICES, DEFAULT_VOICE_ID } from "./voices";

/**
 * Bornes de sécurité des endpoints IA.
 *
 * Sans elles, `z.string()` accepte une chaîne de plusieurs centaines de Mo et
 * `z.array()` un nombre illimité de segments — soit autant d'appels facturés
 * déclenchables par un seul appelant.
 */
export const LIMITS = {
  /** ~6 Mo de WAV une fois décodé, soit ~3 min de mono 16 kHz. */
  audioBase64: 8 * 1024 * 1024,
  /** Un segment de sous-titre dépasse rarement 200 caractères. */
  segmentText: 500,
  /** Au-delà, la vidéo dépasse largement le format court visé. */
  segmentCount: 400,
  /** Une réplique de voix off ; borne le coût par appel TTS. */
  speechText: 800,
} as const;

const turnstileToken = z.string().max(4096).optional();

const timedSegment = z.object({
  text: z.string().max(LIMITS.segmentText),
  start: z.number().finite().nonnegative(),
  end: z.number().finite().nonnegative(),
});

export const transcribeInput = z.object({
  audioBase64: z.string().max(LIMITS.audioBase64, "Audio trop volumineux (max ~6 Mo)."),
  mime: z.enum(["audio/wav", "audio/mpeg", "audio/mp4"]).default("audio/wav"),
  sourceLanguage: z
    .enum(SOURCE_LANGUAGE_CODES as [string, ...string[]])
    .default(DEFAULT_SOURCE_LANGUAGE.code),
  turnstileToken,
});

export const translateInput = z.object({
  segments: z
    .array(timedSegment)
    .max(LIMITS.segmentCount, "Trop de segments : utilise une vidéo plus courte."),
  sourceLanguage: z.string().min(2).max(40).default(DEFAULT_SOURCE_LANGUAGE.name),
  targetLanguage: z.string().min(2).max(40).default("English"),
  turnstileToken,
});

export const speechInput = z
  .object({
    text: z.string().min(1).max(LIMITS.speechText, "Texte trop long pour un seul segment."),
    voiceId: z.string().min(1).max(64).default(DEFAULT_VOICE_ID),
    speed: z.number().min(0.7).max(1.2).default(1),
    direction: z.enum(VOICE_DIRECTIONS).default("neutral"),
    previousText: z.string().max(LIMITS.speechText).optional(),
    nextText: z.string().max(LIMITS.speechText).optional(),
    provider: z.enum(["elevenlabs", "ai33"]).default("elevenlabs"),
    turnstileToken,
  })
  .superRefine((value, ctx) => {
    // La voix est validée selon le fournisseur : sur ElevenLabs, seule
    // l'allowlist est acceptée, sinon n'importe quelle voix du compte (y
    // compris les voix premium facturées plus cher) serait déclenchable.
    if (value.provider === "elevenlabs" && !ALLOWED_ELEVENLABS_VOICES.has(value.voiceId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["voiceId"],
        message: "Voix non autorisée.",
      });
    }
    if (value.provider === "ai33" && !AI33_VOICE_PATTERN.test(value.voiceId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["voiceId"],
        message: "Identifiant de voix clonée invalide.",
      });
    }
  });
