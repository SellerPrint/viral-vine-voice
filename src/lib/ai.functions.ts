import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

function elevenKey() {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error("ElevenLabs is not connected");
  return k;
}
function lovableKey() {
  const k = process.env.LOVABLE_API_KEY;
  if (!k) throw new Error("LOVABLE_API_KEY missing");
  return k;
}

/** Transcribe French audio (WAV/MP3 as base64). Returns words with timestamps. */
export const transcribeAudio = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ audioBase64: z.string(), mime: z.string().default("audio/wav") }).parse(input),
  )
  .handler(async ({ data }) => {
    const bytes = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: data.mime });
    const form = new FormData();
    form.append("file", blob, "audio.wav");
    form.append("model_id", "scribe_v2");
    form.append("language_code", "fra");
    form.append("tag_audio_events", "false");
    form.append("diarize", "false");

    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": elevenKey() },
      body: form,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Transcription failed (${res.status}): ${err.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      text: string;
      words?: Array<{ text: string; start: number; end: number; type?: string }>;
    };
    const words = (json.words ?? []).filter((w) => w.type !== "spacing" && w.text.trim().length);
    return { text: json.text, words };
  });

/** Translate FR segments (sentences) to EN keeping same count/order. */
export const translateSegments = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        segments: z.array(z.object({ text: z.string(), start: z.number(), end: z.number() })),
        targetLanguage: z.string().default("English"),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    if (data.segments.length === 0) return { segments: [] };
    const lang = data.targetLanguage || "English";

    const prompt = `You are a translator for viral TikTok content. Translate each French segment into natural, punchy ${lang} suitable for a voice-over. Keep it concise so the translation roughly matches the French duration. Return exactly one translation per input segment, in order.

INPUT SEGMENTS (FR):
${data.segments.map((s, i) => `${i + 1}. [${s.end - s.start}s] ${s.text}`).join("\n")}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You translate French to English for TikTok voice-overs." },
          { role: "user", content: prompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_translations",
              description: "Return the English translations in order.",
              parameters: {
                type: "object",
                properties: {
                  translations: {
                    type: "array",
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
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Translation failed (${res.status}): ${err.slice(0, 300)}`);
    }
    const json = await res.json();
    const call = json.choices?.[0]?.message?.tool_calls?.[0];
    const args = call ? JSON.parse(call.function.arguments) : { translations: [] };
    const translations: string[] = args.translations ?? [];
    const segments = data.segments.map((s, i) => ({
      start: s.start,
      end: s.end,
      textEn: translations[i] ?? "",
      textFr: s.text,
    }));
    return { segments };
  });

/** Synthesize one segment to MP3 base64. */
export const synthesizeSpeech = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        text: z.string().min(1),
        voiceId: z.string().default("EXAVITQu4vr4xnSDxMaL"),
        speed: z.number().min(0.7).max(1.2).default(1.0),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${data.voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": elevenKey(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: data.text,
          model_id: "eleven_turbo_v2_5",
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.75,
            style: 0.35,
            use_speaker_boost: true,
            speed: data.speed,
          },
        }),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`TTS failed (${res.status}): ${err.slice(0, 300)}`);
    }
    const buf = await res.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    return { audioBase64: b64 };
  });
