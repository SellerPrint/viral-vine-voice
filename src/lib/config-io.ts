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
import { DEFAULT_MASKS, SUBTITLE_PRESETS, TARGET_LANGUAGES } from "./video/presets";
import { DEFAULT_RENDER_OPTIONS, type RenderOptions } from "./video/render-options";
import { TRANSITIONS } from "./video/transitions";

/** Version du format. Incrementer si la forme change de facon incompatible. */
export const CONFIG_VERSION = 1;

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
  })
  .strict();

export type ViralDubConfig = z.infer<typeof configSchema>;

export type ConfigPayload = {
  presetId: string;
  sourceLanguage: string;
  targetLanguage: string;
  options: RenderOptions;
  masks: { id: string; x: number; y: number; w: number; h: number; enabled: boolean }[];
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
  };
}

/** Nom de fichier propose au telechargement. */
export function configFileName(date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10);
  return `viraldub-config-${stamp}.json`;
}

/** Options par defaut, exposees pour reinitialiser depuis l'interface. */
export const DEFAULT_CONFIG_OPTIONS = DEFAULT_RENDER_OPTIONS;
