import type { SourceLanguage } from "@/lib/languages";

import type { UpscaleMode } from "./filters";
import type { TransitionType } from "./transitions";

export type SubtitlePreset = {
  id: string;
  name: string;
  fontsize: number;
  lineSpacing: number;
  uppercase: boolean;
  maxCharsPerLine: number;
  maxLines: number;
  fontColor: string;
  boxColor: string; // rgba with @a
  boxBorderW: number;
  /** vertical anchor in the frame, 0 = top, 1 = bottom */
  yAnchor: number;
  /** CapCut-like styling */
  useBox?: boolean;
  borderW?: number;
  borderColor?: string;
  shadowColor?: string;
  shadowX?: number;
  shadowY?: number;
  /**
   * Opacite du fond, 0 = totalement transparent, 1 = opaque.
   *
   * Auparavant `buildStyleBits` forcait 0.95 quel que soit le preset : le
   * bandeau noir etait donc toujours tres visible, meme sur un style concu
   * pour etre discret.
   */
  boxOpacity?: number;
  /** Opacite de la plaque qui recouvre les sous-titres d'origine. */
  plateOpacity?: number;
};

export const SUBTITLE_PRESETS: SubtitlePreset[] = [
  {
    // Defaut volontairement sobre : aucun aplat de couleur, lisibilite
    // assuree par un contour et une ombre plutot que par un bandeau opaque.
    id: "discret",
    name: "Discret (recommande)",
    fontsize: 88,
    lineSpacing: 16,
    uppercase: false,
    maxCharsPerLine: 24,
    maxLines: 2,
    fontColor: "white",
    boxColor: "black@0.0",
    boxBorderW: 0,
    yAnchor: 0.8,
    useBox: false,
    borderW: 6,
    borderColor: "black",
    shadowColor: "black@0.45",
    shadowX: 1,
    shadowY: 2,
    boxOpacity: 0,
    plateOpacity: 0.85,
  },
  {
    id: "capcut-classic",
    name: "CapCut Classic",
    fontsize: 105,
    lineSpacing: 18,
    uppercase: false,
    maxCharsPerLine: 20,
    maxLines: 2,
    fontColor: "white",
    boxColor: "black@0.0",
    boxBorderW: 0,
    yAnchor: 0.78,
    useBox: false,
    borderW: 10,
    borderColor: "black",
    shadowColor: "black@0.6",
    shadowX: 2,
    shadowY: 3,
  },
  {
    id: "capcut-pop",
    name: "CapCut Pop (jaune)",
    fontsize: 112,
    lineSpacing: 18,
    uppercase: true,
    maxCharsPerLine: 16,
    maxLines: 2,
    fontColor: "yellow",
    boxColor: "black@0.0",
    boxBorderW: 0,
    yAnchor: 0.74,
    useBox: false,
    borderW: 12,
    borderColor: "black",
    shadowColor: "black@0.7",
    shadowX: 3,
    shadowY: 4,
  },
  {
    id: "capcut-highlight",
    name: "CapCut Highlight",
    fontsize: 98,
    lineSpacing: 24,
    uppercase: true,
    maxCharsPerLine: 18,
    maxLines: 2,
    fontColor: "white",
    boxColor: "#FF0050@0.9",
    boxBorderW: 14,
    yAnchor: 0.76,
    useBox: true,
    borderW: 4,
    borderColor: "black",
  },
  {
    id: "capcut-minimal",
    name: "CapCut Minimal",
    fontsize: 84,
    lineSpacing: 15,
    uppercase: false,
    maxCharsPerLine: 26,
    maxLines: 2,
    fontColor: "white",
    boxColor: "black@0.55",
    boxBorderW: 12,
    yAnchor: 0.82,
    useBox: true,
    borderW: 4,
    borderColor: "black",
  },
  {
    id: "tiktok-bold",
    name: "TikTok Bold",
    fontsize: 91,
    lineSpacing: 18,
    uppercase: false,
    maxCharsPerLine: 22,
    maxLines: 3,
    fontColor: "white",
    boxColor: "black@0.75",
    boxBorderW: 12,
    yAnchor: 0.78,
    useBox: true,
  },
  {
    id: "minimal-top",
    name: "Minimal Top",
    fontsize: 70,
    lineSpacing: 12,
    uppercase: false,
    maxCharsPerLine: 32,
    maxLines: 2,
    fontColor: "white",
    boxColor: "black@0.45",
    boxBorderW: 8,
    yAnchor: 0.18,
    useBox: true,
  },
];

