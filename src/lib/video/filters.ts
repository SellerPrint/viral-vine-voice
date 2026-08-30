/**
 * Filtres visuels facultatifs, inspires des presets CapCut.
 *
 * Chaque filtre expose deux formes strictement equivalentes :
 * - `ffmpeg` : la chaine de filtres appliquee au rendu final ;
 * - `css`    : le `filter` CSS utilise pour l'apercu instantane.
 *
 * Les deux doivent rester coherents, sinon l'apercu ment sur le resultat.
 */
export type VideoFilter = {
  id: string;
  name: string;
  description: string;
  /** Chaine FFmpeg, vide pour « aucun filtre ». */
  ffmpeg: string;
  /** Equivalent CSS approche, pour l'apercu. */
  css: string;
};

export const VIDEO_FILTERS: VideoFilter[] = [
  {
    id: "none",
    name: "Aucun",
    description: "Image d'origine, sans retouche.",
    ffmpeg: "",
    css: "none",
  },
  {
    id: "pure",
    name: "Pure",
    description: "Legere montee de contraste et de nettete. Rendu propre et neutre.",
    ffmpeg: "eq=contrast=1.08:saturation=1.05:brightness=0.01,unsharp=5:5:0.6:5:5:0.0",
    css: "contrast(1.08) saturate(1.05) brightness(1.01)",
  },
  {
    id: "vivid",
    name: "Vivid",
    description: "Couleurs saturees et contrastees, style reseaux sociaux.",
    ffmpeg: "eq=contrast=1.18:saturation=1.35:brightness=0.02",
    css: "contrast(1.18) saturate(1.35) brightness(1.02)",
  },
  {
    id: "warm",
    name: "Chaud",
    description: "Temperature plus chaude, teint dore.",
    ffmpeg: "colortemperature=temperature=8200,eq=saturation=1.1",
    css: "sepia(0.18) saturate(1.15) hue-rotate(-8deg)",
  },
  {
    id: "cool",
    name: "Froid",
    description: "Dominante bleutee, ambiance nocturne.",
    ffmpeg: "colortemperature=temperature=4600,eq=saturation=1.05",
    css: "saturate(1.05) hue-rotate(8deg) brightness(1.02)",
  },
  {
    id: "film",
    name: "Film",
    description: "Contraste doux et teintes desaturees, look cinema.",
    ffmpeg: "eq=contrast=1.12:saturation=0.88:gamma=1.05",
    css: "contrast(1.12) saturate(0.88)",
  },
  {
    id: "bw",
    name: "Noir & blanc",
    description: "Monochrome contraste.",
    ffmpeg: "hue=s=0,eq=contrast=1.15",
    css: "grayscale(1) contrast(1.15)",
  },
];

export const DEFAULT_FILTER_ID = "none";

export function getFilter(id: string | undefined): VideoFilter {
  return VIDEO_FILTERS.find((f) => f.id === id) ?? VIDEO_FILTERS[0];
}

/**
 * Mise a l'echelle facultative facon « 4K » de CapCut.
 *
 * `none` n'ajoute aucun filtre. Les autres valeurs agrandissent l'image puis
 * la reaccentuent, ce qui ne cree evidemment pas de detail absent de la source
 * mais rend le resultat plus net a l'affichage.
 *
 * Cout reel : le temps d'encodage croit avec le nombre de pixels. Passer de
 * 1080p a 2160p, c'est 4 fois plus de pixels, donc un rendu nettement plus
 * long dans le navigateur — et un risque d'echec memoire sur mobile.
 */
export type UpscaleMode = "none" | "1440" | "2160";

export const UPSCALE_MODES: { id: UpscaleMode; name: string; note: string }[] = [
  { id: "none", name: "Resolution d'origine", note: "Le plus rapide." },
  { id: "1440", name: "2K (1440p)", note: "Environ 2 fois plus lent." },
  { id: "2160", name: "4K (2160p)", note: "Environ 4 fois plus lent. Deconseille sur mobile." },
];

/**
 * Construit la chaine de mise a l'echelle.
 *
 * La hauteur cible s'applique au plus grand cote pour gerer aussi bien le
 * format portrait (TikTok) que paysage. `-2` conserve le ratio en garantissant
 * une dimension paire, exigee par libx264.
 */
export function buildUpscaleFilter(
  mode: UpscaleMode,
  videoWidth: number,
  videoHeight: number,
): string {
  if (mode === "none") return "";

  const target = mode === "2160" ? 2160 : 1440;
  const longest = Math.max(videoWidth, videoHeight);

  // Ne jamais reduire une video deja plus grande, ni upscaler sans dimensions.
  if (!longest || longest >= target) return "";

  const portrait = videoHeight >= videoWidth;
  const scale = portrait ? `scale=-2:${target}` : `scale=${target}:-2`;
  // `lanczos` donne un resultat plus net que le bilineaire par defaut.
  return `${scale}:flags=lanczos,unsharp=5:5:0.8:5:5:0.0`;
}

/** Combine filtre colorimetrique et mise a l'echelle en une seule chaine. */
export function buildLookFilters(
  filterId: string | undefined,
  upscale: UpscaleMode,
  videoWidth: number,
  videoHeight: number,
): string {
  return [getFilter(filterId).ffmpeg, buildUpscaleFilter(upscale, videoWidth, videoHeight)]
    .filter(Boolean)
    .join(",");
}
