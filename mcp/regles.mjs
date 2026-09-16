/**
 * Bornes et listes blanches du serveur MCP.
 *
 * ## Pourquoi ce fichier existe alors que l'application a déjà ses constantes
 *
 * Le serveur tourne dans Node, sans bundler, sans TypeScript. Il lui faut donc
 * une copie des valeurs que l'interface admet. Cette copie est le seul endroit
 * où la duplication est tolérée, et `serveur.test.mjs` la surveille : chaque
 * liste est comparée à son équivalent dans `src/lib/**` à chaque exécution des
 * tests. Ajouter un préréglage de sous-titres côté app sans le déclarer ici fait
 * rougir le test — c'est voulu.
 */

/** Version du format de configuration, alignée sur `CONFIG_VERSION` de l'app. */
export const CONFIG_VERSION = 2;

/** Les mêmes bornes que les curseurs de l'inspecteur, au unité près. */
export const CORPS = { min: 20, max: 170 };
export const ANCRAGE = { min: 0, max: 0.98 };
export const LIGNES = { minChars: 8, maxChars: 60, minLines: 1, maxLines: 6 };
export const OPACITE = { min: 0, max: 1 };

/** Un projet ne dépasse pas ces comptes : au-delà, le graphe FFmpeg s'enfonce. */
export const MAX_BLOCS = 400;
/**
 * Le plafond réel du moteur de sous-titres (`MAX_CUES`) : au-delà, les lignes ne
 * sont pas rendues. `mcp/serveur.test.mjs` compare ce nombre à la constante de
 * `src/lib/video/subtitles/cues.ts` — c'est là que la copie est surveillée.
 */
export const MAX_LIGNES_MOTEUR = 320;
export const MAX_COUPES = 200;
export const MAX_CADRES = 20;
export const MAX_DUREE = 3600;

/** Le `Clip` de l'éditeur, restreint à ce qu'un fichier peut décrire. */
export const PISTES = ["video", "subs", "dub", "sfx"];
export const RAISONS_COUPURE = ["silence", "manuel"];

/** Force de masquage, telle que le moteur la lit. */
export const FORCES_MASQUE = ["light", "medium", "strong"];
export const FOURNISSEURS_VOIX = ["elevenlabs", "ai33"];

/**
 * Les préréglages de sous-titres, par identifiant — l'atelier ne connaît que
 * ceux-là, et un `presetId` hors liste fait rejeter **tout** le fichier à
 * l'import (`oneOf(presetIds)`). C'est le premier écart que le test de parité
 * a démasqué : la liste avait été recopiée de mémoire.
 */
export const PRESETS_SOUS_TITRES = [
  "discret",
  "capcut-classic",
  "capcut-pop",
  "capcut-highlight",
  "capcut-minimal",
  "tiktok-bold",
  "minimal-top",
];

/** Transition entre deux segments, telle que `transitions.ts` les construit. */
export const TRANSITIONS = [
  "none",
  "fade",
  "fadeblack",
  "fadewhite",
  "dissolve",
  "fadegrays",
  "fadefast",
  "fadeslow",
  "slideleft",
  "slideright",
  "slideup",
  "slidedown",
  "coverleft",
  "coverright",
  "coverup",
  "coverdown",
  "revealleft",
  "revealright",
  "wipeleft",
  "wiperight",
  "wipeup",
  "wipedown",
  "diagtl",
  "diagbr",
  "pixelize",
  "zoomin",
  "hblur",
  "smoothleft",
  "circleopen",
  "circleclose",
  "radial",
  "squeezeh",
  "squeezev",
  "horzopen",
  "vertopen",
];

/** Modes d'agrandissement (`UPSCALE_MODES` côté app). */
export const UPSCALE = ["none", "1440", "2160"];

/** Filtres d'image (`VIDEO_FILTERS` côté app). */
export const FILTRES = [
  "none",
  "pure",
  "vivid",
  "warm",
  "cool",
  "film",
  "bw",
  "vintage",
  "fade",
  "punch",
];

/** Effets visuels CapCut (`VFX_EFFECTS` côté app). */
export const EFFETS_VFX = [
  "none",
  "glow",
  "bloom",
  "neon",
  "flash",
  "strobe",
  "leak",
  "golden",
  "moonlight",
  "rim",
  "flare",
  "shake",
  "handheld",
  "zoom",
  "crash",
  "dutch",
  "pulse",
  "glitch",
  "rgb",
  "pixel",
  "mosaic",
  "static",
  "hologram",
  "cyber",
  "scanline",
  "grain",
  "vignette",
  "filmold",
  "vhs",
  "crt",
  "super8",
  "polaroid",
  "bleach",
  "tealorange",
  "noir",
  "sepia",
  "lofi",
  "y2k",
  "dream",
  "blur",
  "motion",
  "radial",
  "tilt",
  "soft",
  "sharpen",
  "fog",
  "invert",
  "poster",
  "comic",
  "thermal",
  "nightvis",
  "duotone",
  "pastel",
  "ice",
  "fire",
  "underwater",
  "infrared",
  "acid",
  "matte",
];

/** Animations de légende (`TEXT_FX` côté app). */
export const ANIMATIONS_TEXTE = [
  "none",
  "fade",
  "pop",
  "bounce",
  "slide-up",
  "slide-down",
  "slide-left",
  "slide-right",
  "typewriter",
  "scale",
  "zoom-out",
  "blur-in",
  "blur-out",
  "drop",
  "rise",
  "elastic",
  "flip",
  "glitch",
  "shake",
  "spin",
  "explode",
  "rotate",
  "wave",
  "karaoke",
  "glow",
  "neon",
  "heartbeat",
  "flicker",
];

