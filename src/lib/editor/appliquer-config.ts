import { applyConfig, bornerTimeline, exportConfig, parseConfig } from "@/lib/config-io";
import { SOURCE_LANGUAGES } from "@/lib/languages";
import { TARGET_LANGUAGES } from "@/lib/video/presets";
import { makeClip } from "@/lib/editor/project";
import type { Clip, Project } from "@/lib/editor/types";

/**
 * La porte unique par laquelle une configuration entre dans l'atelier.
 *
 * Deux origines, un seul chemin : le fichier posé sur la table (onglet Projet →
 * Importer) et le document que rend le fil MCP (`POST /api/mcp`). Les deux
 * passent ici, parce qu'un second implémenteur de la même fusion finirait par
 * diverger — c'est exactement la famille de bugs déjà vue dans ce dépôt, où
 * l'aperçu et l'encodage s'étaient séparés sur la plaque du texte.
 *
 * Le reste de l'application n'est pas court-circuité pour autant : `parseConfig`
 * valide bornes et formes avant toute écriture dans le projet, et
 * `bornerTimeline` écarte les segments qui dépasseraient la durée réelle du
 * plan — un agent peut composer un montage plus long que la vidéo, il doit
 * obtenir le montage tronqué et le savoir, pas un plan qui joue dans le vide.
 */

/**
 * Ce que le projet porte actuellement, écrit au format du fichier de réglages.
 *
 * La même fonction sert au bouton « Exporter » et à l'envoi vers le fil MCP :
 * ce qui sort de l'atelier est donc décrit une seule fois — notamment
 * l'oubli volontaire de `clonedVoiceId`, qui reste dans le compte de
 * l'utilisateur quel que soit le destinataire.
 */
export function configurationDuProjet(project: Project): string {
  return exportConfig({
    presetId: project.presetId,
    sourceLanguage: project.sourceLanguage.code,
    targetLanguage: project.targetLanguage.code,
    options: {
      wordByWord: project.wordByWord,
      removeOriginalAudio: project.removeOriginalAudio,
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
    },
    masks: project.masks,
    // Le corps et l'ancrage réglés à la souris voyagent avec le reste : un
    // fichier qui ne dirait que « preset karaoké » perdrait la typographie.
    overrides: project.overrides,
    // Le montage voyage avec les réglages : sans les blocs, un agent ne recevait
    // qu'une fiche de style, et devait tout recomposer à la main.
    timeline: {
      // flatMap plutot que filter+map : c'est le test sur `track` qui doit
      // restreindre le type, sinon « cuts » se glisse dans les blocs exportés.
      clips: project.clips.flatMap((clip) =>
        clip.track === "cuts"
          ? []
          : [
              {
                track: clip.track,
                start: clip.start,
                duration: clip.duration,
                label: clip.label,
                ...(clip.text ? { text: clip.text } : {}),
                ...(clip.sourceText ? { sourceText: clip.sourceText } : {}),
                ...(clip.speakerId ? { speakerId: clip.speakerId } : {}),
              },
            ],
      ),
      cuts: project.clips
        .filter((clip) => clip.track === "cuts")
        .map((clip) => ({ start: clip.start, duration: clip.duration })),
    },
  });
}

export type CibleApplication = {
  patch: (patch: Partial<Project>) => void;
  notify: (avis: { kind: "ok" | "warn" | "error"; text: string }) => void;
};

/**
 * Les deux portes disent la même chose à leur manière : le texte reste celui que
 * l'utilisateur connaît (« Montage importé : … » pour le fichier), et celui de
 * l'agent nomme sa source — un montage qui arrive tout seul doit être nommé.
 */
const PHRASES = {
  fichier: { montage: "Montage importé", config: "Configuration importée." },
  agent: { montage: "Montage venu de l'agent", config: "Configuration venue de l'agent." },
} as const;

