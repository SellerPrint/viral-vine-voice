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
export const PISTES = ["video", "subs", "dub"];
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
export const TRANSITIONS = ["none", "fade", "fadeblack", "dissolve", "slideleft"];

/** Modes d'agrandissement (`UPSCALE_MODES` côté app). */
export const UPSCALE = ["none", "1440", "2160"];

/** Filtres d'image (`VIDEO_FILTERS` côté app). */
export const FILTRES = ["none", "pure", "vivid", "warm", "cool", "film", "bw"];

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
