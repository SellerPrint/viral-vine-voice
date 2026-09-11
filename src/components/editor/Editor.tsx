import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";

import { Notice } from "./ui";
import { activeCue, clipsToCues } from "@/lib/editor/cues";
import { sourceToTimeline } from "@/lib/editor/edl";
import { EMPTY_PROJECT, projectPreset } from "@/lib/editor/project";
import {
  createEditorState,
  derive,
  editorReducer,
  projectOf,
  redoable,
  undoable,
} from "@/lib/editor/store";

import {
  EditorContext,
  useEditor,
  useEditorActions,
  useEditorKeyboard,
  type EditorApi,
} from "./editor-context";
import { ExportDialog } from "./ExportDialog";
import { Inspector } from "./Inspector";
import { LeftPanel } from "./LeftPanel";
import { PreviewStage } from "./PreviewStage";
import { Timeline } from "./Timeline";
import { TopBar } from "./TopBar";

/**
 * Le monteur.
 *
 * Gabarit en trois bandes — barre d'outils, atelier (rail + panneau + scène +
 * inspecteur), timeline — et une règle : rien ne se masque mutuellement. Ouvrir
 * un réglage ne doit jamais faire disparaître l'aperçu ni la piste, c'est
 * l'expérience complète d'un logiciel de montage, là où le SaaS d'origine
 * empilait les formulaires puis laissait l'écran vide pendant un rendu.
 */
/**
 * Fournit l'état du monteur à tout l'atelier.
 *
 * Le provider vit ici, à côté de l'unique point de montage, et les hooks dans
 * `editor-context.ts` : un module qui mélange composants et fonctions fait
 * perdre le Fast Refresh de Vite, et le séparateur est gratuit.
 */
function EditorProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(editorReducer, EMPTY_PROJECT, createEditorState);
  const project = projectOf(state);

  const derived = useMemo(() => {
    const base = derive(state);
    const selectedId = state.selection?.kind === "clip" ? state.selection.id : null;
    const cues = clipsToCues(base.subs, {
      wordByWord: project.wordByWord,
      duration: base.sourceDuration,
    });
    return {
      ...base,
      cues,
      preset: projectPreset(project),
      visibleCue: activeCue(cues, state.ui.playhead),
      outputPlayhead: sourceToTimeline(state.ui.playhead, base.keeps),
      selectedClip: selectedId
        ? (project.clips.find((clip) => clip.id === selectedId) ?? null)
        : null,
      canUndo: undoable(state),
      canRedo: redoable(state),
    };
  }, [state, project]);

  const value = useMemo<EditorApi>(
    () => ({ state, project, ui: state.ui, dispatch, derived }),
    [state, project, derived],
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function Editor() {
  return (
    <EditorProvider>
      <EditorFrame />
    </EditorProvider>
  );
}

const UI_SCALE_KEY = "viraldub.ui-scale";

function EditorFrame() {
  const { project, ui, dispatch } = useEditor();
  const actions = useEditorActions();
  const [dropping, setDropping] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const bootstrapped = useRef(false);

  // Marqueur d'hydratation, pour les tests bout en bout : sans lui, un
  // `setInputFiles` envoyé trop tôt part dans le vide — le gestionnaire React
  // n'est pas encore branché sur le champ, et le test échoue pour une raison
  // qui n'a rien à voir avec l'application.
  useEffect(() => setHydrated(true), []);

  // La densité choisie survit au rechargement. Lecture après montage, jamais
  // pendant : au rendu côté serveur, `localStorage` n'existe pas et une valeur
  // lue ici ferait désacorder l'HTML serveur du premier rendu client.
  useEffect(() => {
    const saved = window.localStorage.getItem(UI_SCALE_KEY);
    if (saved === "compact" || saved === "confort" || saved === "large") {
      if (saved !== ui.uiScale) dispatch({ type: "ui", patch: { uiScale: saved } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.localStorage.setItem(UI_SCALE_KEY, ui.uiScale);
  }, [ui.uiScale]);

  useEditorKeyboard();

  // Premier lancement : on ouvre la démo pour que l'atelier ne soit jamais une
  // page vide. Si l'asset est absent, l'éditeur reste utilisable, sans plan.
  useEffect(() => {
    if (bootstrapped.current || project.source) return;
    bootstrapped.current = true;
    void actions.loadDemo();
  }, [actions, project.source]);

  // Un dépôt hors de la zone d'import doit rester un import : c'est le réflexe
  // de n'importe qui, et le SaaS refusait silencieusement le geste.
  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      setDropping(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDropping(false);
    };
    const onDrop = (event: DragEvent) => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      event.preventDefault();
      setDropping(false);
      void actions.importFile(file);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [actions]);

  // Un message informatif s'efface ; une erreur reste affichée jusqu'à ce
  // qu'on la lise (ou la ferme) : elle est justement là pour qu'on agisse.
  useEffect(() => {
    if (!ui.notice || ui.notice.kind === "error" || ui.notice.kind === "warn") return;
    const timer = setTimeout(() => actions.notify(null), 9000);
    return () => clearTimeout(timer);
  }, [ui.notice, actions]);

  return (
    <div
      className="ed-root"
      data-ui={ui.uiScale}
      data-timeline={ui.timelineOpen ? "open" : "closed"}
      data-dropping={dropping ? "true" : "false"}
      data-hydrated={hydrated ? "true" : "false"}
    >
      <TopBar />

      <div
        className="ed-main"
        data-left={ui.leftPanel ? "open" : "closed"}
        data-right={ui.rightPanel ? "open" : "closed"}
      >
        <LeftPanel />
        <PreviewStage />
        <Inspector />
      </div>

      <Timeline />

      {ui.exportOpen ? <ExportDialog /> : null}

      {ui.busy ? (
        <div
          className="ed-alert"
          style={{
            position: "fixed",
            right: 14,
            top: 54,
            zIndex: 40,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "#101013",
            boxShadow: "var(--ed-shadow)",
          }}
          role="status"
        >
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 99,
              border: "2px solid rgba(255,255,255,.2)",
              borderTopColor: "#4f8dff",
              display: "inline-block",
              animation: "spin 900ms linear infinite",
            }}
          />
          {ui.busy}
          <button
            type="button"
            className="ed-btn ed-btn--sm"
            style={{ marginLeft: 6 }}
            onClick={() => dispatch({ type: "ui", patch: { busy: null } })}
          >
            masquer
          </button>
        </div>
      ) : null}

      {ui.notice ? (
        <div
          data-testid="notice"
          style={{
            position: "fixed",
            left: "50%",
            transform: "translateX(-50%)",
            bottom: 12,
            zIndex: 45,
            width: "max-content",
            maxWidth: "min(620px, calc(100% - 32px))",
            // Le bandeau ne doit jamais voler un clic : seul son contenu réagit.
            pointerEvents: "none",
          }}
        >
          <div style={{ pointerEvents: "auto" }}>
            <Notice notice={ui.notice} onDismiss={() => actions.notify(null)} />
          </div>
        </div>
      ) : null}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
