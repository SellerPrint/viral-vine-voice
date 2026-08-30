import { z } from "zod";

import { VOICE_DIRECTIONS, type VoiceDirection } from "./ai.constants";
import { arrayBufferToBase64, base64ToBytes, exactArrayBuffer } from "./base64";

export type TimedText = { text: string; start: number; end: number };

export { VOICE_DIRECTIONS, type VoiceDirection } from "./ai.constants";

/** Toute réponse d'API tierce est validée : un champ manquant ne doit pas
 *  se propager silencieusement dans le pipeline. */
const TranscriptionResponse = z.object({
  text: z.string().default(""),
  words: z
    .array(
      z.object({
        text: z.string(),
        start: z.number(),
        end: z.number(),
        type: z.string().optional(),
        speaker_id: z.string().optional(),
      }),
    )
    .default([]),
});

const TranslationPayload = z.object({
  results: z.array(
    z.object({
      translation: z.string(),
      direction: z.enum(VOICE_DIRECTIONS).catch("neutral"),
    }),
  ),
});

const ChatCompletionResponse = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          tool_calls: z
            .array(z.object({ function: z.object({ arguments: z.string() }) }))
            .optional(),
        }),
      }),
    )
    .default([]),
});

async function readErrorBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "<corps illisible>";
  }
}

export async function requestTranscription(
  apiKey: string,
  audioBase64: string,
  mime: string,
  languageCode: string,
  signal?: AbortSignal,
) {
  const blob = new Blob([exactArrayBuffer(base64ToBytes(audioBase64))], { type: mime });
  const form = new FormData();
  form.append("file", blob, "audio.wav");
  form.append("model_id", "scribe_v2");
  form.append("language_code", languageCode);
  form.append("tag_audio_events", "false");
  form.append("diarize", "true");

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `Transcription échouée (${response.status}) : ${await readErrorBody(response)}`,
    );
  }

  const result = TranscriptionResponse.parse(await response.json());
  return {
    text: result.text,
    words: result.words
      .filter((word) => word.type !== "spacing" && word.text.trim().length > 0)
      .map((word) => ({
        text: word.text,
        start: word.start,
        end: word.end,
        speakerId: word.speaker_id || "0",
      })),
  };
}

/**
 * Fournisseur de traduction.
 *
 * N'importe quelle API compatible OpenAI (`/v1/chat/completions`) convient.
 * On détecte la première clé disponible, du plus recommandé au plus ancien,
 * ce qui permet de changer de fournisseur sans toucher au code.
 */
export type TranslationProvider = { apiKey: string; baseUrl: string; model: string };

const PROVIDERS: { env: string; baseUrl: string; model: string }[] = [
  // Google AI Studio — gratuit, sans carte bancaire. https://aistudio.google.com/apikey
  {
    env: "GEMINI_API_KEY",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    // Google retire ses modeles vite : gemini-2.0-flash a ete arrete le
    // 2026-06-01 et gemini-2.5-flash l'est le 2026-10-16. On vise donc un
    // modele courant, et `MODEL_FALLBACKS` prend le relais s'il disparait.
    model: "gemini-3.5-flash",
  },
  // Groq — gratuit, très rapide. https://console.groq.com/keys
  {
    env: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
  },
  // OpenRouter — modèles `:free`. https://openrouter.ai/keys
  {
    env: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.3-70b-instruct:free",
  },
  // Passerelle Lovable — historique, facturée sur les crédits du workspace.
  {
    env: "LOVABLE_API_KEY",
    baseUrl: "https://ai.gateway.lovable.dev/v1",
    model: "google/gemini-2.5-flash",
  },
];

/**
 * Modeles de repli, essayes dans l'ordre si le modele configure a ete retire.
 *
 * Un modele arrete renvoie 404 / NOT_FOUND : sans repli, la traduction casse
 * du jour au lendemain sans changement de code de notre cote.
 */
const MODEL_FALLBACKS: Record<string, string[]> = {
  "generativelanguage.googleapis.com": [
    "gemini-3.5-flash",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
  ],
};

/** Vrai si l'erreur traduit un modele inexistant ou retire. */
function isModelUnavailable(message: string): boolean {
  return /404|NOT_FOUND|not found|is not supported|has been deprecated|shut down/i.test(message);
}

/**
 * Résout le fournisseur à utiliser.
 *
 * `TRANSLATION_BASE_URL` / `TRANSLATION_MODEL` permettent de surcharger le
 * couple détecté, ou d'utiliser un fournisseur absent de la liste avec
 * `TRANSLATION_API_KEY`.
 */
