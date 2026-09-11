import { DEFAULT_SOURCE_LANGUAGE } from "@/lib/languages";
import {
  DEFAULT_MASKS,
  SUBTITLE_PRESETS,
  TARGET_LANGUAGES,
  type MaskZone,
  type SubtitleOverrides,
  type SubtitlePreset,
} from "@/lib/video/presets";
import type { Segment } from "@/lib/video/subtitles/cues";
import type { Range } from "./edl";
import { clamp, keptRanges, normalizeRanges, round3 } from "./edl";
import type { Clip, Project, Quality, SourceMedia, TrackId } from "./types";

/**
 * Fabrique d'états de projet.
 *
 * Ce module est le seul endroit où l'on sait à quoi ressemble « un projet sans
 * rien dessus » et « le projet de démonstration ». Les composants ne font
 * qu'appeler ces fonctions, ce qui garde l'annulation/le rejeu trivialement
 * cohérents : toute mutation passe par un objet `Project` complet.
 */

let sequence = 0;

/**
 * Identifiant local.
 *
 * Volontairement pas `crypto.randomUUID()` : appelé pendant le rendu initial,
 * il ferait diverger l'HTML côté serveur et côté client (erreurs
 * d'hydratation). Ce compteur n'avance que dans les gestionnaires d'événements,
 * donc côté client uniquement.
 */
export function nextId(prefix = "clip"): string {
  sequence += 1;
  return `${prefix}-${sequence.toString(36)}`;
}

export const EMPTY_PROJECT: Project = {
  name: "Nouveau montage",
  source: null,
  clips: [],
  masks: DEFAULT_MASKS.map((m) => ({ ...m })),
  presetId: SUBTITLE_PRESETS[0].id,
  overrides: {},
  wordByWord: true,
  boxOpacity: 0,
  removeOriginalAudio: false,
  ambienceLevel: 0.25,
  cutSilences: true,
  transition: "none",
  transitionDuration: 0.3,
  mirror: false,
  filterId: "none",
  upscale: "none",
  maskStrength: "medium",
  sourceLanguage: DEFAULT_SOURCE_LANGUAGE,
  targetLanguage: TARGET_LANGUAGES[0],
  ttsProvider: "elevenlabs",
  clonedVoiceId: "",
  quality: "standard" as Quality,
};

/* -------------------------------------------------------------------------- */
/* Clips                                                                       */
/* -------------------------------------------------------------------------- */

export type CuePatch = {
  text?: string;
  sourceText?: string;
  speakerId?: string;
  start?: number;
  duration?: number;
  audioUrl?: string;
  peaks?: number[];
};

export function makeClip(track: TrackId, range: Range, extra: Partial<Clip> = {}): Clip {
  const start = round3(Math.max(0, Math.min(range.start, range.end)));
  const end = round3(Math.max(range.start, range.end));
  return {
    id: nextId(track),
    track,
    start,
    duration: Math.max(0.12, round3(end - start)),
    label: extra.label ?? defaultLabel(track, extra),
    ...extra,
  };
}

function defaultLabel(track: TrackId, extra: Partial<Clip>): string {
  if (extra.label) return extra.label;
  if (track === "subs") return (extra.text ?? "Sous-titre").slice(0, 28);
  if (track === "cuts") return extra.reason === "silence" ? "Silence" : "Coupe";
  if (track === "dub") return "Voix off";
  return "Plan";
}

/** Clips d'une piste, triés par position. */
export function clipsOn(clips: Clip[], track: TrackId): Clip[] {
  return clips.filter((c) => c.track === track).sort((a, b) => a.start - b.start);
}

/** Plages retirées du montage, telles que le moteur de rendu les attend. */
export function cutRanges(clips: Clip[]): Range[] {
  return normalizeRanges(
    clips
      .filter((c) => c.track === "cuts")
      .map((c) => ({ start: c.start, end: c.start + c.duration })),
  );
}

export function clipRange(clip: Clip): Range {
  return { start: clip.start, end: clip.start + clip.duration };
}