/** Rectangular mask expressed in normalized coords (0..1) of frame. */
export type MaskZone = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  enabled: boolean;
};

export const DEFAULT_MASKS: MaskZone[] = [
  { id: "bottom", label: "Sous-titres FR (bas)", x: 0, y: 0.82, w: 1, h: 0.14, enabled: false },
  { id: "top", label: "Bandeau haut", x: 0, y: 0, w: 1, h: 0.08, enabled: false },
  { id: "tl", label: "Logo haut-gauche", x: 0, y: 0.02, w: 0.28, h: 0.08, enabled: false },
  { id: "tr", label: "Logo haut-droite", x: 0.72, y: 0.02, w: 0.28, h: 0.08, enabled: false },
];

export type SubtitleOverrides = Partial<
  Pick<
    SubtitlePreset,
    | "fontsize"
    | "maxCharsPerLine"
    | "maxLines"
    | "yAnchor"
    | "uppercase"
    | "fontColor"
    | "boxColor"
    | "boxOpacity"
    | "borderW"
  >
>;

/** Langue de sortie des sous-titres (et de la future voix off). */
export type TargetLanguage = { code: string; label: string; name: string };

export const TARGET_LANGUAGES: TargetLanguage[] = [
  { code: "en", label: "🇬🇧 Anglais", name: "English" },
  { code: "fr", label: "🇫🇷 Français", name: "French" },
  { code: "es", label: "🇪🇸 Espagnol", name: "Spanish" },
  { code: "pt", label: "🇧🇷 Portugais", name: "Portuguese (Brazil)" },
  { code: "de", label: "🇩🇪 Allemand", name: "German" },
  { code: "it", label: "🇮🇹 Italien", name: "Italian" },
  { code: "nl", label: "🇳🇱 Néerlandais", name: "Dutch" },
  { code: "ar", label: "🇸🇦 Arabe", name: "Arabic" },
  { code: "hi", label: "🇮🇳 Hindi", name: "Hindi" },
  { code: "id", label: "🇮🇩 Indonésien", name: "Indonesian" },
  { code: "ja", label: "🇯🇵 Japonais", name: "Japanese" },
  { code: "ko", label: "🇰🇷 Coréen", name: "Korean" },
  { code: "tr", label: "🇹🇷 Turc", name: "Turkish" },
];

export type TtsProvider = "elevenlabs" | "ai33";

export type PipelineOptions = {
  preset: SubtitlePreset;
  overrides: SubtitleOverrides;
  masks: MaskZone[];
  /** Langue parlée dans la vidéo source */
  sourceLanguage?: SourceLanguage;
  targetLanguage?: TargetLanguage;
  /** Interrompt le traitement en cours */
  signal?: AbortSignal;
  /** Jeton anti-robot transmis aux endpoints IA */
  turnstileToken?: string;
  /** Couper réellement les silences (défaut: true) */
  cutSilences?: boolean;
  /** Affichage des sous-titres mot par mot (défaut: true) */
  wordByWord?: boolean;
  /** Supprimer totalement l'audio d'origine (défaut: true) */
  removeOriginalAudio?: boolean;
  /** Moteur de synthèse vocale */
  ttsProvider?: TtsProvider;
  /** Identifiant de la voix clonée (ai33.pro) */
  clonedVoiceId?: string;
  /** Effet miroir (flip horizontal) pour éviter la détection de doublon */
  mirror?: boolean;
  /** Filtre colorimétrique (voir `filters.ts`) */
  filterId?: string;
  /** Mise à l'échelle façon « 4K » */
  upscale?: UpscaleMode;
  /** Transition entre segments après coupe des silences */
  transition?: TransitionType;
  /** Durée souhaitée de la transition, en secondes */
  transitionDuration?: number;
};

export function resolvePreset(preset: SubtitlePreset, o: SubtitleOverrides): SubtitlePreset {
  return { ...preset, ...o };
}
