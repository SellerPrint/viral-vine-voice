import { beforeEach, describe, expect, it } from "vitest";

import {
  CACHE_LIMITS,
  readSpeechCache,
  readTranslationCache,
  speechCacheKey,
  translationCacheKey,
  writeSpeechCache,
  writeTranslationCache,
} from "./ai.cache.server";
import { __resetMemoryKv } from "./kv.server";

beforeEach(() => {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  __resetMemoryKv();
});

const segments = [
  { text: "Bonjour le monde", start: 0, end: 2 },
  { text: "Regarde ce pangolin", start: 2, end: 4 },
];

describe("translationCacheKey", () => {
  it("donne la même clé pour le même contenu", async () => {
    const a = await translationCacheKey({ segments, sourceLanguage: "fr", targetLanguage: "en" });
    const b = await translationCacheKey({ segments, sourceLanguage: "fr", targetLanguage: "en" });
    expect(a).toBe(b);
  });

  it("ignore les horodatages : une découpe décalée doit rester un hit", async () => {
    // Sinon le moindre recalage des silences ferait manquer le cache.
    const shifted = segments.map((s) => ({ ...s, start: s.start + 0.4, end: s.end + 0.4 }));
    const a = await translationCacheKey({ segments, sourceLanguage: "fr", targetLanguage: "en" });
    const b = await translationCacheKey({
      segments: shifted,
      sourceLanguage: "fr",
      targetLanguage: "en",
    });
    expect(a).toBe(b);
  });

  it("change de clé si le texte change", async () => {
    const other = [{ text: "Autre chose", start: 0, end: 2 }];
    const a = await translationCacheKey({ segments, sourceLanguage: "fr", targetLanguage: "en" });
    const b = await translationCacheKey({
      segments: other,
      sourceLanguage: "fr",
      targetLanguage: "en",
    });
    expect(a).not.toBe(b);
  });

  it("change de clé si la langue cible change", async () => {
    const en = await translationCacheKey({ segments, sourceLanguage: "fr", targetLanguage: "en" });
    const es = await translationCacheKey({ segments, sourceLanguage: "fr", targetLanguage: "es" });
    expect(en).not.toBe(es);
  });
});

describe("cache de traduction", () => {
  it("relit ce qui a été écrit", async () => {
    const key = await translationCacheKey({ segments, sourceLanguage: "fr", targetLanguage: "en" });
    await writeTranslationCache(key, { segments: [{ textEn: "Hello" }], untranslated: 0 });
    const hit = await readTranslationCache(key);
    expect(hit?.untranslated).toBe(0);
    expect(hit?.segments).toHaveLength(1);
  });

  it("renvoie null sur une clé jamais écrite", async () => {
    expect(await readTranslationCache("tr:inexistante")).toBeNull();
  });
});

describe("speechCacheKey", () => {
  const base = {
    text: "Hello world",
    voiceId: "voice-1",
    speed: 1,
    provider: "elevenlabs",
    direction: "neutral",
  };

  it("distingue deux voix différentes", async () => {
    const a = await speechCacheKey(base);
    const b = await speechCacheKey({ ...base, voiceId: "voice-2" });
    expect(a).not.toBe(b);
  });

  it("distingue deux vitesses réellement différentes", async () => {
    const a = await speechCacheKey(base);
    const b = await speechCacheKey({ ...base, speed: 1.2 });
    expect(a).not.toBe(b);
  });

  it("tolère un écart de vitesse imperceptible", async () => {
    // 1.000 et 1.001 produiraient un audio indiscernable : deux clés
    // distinctes ne feraient que gonfler le magasin pour rien.
    const a = await speechCacheKey(base);
    const b = await speechCacheKey({ ...base, speed: 1.001 });
    expect(a).toBe(b);
  });

  it("distingue deux intentions de jeu", async () => {
    const a = await speechCacheKey(base);
    const b = await speechCacheKey({ ...base, direction: "excited" });
    expect(a).not.toBe(b);
  });
});

describe("cache de synthèse", () => {
  it("relit un audio mis en cache", async () => {
    const key = await speechCacheKey({
      text: "Hi",
      voiceId: "v",
      speed: 1,
      provider: "elevenlabs",
      direction: "neutral",
    });
    await writeSpeechCache(key, "QUJDRA==");
    expect(await readSpeechCache(key)).toBe("QUJDRA==");
  });

  it("refuse de stocker un audio trop volumineux", async () => {
    const key = "sp:enorme";
    await writeSpeechCache(key, "x".repeat(CACHE_LIMITS.MAX_CACHED_AUDIO_CHARS + 1));
    // Au-delà de la limite, le coût de stockage annule le gain.
    expect(await readSpeechCache(key)).toBeNull();
  });

  it("accepte un audio juste sous la limite", async () => {
    const key = "sp:limite";
    await writeSpeechCache(key, "x".repeat(CACHE_LIMITS.MAX_CACHED_AUDIO_CHARS));
    expect(await readSpeechCache(key)).not.toBeNull();
  });
});