/** Remplace la plage d'un clip en gardant sa durée si `end` est omis. */
export function applyRange(clips: Clip[], id: string, range: Range, duration?: number): Clip[] {
  return clips.map((clip) => {
    if (clip.id !== id) return clip;
    const start = round3(Math.max(0, range.start));
    const end = round3(Math.max(start + 0.12, range.end));
    return { ...clip, start, duration: duration ?? end - start };
  });
}

/* -------------------------------------------------------------------------- */
/* Rejet du pipeline dans la timeline                                           */
/* -------------------------------------------------------------------------- */

export type PipelineIngest = {
  clips: Clip[];
  masks: MaskZone[];
  warnings: string[];
  /** Nombre de blocs créés, pour le message de confirmation. */
  cues: number;
  cuts: number;
};

/**
 * Transforme le résultat d'un doublage IA en pistes éditables.
 *
 * C'est le geste qui fait de l'ensemble un éditeur et non un formulaire : une
 * fois la machine passée, chaque phrase devient un bloc que l'on déplace, chaque
 * silence une coupe que l'on peut refuser.
 */
export function ingestPipeline(
  project: Project,
  input: { segments: Segment[]; cuts?: Range[] },
): PipelineIngest {
  const duration = project.source?.duration ?? 0;
  const warnings: string[] = [];

  const subs: Clip[] = input.segments
    .filter((s) => (s.textEn || s.textFr).trim())
    .map((s) =>
      makeClip(
        "subs",
        { start: s.start, end: Math.max(s.end, s.start + 0.2) },
        {
          text: s.textEn.trim() || s.textFr.trim(),
          sourceText: s.textFr.trim(),
          speakerId: s.speakerId,
        },
      ),
    );

  const cuts: Clip[] = (input.cuts ?? [])
    .map((r) => ({ start: round3(r.start), end: round3(r.end) }))
    .filter((r) => r.end - r.start > 0.05)
    .map((r) => makeClip("cuts", r, { reason: "silence" }));

  // Seules les coupes automatiques sont remplacées : la liste sortie du
  // pipeline ne connaît pas les plages retirées à la main, et effacer le
  // travail du monteur au moment d'un doublage serait impardonnable.
  const manualCuts = project.clips.filter(
    (clip) => clip.track === "cuts" && clip.reason !== "silence",
  );
  const otherClips = project.clips.filter((clip) => clip.track !== "subs" && clip.track !== "cuts");

  if (subs.length === 0) {
    warnings.push(
      "Aucun sous-titre n'a pu être posé sur la piste : vérifie la transcription avant de réessayer.",
    );
  }
  let trimmed = 0;
  if (duration > 0) {
    // Un clip posé hors cadre ne serait ni visible ni saisissable : on le
    // ramène dans la source plutôt que de le laisser flotter.
    for (const clip of subs) {
      if (clip.start + clip.duration > duration + 0.05) {
        clip.duration = round3(Math.max(MIN_CUE, duration - clip.start));
        trimmed += 1;
      }
    }
    if (trimmed > 0) {
      warnings.push(
        `${trimmed} sous-titre(s) dépassaient la durée de la vidéo : rogné(s) à la dernière image.`,
      );
    }
  }

  return {
    clips: [...otherClips, ...manualCuts, ...subs, ...cuts],
    masks: project.masks,
    warnings,
    cues: subs.length,
    cuts: cuts.length,
  };
}

/** Plages réellement conservées par le moteur, compte tenu des coupes. */
export function projectKeeps(project: Project): Range[] {
  const duration = project.source?.duration ?? 0;
  return keptRanges(duration, cutRanges(project.clips));
}

export function projectPreset(project: Project): SubtitlePreset {
  return resolvePresetById(project.presetId, project.overrides);
}

export function resolvePresetById(id: string, overrides: SubtitleOverrides): SubtitlePreset {
  const base = SUBTITLE_PRESETS.find((p) => p.id === id) ?? SUBTITLE_PRESETS[0];
  return { ...base, ...overrides };
}

