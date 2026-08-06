import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  requestClonedSpeech,
  requestSpeech,
  requestTranscription,
  requestTranslations,
  type VoiceDirection,
} from "./ai.server";

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
    const results = await requestTranslations(apiKey, data.segments, data.targetLanguage);
    return {
      segments: data.segments.map((segment, index) => ({
        start: segment.start,
        end: segment.end,
        textEn: results[index].text,
        textFr: segment.text,
        direction: results[index].direction,
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
      provider: z.enum(["elevenlabs", "ai33"]).default("elevenlabs"),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    if (data.provider === "ai33") {
      const ai33Key = process.env.AI33_API_KEY;
      if (!ai33Key) throw new Error("Clé API ai33.pro manquante (AI33_API_KEY)");
      const audioBase64 = await requestClonedSpeech(ai33Key, {
        text: data.text,
        voiceId: data.voiceId,
        speed: data.speed,
        direction: data.direction,
      });
      return { audioBase64 };
    }
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ElevenLabs is not connected");
    const audioBase64 = await requestSpeech(apiKey, data);
    return { audioBase64 };
  });
