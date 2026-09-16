import { makeClip } from "./project";
import type { Clip, Project } from "./types";
import { cadreCouvrant, type MaskZone } from "@/lib/video/presets";

/**
 * Formats viraux 9:16 — un clic pose le cadre, pas seulement une police.
 *
 * Chaque modèle écrit masques, style de légende et, si la piste est libre,
 * un bloc hook ou outro. Pas de zoom caméra : le graphe ffmpeg n'est pas
 * réécrit. « Zoom punch » = légendes géantes au centre, mot à mot.
 *
 * Le bandeau `bottom` est le cadre couvrant : dès qu'il est allumé, la légende
 * s'ancre sur lui (`ancreLegende`). Le hook a donc besoin d'un masque *autre*
 * (`st-origine`) pour flouter l'ancien ST sans coller le texte dessus.
 */

export type ViralTemplateId = "hook" | "punch" | "bandeau" | "outro";

export type ViralTemplate = {
  id: ViralTemplateId;
  name: string;
  tagline: string;
  /** Position de la légende dans la maquette 9:16 (haut / centre / bas). */
  caption: "top" | "center" | "bottom";
  accent: string;
};

export const VIRAL_TEMPLATES: ViralTemplate[] = [
  {
    id: "hook",
    name: "Hook 3 s",
    tagline: "Texte en haut les 3 premières secondes, ancien ST flouté en bas.",
    caption: "top",
    accent: "#ffd400",
  },
  {
    id: "punch",
    name: "Zoom punch",
    tagline: "Légendes géantes au centre, mot à mot, look CapCut Pop.",
    caption: "center",
    accent: "#ffd400",
  },
  {
    id: "bandeau",
    name: "Bandeau bas",
    tagline: "Plaque basse qui recouvre les sous-titres d'origine, légende calée dessus.",
    caption: "bottom",
    accent: "#00e5c8",
  },
  {
    id: "outro",
    name: "Outro",
    tagline: "Un appel à l'action sur les 2 dernières secondes, sans bouger le reste.",
    caption: "bottom",
    accent: "#FF0050",
  },
];

export function viralTemplate(id: string): ViralTemplate | undefined {
  return VIRAL_TEMPLATES.find((item) => item.id === id);
}

const HOOK_WINDOW = { start: 0.15, end: 2.85 };
const OUTRO_SECONDS = 2.2;
const ORIGIN_ST = "st-origine";

function overlaps(clip: Clip, start: number, end: number): boolean {
  const clipEnd = clip.start + clip.duration;
  return clip.track === "subs" && clip.start < end && clipEnd > start;
}

function copyMasks(masks: MaskZone[]): MaskZone[] {
  return masks.map((zone) => ({ ...zone }));
}

function setEnabled(masks: MaskZone[], id: string, enabled: boolean): MaskZone[] {
  return masks.map((zone) => (zone.id === id ? { ...zone, enabled } : zone));
}

function tuneMask(masks: MaskZone[], id: string, patch: Partial<MaskZone>): MaskZone[] {
  return masks.map((zone) => (zone.id === id ? { ...zone, ...patch } : zone));
}

/** Masque de flou hors cadre couvrant : l'ancien ST devient illisible, la légende reste libre. */
function withOriginCover(masks: MaskZone[], on: boolean): MaskZone[] {
  const next = masks.map((zone) =>
    zone.id === ORIGIN_ST
      ? { ...zone, enabled: on, x: 0, y: 0.82, w: 1, h: 0.14 }
      : zone,
  );
  if (on && !next.some((zone) => zone.id === ORIGIN_ST)) {
    next.push({
      id: ORIGIN_ST,
      label: "Ancien ST (bas)",
      x: 0,
      y: 0.82,
      w: 1,
      h: 0.14,
      enabled: true,
    });
  }
  return next;
}

export type TemplateApply = {
  patch: Partial<Project>;
  added: number;
  notice: string;
};

/**
 * Applique un format viral. Pur : le projet d'entrée n'est pas muté.
 */