/** Borne une position normalisée dans le cadre, avec une marge saisissable. */
export function clampZone(zone: MaskZone, minSize = 0.03): MaskZone {
  const w = clamp(zone.w, minSize, 1);
  const h = clamp(zone.h, minSize, 1);
  return {
    ...zone,
    w: round3(w),
    h: round3(h),
    x: round3(clamp(zone.x, 0, 1 - w)),
    y: round3(clamp(zone.y, 0, 1 - h)),
  };
}

/* -------------------------------------------------------------------------- */
/* Projet de démonstration                                                      */
/* -------------------------------------------------------------------------- */

/** Fenêtres de parole du clip livré dans `public/demo/`. */
const DEMO_LINES: { start: number; end: number; fr: string; en: string }[] = [
  { start: 0.4, end: 2.4, fr: "tu veux doubler tes vidéos", en: "you want to dub your clips" },
  {
    start: 3.0,
    end: 5.2,
    fr: "sans quitter ton navigateur",
    en: "without leaving your browser",
  },
  { start: 5.9, end: 7.6, fr: "on retire les sous-titres", en: "we erase the burned captions" },
  {
    start: 8.3,
    end: 10.4,
    fr: "on traduit puis on ajoute la voix",
    en: "we translate then add the voice",
  },
  { start: 11.2, end: 13.0, fr: "et on coupe les silences", en: "and we cut every pause" },
  { start: 13.7, end: 15.4, fr: "prêt à publier", en: "ready to publish" },
];

/** Durée minimale d'un cue, celle du moteur de rendu. */
const MIN_CUE = 0.12;

/**
 * Projet de démonstration : le clip `public/demo/tiktok-demo.mp4` (16 s,
 * sous-titres incrustés en bas, watermark en haut à gauche, logo en haut à
 * droite) et une timeline déjà peuplée.
 *
 * Il permet de manipuler l'éditeur — trim, coupe, masques, style — sans clé API
 * ni import de fichier, et de lancer un vrai rendu local.
 */
export function demoProject(source: SourceMedia): Project {
  // Les blocs sont recalés sur la durée *réelle* du média chargé : un clip de
  // substitution plus court ne doit pas éjecter des blocs hors champ, où ils
  // seraient impossibles à sélectionner à la souris.
  const limit = (value: number) => (source.duration > 0 ? Math.min(value, source.duration) : value);
  const lines = DEMO_LINES.filter((line) => line.start < limit(line.end) - MIN_CUE);
  const clips: Clip[] = [
    ...lines.map((line) =>
      makeClip(
        "subs",
        { start: line.start, end: limit(line.end) },
        { text: line.en, sourceText: line.fr },
      ),
    ),
    ...lines.slice(0, 5).map((line, i) =>
      makeClip(
        "dub",
        { start: line.start, end: limit(line.end) },
        {
          label: `PRISE ${i + 1}`,
          peaks: fakePeaks(limit(line.end) - line.start, i + 3),
        },
      ),
    ),
  ];

  return {
    ...EMPTY_PROJECT,
    name: "Démo — doublage vertical",
    source: { ...source, demo: true },
    clips,
    presetId: "capcut-pop",
    boxOpacity: 0,
    masks: DEFAULT_MASKS.map((m) =>
      m.id === "bottom"
        ? { ...m, enabled: true, y: 0.75, h: 0.145 }
        : m.id === "tl" || m.id === "tr"
          ? { ...m, enabled: true }
          : m,
    ),
    filterId: "vivid",
  };
}

/**
 * Forme d'onde de démonstration.
 *
 * Elle imite une enveloppe syllabique pour que la piste audio soit lisible sans
 * avoir à décoder un WAV : c'est un ornement d'aperçu, pas une mesure.
 */
export function fakePeaks(duration: number, seed = 1): number[] {
  const buckets = Math.max(12, Math.min(90, Math.round(duration * 12)));
  const out: number[] = [];
  for (let i = 0; i < buckets; i++) {
    const x = i / buckets;
    const syllable = Math.abs(Math.sin(x * Math.PI * duration * 3.4 + seed));
    const taper = Math.sin(Math.PI * x) ** 0.6;
    out.push(round3(0.18 + 0.8 * syllable * taper));
  }
  return out;
}
