import { createContext, useContext, useEffect, useMemo, useRef, type Dispatch } from "react";

import { clipsToCues, activeCue } from "@/lib/editor/cues";
import { demoProject, EMPTY_PROJECT } from "@/lib/editor/project";
import { formatClock } from "@/lib/editor/edl";
import { describe } from "@/lib/errors";
import { loadDemoSource, loadSourceFromFile, validateVideoFile } from "@/lib/editor/media";
import { releaseFfmpeg } from "@/lib/video/ffmpeg-client";
import type { SubtitlePreset } from "@/lib/video/presets";
import {
  derive,
  type Action,
  type EditorState,
  type Notice,
  type PanelTab,
  type Selection,
  type UiState,
} from "@/lib/editor/store";
import type { Clip, Project } from "@/lib/editor/types";

/**
 * Câblage React du monteur.
 *
 * Le réducteur est pur (`src/lib/editor/store.ts`) ; ce fichier n'ajoute que ce
 * que React exige : un contexte, des sélecteurs mémoïsés, et les raccourcis
 * clavier. Cette frontière est volontaire : on peut tester chaque geste de
 * montage sans jsdom, et le composant `<Editor>` reste lisible.
 */

export type EditorApi = {
  state: EditorState;
  project: Project;
  ui: UiState;
  dispatch: Dispatch<Action>;
  derived: ReturnType<typeof derive> & {
    preset: SubtitlePreset;
    cues: ReturnType<typeof clipsToCues>;
    visibleCue: ReturnType<typeof activeCue>;
    /** Temps source correspondant au playhead, une fois les coupes appliquées. */
    outputPlayhead: number;
    selectedClip: Clip | null;
    canUndo: boolean;
    canRedo: boolean;
  };
};

export const EditorContext = createContext<EditorApi | null>(null);

/** État courant du monteur, vue par tous les panneaux. */
export function useEditor(): EditorApi {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor() doit être appelé dans <EditorProvider>.");
  return ctx;
}