export function applyViralTemplate(project: Project, id: ViralTemplateId): TemplateApply {
  const duration = project.source?.duration ?? 0;
  const subs = project.clips.filter((clip) => clip.track === "subs");

  if (id === "hook") {
    const masks = withOriginCover(
      setEnabled(setEnabled(copyMasks(project.masks), "bottom", false), "top", false),
      true,
    );
    const busy = subs.some((clip) => overlaps(clip, HOOK_WINDOW.start, HOOK_WINDOW.end));
    const extra: Clip[] = busy
      ? []
      : [
          makeClip(
            "subs",
            { start: HOOK_WINDOW.start, end: Math.min(HOOK_WINDOW.end, duration || HOOK_WINDOW.end) },
            { text: "Écris ton hook ici", sourceText: "Écris ton hook ici" },
          ),
        ];
    return {
      patch: {
        masks,
        clips: extra.length ? [...project.clips, ...extra] : project.clips,
        presetId: "capcut-pop",
        wordByWord: true,
        boxOpacity: 0,
        filterId: "vivid",
        maskStrength: "medium",
        overrides: { yAnchor: 0.16, fontsize: 118, uppercase: true, borderW: 12, fontColor: "yellow" },
      },
      added: extra.length,
      notice: extra.length
        ? "Hook 3 s posé : légende en haut, ancien ST flouté en bas. Écris le texte du bloc, puis Auto sous-titres pour le reste."
        : "Cadre Hook 3 s posé (texte en haut, ancien ST flouté). Un bloc occupait déjà le début : il n'a pas été remplacé.",
    };
  }

  if (id === "punch") {
    const masks = withOriginCover(
      setEnabled(copyMasks(project.masks), "bottom", false),
      true,
    );
    return {
      patch: {
        masks,
        presetId: "capcut-pop",
        wordByWord: true,
        boxOpacity: 0,
        filterId: "vivid",
        overrides: { yAnchor: 0.52, fontsize: 132, uppercase: true, borderW: 14, fontColor: "yellow" },
      },
      added: 0,
      notice:
        "Zoom punch : légendes géantes au centre, mot à mot. Pas de zoom caméra — le graphe d'encodage reste le même.",
    };
  }

  if (id === "bandeau") {
    const masks = withOriginCover(
      tuneMask(copyMasks(project.masks), "bottom", {
        enabled: true,
        x: 0,
        y: 0.74,
        w: 1,
        h: 0.18,
      }),
      false,
    );
    return {
      patch: {
        masks,
        presetId: "capcut-classic",
        wordByWord: true,
        boxOpacity: 0,
        maskStrength: "medium",
        overrides: { yAnchor: 0.83, fontsize: 96, uppercase: false, borderW: 10, fontColor: "white" },
      },
      added: 0,
      notice:
        "Bandeau bas posé : il recouvre les sous-titres d'origine, la légende s'ancre au centre de la plaque.",
    };
  }

  // outro
  const end = duration > 0 ? duration : OUTRO_SECONDS;
  const start = Math.max(0, end - OUTRO_SECONDS);
  const busy = subs.some((clip) => overlaps(clip, start, end));
  const extra: Clip[] =
    busy || end - start < 0.4
      ? []
      : [
          makeClip(
            "subs",
            { start, end },
            { text: "Suis pour plus", sourceText: "Suis pour plus" },
          ),
        ];
  return {
    patch: {
      clips: extra.length ? [...project.clips, ...extra] : project.clips,
      presetId: project.presetId === "discret" ? "capcut-pop" : project.presetId,
      wordByWord: true,
    },
    added: extra.length,
    notice: extra.length
      ? "Outro posé sur les 2 dernières secondes. Change le texte du bloc — le reste du montage reste en place."
      : end - start < 0.4
        ? "Plan trop court pour une outro de 2 s."
        : "Cadre outro : un bloc occupait déjà la fin, il n'a pas été remplacé.",
  };
}

/** Quel format colle à l'état courant, pour marquer la carte active. */
export function matchingViralTemplate(project: Project): ViralTemplateId | null {
  const covering = cadreCouvrant(project.masks);
  const y = project.overrides.yAnchor;
  const size = project.overrides.fontsize ?? 0;
  if (covering?.id === "bottom" && covering.y >= 0.7) return "bandeau";
  if (typeof y === "number" && y < 0.28 && size >= 110) return "hook";
  if (typeof y === "number" && y > 0.42 && y < 0.62 && size >= 120) return "punch";
  const duration = project.source?.duration ?? 0;
  if (duration > 0) {
    const from = Math.max(0, duration - OUTRO_SECONDS);
    const hasOutro = project.clips.some(
      (clip) =>
        clip.track === "subs" &&
        clip.start >= from - 0.08 &&
        /suis pour plus/i.test(clip.text ?? ""),
    );
    if (hasOutro) return "outro";
  }
  return null;
}