/** Identifiants SFX (`SFX_LIBRARY` côté app), dans le même ordre. */
export const BRUITAGES = [
  "whoosh",
  "whoosh-long",
  "whoosh-in",
  "whoosh-out",
  "swipe",
  "whip",
  "swoosh",
  "reverse",
  "impact",
  "boom",
  "bass",
  "slam",
  "punch",
  "thud",
  "crash",
  "kick",
  "click",
  "snap",
  "pop",
  "tap",
  "shutter",
  "type",
  "notify",
  "send",
  "like",
  "toggle",
  "riser",
  "riser-short",
  "downer",
  "tension",
  "reverse-cym",
  "glitch",
  "sparkle",
  "static",
  "zap",
  "digital",
  "record",
  "braam",
  "subdrop",
  "stinger",
  "trailer",
  "heartbeat",
  "air",
  "boing",
  "plop",
  "zip",
  "slide",
  "honk",
  "clap",
  "hat",
  "laser",
  "beep",
  "beep-double",
  "scan",
  "warp",
  "powerup",
  "powerdown",
  "modem",
];

/** Durées nominales, pour poser un SFX sans deviner. */
export const DUREES_BRUITAGE = {
  whoosh: 0.42,
  "whoosh-long": 0.78,
  "whoosh-in": 0.5,
  "whoosh-out": 0.48,
  swipe: 0.32,
  whip: 0.28,
  swoosh: 0.55,
  reverse: 0.62,
  impact: 0.38,
  boom: 0.72,
  bass: 0.55,
  slam: 0.34,
  punch: 0.26,
  thud: 0.44,
  crash: 0.7,
  kick: 0.32,
  click: 0.1,
  snap: 0.16,
  pop: 0.18,
  tap: 0.09,
  shutter: 0.26,
  type: 0.38,
  notify: 0.48,
  send: 0.28,
  like: 0.36,
  toggle: 0.14,
  riser: 1.15,
  "riser-short": 0.7,
  downer: 0.9,
  tension: 1.4,
  "reverse-cym": 1.05,
  glitch: 0.34,
  sparkle: 0.58,
  static: 0.5,
  zap: 0.22,
  digital: 0.4,
  record: 0.8,
  braam: 1.2,
  subdrop: 1.0,
  stinger: 0.55,
  trailer: 0.85,
  heartbeat: 1.15,
  air: 0.45,
  boing: 0.45,
  plop: 0.2,
  zip: 0.3,
  slide: 0.55,
  honk: 0.28,
  clap: 0.22,
  hat: 0.14,
  laser: 0.32,
  beep: 0.18,
  "beep-double": 0.32,
  scan: 0.7,
  warp: 0.85,
  powerup: 0.5,
  powerdown: 0.6,
  modem: 0.65,
};

/**
 * Qualités d'encodage (`QUALITY_PRESETS` côté atelier). Pas de débit ni de
 * cadence imposés ici : le moteur relit la source (`source.fps`) et règle le
 * crf depuis ce choix — promettre un `bitrate` à l'export serait un champ que
 * personne ne lit.
 */
export const QUALITES = ["draft", "standard", "high"];

/**
 * Les codes de langue admis par l'atelier, séparés en deux listes : la source
 * (transcription) et la cible (doublage) n'ont pas les mêmes entrées. Un code
 * hors liste ferait rejeter tout le fichier à l'import — `valider` refuse donc
 * avant, et `serveur.test.mjs` compare les deux listes aux constantes réelles.
 */
export const LANGUES_SOURCE = ["fra", "eng", "spa", "deu", "ita", "por", "ara"];
export const LANGUES_CIBLES = [
  "en",
  "fr",
  "es",
  "pt",
  "de",
  "it",
  "nl",
  "ar",
  "hi",
  "id",
  "ja",
  "ko",
  "tr",
];

/**
 * Les zones livrées avec un projet neuf, copiées de `DEFAULT_MASKS` — y
 * compris leur défaut : **aucun cadre n'est actif à l'ouverture**. Le test de
 * parité compare ces quatre entrées champ par champ, pour que le serveur ne
 * puisse pas masquer une zone que l'atelier ne masque pas (ni l'inverse).
 */
export const CADRES_PAR_DEFAUT = [
  { id: "bottom", label: "Sous-titres FR (bas)", x: 0, y: 0.82, w: 1, h: 0.14, actif: false },
  { id: "top", label: "Bandeau haut", x: 0, y: 0, w: 1, h: 0.08, actif: false },
  { id: "tl", label: "Logo haut-gauche", x: 0, y: 0.02, w: 0.28, h: 0.08, actif: false },
  { id: "tr", label: "Logo haut-droite", x: 0.72, y: 0.02, w: 0.28, h: 0.08, actif: false },
];

/** Le préréglage avec lequel l'atelier ouvre un projet. */
export const PRESET_PAR_DEFAUT = "capcut-pop";

/**
 * Recettes de montage rythmique, bornées pour rester montables à la main après.
 */
export const RYTHME = {
  bpmMin: 60,
  bpmMax: 200,
  /** Autour de chaque temps, on garde cette fenêtre de part et d'autre. */
  gardeeMin: 0.2,
  gardeeMax: 4,
  decalageMax: 4,
};
