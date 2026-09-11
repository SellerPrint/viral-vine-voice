import {
  clamp,
  dragRange,
  keptRanges,
  normalizeRanges,
  outputDuration,
  pushApart,
  round3,
  splitRange,
  type Range,
} from "./edl";
import { clipRange, clipsOn, cutRanges, makeClip } from "./project";
import {
  canRedo,
  canUndo,
  commit,
  createHistory,
  redo,
  seal as sealHistory,
  undo,
  type History,
} from "./history";
import type { MaskZone } from "@/lib/video/presets";
import type { Clip, Project } from "./types";

/**
 * Le réducteur du monteur — pur, sans React ni DOM.
 *
 * Chaque geste de la timeline (glisser un bloc, tirer une poignée, couper à la
 * tête de lecture) se termine ici. Le garder pur a un motif très concret : ces
 * gestes sont exactement ceux qui, dans un éditeur, produisent des états
 * incohérents — un clip de durée négative après un trim trop long, un sous-titre
 * éjecté hors du média, une coupe qui en avale une autre. Ces classes de bug ne
 * se voient qu'en rejouant des séries de gestes, ce qu'un test fait très bien et
 * ce qu'un testeur humain fait mal.
 */

export type PanelTab =
  | "media"
  | "cuts"
  | "subtitles"
  | "style"
  | "audio"
  | "effects"
  | "transitions"
  | "masks"
  | "project";

export type InspectorTab = "clip" | "style" | "audio" | "project";

export type Selection =
  { kind: "clip"; id: string } | { kind: "mask"; id: string } | { kind: "source" } | null;

export type Notice = { kind: "info" | "warn" | "error" | "ok"; text: string } | null;

export type UiState = {
  tab: PanelTab;
  inspectorTab: InspectorTab;
  playhead: number;
  playing: boolean;
  /** Pixels par seconde sur la timeline. */
  zoom: number;
  snap: boolean;
  showSubs: boolean;
  showMasks: boolean;
  /** La scène affiche le dernier rendu plutôt que la source. */
  compare: boolean;
  renderUrl: string | null;
  renderNote: string | null;
  busy: string | null;
  notice: Notice;
  exportOpen: boolean;
  /**
   * Onglet que la boîte d'export doit ouvrir.
   *
   * « Doublage IA » et « Exporter » ne visent pas la même chose : sans ce
   * champ, le premier ouvrait le rendu local, et l'utilisateur lançait un
   * encodage sans voix en croyant lancer le doublage.
   */
  exportMode: "local" | "ia";
};

export type EditorState = {
  /** L'unique implémentation de l'annulation vit dans `history.ts`. */
  hist: History<Project>;
  selection: Selection;
  ui: UiState;
};

export const MIN_CLIP = 0.12;

export const INITIAL_UI: UiState = {
  tab: "media",
  inspectorTab: "clip",
  playhead: 0,
  playing: false,
  zoom: 46,
  snap: true,
  showSubs: true,
  showMasks: true,
  compare: false,
  renderUrl: null,
  renderNote: null,
  busy: null,
  notice: null,
  exportOpen: false,
  exportMode: "local",
};

export type Action =
  | { type: "patch"; patch: Partial<Project>; mergeKey?: string }
  | { type: "clips"; clips: Clip[]; mergeKey?: string; select?: string | null }
  | { type: "updateClip"; id: string; patch: Partial<Clip>; mergeKey?: string }
  | {
      type: "dragClip";
      id: string;
      delta: number;
      mode: "move" | "trim-left" | "trim-right";
      /**
       * Plage du bloc au moment où le geste a commencé.
       *
       * Obligatoire : sans elle, le delta cumulé depuis l'appui serait rejoué
       * sur une position déjà déplacée à chaque image, et le bloc s'envolerait
       * à trois fois la distance parcourue par la souris.
       */
      origin: Range;
    }
  | { type: "splitAtPlayhead" }
  | { type: "deleteSelection" }
  | { type: "addCueAtPlayhead"; text?: string }
  | { type: "addCutAtPlayhead"; seconds?: number }
  | { type: "setMasks"; masks: MaskZone[]; mergeKey?: string }
  | { type: "addMask" }
  | { type: "replaceMask"; id: string; patch: Partial<MaskZone>; mergeKey?: string }
  | { type: "nudgeSelection"; seconds: number }
  | { type: "seek"; time: number }
  | { type: "ui"; patch: Partial<UiState> }
  | { type: "select"; selection: Selection }
  | { type: "seal" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "loadProject"; project: Project; keepHistory?: boolean; select?: Selection };

