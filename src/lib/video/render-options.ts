import type { UpscaleMode } from "./filters";
import type { TtsProvider } from "./presets";
import type { MaskStrength } from "./ffmpeg/graph";
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
  /**
   * Volume de l'ambiance d'origine sous la voix off, de 0 a 1.
   *
   * Ignore si `removeOriginalAudio` est actif. C'est ce qui donne la
   * sensation d'immersion : sans un fond audible, la voix flotte sur du
   * silence et sonne comme un commentaire plaque.
   */
  ambienceLevel: number;
  /**
   * Intensite du floutage des zones masquees.
   *
   * L'ancien traitement unique (`boxblur=40:3` + plaque noire a 55 %)
   * transformait la zone en dalle uniforme.
   */
  maskStrength: MaskStrength;
};

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  wordByWord: true,
  removeOriginalAudio: false,
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
  // Ambiance conservee par defaut, a un niveau qui ne masque pas la voix.
  ambienceLevel: 0.25,
  // Le texte devient illisible mais la scene reste reconnaissable.
  maskStrength: "medium",
};
