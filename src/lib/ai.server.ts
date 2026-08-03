export type TimedText = { text: string; start: number; end: number };

export type VoiceDirection = "neutral" | "energetic" | "excited" | "serious" | "soft";

export async function requestTranscription(
  apiKey: string,
  audioBase64: string,
  mime: string,
) {
  const bytes = Uint8Array.from(atob(audioBase64), (character) => character.charCodeAt(0));
  const blob = new Blob([bytes], { type: mime });
  const form = new FormData();
  form.append("file", blob, "audio.wav");
  form.append("model_id", "scribe_v2");
  form.append("language_code", "fra");
  form.append("tag_audio_events", "false");
  form.append("diarize", "true");

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Transcription failed (${response.status}): ${error.slice(0, 300)}`);
  }
  const result = (await response.json()) as {
    text: string;
    words?: Array<{
      text: string;
      start: number;
      end: number;
      type?: string;
      speaker_id?: string;
    }>;
  };
  return {
    text: result.text,
    words: (result.words ?? []).filter(
      (word) => word.type !== "spacing" && word.text.trim().length > 0,
    ),
  };
}

export async function requestTranslations(
  apiKey: string,
  segments: TimedText[],
  targetLanguage: string,
) {
  const prompt = `Translate every numbered French segment into natural, concise ${targetLanguage} for a dubbed short video.
Preserve emotion, emphasis, punctuation, questions and exclamations. Match the allotted duration; do not add explanations, numbering, quotes, markdown or line breaks inside a translation. Return exactly ${segments.length} translations in the same order.

SEGMENTS:
${segments.map((segment, index) => `${index + 1}. [${(segment.end - segment.start).toFixed(2)}s] ${segment.text}`).join("\n")}`;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: `Translate French speech to ${targetLanguage}. Preserve delivery and timing exactly.`,
        },
        { role: "user", content: prompt },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "return_translations",
            description: "Return one clean translation for each source segment.",
            parameters: {
              type: "object",
              properties: {
                translations: {
                  type: "array",
                  minItems: segments.length,
                  maxItems: segments.length,
                  items: { type: "string" },
                },
              },
              required: ["translations"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "return_translations" } },
    }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Translation failed (${response.status}): ${error.slice(0, 300)}`);
  }
  const result = (await response.json()) as {
    choices?: Array<{
      message?: { tool_calls?: Array<{ function?: { arguments?: string } }> };
    }>;
  };
  const rawArguments = result.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!rawArguments) throw new Error("La traduction n'a retourné aucun segment structuré.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    throw new Error("La réponse de traduction est mal formatée. Réessaie le traitement.");
  }
  if (!parsed || typeof parsed !== "object" || !("translations" in parsed)) {
    throw new Error("La réponse de traduction ne contient pas les sous-titres attendus.");
  }
  const translations = (parsed as { translations?: unknown }).translations;
  if (!Array.isArray(translations) || translations.length !== segments.length) {
    throw new Error(
      `La traduction a retourné ${Array.isArray(translations) ? translations.length : 0} segments au lieu de ${segments.length}.`,
    );
  }
  return translations.map((value) => {
    const clean = String(value)
      .replace(/^\s*(?:\d+[.)-]\s*|[-*•]\s*)/, "")
      .replace(/^(["'“”«»])(.*)\1$/, "$2")
      .replace(/(?:\\[rn]|\/n|[\r\n])+\s*/gi, " ")
      .replace(/[*_`#]+/g, "")
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .trim();
    return clean.charAt(0).toLocaleUpperCase() + clean.slice(1);
  });
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
) {
  const delivery = {
    neutral: { stability: 0.5, style: 0.25 },
    energetic: { stability: 0.3, style: 0.65 },
    excited: { stability: 0.25, style: 0.8 },
    serious: { stability: 0.7, style: 0.2 },
    soft: { stability: 0.65, style: 0.15 },
  }[input.direction];
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${input.voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
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
    const error = await response.text();
    throw new Error(`TTS failed (${response.status}): ${error.slice(0, 300)}`);
  }
  return Buffer.from(await response.arrayBuffer()).toString("base64");
}