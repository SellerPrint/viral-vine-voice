/** Directions émotionnelles acceptées pour la synthèse vocale. */
export const VOICE_DIRECTIONS = ["neutral", "energetic", "excited", "serious", "soft"] as const;

export type VoiceDirection = (typeof VOICE_DIRECTIONS)[number];
