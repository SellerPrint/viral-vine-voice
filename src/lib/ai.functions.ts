import { createServerFn } from "@tanstack/react-start";

import { speechInput, transcribeInput, translateInput } from "./ai.schemas";
import {
  requestClonedSpeech,
  requestSpeech,
  requestTranscription,
  requestTranslations,
  resolveTranslationProvider,
} from "./ai.server";
import { consumeTtsBudget, guard, requestSignal } from "./guard.server";

// Les schémas vivent dans `ai.schemas.ts` : TanStack compile ce module pour le
// client, et les garder à part les rend testables directement.

export const transcribeAudio = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => transcribeInput.parse(input))
  .handler(async ({ data }) => {
    await guard("transcribe", data.turnstileToken);
    const signal = requestSignal();

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("Clé API ElevenLabs manquante (ELEVENLABS_API_KEY).");

    return requestTranscription(apiKey, data.audioBase64, data.mime, data.sourceLanguage, signal);
  });

export const translateSegments = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => translateInput.parse(input))
  .handler(async ({ data }) => {
    if (data.segments.length === 0) return { segments: [], untranslated: 0 };

    await guard("translate", data.turnstileToken);
    const signal = requestSignal();

    const provider = resolveTranslationProvider();
    if (!provider) {
      throw new Error(
        "Clé API de traduction manquante. Définis GEMINI_API_KEY (gratuit : " +
          "https://aistudio.google.com/apikey), GROQ_API_KEY ou OPENROUTER_API_KEY.",
      );
    }

    const { results, failed } = await requestTranslations(
      provider,
      data.segments,
      data.sourceLanguage,
      data.targetLanguage,
      signal,
    );

    return {
      // `failed` : segments retombés sur le texte source (lot en échec).
      untranslated: failed,
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
  .inputValidator((input: unknown) => speechInput.parse(input))
  .handler(async ({ data }) => {
    await guard("speech", data.turnstileToken);
    // Plafond global : borne la facture même derrière un pool de proxys.
    await consumeTtsBudget(data.text.length);
    const signal = requestSignal();

    if (data.provider === "ai33") {
      const ai33Key = process.env.AI33_API_KEY;
      if (!ai33Key) throw new Error("Clé API ai33.pro manquante (AI33_API_KEY).");

      const audioBase64 = await requestClonedSpeech(
        ai33Key,
        {
          text: data.text,
          voiceId: data.voiceId,
          speed: data.speed,
          direction: data.direction,
        },
        signal,
      );
      return { audioBase64 };
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("Clé API ElevenLabs manquante (ELEVENLABS_API_KEY).");

    const audioBase64 = await requestSpeech(apiKey, data, signal);
    return { audioBase64 };
  });
