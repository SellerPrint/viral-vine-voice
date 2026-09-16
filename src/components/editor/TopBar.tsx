import { useRef } from "react";

import { Link } from "@tanstack/react-router";

import { Icon } from "./ui";
import { useEditor, useEditorActions } from "./editor-context";

/**
 * Barre supérieure façon CapCut Pro : marque à gauche, nom du projet au
 * centre, Export cyan à droite. Aucun réglage de montage ici.
 */
export function TopBar() {
  const { project, ui, dispatch } = useEditor();
  const fileRef = useRef<HTMLInputElement>(null);
  const actions = useEditorActions();

  return (
    <header className="ed-topbar">
      <div className="ed-topbar-left">
        <Link
          to="/"
          aria-label="Monteur ViralDub"
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <span className="ed-logo">
            <Icon name="scissors" size={13} />
          </span>
          <span className="ed-brand">ViralDub</span>
        </Link>
        <span className="ed-topbar-rule" />
      </div>

      <input
        className="ed-project-name"
        value={project.name}
        aria-label="Nom du projet"
        onChange={(event) => actions.patch({ name: event.target.value }, "name")}
        onBlur={actions.endGesture}
      />

      <div className="ed-topbar-right">
        <button
          type="button"
          className="ed-btn ed-btn--ghost"
          onClick={() => fileRef.current?.click()}
          title="Importer un plan depuis ton disque — ou dépose-le n'importe où dans la fenêtre"
        >
          <Icon name="upload" size={13} />
          <span className="ed-btn-label">Importer un plan</span>
        </button>
        <input
          ref={fileRef}
          id="ed-import-plan"
          type="file"
          accept="video/*"
          className="sr-only"
          style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
          aria-label="Importer un plan"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void actions.importFile(file);
          }}
        />

        <div className="ed-seg" role="group" aria-label="Volets de l'atelier">
          <button
            type="button"
            className={`ed-seg-btn${ui.leftPanel ? " is-active" : ""}`}
            aria-pressed={ui.leftPanel}
            title="Médiathèque à gauche — F replie ou rouvre les trois volets"
            onClick={() => dispatch({ type: "ui", patch: { leftPanel: !ui.leftPanel } })}
          >
            Médiathèque
          </button>
          <button
            type="button"
            className={`ed-seg-btn${ui.timelineOpen ? " is-active" : ""}`}
            aria-pressed={ui.timelineOpen}
            title="Timeline — la replier rend de la hauteur au plan"
            onClick={() => dispatch({ type: "ui", patch: { timelineOpen: !ui.timelineOpen } })}
          >
            Timeline
          </button>
          <button
            type="button"
            className={`ed-seg-btn${ui.rightPanel ? " is-active" : ""}`}
            aria-pressed={ui.rightPanel}
            title="Inspecteur à droite — F replie ou rouvre les trois volets"
            onClick={() => dispatch({ type: "ui", patch: { rightPanel: !ui.rightPanel } })}
          >
            Inspecteur
          </button>
        </div>

        <button
          type="button"
          className="ed-btn ed-btn--ghost"
          onClick={() => actions.openExport(true, "ia")}
          disabled={!project.source}
        >
          <Icon name="wand" size={13} />
          <span className="ed-btn-label">Doublage IA</span>
        </button>

        <button
          type="button"
          className="ed-btn ed-btn--primary ed-export-cta"
          onClick={() => actions.openExport(true)}
          disabled={!project.source}
          title="Rendu local de la timeline (Ctrl+E)"
        >
          <Icon name="upload" size={13} />
          Exporter
        </button>
      </div>
    </header>
  );
}
