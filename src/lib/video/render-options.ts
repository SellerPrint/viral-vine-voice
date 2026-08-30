import type { UpscaleMode } from "./filters";
import type { TtsProvider } from "./presets";
import type { TransitionType } from "./transitions";

/** Options de rendu pilotées depuis le panneau de réglages. */
export type RenderOptions = {
  wordByWord: boolean;
  removeOriginalAudio: boolean;
  cutSilences: boolean;
  mirror: boolean;
  ttsProvider: TtsProvider;
  clonedVoiceId: string;
  /** Filtre colorimetrique applique a l'image. */
  filterId: string;
  /** Mise a l'echelle facon « 4K ». */
  upscale: UpscaleMode;
  /** Transition inseree entre deux segments apres coupe des silences. */
  transition: TransitionType;
  /** Duree souhaitee de la transition, en secondes. */
  transitionDuration: number;
  /** Opacite du fond des sous-titres, 0 = transparent. */
  subtitleOpacity: number;
};

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  wordByWord: true,
  removeOriginalAudio: true,
  cutSilences: true,
  mirror: false,
  ttsProvider: "elevenlabs",
  clonedVoiceId: "",
  filterId: "none",
  upscale: "none",
  // Coupe franche par defaut : c'est le comportement historique, et une
  // transition modifie la duree finale.
  transition: "none",
  transitionDuration: 0.3,
  // Defaut discret, conformement au preset « discret ».
  subtitleOpacity: 0,
};
