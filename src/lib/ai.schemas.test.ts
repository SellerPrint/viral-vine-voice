import { describe, expect, it } from "vitest";

import { LIMITS, speechInput, transcribeInput, translateInput } from "./ai.schemas";
import { DEFAULT_VOICE_ID, SPEAKER_VOICES } from "./voices";

/**
 * Ces bornes sont la principale protection contre l'usage abusif des API
 * facturées : elles méritent d'être verrouillées par des tests.
 */

describe("transcribeInput", () => {
  const valid = { audioBase64: "AAAA", mime: "audio/wav" as const };

  it("accepte une entrée valide", () => {
    expect(transcribeInput.parse(valid).mime).toBe("audio/wav");
  });

  it("applique le français par défaut", () => {
    expect(transcribeInput.parse(valid).sourceLanguage).toBe("fra");
  });

  it("accepte une autre langue source connue", () => {
    expect(transcribeInput.parse({ ...valid, sourceLanguage: "spa" }).sourceLanguage).toBe("spa");
  });

  it("rejette une langue source inconnue", () => {
    expect(() => transcribeInput.parse({ ...valid, sourceLanguage: "xyz" })).toThrow();
  });

  it("rejette un audio au-delà de la limite", () => {
    expect(() =>
      transcribeInput.parse({ ...valid, audioBase64: "A".repeat(LIMITS.audioBase64 + 1) }),
    ).toThrow(/trop volumineux/i);
  });

  it("accepte un audio à la limite exacte", () => {
    expect(() =>
      transcribeInput.parse({ ...valid, audioBase64: "A".repeat(LIMITS.audioBase64) }),
    ).not.toThrow();
  });

  it("rejette un type MIME non audio", () => {
    expect(() => transcribeInput.parse({ ...valid, mime: "application/zip" })).toThrow();
  });

  it("rejette un jeton anti-robot démesuré", () => {
    expect(() => transcribeInput.parse({ ...valid, turnstileToken: "x".repeat(5000) })).toThrow();
  });
});

describe("translateInput", () => {
  const segment = { text: "bonjour", start: 0, end: 1 };

  it("accepte une liste vide", () => {
    expect(translateInput.parse({ segments: [] }).segments).toEqual([]);
  });

  it("applique l'anglais comme cible par défaut", () => {
    expect(translateInput.parse({ segments: [segment] }).targetLanguage).toBe("English");
  });

  it("accepte le nombre maximal de segments", () => {
    const segments = Array.from({ length: LIMITS.segmentCount }, () => segment);
    expect(() => translateInput.parse({ segments })).not.toThrow();
  });

  it("rejette un dépassement du nombre de segments", () => {
    const segments = Array.from({ length: LIMITS.segmentCount + 1 }, () => segment);
    expect(() => translateInput.parse({ segments })).toThrow(/Trop de segments/i);
  });

  it("rejette un segment au texte démesuré", () => {
    expect(() =>
      translateInput.parse({
        segments: [{ ...segment, text: "x".repeat(LIMITS.segmentText + 1) }],
      }),
    ).toThrow();
  });

  it("rejette un horodatage négatif", () => {
    expect(() => translateInput.parse({ segments: [{ ...segment, start: -1 }] })).toThrow();
  });

  it("rejette un horodatage non fini", () => {
    expect(() => translateInput.parse({ segments: [{ ...segment, end: Infinity }] })).toThrow();
  });
});

describe("speechInput", () => {
  const valid = { text: "hello", voiceId: DEFAULT_VOICE_ID, provider: "elevenlabs" as const };

  it("accepte une voix de l'allowlist", () => {
    expect(speechInput.parse(valid).voiceId).toBe(DEFAULT_VOICE_ID);
  });

  it("accepte chaque voix déclarée", () => {
    for (const voiceId of Object.values(SPEAKER_VOICES)) {
      expect(() => speechInput.parse({ ...valid, voiceId })).not.toThrow();
    }
  });

  it("rejette une voix hors allowlist", () => {
    // Sans ce contrôle, une voix premium du compte serait déclenchable par un tiers.
    expect(() => speechInput.parse({ ...valid, voiceId: "PREMIUM_VOICE_XYZ" })).toThrow(
      /Voix non autorisée/i,
    );
  });

  it("rejette un texte au-delà de la limite", () => {
    expect(() => speechInput.parse({ ...valid, text: "x".repeat(LIMITS.speechText + 1) })).toThrow(
      /Texte trop long/i,
    );
  });

  it("rejette un texte vide", () => {
    expect(() => speechInput.parse({ ...valid, text: "" })).toThrow();
  });

  it("borne la vitesse dans la plage acceptée par le fournisseur", () => {
    expect(() => speechInput.parse({ ...valid, speed: 1.5 })).toThrow();
    expect(() => speechInput.parse({ ...valid, speed: 0.5 })).toThrow();
    expect(speechInput.parse({ ...valid, speed: 1.2 }).speed).toBe(1.2);
  });

  it("applique la direction neutre par défaut", () => {
    expect(speechInput.parse(valid).direction).toBe("neutral");
  });

  it("rejette une direction inconnue", () => {
    expect(() => speechInput.parse({ ...valid, direction: "angry" })).toThrow();
  });

  it("accepte un identifiant de voix clonée bien formé", () => {
    expect(() =>
      speechInput.parse({ text: "hi", voiceId: "ma-voix_01", provider: "ai33" }),
    ).not.toThrow();
  });

  it("rejette un identifiant de voix clonée mal formé", () => {
    expect(() =>
      speechInput.parse({ text: "hi", voiceId: "../../etc/passwd", provider: "ai33" }),
    ).toThrow(/Identifiant de voix clonée invalide/i);
  });

  it("n'applique pas l'allowlist ElevenLabs au fournisseur ai33", () => {
    expect(() =>
      speechInput.parse({ text: "hi", voiceId: "alloy", provider: "ai33" }),
    ).not.toThrow();
  });

  it("borne le contexte prosodique", () => {
    expect(() =>
      speechInput.parse({ ...valid, previousText: "x".repeat(LIMITS.speechText + 1) }),
    ).toThrow();
  });
});