/** Raccourcis de confort : les gestes qu'un monteur fait mille fois par session. */
export function useEditorActions() {
  const { dispatch, ui, derived, project } = useEditor();

  // L'état lu *après* un `await` : une fermeture capturée avant l'attente est
  // déjà fausse quand le chargement de la démo se termine en parallèle d'un
  // import de l'utilisateur.
  const latest = useRef(project);
  latest.current = project;

  // Compteur de « reprise en main » : un import ou « Nouveau projet » survenu
  // pendant le téléchargement de la démo doit la faire renoncer. Un simple
  // booléen ne suffit pas : il resterait vrai et bloquerait le bouton « Ouvrir
  // la démo » cliqué plus tard. Chacun mémorise la valeur au départ, puis la
  // compare une fois son attente terminée.
  const tookOver = useRef(0);

  return useMemo(
    () => ({
      patch: (patch: Partial<Project>, mergeKey?: string) =>
        dispatch({ type: "patch", patch, mergeKey }),
      select: (selection: Selection) => dispatch({ type: "select", selection }),
      setUi: (patch: Partial<UiState>) => dispatch({ type: "ui", patch }),
      setTab: (tab: PanelTab) => dispatch({ type: "ui", patch: { tab } }),
      seek: (time: number) => dispatch({ type: "seek", time }),
      nudge: (seconds: number) => dispatch({ type: "nudgeSelection", seconds }),
      togglePlay: () => dispatch({ type: "ui", patch: { playing: !ui.playing } }),
      split: () => dispatch({ type: "splitAtPlayhead" }),
      remove: () => dispatch({ type: "deleteSelection" }),
      addCue: () => dispatch({ type: "addCueAtPlayhead" }),
      addCut: () => dispatch({ type: "addCutAtPlayhead" }),
      addMask: () => dispatch({ type: "addMask" }),
      updateClip: (id: string, patch: Partial<Clip>, mergeKey?: string) =>
        dispatch({ type: "updateClip", id, patch, mergeKey }),
      dragClip: (
        id: string,
        mode: "move" | "trim-left" | "trim-right",
        origin: { start: number; end: number },
        delta: number,
      ) => dispatch({ type: "dragClip", id, delta, mode, origin }),
      endGesture: () => dispatch({ type: "seal" }),
      undo: () => dispatch({ type: "undo" }),
      redo: () => dispatch({ type: "redo" }),
      load: (project: Project, options?: { keepHistory?: boolean; select?: Selection }) =>
        dispatch({ type: "loadProject", project, ...options }),
      notify: (notice: Notice) => dispatch({ type: "ui", patch: { notice } }),
      setBusy: (busy: string | null) => dispatch({ type: "ui", patch: { busy } }),
      setUiScale: (uiScale: "compact" | "confort" | "large") =>
        dispatch({ type: "ui", patch: { uiScale } }),
      // Le mode est toujours reposé : « Exporter » doit ouvrir le rendu local
      // même si la dernière boîte lancée l'était par « Doublage IA ».
      openExport: (open = true, mode: "local" | "ia" = "local") =>
        dispatch({ type: "ui", patch: { exportOpen: open, exportMode: mode } }),
      zoomBy: (factor: number) =>
        dispatch({ type: "ui", patch: { zoom: clampZoom(ui.zoom * factor) } }),
      fitTimeline: () =>
        dispatch({
          type: "ui",
          patch: {
            zoom: clampZoom(
              Math.max(
                8,
                Math.min(320, (timelineWidth() || 900) / (derived.timelineDuration || 1)),
              ),
            ),
          },
        }),
      /** Importe un plan et repart d'un projet neuf (le montage précédent n'a
       * plus de sens sans sa source). */
      importFile: async (file: File) => {
        const problem = validateVideoFile(file);
        if (problem) {
          dispatch({ type: "ui", patch: { notice: { kind: "error", text: problem } } });
          return false;
        }
        // L'utilisateur reprend la main : la démo en vol devra s'effacer.
        tookOver.current += 1;
        dispatch({ type: "ui", patch: { busy: "Copie locale de la vidéo…" } });
        try {
          const source = await loadSourceFromFile(file);
          const next: Project = {
            ...project,
            name: file.name.replace(/\.[^.]+$/, ""),
            source,
            clips: [],
          };
          dispatch({ type: "loadProject", project: next });
          dispatch({
            type: "ui",
            patch: {
              notice: {
                kind: "ok",
                text: `Plan importé — ${formatClock(source.duration)}, ${source.width}×${source.height}, ${Math.round(
                  source.size / 1024 / 1024,
                )} Mo.`,
              },
              tab: "cuts",
            },
          });
          return true;
        } catch (error) {
          dispatch({
            type: "ui",
            patch: {
              notice: { kind: "error", text: describe(error, "La vidéo n'a pas pu être lue.") },
            },
          });
          return false;
        } finally {
          dispatch({ type: "ui", patch: { busy: null } });
        }
      },
      loadDemo: async () => {
        const startedAt = tookOver.current;
        dispatch({ type: "ui", patch: { busy: "Chargement de la démonstration…" } });
        try {
          const source = await loadDemoSource();
          // Un plan a été importé pendant le téléchargement : on ne passe pas
          // dessus. Constaté en test bout en bout — la démo, plus lente à
          // arriver, écrasait le montage en cours de l'utilisateur, et le plan
          // importé héritait des masques et du style posés par la démo.
          if (latest.current.source || tookOver.current !== startedAt) return;
          dispatch({ type: "loadProject", project: demoProject(source) });
          dispatch({
            type: "ui",
            patch: {
              notice: {
                kind: "info",
                text: "Démo chargée : six prises, un bandeau de sous-titres à masquer, deux logos à flouter. Essaie « Détecter les silences », puis Export.",
              },
              zoom: Math.max(
                18,
                Math.min(120, (timelineWidth() || 760) / Math.max(1, source.duration)),
              ),
            },
          });
        } catch (error) {
          dispatch({
            type: "ui",
            patch: {
              notice: { kind: "error", text: describe(error, "La démo n'a pas pu être chargée.") },
            },
          });
        } finally {
          dispatch({ type: "ui", patch: { busy: null } });
        }
      },
      closeProject: () => {
        tookOver.current += 1;
        releaseFfmpeg();
        dispatch({ type: "loadProject", project: { ...EMPTY_PROJECT } });
        dispatch({ type: "ui", patch: { notice: null, renderUrl: null, compare: false } });
      },
    }),
    [dispatch, project, ui.playing, ui.zoom, derived.timelineDuration],
  );
}

function clampZoom(value: number): number {
  return Math.round(Math.max(4, Math.min(460, value)) * 100) / 100;
}

