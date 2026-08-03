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
};

export const SUBTITLE_PRESETS: SubtitlePreset[] = [
  {
    id: "tiktok-bold",
    name: "TikTok Bold",
    fontsize: 26,
    lineSpacing: 6,
    uppercase: false,
    maxCharsPerLine: 22,
    maxLines: 3,
    fontColor: "white",
    boxColor: "black@0.75",
    boxBorderW: 12,
    yAnchor: 0.78,
  },
  {
    id: "clean-white",
    name: "Clean White",
    fontsize: 22,
    lineSpacing: 4,
    uppercase: false,
    maxCharsPerLine: 28,
    maxLines: 2,
    fontColor: "white",
    boxColor: "black@0.55",
    boxBorderW: 10,
    yAnchor: 0.82,
  },
  {
    id: "karaoke-yellow",
    name: "Karaoke Yellow",
    fontsize: 28,
    lineSpacing: 5,
    uppercase: true,
    maxCharsPerLine: 20,
    maxLines: 2,
    fontColor: "yellow",
    boxColor: "black@0.7",
    boxBorderW: 14,
    yAnchor: 0.74,
  },
  {
    id: "minimal-top",
    name: "Minimal Top",
    fontsize: 20,
    lineSpacing: 4,
    uppercase: false,
    maxCharsPerLine: 32,
    maxLines: 2,
    fontColor: "white",
    boxColor: "black@0.45",
    boxBorderW: 8,
    yAnchor: 0.18,
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
  { id: "bottom", label: "Sous-titres FR (bas)", x: 0, y: 0.82, w: 1, h: 0.14, enabled: true },
  { id: "top", label: "Bandeau haut", x: 0, y: 0, w: 1, h: 0.08, enabled: false },
  { id: "tl", label: "Logo haut-gauche", x: 0, y: 0.02, w: 0.28, h: 0.08, enabled: false },
  { id: "tr", label: "Logo haut-droite", x: 0.72, y: 0.02, w: 0.28, h: 0.08, enabled: false },
];

export type SubtitleOverrides = Partial<
  Pick<SubtitlePreset, "fontsize" | "maxCharsPerLine" | "maxLines" | "yAnchor" | "uppercase">
>;

/** Langue de sortie des sous-titres (et de la future voix off). */
export type TargetLanguage = { code: string; label: string; name: string };

export const TARGET_LANGUAGES: TargetLanguage[] = [
  { code: "en", label: "🇬🇧 Anglais", name: "English" },
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

export type PipelineOptions = {
  preset: SubtitlePreset;
  overrides: SubtitleOverrides;
  masks: MaskZone[];
  targetLanguage?: TargetLanguage;
};

export function resolvePreset(preset: SubtitlePreset, o: SubtitleOverrides): SubtitlePreset {
  return { ...preset, ...o };
}
