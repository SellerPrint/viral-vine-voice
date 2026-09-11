import { Link } from "@tanstack/react-router";

import { Icon, IconButton } from "./ui";
import { useEditor, useEditorActions } from "./editor-context";

/**
 * Barre supérieure : identification du projet, annulation, export.
 *
 * Comme dans un logiciel de montage, elle ne contient aucun réglage — seulement
 * ce qui se fait *au projet* entier. Les boutons y sont groupés par fréquence
 * d'usage : annuler/rétablir à gauche (réflexe), exporter à droite (but).
 */
export function TopBar() {
  const { project, derived, ui, dispatch } = useEditor();
  const actions = useEditorActions();

  return (
    <header className="ed-topbar">
      <Link
        to="/"
        aria-label="Monteur ViralDub"
        style={{ display: "flex", alignItems: "center", gap: 8 }}
      >
        <span
          className="bg-grad-brand"
          style={{
            display: "grid",
            placeItems: "center",
            width: 22,
            height: 22,
            borderRadius: 6,
            color: "#0b0b0d",
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            fontSize: 13,
          }}
        >
          V
        </span>
        <span className="ed-brand">ViralDub</span>
      </Link>
      <span className="ed-badge">Monteur</span>

      <span style={{ width: 1, height: 18, background: "var(--ed-line)", margin: "0 2px" }} />

      <input
        className="ed-project-name"
        value={project.name}
        aria-label="Nom du projet"
        onChange={(event) => actions.patch({ name: event.target.value }, "name")}
        onBlur={actions.endGesture}
      />

      <div className="ed-btn-row" style={{ marginLeft: 6 }}>
        <IconButton
          icon="undo"
          label="Annuler (Ctrl+Z)"
          onClick={actions.undo}
          disabled={!derived.canUndo}
        />
        <IconButton
          icon="redo"
          label="Rétablir (Ctrl+Maj+Z)"
          onClick={actions.redo}
          disabled={!derived.canRedo}
        />
      </div>

      <div style={{ flex: 1 }} />

      {/* Volets : « tout est petit » se règle d'abord en rendant de la place au
          plan, avant de grossir les contrôles. */}
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

      <span className="ed-timecode" style={{ marginRight: 4 }}>
        {project.source ? (
          <>
            <b>{project.source.name}</b> · {project.source.width}×{project.source.height} ·{" "}
            {Math.round(project.source.size / 1024 / 1024)} Mo
          </>
        ) : (
          "aucun plan"
        )}
      </span>

      <IconButton
        icon="eye"
        label="Comparer avec le dernier rendu"
        active={ui.compare}
        disabled={!ui.renderUrl}
        onClick={() => dispatch({ type: "ui", patch: { compare: !ui.compare } })}
      />

      <Link
        to="/how-it-works"
        className="ed-btn ed-btn--ghost"
        style={{ height: 28 }}
        title="Comment le doublage fonctionne"
      >
        <Icon name="info" size={13} />
        Comment ça marche
      </Link>

      <button
        type="button"
        className="ed-btn"
        style={{ height: 28 }}
        onClick={() => actions.openExport(true, "ia")}
        disabled={!project.source}
      >
        <Icon name="wand" size={13} />
        Doublage IA
      </button>

      <button
        type="button"
        className="ed-btn ed-btn--primary"
        style={{ height: 28 }}
        onClick={() => actions.openExport(true)}
        disabled={!project.source}
        title="Rendu local de la timeline (Ctrl+E)"
      >
        <Icon name="download" size={13} />
        Exporter
      </button>
    </header>
  );
}
