/**
 * Import / export de la configuration de rendu.
 *
 * ## Modele de menace
 *
 * Un fichier de configuration est une **donnee non fiable** : il arrive du
 * disque de l'utilisateur, potentiellement recu par message ou telecharge.
 * Trois risques concrets, tous traites ici.
 *
 * 1. **Fuite de secret.** L'identifiant de voix clonee (`clonedVoiceId`) est
 *    lie au compte ai33.pro de l'utilisateur. Partager un preset ne doit pas
 *    partager cet identifiant : il est explicitement exclu de l'export.
 *
 * 2. **Injection par valeur inattendue.** Les options alimentent des chaines
 *    de filtres ffmpeg. Une valeur non prevue (`filterId: "x,drawtext=..."`)
 *    pourrait detourner le graphe. Chaque champ est donc valide contre une
 *    **liste blanche** ou une plage numerique — jamais accepte tel quel.
 *
 * 3. **Pollution de prototype.** `JSON.parse` peut produire une cle
 *    `__proto__`. Zod ne recopie que les champs declares, ce qui neutralise
 *    l'attaque, et on refuse en plus les cles inconnues (`strict()`).
 *
 * L'import est **purement local** : rien n'est envoye au serveur, et le
 * fichier ne peut donc pas servir a exfiltrer des donnees.
 */

import { z } from "zod";

import { SOURCE_LANGUAGES } from "./languages";
import { UPSCALE_MODES, VIDEO_FILTERS } from "./video/filters";
import {
  DEFAULT_MASKS,
  SUBTITLE_PRESETS,
  TARGET_LANGUAGES,
  type SubtitleOverrides,
} from "./video/presets";
import { DEFAULT_RENDER_OPTIONS, type RenderOptions } from "./video/render-options";
import { TRANSITIONS } from "./video/transitions";

/**
 * Version du format. Incrementer si la forme change de facon incompatible.
 *
 * v2 ajoute `timeline` : sans elle, un fichier de configuration ne portait que
 * des REGLAGES (style, masques, options) — jamais le montage lui-meme. Un agent
 * ne pouvait donc pas rendre un travail, seulement ses consignes.
 */
export const CONFIG_VERSION = 2;

/** Taille maximale acceptee, en octets. Une config pese moins de 2 Ko. */
export const MAX_CONFIG_BYTES = 64 * 1024;

const filterIds = VIDEO_FILTERS.map((f) => f.id);
const upscaleIds = UPSCALE_MODES.map((m) => m.id);
const transitionIds = TRANSITIONS.map((t) => t.id);
const presetIds = SUBTITLE_PRESETS.map((p) => p.id);
const sourceCodes = SOURCE_LANGUAGES.map((l) => l.code);
const targetCodes = TARGET_LANGUAGES.map((l) => l.code);
// Les listes ci-dessus sont derivees des constantes de l'application : ajouter
// un filtre ou une transition l'autorise automatiquement a l'import, sans
// risque d'oublier de mettre a jour une seconde liste.

/**
 * Valeur appartenant a une liste blanche.
 *
 * Le parametre de type conserve le type litteral de la liste (`UpscaleMode`
 * plutot que `string`), pour que la sortie du schema s'affecte directement aux
 * options sans conversion — donc sans endroit ou la validation pourrait etre
 * contournee par un `as`.
 */
function oneOf<T extends string>(values: readonly T[]) {
  return z.string().refine((v): v is T => (values as readonly string[]).includes(v), {
    message: "valeur non reconnue",
  }) as unknown as z.ZodType<T>;
}

const zeroToOne = z.number().finite().min(0).max(1);

/**
 * Couleur de texte ou de fond pour `drawtext` : `#rrggbb` ou un nom, avec le
 * suffixe `@alpha` que les préréglages emploient deja (`black@0.55`). La forme
 * compte autant que la liste blanche : une virgule ou un `=` dans cette valeur
 * fermerait l'argument du filtre et detournerait le graphe.
 */