/* -------------------------------------------------------------------------- */
/* Sélecteurs                                                                  */
/* -------------------------------------------------------------------------- */

export type Derived = {
  removed: Range[];
  keeps: Range[];
  sourceDuration: number;
  /** Durée régnant sur la règle (le temps source). */
  timelineDuration: number;
  /** Durée de la vidéo qui sortira du moteur. */
  outputSeconds: number;
  subs: Clip[];
};

export function derive(state: EditorState): Derived {
  const project = state.hist.present;
  const sourceDuration = project.source?.duration ?? 0;
  const removed = normalizeRanges(cutRanges(project.clips));
  return {
    removed,
    keeps: keptRanges(sourceDuration, removed),
    sourceDuration,
    timelineDuration: sourceDuration,
    outputSeconds: outputDuration(sourceDuration, removed),
    subs: clipsOn(project.clips, "subs"),
  };
}

export function selectedClipId(selection: Selection): string | null {
  return selection?.kind === "clip" ? selection.id : null;
}

export function selectedMaskId(selection: Selection): string | null {
  return selection?.kind === "mask" ? selection.id : null;
}

/* -------------------------------------------------------------------------- */
/* Aïdants de glisser                                                          */
/* -------------------------------------------------------------------------- */

/** Graduations entières, pour que la souris « accroche » aux secondes visibles. */
export function wholeSeconds(duration: number, zoom: number): number[] {
  if (!(duration > 0)) return [];
  // Un aimant tous les 1 s au-delà de 40 px/s, tous les 5 s en dessous : à
  // 6 px/s, coller à la seconde signifierait ne plus pouvoir placer librement.
  const step = zoom >= 40 ? 1 : zoom >= 18 ? 2 : 5;
  const out: number[] = [];
  for (let t = 0; t <= duration + 0.001; t += step) out.push(round3(t));
  return out;
}

/** Bords des sous-titres : les coupes doivent tomber sur une fin de phrase. */
export function snapTargets(state: EditorState, clip: Clip): number[] {
  const duration = state.hist.present.source?.duration ?? 0;
  const targets: number[] = [0, duration, state.ui.playhead];
  for (const other of clipsOn(state.hist.present.clips, clip.track)) {
    if (other.id === clip.id) continue;
    targets.push(other.start, round3(other.start + other.duration));
  }
  if (clip.track === "cuts") {
    for (const sub of clipsOn(state.hist.present.clips, "subs")) {
      targets.push(sub.start, round3(sub.start + sub.duration));
    }
  } else {
    for (const cut of cutRanges(state.hist.present.clips)) {
      targets.push(cut.start, cut.end);
    }
  }
  targets.push(...wholeSeconds(duration, state.ui.zoom));
  return targets.filter((t) => Number.isFinite(t));
}

export function snapEdge(value: number, targets: number[], zoom: number): number {
  // Huit pixels de tolérance, quelle que soit l'échelle : c'est la sensation
  // visée, pas une durée absolue.
  const tolerance = Math.max(0.02, 8 / Math.max(6, zoom));
  let best = value;
  let distance = tolerance;
  for (const target of targets) {
    const delta = Math.abs(target - value);
    if (delta <= distance) {
      distance = delta;
      best = target;
    }
  }
  return round3(best);
}

/* -------------------------------------------------------------------------- */
/* Réducteur                                                                   */
/* -------------------------------------------------------------------------- */

function push(state: EditorState, project: Project, mergeKey?: string): EditorState {
  if (project === state.hist.present) return state;
  const hist = commit(state.hist, project, { mergeKey });
  return hist === state.hist ? state : { ...state, hist };
}

function withClips(state: EditorState, clips: Clip[], mergeKey?: string): EditorState {
  return push(state, { ...state.hist.present, clips }, mergeKey);
}

