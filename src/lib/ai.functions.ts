import { createServerFn } from "@tanstack/react-start";

import { speechInput, transcribeInput, translateInput } from "./ai.schemas";
import {
  requestClonedSpeech,
  requestSpeech,
  requestTranscription,
  requestTranslations,
  resolveTranslationProvider,
} from "./ai.server";
import {
  readSpeechCache,
  readTranslationCache,
  speechCacheKey,
  translationCacheKey,
  writeSpeechCache,
  writeTranslationCache,
} from "./ai.cache.server";
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

    // Cache avant appel : relancer un rendu sur la meme video retraduisait
    // les memes segments a l'identique.
    const cacheKey = await translationCacheKey({
      segments: data.segments,
      sourceLanguage: data.sourceLanguage,
      targetLanguage: data.targetLanguage,
    });
    const cached = await readTranslationCache(cacheKey);
    if (cached) {
      console.info("[cache] traduction servie depuis le cache");
      return { segments: cached.segments as never, untranslated: cached.untranslated };
    }

    const { results, failed } = await requestTranslations(
      provider,
      data.segments,
      data.sourceLanguage,
      data.targetLanguage,
      signal,
    );

    const payload = {
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

    // Un lot partiellement en echec n'est pas mis en cache : on ne veut pas
    // figer une traduction degradee pendant une semaine.
    if (failed === 0) {
      await writeTranslationCache(cacheKey, payload);
    }

    return payload;
  });

export const synthesizeSpeech = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => speechInput.parse(input))
  .handler(async ({ data }) => {
    await guard("speech", data.turnstileToken);
    const signal = requestSignal();

    // Le cache est consulte AVANT le plafond de depense : un extrait deja
    // synthetise ne coute rien au fournisseur, il ne doit donc rien amputer
    // du budget quotidien.
    const speechKey = await speechCacheKey({
      text: data.text,
      voiceId: data.voiceId,
      speed: data.speed,
      provider: data.provider,
      direction: data.direction,
    });
    const cachedAudio = await readSpeechCache(speechKey);
    if (cachedAudio) {
      console.info("[cache] synthese servie depuis le cache");
      return { audioBase64: cachedAudio };
    }

    // Plafond global : borne la facture même derrière un pool de proxys.
    await consumeTtsBudget(data.text.length);

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
      await writeSpeechCache(speechKey, audioBase64);
      return { audioBase64 };
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("Clé API ElevenLabs manquante (ELEVENLABS_API_KEY).");

    const audioBase64 = await requestSpeech(apiKey, data, signal);
    await writeSpeechCache(speechKey, audioBase64);
    return { audioBase64 };
  });
