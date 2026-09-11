import type { SourceLanguage } from "@/lib/languages";
import type { UpscaleMode } from "@/lib/video/filters";
import type { MaskStrength } from "@/lib/video/ffmpeg/graph";
import type { MaskZone, SubtitleOverrides, TargetLanguage, TtsProvider } from "@/lib/video/presets";
import type { RenderOptions } from "@/lib/video/render-options";
import type { TransitionType } from "@/lib/video/transitions";

/**
 * Modèle de données de l'éditeur.
 *
 * Tout ce qui vit ici est **sérielisable** (sauf `source.bytes`, jamais écrit
 * sur disque) : un projet peut donc être archivé, rejoué, et placé dans une
 * pile d'annulation sans copier de référence vivante.
 *
 * ## Convention de temps, partout la même
 *
 * Les positions des clips sont exprimées dans la **timeline source**, c'est-à-
 * dire la horodatage de la vidéo importée. Les coupes (`track === "cuts"`)
 * sont des plages *retirées* de cette même timeline. Le rendu, lui, produit
 * une vidéo plus courte : la projection source → sortie est faite par
 * `keptRanges()` + `sourceToTimeline()` (voir `edl.ts`), exactement comme le
 * fait le moteur FFmpeg avec `trim`/`concat`.
 */

export const TRACKS = ["video", "cuts", "subs", "dub"] as const;
export type TrackId = (typeof TRACKS)[number];

export type TrackMeta = {
  id: TrackId;
  label: string;
  hint: string;
  height: number;
  /** Une seule plage continue, non découpable : la source. */
  primary?: boolean;
};

export const TRACK_LAYOUT: TrackMeta[] = [
  {
    id: "video",
    label: "Vidéo",
    hint: "Plan importé — les segments retirés apparaissent en creux",
    height: 60,
    primary: true,
  },
  { id: "cuts", label: "Coupes", hint: "Plages supprimées du montage", height: 34 },
  { id: "subs", label: "Textes", hint: "Texte incrusté au rendu", height: 46 },
  { id: "dub", label: "Voix off", hint: "Doublage généré (aperçu audio)", height: 38 },
];

export type Clip = {
  id: string;
  track: TrackId;
  /** Début sur la timeline source, en secondes. */
  start: number;
  duration: number;
  label: string;
  /** Sous-titres : texte incrusté tel quel au rendu. */
  text?: string;
  /** Sous-titres : phrase d'origine, affichée en rappel. */
  sourceText?: string;
  /** Locuteur (index de voix ElevenLabs). */
  speakerId?: string;
  /** Voix off : URL de l'extrait WAV et crêtes pour la forme d'onde. */
  audioUrl?: string;
  peaks?: number[];
  /** Coupe : raison affichée dans la pastille. */
  reason?: "silence" | "manuel";
};

export type SourceMedia = {
  name: string;
  /** URL lisible par `<video>`. */
  url: string;
  /** Octets du fichier, nécessaires au rendu. Absents sur un flux distant. */
  bytes: Uint8Array | null;
  size: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  /** Vrai quand le projet est la démo livrée avec l'application. */
  demo?: boolean;
};

export type Quality = "draft" | "standard" | "high";

export const QUALITY_PRESETS: Record<Quality, { preset: string; crf: number; note: string }> = {
  draft: { preset: "ultrafast", crf: 30, note: "Encodage rapide, poids plus élevé." },
  standard: { preset: "veryfast", crf: 26, note: "Réglage par défaut du moteur." },
  high: { preset: "slow", crf: 20, note: "Lent en navigateur : réservé aux clips courts." },
};

export type Project = {
  name: string;
  source: SourceMedia | null;
  clips: Clip[];
  masks: MaskZone[];

  /* ------------------------------ sous-titres ------------------------------ */
  presetId: string;
  overrides: SubtitleOverrides;
  wordByWord: boolean;
  /** Opacité du fond des sous-titres, 0 = transparent. */
  boxOpacity: number;

  /* --------------------------------- audio --------------------------------- */
  removeOriginalAudio: boolean;
  ambienceLevel: number;

  /* --------------------------------- montage -------------------------------- */
  cutSilences: boolean;
  transition: TransitionType;
  transitionDuration: number;

  /* ---------------------------------- image --------------------------------- */
  mirror: boolean;
  filterId: string;
  upscale: UpscaleMode;
  maskStrength: MaskStrength;

  /* --------------------------------- langues -------------------------------- */
  sourceLanguage: SourceLanguage;
  targetLanguage: TargetLanguage;

  /* -------------------------------- voix off -------------------------------- */
  ttsProvider: TtsProvider;
  clonedVoiceId: string;

  quality: Quality;
};

/** Options de rendu comprises par le pipeline historique. */
export function toRenderOptions(project: Project): RenderOptions {
  return {
    wordByWord: project.wordByWord,
    removeOriginalAudio: project.removeOriginalAudio,
    // Les coupes sont déjà matérialisées sur la piste « Coupes » : le drapeau
    // ne commande plus que la *détection automatique*.
    cutSilences: project.cutSilences,
    mirror: project.mirror,
    ttsProvider: project.ttsProvider,
    clonedVoiceId: project.clonedVoiceId,
    filterId: project.filterId,
    upscale: project.upscale,
    transition: project.transition,
    transitionDuration: project.transitionDuration,
    subtitleOpacity: project.boxOpacity,
    ambienceLevel: project.ambienceLevel,
    maskStrength: project.maskStrength,
  };
}