/** Largeur utile de la zone de timeline, si elle est montée. */
function timelineWidth(): number {
  if (typeof document === "undefined") return 0;
  const element = document.querySelector<HTMLElement>("[data-tl-scroll]");
  return element?.clientWidth ?? 0;
}

/**
 * Raccourcis clavier globaux du monteur.
 *
 * Ignore les champs de saisie : taper « s » dans une zone de texte ne doit pas
 * couper le bloc sous le curseur. L'écouteur est enregistré une fois et lit
 * l'état dans une ref — l'inverse (dépendre de `ui.playhead`) recréerait
 * l'écouteur à chaque image pendant la lecture, soit soixante poses de listener
 * par seconde pour un geste qui n'a rien à voir avec le clavier.
 */
/** Touche, en minuscules, sans supposer que `event.key` est une lettre. */
function key0(event: KeyboardEvent): string {
  return (event.key ?? "").toLowerCase();
}

export function useEditorKeyboard() {
  const editor = useEditor();
  const latest = useRef(editor);
  latest.current = editor;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { ui, derived, dispatch, project } = latest.current;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT|DIALOG)$/.test(target.tagName) ||
          target.getAttribute("role") === "textbox")
      ) {
        return;
      }

      const seek = (time: number) => dispatch({ type: "seek", time });
      const setUi = (patch: Partial<UiState>) => dispatch({ type: "ui", patch });

      if (event.key === "Escape") {
        if (ui.exportOpen) setUi({ exportOpen: false });
        else dispatch({ type: "select", selection: null });
        return;
      }

      /* F : l'aperçu prend toute la place. Sur un portable, replier les deux
         volets est le moyen le plus direct de rendre un plan vertical lisible
         sans sortir du montage — plus efficace que de grossir les contrôles. */
      if (key0(event) === "f" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        const open = !(ui.leftPanel && ui.rightPanel && ui.timelineOpen);
        setUi({ leftPanel: open, rightPanel: open, timelineOpen: open });
        return;
      }

      const meta = event.metaKey || event.ctrlKey;
      const frame = 1 / Math.max(1, project.source?.fps ?? 30);
      const duration = derived.timelineDuration;
      const key = event.key.toLowerCase();

      if (meta && key === "z") {
        event.preventDefault();
        dispatch({ type: "seal" });
        dispatch({ type: event.shiftKey ? "redo" : "undo" });
        return;
      }
      if (meta && key === "e") {
        event.preventDefault();
        setUi({ exportOpen: !ui.exportOpen });
        return;
      }
      // Alt garde son usage fin (déplacement à l'image près dans les champs),
      // mais aucun raccourci de montage ne s'y oppose ici.
      if (meta) return;

      switch (key) {
        case " ":
        case "k":
          event.preventDefault();
          setUi({ playing: !ui.playing });
          return;
        case "arrowleft":
          event.preventDefault();
          seek(ui.playhead - frame * 3);
          return;
        case "arrowright":
          event.preventDefault();
          seek(ui.playhead + frame * 3);
          return;
        case "j":
          setUi({ playing: true });
          seek(Math.max(0, ui.playhead - 3));
          return;
        case "l":
          setUi({ playing: true });
          seek(Math.min(duration, ui.playhead + 3));
          return;
        case "home":
          seek(0);
          return;
        case "end":
          seek(Math.max(0, duration - 0.05));
          return;
        case "s":
          event.preventDefault();
          dispatch({ type: "splitAtPlayhead" });
          return;
        case "c":
          event.preventDefault();
          dispatch({ type: "addCueAtPlayhead" });
          return;
        case "x":
          event.preventDefault();
          dispatch({ type: "addCutAtPlayhead" });
          return;
        case "delete":
        case "backspace":
          event.preventDefault();
          dispatch({ type: "deleteSelection" });
          return;
        case "m":
          setUi({ snap: !ui.snap });
          return;
        case "v":
          setUi({ showSubs: !ui.showSubs });
          return;
        case "+":
        case "=":
          event.preventDefault();
          setUi({ zoom: Math.min(460, ui.zoom * 1.3) });
          return;
        case "-":
        case "_":
          event.preventDefault();
          setUi({ zoom: Math.max(4, ui.zoom / 1.3) });
          return;
        default:
          return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