/** `true` si le projet a été modifié, `false` si la configuration a été refusée. */
export function appliquerConfiguration(
  brut: string,
  project: Project,
  cible: CibleApplication,
  origine: "fichier" | "agent" = "fichier",
): boolean {
  const result = parseConfig(brut);
  if (!result.ok) {
    cible.notify({ kind: "error", text: result.error });
    return false;
  }

  const merged = applyConfig(result.config, {
    presetId: project.presetId,
    sourceLanguage: project.sourceLanguage.code,
    targetLanguage: project.targetLanguage.code,
    options: {
      wordByWord: project.wordByWord,
      removeOriginalAudio: project.removeOriginalAudio,
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
    },
    masks: project.masks,
    overrides: project.overrides,
  });

  cible.patch({
    presetId: merged.presetId,
    // Le fichier porte le style complet ou rien : on ne melange pas un import
    // avec la reglure precedente, sinon deux imports successifs s'empilent.
    overrides: merged.overrides ?? {},
    sourceLanguage:
      SOURCE_LANGUAGES.find((item) => item.code === merged.sourceLanguage) ??
      project.sourceLanguage,
    targetLanguage:
      TARGET_LANGUAGES.find((item) => item.code === merged.targetLanguage) ??
      project.targetLanguage,
    wordByWord: merged.options.wordByWord,
    removeOriginalAudio: merged.options.removeOriginalAudio,
    cutSilences: merged.options.cutSilences,
    mirror: merged.options.mirror,
    ttsProvider: merged.options.ttsProvider,
    clonedVoiceId: merged.options.clonedVoiceId,
    filterId: merged.options.filterId,
    upscale: merged.options.upscale,
    transition: merged.options.transition,
    transitionDuration: merged.options.transitionDuration,
    boxOpacity: merged.options.subtitleOpacity,
    ambienceLevel: merged.options.ambienceLevel,
    maskStrength: merged.options.maskStrength,
    masks: project.masks.map((zone) => {
      const imported = merged.masks.find((item) => item.id === zone.id);
      return imported ? { ...zone, ...imported } : zone;
    }),
  });

  // La timeline, elle, remplace les pistes de travail : on ne peut pas
  // « fusionner » deux montages, on choisit l'un ou l'autre. Le plan lui-même
  // reste en place — sinon l'import d'un montage démonte la vidéo qu'il cadre.
  if (!merged.timeline) {
    cible.notify({ kind: "ok", text: PHRASES[origine].config });
    return true;
  }

  const borne = bornerTimeline(merged.timeline, project.source?.duration ?? 0);
  const surcharges = (clip: {
    text?: string;
    sourceText?: string;
    label?: string;
    speakerId?: string;
  }) => {
    const extra: Partial<Clip> = {};
    if (clip.label) extra.label = clip.label;
    if (clip.text) extra.text = clip.text;
    if (clip.sourceText) extra.sourceText = clip.sourceText;
    if (clip.speakerId) extra.speakerId = clip.speakerId;
    return extra;
  };
  const blocs = [
    ...project.clips.filter((clip) => clip.track === "video"),
    ...borne.clips.map((clip) =>
      makeClip(
        clip.track,
        { start: clip.start, end: clip.start + clip.duration },
        surcharges(clip),
      ),
    ),
    ...borne.cuts.map((coupe) =>
      makeClip(
        "cuts",
        { start: coupe.start, end: coupe.start + coupe.duration },
        { reason: "manuel" },
      ),
    ),
  ];
  cible.patch({ clips: blocs });
  cible.notify({
    kind: borne.rejets > 0 ? "warn" : "ok",
    text:
      borne.rejets > 0
        ? `${PHRASES[origine].montage} : ${borne.clips.length} bloc(s), ${borne.cuts.length} coupe(s) — ${borne.rejets} segment(s) hors durée écartés.`
        : `${PHRASES[origine].montage} : ${borne.clips.length} bloc(s), ${borne.cuts.length} coupe(s).`,
  });
  return true;
}