export function resolveTranslationProvider(): TranslationProvider | null {
  const custom = process.env.TRANSLATION_API_KEY;
  if (custom) {
    return {
      apiKey: custom,
      baseUrl: process.env.TRANSLATION_BASE_URL ?? PROVIDERS[0].baseUrl,
      model: process.env.TRANSLATION_MODEL ?? PROVIDERS[0].model,
    };
  }
  for (const candidate of PROVIDERS) {
    const apiKey = process.env[candidate.env];
    if (apiKey) {
      return {
        apiKey,
        baseUrl: process.env.TRANSLATION_BASE_URL ?? candidate.baseUrl,
        model: process.env.TRANSLATION_MODEL ?? candidate.model,
      };
    }
  }
  return null;
}

/** Traduit un lot en un appel. Lève si le compte de résultats ne correspond pas. */
async function requestTranslationBatch(
  provider: TranslationProvider,
  segments: TimedText[],
  sourceLanguage: string,
  targetLanguage: string,
  signal?: AbortSignal,
) {
  // Budget de mots par segment : la voix de synthese lit ~2,8 mots/seconde.
  //
  // Le budget etait auparavant multiplie par la vitesse maximale (1,2x), ce
  // qui revenait a supposer que *chaque* segment serait accelere au maximum.
  // L'acceleration est une marge de securite, pas le regime nominal : la
  // consommer d'avance garantissait un depassement des que la traduction
  // atteignait son budget. On dimensionne donc a vitesse naturelle et l'on
  // garde 1,2x pour absorber les depassements ponctuels.
  const WORDS_PER_SECOND = 2.8;
  const wordBudget = (segment: TimedText) =>
    Math.max(2, Math.floor((segment.end - segment.start) * WORDS_PER_SECOND));

  const prompt = `Translate these ${sourceLanguage} segments for a dubbed video in ${targetLanguage}.
For each segment, provide:
1. The translation. It MUST fit the spoken duration: respect the word budget given for each segment. Prefer a shorter, punchier phrasing over a literal translation. Drop filler words rather than exceed the budget. Use Sentence Case (only first letter and names capitalized).
2. The emotional direction: one of [neutral, energetic, excited, serious, soft].

The word budget is a hard limit, not a suggestion: a translation that is too long gets cut off in the final video.

Return exactly ${segments.length} JSON objects in the 'results' array.
Do not include numbering, quotes, or literal newlines in the text.

SEGMENTS:
${segments.map((segment, index) => `[${index + 1}] (${(segment.end - segment.start).toFixed(2)}s, max ${wordBudget(segment)} words): ${segment.text}`).join("\n")}`;

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify({
      model: provider.model,
      messages: [
        {
          role: "system",
          content: `You are an expert video translator. Translate ${sourceLanguage} to ${targetLanguage}. Output valid JSON for the tool.`,
        },
        { role: "user", content: prompt },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "return_translations",
            description: "Return structured translations and prosody directions.",
            parameters: {
              type: "object",
              properties: {
                // Schema volontairement limite au sous-ensemble OpenAPI accepte
                // par Gemini : chaque noeud porte un `type` explicite, et pas de
                // minItems/maxItems (rejetes en `Unknown name` cote Gemini). Le
                // cardinal attendu est impose par le prompt puis re-verifie plus
                // bas, donc rien n'est perdu.
                results: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      translation: { type: "string" },
                      direction: { type: "string", enum: [...VOICE_DIRECTIONS] },
                    },
                    required: ["translation", "direction"],
                  },
                },
              },
              required: ["results"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "return_translations" } },
    }),
  });
  if (!response.ok) {
    throw new Error(`Traduction échouée (${response.status}) : ${await readErrorBody(response)}`);
  }

  const completion = ChatCompletionResponse.parse(await response.json());
  const rawArguments = completion.choices[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!rawArguments) throw new Error("La traduction n'a retourné aucun segment structuré.");

  let parsed: z.infer<typeof TranslationPayload>;
  try {
    parsed = TranslationPayload.parse(JSON.parse(rawArguments));
  } catch {
    throw new Error("La réponse de traduction est mal formatée.");
  }

  if (parsed.results.length !== segments.length) {
    throw new Error(`Attendu ${segments.length} segments, reçu ${parsed.results.length}.`);
  }

  return parsed.results.map((result) => ({
    text: result.translation
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    direction: result.direction,
  }));
}

/**
 * Nombre de segments par appel de traduction.
 *
 * Un appel unique sur toute la vidéo était en tout-ou-rien : si le modèle
 * renvoyait 39 résultats pour 40 segments, l'intégralité était perdue — y
 * compris la transcription déjà facturée. Découper borne la casse à un lot.
 */
export const TRANSLATION_BATCH_SIZE = 25;

export type TranslationResult = { text: string; direction: VoiceDirection };

/**
 * Traduit tous les segments, lot par lot.
 *
 * Un lot en échec ne fait pas échouer le rendu : ses segments retombent sur le
 * texte source avec une prosodie neutre. La vidéo reste exploitable, et
 * `failed` permet d'avertir l'utilisateur de ce qui n'a pas été traduit.
 */