const couleur = z
  .string()
  .min(3)
  .max(24)
  .regex(/^(#[0-9a-fA-F]{6}|[a-zA-Z]{3,12})(@0?\.\d{1,2})?$/);

/**
 * Le style de legende surcharge a la main, champ par champ.
 *
 * Ce sont exactement les cles de `SubtitleOverrides` : un fichier ne peut donc
 * pas reclamer un effet que le moteur ignore (`xAnchor`, `rotation`, ...). Les
 * bornes reprennent celles des curseurs de l'inspecteur, avec le peu de marge
 * que la manipulation directe s'autorise -- un `yAnchor` de 0 ou 0,98 pose a la
 * souris doit pouvoir revenir par un fichier, sinon l'atelier refuserait ses
 * propres exports.
 */
const subtitleSchema = z
  .object({
    fontsize: z.number().finite().min(20).max(170),
    maxCharsPerLine: z.number().int().min(8).max(60),
    maxLines: z.number().int().min(1).max(6),
    // 0...0,98 : la plage du geste sur la legende ; le rendu borne a 0,06...0,94.
    yAnchor: z.number().finite().min(0).max(0.98),
    uppercase: z.boolean(),
    fontColor: couleur,
    boxColor: couleur,
    boxOpacity: zeroToOne,
    borderW: z.number().finite().min(0).max(12),
  })
  .partial()
  // `.partial()` avant `.strict()` : l'inverse ferait perdre le mode strict.
  .strict();

/**
 * Schema des options exportables.
 *
 * `clonedVoiceId` est volontairement absent : c'est un identifiant de compte,
 * il ne doit ni sortir ni entrer par ce canal.
 */
const optionsSchema = z
  .object({
    wordByWord: z.boolean(),
    removeOriginalAudio: z.boolean(),
    cutSilences: z.boolean(),
    mirror: z.boolean(),
    ttsProvider: z.enum(["elevenlabs", "ai33"]),
    filterId: oneOf(filterIds),
    upscale: oneOf(upscaleIds),
    transition: oneOf(transitionIds),
    // Une duree negative ou demesuree casserait `xfade`.
    transitionDuration: z.number().finite().min(0.1).max(3),
    subtitleOpacity: zeroToOne,
    ambienceLevel: zeroToOne,
    maskStrength: z.enum(["light", "medium", "strong"]),
  })
  // `.partial()` AVANT `.strict()` : dans l'autre ordre, `partial()` reconstruit
  // l'objet et perd le mode strict — une cle inconnue passait alors sans bruit.
  .partial()
  .strict();

const maskSchema = z
  .object({
    id: z.string().max(40),
    // Coordonnees relatives : hors de [0,1] elles produiraient un `crop`
    // invalide et feraient echouer tout le rendu.
    x: zeroToOne,
    y: zeroToOne,
    w: zeroToOne,
    h: zeroToOne,
    enabled: z.boolean(),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Timeline                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Les memes champs que le `Clip` de l'editeur, rien d'autre.
 *
 * Un format qui autoriserait `zoom`, `rotation` ou `voiceId` ferait esperer un
 * effet que le moteur ne rend pas : la configuration importee serait silencieuse
 * a l'export. La liste blanche est donc bornee a ce que le graphe FFmpeg consomme
 * reellement.
 */
const clipSchema = z
  .object({
    track: oneOf(["video", "subs", "dub"] as const),
    // 3600 s : au-dela, une seule valeur mal placee produirait un graphe de
    // filtres demesure et un echec d'export sans message utile.
    start: z.number().finite().min(0).max(3600),
    duration: z.number().finite().min(0.12).max(3600),
    text: z.string().max(300).optional(),
    sourceText: z.string().max(300).optional(),
    label: z.string().max(120).optional(),
    speakerId: z.string().max(64).optional(),
  })
  .strict();

const cutSchema = z
  .object({
    start: z.number().finite().min(0).max(3600),
    duration: z.number().finite().min(0.12).max(600),
  })
  .strict();

const timelineSchema = z
  .object({
    // 400 segments et 200 coupes : les memes ordres de grandeur que MAX_CUES du
    // cote sous-titres, au-dela le navigateur s'enfonce avant de rendre.
    clips: z.array(clipSchema).max(400).optional(),
    cuts: z.array(cutSchema).max(200).optional(),
  })
  .strict();

const configSchema = z
  .object({
    app: z.literal("viraldub"),
    version: z.number().int().min(1).max(CONFIG_VERSION),
    presetId: oneOf(presetIds).optional(),
    sourceLanguage: oneOf(sourceCodes).optional(),
    targetLanguage: oneOf(targetCodes).optional(),
    options: optionsSchema.optional(),
    // Borne le nombre de masques : un tableau de 100 000 entrees ferait
    // exploser le graphe de filtres.
    masks: z.array(maskSchema).max(20).optional(),
    timeline: timelineSchema.optional(),
    // Le style de legende surcharge a la main. Sans lui, un export depuis
    // l'atelier perdait le corps et l'ancrage regles a la souris : l'import
    // remettait le preset nu et le montage ne ressemblait plus a rien.
    subtitle: subtitleSchema.optional(),
  })
  .strict();

export type ViralDubConfig = z.infer<typeof configSchema>;

export type ConfigPayload = {
  presetId: string;
  sourceLanguage: string;
  targetLanguage: string;
  options: RenderOptions;
  masks: { id: string; x: number; y: number; w: number; h: number; enabled: boolean }[];
  timeline?: { clips?: BlocConfig[]; cuts?: CoupeConfig[] };
  /**
   * Les surcharges de legende du projet. Facultatif pour qu'un appelant qui
   * n'a que des reglages a exporter (page de presets, par exemple) n'ait pas a
   * inventer un objet vide.
   */
  overrides?: SubtitleOverrides;
};

/** Un bloc de travail tel qu'un fichier de configuration peut le decrire. */
export type BlocConfig = {
  track: "video" | "subs" | "dub";
  start: number;
  duration: number;
  text?: string;
  sourceText?: string;
  label?: string;
  speakerId?: string;
};

/** Une coupe : une plage retiree de la timeline source. */
export type CoupeConfig = { start: number; duration: number };

/** Une timeline bornee sur la duree reelle du plan, avec ce qui a du etre rejete. */
export type TimelineBornee = {
  clips: BlocConfig[];
  cuts: CoupeConfig[];
  rejets: number;
};

/**
 * Serialise la configuration courante.
 *
 * `clonedVoiceId` est retire explicitement plutot qu'oublie : le
 * deconstructeur rend l'intention visible et un ajout futur de champ sensible
 * se remarquera a la relecture.
 */
export function exportConfig(payload: ConfigPayload): string {
  const { clonedVoiceId: _omit, ...safeOptions } = payload.options;

  const config: ViralDubConfig = {
    app: "viraldub",
    version: CONFIG_VERSION,
    presetId: payload.presetId,
    sourceLanguage: payload.sourceLanguage,
    targetLanguage: payload.targetLanguage,
    options: safeOptions,
    ...(payload.timeline ? { timeline: payload.timeline } : {}),
    ...(payload.overrides && Object.keys(payload.overrides).length > 0
      ? { subtitle: payload.overrides }
      : {}),
    masks: payload.masks.map((m) => ({
      id: m.id,
      x: m.x,
      y: m.y,
      w: m.w,
      h: m.h,
      enabled: m.enabled,
    })),
  };

  return JSON.stringify(config, null, 2);
}

export type ImportResult = { ok: true; config: ViralDubConfig } | { ok: false; error: string };

/**
 * Analyse et valide un fichier de configuration.
 *
 * Ne leve jamais : renvoie un resultat explicite, pour que l'appelant affiche
 * un message plutot qu'un ecran blanc.
 */
export function parseConfig(raw: string): ImportResult {
  if (raw.length > MAX_CONFIG_BYTES) {
    return { ok: false, error: "Fichier trop volumineux pour une configuration." };
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Fichier illisible : ce n'est pas du JSON valide." };
  }

  const parsed = configSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".");
    return {
      ok: false,
      error: path
        ? `Configuration invalide (${path} : ${issue.message}).`
        : "Ce fichier n'est pas une configuration ViralDub.",
    };
  }

  return { ok: true, config: parsed.data };
}

/**
 * Fusionne une configuration importee avec les valeurs courantes.
 *
 * Un champ absent conserve sa valeur actuelle : un fichier partiel reste
 * utilisable, et un champ ajoute dans une version ulterieure n'est jamais
 * `undefined` cote application.
 */
export function applyConfig(config: ViralDubConfig, current: ConfigPayload): ConfigPayload {
  const knownMaskIds = new Set(DEFAULT_MASKS.map((m) => m.id));

  return {
    presetId: config.presetId ?? current.presetId,
    sourceLanguage: config.sourceLanguage ?? current.sourceLanguage,
    targetLanguage: config.targetLanguage ?? current.targetLanguage,
    options: {
      ...current.options,
      ...config.options,
      // Jamais importe : reste celui de la session en cours.
      clonedVoiceId: current.options.clonedVoiceId,
    },
    masks: config.masks
      ? // Un masque dont l'identifiant est inconnu ne correspond a aucune zone
        // de l'interface : l'ignorer evite un etat incoherent.
        current.masks.map((m) => {
          const imported = config.masks?.find((i) => i.id === m.id);
          return imported && knownMaskIds.has(imported.id) ? { ...m, ...imported } : m;
        })
      : current.masks,
    // Absente du fichier, la timeline du projet reste telle quelle : un
    // reglage de style ne doit pas demonter un montage.
    timeline: config.timeline ?? current.timeline,
    // Idem pour la legende : le fichier porte le style complet, pas un melange
    // avec celui d'avant, sinon deux imports successifs s'empilent.
    ...(config.subtitle ? { overrides: config.subtitle } : {}),
  };
}

/**
 * Borner une timeline sur la duree reelle du plan.
 *
 * Un bloc qui commence apres la derniere image, ou qui la depasse, ne serait
 * pas rejete par le moteur : il produirait un graphe `trim` incoherent. Ici on
 * rogne ce qui depasse et on compte ce qui tombe, pour que l'appelant puisse le
 * dire au lieu de se taire.
 */
export function bornerTimeline(
  timeline: NonNullable<ConfigPayload["timeline"]>,
  dureeSource: number,
): TimelineBornee {
  const clips = [...(timeline.clips ?? [])].sort((a, b) => a.start - b.start);
  const cuts = [...(timeline.cuts ?? [])].sort((a, b) => a.start - b.start);
  let rejets = 0;

  const garde = dureeSource > 0 ? Number.isFinite(dureeSource) : true;
  if (!garde) return { clips: [], cuts: [], rejets: clips.length + cuts.length };

  const bornes = (entree: { start: number; duration: number }) => {
    if (dureeSource > 0 && entree.start >= dureeSource - 0.12) {
      rejets += 1;
      return null;
    }
    const duree =
      dureeSource > 0
        ? Math.max(0.12, Math.min(entree.duration, dureeSource - entree.start))
        : entree.duration;
    return {
      ...entree,
      start: Math.round(entree.start * 1000) / 1000,
      duration: Math.round(duree * 1000) / 1000,
    };
  };

  return {
    clips: clips
      .map((c) => {
        const b = bornes(c);
        return b ? { ...c, ...b } : null;
      })
      .filter((c): c is NonNullable<typeof c> => c !== null),
    cuts: cuts
      .map((c) => {
        const b = bornes(c);
        return b ? { ...c, ...b } : null;
      })
      .filter((c): c is NonNullable<typeof c> => c !== null),
    rejets,
  };
}

/** Nom de fichier propose au telechargement. */
export function configFileName(date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10);
  return `viraldub-config-${stamp}.json`;
}

/** Options par defaut, exposees pour reinitialiser depuis l'interface. */
export const DEFAULT_CONFIG_OPTIONS = DEFAULT_RENDER_OPTIONS;
