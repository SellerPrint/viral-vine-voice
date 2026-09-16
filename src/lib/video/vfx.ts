/**
 * Catalogue VFX façon CapCut Pro.
 *
 * Distincts des looks colorimétriques (`VIDEO_FILTERS`) : un VFX s'empile
 * par-dessus le filtre. Chaque entrée expose une chaîne FFmpeg qui **conserve
 * les dimensions** (sinon masques et overlay décalent) et un aperçu CSS.
 *
 * Pas d'assets CapCut : tout est local, ffmpeg.wasm + CSS.
 */

export type VfxCategory = "camera" | "glitch" | "film" | "light" | "blur" | "color";

export type VfxMotion = "shake" | "flash" | "zoom" | "glitch" | "pulse" | "strobe";

export type VfxEffect = {
  id: string;
  name: string;
  description: string;
  category: VfxCategory;
  /** `filter` CSS de l'aperçu. `none` = pas de retouche. */
  css: string;
  /** Animation CSS posée sur `.ed-frame`. */
  motion?: VfxMotion;
  /**
   * Chaîne FFmpeg. `w`/`h` sont les dimensions paires de la source, 0 si
   * inconnues — dans ce cas on évite `scale` vers une taille fixe.
   */
  ffmpeg: (w: number, h: number) => string;
};

export const VFX_CATEGORIES: { id: VfxCategory; label: string }[] = [
  { id: "light", label: "Lumière" },
  { id: "camera", label: "Caméra" },
  { id: "glitch", label: "Glitch" },
  { id: "film", label: "Film" },
  { id: "blur", label: "Flou" },
  { id: "color", label: "Couleur" },
];

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

function mosaic(w: number, h: number, block: number, fallback: string): string {
  if (!w || !h) return fallback;
  const sw = Math.max(6, even(w / block));
  const sh = Math.max(6, even(h / block));
  return `scale=${sw}:${sh}:flags=neighbor,scale=${even(w)}:${even(h)}:flags=neighbor`;
}

