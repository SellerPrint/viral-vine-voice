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

export async function requestTranslations(
  apiKey: string,
  segments: TimedText[],
  sourceLanguage: string,
  targetLanguage: string,
  signal?: AbortSignal,
) {
  const prompt = `Translate these ${sourceLanguage} segments for a dubbed video in ${targetLanguage}.
For each segment, provide:
1. The translation: natural, concise, matching the duration. Use Sentence Case (only first letter and names capitalized).
2. The emotional direction: one of [neutral, energetic, excited, serious, soft].

Return exactly ${segments.length} JSON objects in the 'results' array.
Do not include numbering, quotes, or literal newlines in the text.

SEGMENTS:
${segments.map((segment, index) => `[${index + 1}] (${(segment.end - segment.start).toFixed(2)}s): ${segment.text}`).join("\n")}`;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
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
                results: {
                  type: "array",
                  minItems: segments.length,
                  maxItems: segments.length,
                  items: {
                    type: "object",
                    properties: {
                      translation: { type: "string" },
                      direction: { enum: [...VOICE_DIRECTIONS] },
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
