import type { TtsProvider } from "./presets";

/** Options de rendu pilotées depuis le panneau de réglages. */
export type RenderOptions = {
  wordByWord: boolean;
  removeOriginalAudio: boolean;
  cutSilences: boolean;
  mirror: boolean;
  ttsProvider: TtsProvider;
  clonedVoiceId: string;
};

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  wordByWord: true,
  removeOriginalAudio: true,
  cutSilences: true,
  mirror: false,
  ttsProvider: "elevenlabs",
  clonedVoiceId: "",
};
