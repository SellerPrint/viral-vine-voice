import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requestSpeech, requestTranscription, requestTranslations } from "./ai.server";

export const transcribeAudio = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ audioBase64: z.string(), mime: z.string().default("audio/wav") }).parse(input),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ElevenLabs is not connected");
    return requestTranscription(apiKey, data.audioBase64, data.mime);
  });

export const translateSegments = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      segments: z.array(z.object({ text: z.string(), start: z.number(), end: z.number() })),
      targetLanguage: z.string().default("English"),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    if (data.segments.length === 0) return { segments: [] };
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY missing");
    const translations = await requestTranslations(apiKey, data.segments, data.targetLanguage);
    return {
      segments: data.segments.map((segment, index) => ({
        start: segment.start,
        end: segment.end,
        textEn: translations[index],
        textFr: segment.text,
      })),
    };
  });

export const synthesizeSpeech = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      text: z.string().min(1),
      voiceId: z.string().default("EXAVITQu4vr4xnSDxMaL"),
      speed: z.number().min(0.7).max(1.2).default(1),
      direction: z.enum(["neutral", "energetic", "excited", "serious", "soft"]).default("neutral"),
      previousText: z.string().optional(),
      nextText: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ElevenLabs is not connected");
    const audioBase64 = await requestSpeech(apiKey, data);
    return { audioBase64 };
  });
