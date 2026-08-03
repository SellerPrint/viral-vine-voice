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
    words?: Array<{ text: string; start: number; end: number; type?: string; speaker_id?: string }>;
  };
  return {
    text: result.text,
    words: (result.words ?? [])
      .filter((word) => word.type !== "spacing" && word.text.trim().length > 0)
      .map((w) => ({
        text: w.text,
        start: w.start,
        end: w.end,
        speakerId: w.speaker_id || "0",
      })),
  };
}

export async function requestTranslations(
  apiKey: string,
  segments: TimedText[],
  targetLanguage: string,
) {
  const prompt = `Translate these French segments for a dubbed video in ${targetLanguage}.
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
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: `You are an expert video translator. Translate French to ${targetLanguage}. Output valid JSON for the tool.`,
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
                      direction: { enum: ["neutral", "energetic", "excited", "serious", "soft"] },
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
    const error = await response.text();
    throw new Error(`Translation failed (${response.status}): ${error.slice(0, 300)}`);
  }
  const result = (await response.json()) as any;
  const rawArguments = result.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!rawArguments) throw new Error("La traduction n'a retourné aucun segment structuré.");

  let parsed: any;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    throw new Error("La réponse de traduction est mal formatée.");
  }
  
  const results = parsed.results;
  if (!Array.isArray(results) || results.length !== segments.length) {
    throw new Error(`Attendu ${segments.length} segments, reçu ${results?.length || 0}.`);
  }

  return results.map((r: any) => ({
    text: String(r.translation)
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    direction: (r.direction || "neutral") as VoiceDirection,
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
) {
  const delivery = {
    neutral: { stability: 0.5, style: 0.25 },
    energetic: { stability: 0.35, style: 0.6 },
    excited: { stability: 0.25, style: 0.8 },
    serious: { stability: 0.75, style: 0.15 },
    soft: { stability: 0.6, style: 0.1 },
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