export const VFX_EFFECTS: VfxEffect[] = [
  {
    id: "none",
    name: "Aucun",
    description: "Pas d'effet visuel.",
    category: "camera",
    css: "none",
    ffmpeg: () => "",
  },

  /* -------------------------------- lumière -------------------------------- */
  {
    id: "glow",
    name: "Lueur",
    description: "Halo doux, visages plus lumineux.",
    category: "light",
    css: "brightness(1.08) contrast(1.06) saturate(1.1)",
    ffmpeg: () => "unsharp=5:5:1.3:5:5:0.0,eq=brightness=0.05:saturation=1.08",
  },
  {
    id: "bloom",
    name: "Bloom",
    description: "Hautes lumières qui débordent, look clip.",
    category: "light",
    css: "brightness(1.12) contrast(1.04) saturate(1.18) blur(0.4px)",
    ffmpeg: () => "gblur=sigma=1.2,eq=brightness=0.07:saturation=1.18:contrast=1.05",
  },
  {
    id: "neon",
    name: "Néon",
    description: "Saturation punchy, contours plus nets.",
    category: "light",
    css: "saturate(1.7) contrast(1.18) brightness(1.06)",
    ffmpeg: () => "eq=saturation=1.7:contrast=1.16:brightness=0.05,unsharp=5:5:1.5:5:5:0.0",
  },
  {
    id: "flash",
    name: "Flash",
    description: "Éclats blancs type transition CapCut.",
    category: "light",
    css: "brightness(1.18) contrast(1.08)",
    motion: "flash",
    ffmpeg: () => "eq=brightness=0.16:contrast=1.08",
  },
  {
    id: "strobe",
    name: "Stroboscope",
    description: "Clignotements rapides, club / drop.",
    category: "light",
    css: "brightness(1.22) contrast(1.12)",
    motion: "strobe",
    ffmpeg: () => "eq=brightness=0.12:contrast=1.14",
  },
  {
    id: "leak",
    name: "Fuite de lumière",
    description: "Voile chaud, lumière qui entre dans l'objectif.",
    category: "light",
    css: "sepia(0.22) saturate(1.25) brightness(1.1) hue-rotate(-12deg)",
    ffmpeg: () => "eq=gamma=1.08:brightness=0.08:saturation=1.22:contrast=1.04,hue=h=16",
  },
  {
    id: "golden",
    name: "Golden hour",
    description: "Soleil rasant, tons miel.",
    category: "light",
    css: "sepia(0.28) saturate(1.2) brightness(1.08) hue-rotate(-18deg)",
    ffmpeg: () => "colortemperature=temperature=7800,eq=saturation=1.18:brightness=0.06:gamma=1.05",
  },
  {
    id: "moonlight",
    name: "Clair de lune",
    description: "Nuit bleutée, bas volume de couleur.",
    category: "light",
    css: "saturate(0.55) brightness(0.92) hue-rotate(18deg) contrast(1.08)",
    ffmpeg: () => "colortemperature=temperature=4200,eq=saturation=0.62:brightness=-0.04:contrast=1.1",
  },
  {
    id: "rim",
    name: "Contre-jour",
    description: "Sujet détouré, bords plus clairs.",
    category: "light",
    css: "contrast(1.22) brightness(1.04) saturate(1.12)",
    ffmpeg: () => "unsharp=5:5:1.8:5:5:0.0,eq=contrast=1.2:brightness=0.03:saturation=1.1",
  },
  {
    id: "flare",
    name: "Lens flare",
    description: "Voile chaud + halo, soleil dans l'axe.",
    category: "light",
    css: "brightness(1.14) saturate(1.3) contrast(1.05) hue-rotate(-8deg)",
    ffmpeg: () => "gblur=sigma=0.6,eq=brightness=0.1:saturation=1.28:gamma=1.06,hue=h=12",
  },

  /* -------------------------------- caméra --------------------------------- */
  {
    id: "shake",
    name: "Tremblement",
    description: "Caméra qui tremble — impact, drop, punch.",
    category: "camera",
    css: "none",
    motion: "shake",
    ffmpeg: () => "rotate=0.014*sin(t*32):ow=iw:oh=ih:c=black@0",
  },
  {
    id: "handheld",
    name: "Caméra à l'épaule",
    description: "Micro-mouvements, documentaire.",
    category: "camera",
    css: "none",
    motion: "shake",
    ffmpeg: () => "rotate=0.007*sin(t*7)+0.005*cos(t*11):ow=iw:oh=ih:c=black@0",
  },
  {
    id: "zoom",
    name: "Zoom punch",
    description: "Poussée vers l'avant, rythme des cuts viraux.",
    category: "camera",
    css: "contrast(1.08) saturate(1.08)",
    motion: "zoom",
    ffmpeg: () => "eq=contrast=1.1:saturation=1.08,unsharp=5:5:0.8:5:5:0.0",
  },
  {
    id: "crash",
    name: "Crash zoom",
    description: "Zoom violent + contraste, punchline.",
    category: "camera",
    css: "contrast(1.2) saturate(1.15)",
    motion: "zoom",
    ffmpeg: () => "eq=contrast=1.22:saturation=1.12:brightness=0.02,unsharp=5:5:1.2:5:5:0.0",
  },
  {
    id: "dutch",
    name: "Dutch angle",
    description: "Horizon penché, malaise / tension.",
    category: "camera",
    css: "none",
    ffmpeg: () => "rotate=0.09:ow=iw:oh=ih:c=black@0",
  },
  {
    id: "pulse",
    name: "Pulse",
    description: "Image qui respire au rythme du beat.",
    category: "camera",
    css: "contrast(1.06)",
    motion: "pulse",
    ffmpeg: () => "eq=contrast=1.08:brightness=0.03",
  },

  /* -------------------------------- glitch --------------------------------- */
  {
    id: "glitch",
    name: "Glitch",
    description: "Décalage RGB et saccades, style digital.",
    category: "glitch",
    css: "contrast(1.15) saturate(1.35) hue-rotate(8deg)",
    motion: "glitch",
    ffmpeg: () => "chromashift=cbh=8:crh=-8:cbv=-3:crv=3,eq=contrast=1.12:saturation=1.2",
  },
  {
    id: "rgb",
    name: "RGB split",
    description: "Aberration chromatique, canaux écartés.",
    category: "glitch",
    css: "contrast(1.1) saturate(1.4)",
    ffmpeg: () => "chromashift=cbh=14:crh=-14:cbv=4:crv=-4",
  },
  {
    id: "pixel",
    name: "Pixel",
    description: "Mosaïque / 8-bit, comme l'effet Pixelate.",
    category: "glitch",
    css: "contrast(1.2) saturate(1.15)",
    ffmpeg: (w, h) => mosaic(w, h, 14, "gblur=sigma=3.5"),
  },
  {
    id: "mosaic",
    name: "Mosaïque",
    description: "Gros blocs, censure / low-fi.",
    category: "glitch",
    css: "contrast(1.15)",
    ffmpeg: (w, h) => mosaic(w, h, 8, "gblur=sigma=6"),
  },
  {
    id: "static",
    name: "Snow TV",
    description: "Neige analogique, canal mal réglé.",
    category: "glitch",
    css: "contrast(1.25) grayscale(0.35)",
    motion: "glitch",
    ffmpeg: () => "noise=alls=28:allf=t+u,eq=contrast=1.18:saturation=0.7",
  },
  {
    id: "hologram",
    name: "Hologramme",
    description: "Cyan / magenta, scan sci-fi.",
    category: "glitch",
    css: "saturate(1.6) hue-rotate(160deg) contrast(1.15) brightness(1.08)",
    ffmpeg: () => "hue=h=160:s=1.4,chromashift=cbh=6:crh=-6,eq=contrast=1.12:brightness=0.04",
  },
  {
    id: "cyber",
    name: "Cyberpunk",
    description: "Teal et magenta, néons de rue.",
    category: "glitch",
    css: "saturate(1.55) contrast(1.2) hue-rotate(-12deg)",
    ffmpeg: () => "eq=saturation=1.45:contrast=1.18:brightness=0.02,hue=h=-12,chromashift=cbh=4:crh=-4",
  },
  {
    id: "scanline",
    name: "Scanlines",
    description: "Lignes CRT, moniteur vintage.",
    category: "glitch",
    css: "contrast(1.18) saturate(1.1)",
    ffmpeg: () => "eq=contrast=1.16:saturation=1.08,noise=alls=8:allf=t",
  },

  /* --------------------------------- film ---------------------------------- */
  {
    id: "grain",
    name: "Grain",
    description: "Bruit de capteur, matière film.",
    category: "film",
    css: "contrast(1.06) saturate(0.95)",
    ffmpeg: () => "noise=alls=14:allf=t+u",
  },
  {
    id: "vignette",
    name: "Vignette",
    description: "Bords assombris, sujet au centre.",
    category: "film",
    css: "contrast(1.08) brightness(0.96)",
    ffmpeg: () => "vignette=angle=PI/4",
  },
  {
    id: "filmold",
    name: "Film ancien",
    description: "Grain, vignette et couleurs fanées.",
    category: "film",
    css: "sepia(0.35) contrast(1.12) saturate(0.75) brightness(0.97)",
    ffmpeg: () =>
      "noise=alls=10:allf=t+u,vignette=angle=PI/5,eq=saturation=0.7:contrast=1.14:gamma=1.05",
  },
  {
    id: "vhs",
    name: "VHS",
    description: "Bande analogique : bruit, teinte et contraste.",
    category: "film",
    css: "contrast(1.22) saturate(1.35) hue-rotate(-6deg) brightness(1.04)",
    ffmpeg: () => "noise=alls=18:allf=t+u,hue=h=8:s=1.15,eq=contrast=1.2:saturation=1.28",
  },
  {
    id: "crt",
    name: "CRT",
    description: "Tube cathodique, légèrement bombé visuellement.",
    category: "film",
    css: "contrast(1.2) saturate(1.25) brightness(1.02)",
    ffmpeg: () => "noise=alls=12:allf=t,vignette=angle=PI/3.2,eq=contrast=1.18:saturation=1.2",
  },
  {
    id: "super8",
    name: "Super 8",
    description: "Petit format, grain fort, couleurs chaudes.",
    category: "film",
    css: "sepia(0.4) contrast(1.18) saturate(1.1) brightness(1.04)",
    ffmpeg: () =>
      "noise=alls=16:allf=t+u,eq=saturation=1.12:contrast=1.16:gamma=1.08,hue=h=12,vignette=angle=PI/4.5",
  },
  {
    id: "polaroid",
    name: "Polaroid",
    description: "Tirage instantané, pastels et voile.",
    category: "film",
    css: "sepia(0.18) contrast(0.92) saturate(0.85) brightness(1.08)",
    ffmpeg: () => "eq=contrast=0.92:saturation=0.86:brightness=0.07:gamma=1.1,hue=h=8",
  },
  {
    id: "bleach",
    name: "Bleach bypass",
    description: "Argentique skip-bleach, métal et contraste.",
    category: "film",
    css: "contrast(1.35) saturate(0.55) grayscale(0.25)",
    ffmpeg: () => "eq=contrast=1.32:saturation=0.55:brightness=-0.02",
  },
  {
    id: "tealorange",
    name: "Teal & orange",
    description: "Look blockbuster, ombres froides peaux chaudes.",
    category: "film",
    css: "saturate(1.25) contrast(1.12) hue-rotate(-8deg)",
    ffmpeg: () => "eq=saturation=1.22:contrast=1.12,hue=h=-10,colortemperature=temperature=6200",
  },
  {
    id: "noir",
    name: "Noir",
    description: "Monochrome dur, polar des années 40.",
    category: "film",
    css: "grayscale(1) contrast(1.35) brightness(0.95)",
    ffmpeg: () => "hue=s=0,eq=contrast=1.35:brightness=-0.03:gamma=0.95",
  },
  {
    id: "sepia",
    name: "Sépia",
    description: "Carte postale, photo de famille.",
    category: "film",
    css: "sepia(0.85) contrast(1.08)",
    ffmpeg: () =>
      "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131,eq=contrast=1.08",
  },
  {
    id: "lofi",
    name: "Lo-fi",
    description: "Image un peu sale, compact jetable.",
    category: "film",
    css: "contrast(1.15) saturate(1.2) brightness(1.05)",
    ffmpeg: () => "noise=alls=11:allf=t+u,eq=contrast=1.14:saturation=1.18:brightness=0.04",
  },
  {
    id: "y2k",
    name: "Y2K",
    description: "Flash compact, couleurs sucrées 2000s.",
    category: "film",
    css: "saturate(1.55) contrast(1.1) brightness(1.1) hue-rotate(8deg)",
    ffmpeg: () => "eq=saturation=1.5:contrast=1.1:brightness=0.08,hue=h=10",
  },

  /* --------------------------------- flou ---------------------------------- */
  {
    id: "dream",
    name: "Rêve",
    description: "Flou doux, image un peu laiteuse.",
    category: "blur",
    css: "blur(1.1px) brightness(1.08) saturate(0.82) contrast(0.95)",
    ffmpeg: () => "gblur=sigma=1.5,eq=saturation=0.78:brightness=0.07:gamma=1.08",
  },
  {
    id: "blur",
    name: "Flou",
    description: "Gaussian plein cadre — intro / outro.",
    category: "blur",
    css: "blur(4px) brightness(1.04)",
    ffmpeg: () => "gblur=sigma=6",
  },
  {
    id: "motion",
    name: "Flou de mouvement",
    description: "Trainée horizontale, whip pan.",
    category: "blur",
    css: "blur(2px) contrast(1.08)",
    ffmpeg: () => "boxblur=8:1:4:1",
  },
  {
    id: "radial",
    name: "Flou radial",
    description: "Centre net, bords qui filent.",
    category: "blur",
    css: "blur(1.6px) contrast(1.1) saturate(1.1)",
    motion: "zoom",
    ffmpeg: () => "gblur=sigma=2.4,eq=contrast=1.1:saturation=1.08",
  },
  {
    id: "tilt",
    name: "Tilt-shift",
    description: "Miniature, bas et haut fondus.",
    category: "blur",
    css: "blur(0.8px) saturate(1.25) contrast(1.12)",
    ffmpeg: () => "gblur=sigma=1.1,eq=saturation=1.22:contrast=1.12:brightness=0.02",
  },
  {
    id: "soft",
    name: "Doux",
    description: "Peau lissée, pub beauté.",
    category: "blur",
    css: "blur(0.5px) brightness(1.06) saturate(1.05)",
    ffmpeg: () => "gblur=sigma=0.7,eq=brightness=0.05:saturation=1.06",
  },
  {
    id: "sharpen",
    name: "Netteté",
    description: "Contours croustillants, détail.",
    category: "blur",
    css: "contrast(1.14) saturate(1.05)",
    ffmpeg: () => "unsharp=5:5:2.0:5:5:0.5,eq=contrast=1.08",
  },
  {
    id: "fog",
    name: "Brouillard",
    description: "Voile blanc, distance perdue.",
    category: "blur",
    css: "blur(1.4px) brightness(1.12) saturate(0.7) contrast(0.88)",
    ffmpeg: () => "gblur=sigma=2.2,eq=brightness=0.1:saturation=0.68:contrast=0.9:gamma=1.12",
  },

  /* -------------------------------- couleur -------------------------------- */
  {
    id: "invert",
    name: "Négatif",
    description: "Couleurs inversées.",
    category: "color",
    css: "invert(1) hue-rotate(180deg)",
    ffmpeg: () => "negate",
  },
  {
    id: "poster",
    name: "Poster",
    description: "Aplats, peu de niveaux.",
    category: "color",
    css: "contrast(1.4) saturate(1.5)",
    ffmpeg: () => "eq=contrast=1.4:saturation=1.45,unsharp=5:5:1.4:5:5:0.0",
  },
  {
    id: "comic",
    name: "Comics",
    description: "Encre et couleurs pop.",
    category: "color",
    css: "contrast(1.55) saturate(1.7)",
    ffmpeg: () => "eq=contrast=1.5:saturation=1.65:gamma=0.92,unsharp=5:5:2.2:5:5:0.0",
  },
  {
    id: "thermal",
    name: "Thermique",
    description: "Palette chaleur, caméra IR.",
    category: "color",
    css: "hue-rotate(140deg) saturate(2) contrast(1.3)",
    ffmpeg: () => "hue=h=140:s=2,eq=contrast=1.28:saturation=1.6",
  },
  {
    id: "nightvis",
    name: "Vision nocturne",
    description: "Vert militaire, grain.",
    category: "color",
    css: "grayscale(1) sepia(1) hue-rotate(70deg) saturate(3) contrast(1.3) brightness(1.1)",
    ffmpeg: () => "hue=s=0,eq=contrast=1.28:brightness=0.06,hue=h=80:s=1.8,noise=alls=10:allf=t",
  },
  {
    id: "duotone",
    name: "Duotone",
    description: "Deux teintes, affiche.",
    category: "color",
    css: "grayscale(0.4) sepia(0.5) hue-rotate(-40deg) saturate(1.6) contrast(1.15)",
    ffmpeg: () => "eq=saturation=0.45:contrast=1.16,hue=h=-35:s=1.5",
  },
  {
    id: "pastel",
    name: "Pastel",
    description: "Couleurs lessivées, aesthetic.",
    category: "color",
    css: "saturate(0.7) brightness(1.12) contrast(0.9)",
    ffmpeg: () => "eq=saturation=0.72:brightness=0.1:contrast=0.92:gamma=1.08",
  },
  {
    id: "ice",
    name: "Glace",
    description: "Froid, cyan, peau pâle.",
    category: "color",
    css: "saturate(0.85) hue-rotate(12deg) brightness(1.06) contrast(1.08)",
    ffmpeg: () => "colortemperature=temperature=4000,eq=saturation=0.88:brightness=0.05:contrast=1.08",
  },
  {
    id: "fire",
    name: "Braise",
    description: "Rouges saturés, chaleur.",
    category: "color",
    css: "sepia(0.25) saturate(1.45) hue-rotate(-20deg) contrast(1.12)",
    ffmpeg: () => "colortemperature=temperature=9000,eq=saturation=1.35:contrast=1.12:brightness=0.04",
  },
  {
    id: "underwater",
    name: "Sous-marin",
    description: "Cyan profond, un peu de flou.",
    category: "color",
    css: "hue-rotate(20deg) saturate(0.8) brightness(0.95) blur(0.4px)",
    ffmpeg: () => "hue=h=28:s=0.85,gblur=sigma=0.6,eq=brightness=-0.03:gamma=1.06",
  },
  {
    id: "infrared",
    name: "Infrarouge",
    description: "Foliage blanc, ciels sombres.",
    category: "color",
    css: "hue-rotate(-30deg) saturate(1.4) contrast(1.25)",
    ffmpeg: () => "hue=h=-40:s=1.35,eq=contrast=1.22:saturation=1.2",
  },
  {
    id: "acid",
    name: "Acid",
    description: "Teintes chimiques, clip rave.",
    category: "color",
    css: "hue-rotate(90deg) saturate(2) contrast(1.2)",
    ffmpeg: () => "hue=h=90:s=1.8,eq=contrast=1.18:saturation=1.5",
  },
  {
    id: "matte",
    name: "Matte",
    description: "Noirs relevés, look log / LUT.",
    category: "color",
    css: "contrast(0.88) saturate(0.9) brightness(1.04)",
    ffmpeg: () => "eq=contrast=0.88:saturation=0.9:brightness=0.04:gamma=1.12",
  },
];

const BY_ID = new Map(VFX_EFFECTS.map((item) => [item.id, item]));

export function getVfx(id: string | undefined | null): VfxEffect {
  return BY_ID.get(id ?? "none") ?? VFX_EFFECTS[0];
}

/** Chaîne FFmpeg du VFX, vide si « aucun » ou identifiant inconnu. */
export function buildVfxFilter(id: string | undefined | null, width = 0, height = 0): string {
  return getVfx(id).ffmpeg(width, height);
}

/** Look colorimétrique + VFX, une seule chaîne linéaire. */
export function composeLookChain(look: string, vfx: string): string {
  return [look, vfx].filter(Boolean).join(",");
}
