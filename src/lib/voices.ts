/**
 * Allowlist des voix utilisables.
 *
 * Partagée entre le client (choix de la voix par locuteur) et le serveur
 * (validation). Sans cette liste, un appelant arbitraire pourrait déclencher
 * n'importe quelle voix du compte, y compris les voix premium facturées plus
 * cher.
 */
export const SPEAKER_VOICES: Record<string, string> = {
  "0": "EXAVITQu4vr4xnSDxMaL", // Bella
  "1": "pNInz6obpgDQGcFmaJgB", // Adam
  "2": "IKne3meq5aZN9X97s4mc", // Charlie
  "3": "Lcf7u9Pa966p7ftY009V", // Emily
};

export const DEFAULT_VOICE_ID = SPEAKER_VOICES["0"];

/** Voix ElevenLabs autorisées côté serveur. */
export const ALLOWED_ELEVENLABS_VOICES = new Set(Object.values(SPEAKER_VOICES));

/**
 * Voix ai33.pro autorisées (API compatible OpenAI).
 * L'utilisateur saisit l'identifiant de sa voix clonée : on borne le format
 * plutôt que le contenu, la liste dépendant de son compte.
 */
export const AI33_VOICE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const DEFAULT_AI33_VOICE = "alloy";

export function resolveSpeakerVoice(speakerId: string | undefined): string {
  return SPEAKER_VOICES[speakerId ?? "0"] ?? DEFAULT_VOICE_ID;
}