export function editorReducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "patch":
      return push(state, { ...state.hist.present, ...action.patch }, action.mergeKey);

    case "clips": {
      const next = withClips(state, action.clips, action.mergeKey);
      if (action.select === undefined) return next;
      return {
        ...next,
        selection: action.select === null ? null : { kind: "clip", id: action.select },
      };
    }

    case "updateClip": {
      const clips = state.hist.present.clips.map((clip) =>
        clip.id === action.id ? { ...clip, ...action.patch } : clip,
      );
      return withClips(state, clips, action.mergeKey);
    }

    case "dragClip": {
      const project = state.hist.present;
      const { ui } = state;
      const clip = project.clips.find((c) => c.id === action.id);
      if (!clip) return state;

      const duration = project.source?.duration ?? 0;
      const bounds = { min: 0, max: duration > 0 ? duration : Number.POSITIVE_INFINITY };
      const raw = dragRange(action.origin, action.delta, action.mode, bounds, MIN_CLIP);

      let start = raw.start;
      let end = raw.end;
      if (ui.snap) {
        const targets = snapTargets(state, clip);
        const left = snapEdge(raw.start, targets, ui.zoom);
        const right = snapEdge(raw.end, targets, ui.zoom);
        // Un bord aimanté ne doit jamais passer de l'autre côté : un clip
        // inversé devient invisible et irrécupérable à la souris.
        start = round3(Math.min(Math.max(0, left), right - MIN_CLIP));
        end = round3(Math.max(right, start + MIN_CLIP));
      }

      let clips = project.clips.map((c) =>
        c.id === clip.id ? { ...c, start: round3(start), duration: round3(end - start) } : c,
      );
      // L'insertion pousse les voisins quel que soit l'aimant : deux blocs l'un
      // sur l'autre ne sont pas un choix de montage, c'est une perte de texte.
      if (clip.track === "subs" && action.mode === "move") clips = pushApart(clips, clip.id);
      return withClips(state, clips, `drag:${clip.id}:${action.mode}`);
    }

    case "splitAtPlayhead": {
      const project = state.hist.present;
      const { ui } = state;
      const time = ui.playhead;
      const id = selectedClipId(state.selection);
      const selected = id ? project.clips.find((c) => c.id === id) : undefined;
      const candidates = selected ? [selected] : clipsOn(project.clips, "subs");
      const target = candidates.find(
        (clip) => time > clip.start + MIN_CLIP && time < clip.start + clip.duration - MIN_CLIP,
      );
      if (!target) return state;

      const pieces = splitRange(clipRange(target), time);
      if (!pieces) return state;
      const [first, second] = pieces;
      const half = Math.ceil((target.peaks?.length ?? 0) / 2);
      const shared = {
        text: target.text,
        sourceText: target.sourceText,
        speakerId: target.speakerId,
        label: target.label,
      };
      const a = makeClip(target.track, first, {
        ...shared,
        peaks: target.peaks ? target.peaks.slice(0, half) : undefined,
      });
      const b = makeClip(target.track, second, {
        ...shared,
        peaks: target.peaks && half ? target.peaks.slice(half) : undefined,
      });
      // L'identifiant de `makeClip` vient d'un compteur de module : deux
      // clips créés dans la même micro-tâche ne peuvent pas se ressembler.
      const clips = [...project.clips.filter((c) => c.id !== target.id), a, b];
      return {
        ...withClips(state, clips),
        selection: { kind: "clip", id: b.id },
      };
    }

    case "deleteSelection": {
      const project = state.hist.present;
      if (state.selection?.kind === "clip") {
        const id = state.selection.id;
        const clips = project.clips.filter((c) => c.id !== id);
        return { ...withClips(state, clips), selection: null };
      }
      if (state.selection?.kind === "mask") {
        const id = state.selection.id;
        // Éteindre plutôt que supprimer : la zone garde sa place et sa liste
        // reste stable, un faux clic se rattrape d'un clic.
        const masks = project.masks.map((m) => (m.id === id ? { ...m, enabled: false } : m));
        return { ...push(state, { ...project, masks }), selection: null };
      }
      return state;
    }

    case "addCueAtPlayhead": {
      const project = state.hist.present;
      const { ui } = state;
      const duration = project.source?.duration ?? 0;
      const start = round3(clamp(ui.playhead, 0, Math.max(0, duration - MIN_CLIP)));
      const end = round3(duration > 0 ? Math.min(duration, start + 2) : start + 2);
      const clip = makeClip("subs", { start, end }, { text: action.text ?? "Nouveau sous-titre" });
      return {
        ...withClips(state, [...project.clips, clip]),
        selection: { kind: "clip", id: clip.id },
      };
    }

    case "addCutAtPlayhead": {
      const project = state.hist.present;
      const { ui } = state;
      const duration = project.source?.duration ?? 0;
      const requested = action.seconds ?? 0.8;
      const start = round3(clamp(ui.playhead, 0, Math.max(0, duration - requested)));
      const end = round3(duration > 0 ? Math.min(duration, start + requested) : start + requested);
      const clip = makeClip("cuts", { start, end }, { reason: "manuel" });
      return {
        ...withClips(state, [...project.clips, clip]),
        selection: { kind: "clip", id: clip.id },
      };
    }

    case "setMasks":
      return push(state, { ...state.hist.present, masks: action.masks }, action.mergeKey);

    case "replaceMask": {
      const masks = state.hist.present.masks.map((m) =>
        m.id === action.id ? { ...m, ...action.patch } : m,
      );
      return push(state, { ...state.hist.present, masks }, action.mergeKey);
    }

    case "addMask": {
      const project = state.hist.present;
      const zone: MaskZone = {
        id: `zone-${project.masks.length + 1}-${Date.now().toString(36).slice(-4)}`,
        label: `Zone ${project.masks.length + 1}`,
        x: 0.2,
        y: 0.34,
        w: 0.6,
        h: 0.1,
        enabled: true,
      };
      return {
        ...push(state, { ...project, masks: [...project.masks, zone] }),
        selection: { kind: "mask", id: zone.id },
      };
    }

    case "nudgeSelection": {
      const project = state.hist.present;
      const id = selectedClipId(state.selection);
      if (!id) return state;
      const clip = project.clips.find((c) => c.id === id);
      if (!clip) return state;
      const duration = project.source?.duration ?? 0;
      const max = duration > 0 ? duration - clip.duration : Number.POSITIVE_INFINITY;
      const start = round3(clamp(clip.start + action.seconds, 0, Math.max(0, max)));
      let clips = project.clips.map((c) => (c.id === id ? { ...c, start } : c));
      if (clip.track === "subs") clips = pushApart(clips, id);
      return withClips(state, clips);
    }

    case "seek": {
      const duration = state.hist.present.source?.duration ?? 0;
      const playhead = round3(clamp(action.time, 0, duration > 0 ? duration : action.time));
      if (playhead === state.ui.playhead) return state;
      return { ...state, ui: { ...state.ui, playhead } };
    }

    case "ui": {
      const ui = { ...state.ui, ...action.patch };
      if (ui === state.ui) return state;
      return { ...state, ui };
    }

    case "select":
      return { ...state, selection: action.selection };

    case "seal": {
      const hist = sealHistory(state.hist);
      return hist === state.hist ? state : { ...state, hist };
    }

    case "undo": {
      const hist = undo(state.hist);
      return hist === state.hist ? state : { ...state, hist };
    }

    case "redo": {
      const hist = redo(state.hist);
      return hist === state.hist ? state : { ...state, hist };
    }

    case "loadProject": {
      const hist =
        action.keepHistory === false
          ? commit(state.hist, action.project)
          : createHistory(action.project);
      return {
        ...state,
        hist,
        selection: action.select ?? null,
        ui: {
          ...state.ui,
          playhead: 0,
          playing: false,
          compare: false,
          renderUrl: action.keepHistory === false ? state.ui.renderUrl : null,
          renderNote: action.keepHistory === false ? state.ui.renderNote : null,
        },
      };
    }

    default:
      return state;
  }
}

export function createEditorState(project: Project): EditorState {
  return { hist: createHistory<Project>(project), selection: null, ui: INITIAL_UI };
}

export const projectOf = (state: EditorState): Project => state.hist.present;
export const undoable = (state: EditorState): boolean => canUndo(state.hist);
export const redoable = (state: EditorState): boolean => canRedo(state.hist);