export async function requestTranslations(
  provider: TranslationProvider,
  segments: TimedText[],
  sourceLanguage: string,
  targetLanguage: string,
  signal?: AbortSignal,
): Promise<{ results: TranslationResult[]; failed: number }> {
  const batches: TimedText[][] = [];
  for (let i = 0; i < segments.length; i += TRANSLATION_BATCH_SIZE) {
    batches.push(segments.slice(i, i + TRANSLATION_BATCH_SIZE));
  }

  const results: TranslationResult[] = [];
  let failed = 0;
  let lastError: unknown;
  // Modele courant : peut basculer sur un repli si celui d'origine est retire.
  let active = provider;

  for (const batch of batches) {
    signal?.throwIfAborted();
    try {
      results.push(
        ...(await requestTranslationBatch(active, batch, sourceLanguage, targetLanguage, signal)),
      );
    } catch (error) {
      if (signal?.aborted) throw error;

      // Modele retire : on rejoue le lot sur le premier repli qui repond.
      const message = error instanceof Error ? error.message : String(error);
      const host = new URL(active.baseUrl).hostname;
      const candidates = (MODEL_FALLBACKS[host] ?? []).filter((m) => m !== active.model);

      if (isModelUnavailable(message) && candidates.length > 0) {
        let recovered = false;
        for (const model of candidates) {
          try {
            const retried = await requestTranslationBatch(
              { ...active, model },
              batch,
              sourceLanguage,
              targetLanguage,
              signal,
            );
            console.warn(`Modele ${active.model} indisponible, bascule sur ${model}.`);
            active = { ...active, model };
            results.push(...retried);
            recovered = true;
            break;
          } catch (retryError) {
            if (signal?.aborted) throw retryError;
            lastError = retryError;
          }
        }
        if (recovered) continue;
      }

      lastError = error;
      console.error(`Traduction échouée sur un lot de ${batch.length} segments`, error);
      failed += batch.length;
      // Repli : on garde le texte source plutôt que de perdre le segment.
      results.push(
        ...batch.map((segment) => ({ text: segment.text, direction: "neutral" as const })),
      );
    }
  }

  // Tous les lots ont échoué : rien n'a été traduit, autant le dire clairement
  // que de livrer une vidéo doublée dans la langue d'origine.
  if (segments.length > 0 && failed === segments.length) {
    // Sans la cause, l'utilisateur ne peut rien faire : cle invalide, quota
    // depasse et modele retire demandent trois actions differentes.
    const cause = lastError instanceof Error ? lastError.message : String(lastError ?? "");
    throw new Error(
      `La traduction a échoué sur l'ensemble des segments.${cause ? ` Cause : ${cause}` : ""}`,
    );
  }

  return { results, failed };
}

export async function requestSpeech(
  apiKey: string,
  input: {
    text: string;
    voiceId: string;
    speed: number;
    direction: VoiceDirection;
    previousText?: string;
    nextText?: string;
  },
  signal?: AbortSignal,
) {
  const delivery = {
    neutral: { stability: 0.5, style: 0.25 },
    energetic: { stability: 0.35, style: 0.6 },
    excited: { stability: 0.25, style: 0.8 },
    serious: { stability: 0.75, style: 0.15 },
    soft: { stability: 0.6, style: 0.1 },
  }[input.direction];

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      signal,
      body: JSON.stringify({
        text: input.text,
        model_id: "eleven_turbo_v2_5",
        previous_text: input.previousText,
        next_text: input.nextText,
        voice_settings: {
          stability: delivery.stability,
          similarity_boost: 0.75,
          style: delivery.style,
          use_speaker_boost: true,
          speed: input.speed,
        },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Synthèse vocale échouée (${response.status}) : ${await readErrorBody(response)}`,
    );
  }
  return arrayBufferToBase64(await response.arrayBuffer());
}

/**
 * Voix clonée via ai33.pro (API compatible OpenAI /v1/audio/speech).
 * `voiceId` correspond à l'identifiant de la voix clonée du compte.
 */
export async function requestClonedSpeech(
  apiKey: string,
  input: { text: string; voiceId: string; speed: number; direction: VoiceDirection },
  signal?: AbortSignal,
) {
  const tone = {
    neutral: "Speak naturally.",
    energetic: "Speak with energy and drive.",
    excited: "Speak excitedly, with high enthusiasm.",
    serious: "Speak seriously and calmly.",
    soft: "Speak softly and gently.",
  }[input.direction];

  const response = await fetch("https://api.ai33.pro/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify({
      model: "tts-1-hd",
      input: input.text,
      voice: input.voiceId,
      instructions: tone,
      speed: input.speed,
      response_format: "mp3",
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Synthèse vocale ai33.pro échouée (${response.status}) : ${await readErrorBody(response)}`,
    );
  }
  return arrayBufferToBase64(await response.arrayBuffer());
}
