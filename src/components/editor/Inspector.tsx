import { getFilter } from "@/lib/video/filters";
import { SUBTITLE_PRESETS } from "@/lib/video/presets";
import { formatClock } from "@/lib/editor/edl";
import { clampZone } from "@/lib/editor/project";
import type { InspectorTab } from "@/lib/editor/store";
import {
  selectedIds,
  onlySelection,
  selectedMaskId as storeSelectedMaskId,
} from "@/lib/editor/store";

import { Chips, Icon, IconButton, Kv, NumberField, Section, Slider, Switch } from "./ui";
import { useEditor, useEditorActions } from "./editor-context";

/**
 * Inspecteur : les réglages de *ce qui est sélectionné*.
 *
 * Règle unique de ce panneau : il ne montre que ce qui a un sens pour la
 * sélection courante. Un bloc de sous-titre n'a rien à faire d'un curseur de
 * définition ; une coupe n'a pas de texte. C'est ce qui rend l'atelier
 * compréhensible sans documentation.
 */

const TABS: { id: InspectorTab; label: string }[] = [
  { id: "clip", label: "Bloc" },
  { id: "style", label: "Style" },
  { id: "audio", label: "Audio" },
  { id: "project", label: "Projet" },
];

export function Inspector() {
  const { ui, dispatch, derived, state } = useEditor();
  const tab = ui.inspectorTab;
  const clip = derived.selectedClip;

  // Une sélection de bloc fait basculer l'onglet sur « Bloc » : c'est ce que
  // l'utilisateur vient chercher en cliquant sur la timeline.
  const effective: InspectorTab =
    tab === "clip" &&
    !clip &&
    state.selection?.kind !== "source" &&
    state.selection?.kind !== "mask"
      ? "project"
      : tab;

  const groupe = selectedIds(state.selection).length;

  return (
    <aside className="ed-inspector">
      {/* Un rappel, pas une niche : plusieurs blocs en main se voient aussi sur
          la piste, mais c'est ici qu'on lit ce que le geste veut dire. */}
      {groupe > 1 ? (
        <p className="ed-note ed-selection-note">
          {groupe} éléments en main — glisser l'un déplace le groupe, Suppr les efface.
        </p>
      ) : null}
      <div className="ed-insp-tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={effective === item.id}
            className={`ed-insp-tab${effective === item.id ? " is-active" : ""}`}
            onClick={() => dispatch({ type: "ui", patch: { inspectorTab: item.id } })}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="ed-panel-body" style={{ borderTop: "1px solid var(--ed-line)" }}>
        {effective === "clip" ? <ClipInspector /> : null}
        {effective === "style" ? <StyleInspector /> : null}
        {effective === "audio" ? <AudioInspector /> : null}
        {effective === "project" ? <ProjectInspector /> : null}
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */

function ClipInspector() {
  const { project, derived, state, dispatch } = useEditor();
  const actions = useEditorActions();
  const clip = derived.selectedClip;
  const duration = project.source?.duration ?? 0;

  const selectedMaskId = storeSelectedMaskId(state.selection);
  if (selectedMaskId) {
    const zone = project.masks.find((item) => item.id === selectedMaskId);
    if (!zone) return <p className="ed-note">Zone introuvable.</p>;
    return (
      <>
        <Section title={zone.label}>
          <p className="ed-note">
            Glisse la zone dans la scène, ou ajuste ses bords ici. Elle sera floutée à l'encodage.
          </p>
          <div className="ed-grid-2">
            {(
              [
                ["x", "X %"],
                ["y", "Y %"],
                ["w", "Largeur %"],
                ["h", "Hauteur %"],
              ] as const
            ).map(([key, label]) => (
              <NumberField
                key={key}
                label={label}
                value={Math.round(zone[key] * 100)}
                min={0}
                max={100}
                step={1}
                onChange={(value) =>
                  dispatch({
                    type: "setMasks",
                    masks: project.masks.map((item) => {
                      if (item.id !== zone.id) return item;
                      // Un plancher de taille ne doit pas interdire une
                      // position : coller une zone au bord (0 %) la faisait
                      // sauter à 2 %, et le curseur refusait de la ramener.
                      const next =
                        key === "w" || key === "h"
                          ? Math.max(0.02, value / 100)
                          : Math.max(0, Math.min(1, value / 100));
                      return clampZone({ ...item, [key]: next });
                    }),
                    mergeKey: `mask-field:${zone.id}:${key}`,
                  })
                }
              />
            ))}
          </div>
          <div className="ed-btn-row">
            <button
              type="button"
              className="ed-btn ed-btn--sm"
              onClick={() =>
                dispatch({
                  type: "setMasks",
                  masks: project.masks.map((item) =>
                    item.id === zone.id ? { ...item, enabled: !item.enabled } : item,
                  ),
                })
              }
            >
              {zone.enabled ? "Désactiver" : "Activer"}
            </button>
            <button
              type="button"
              className="ed-btn ed-btn--sm ed-btn--danger"
              onClick={() =>
                actions.patch({ masks: project.masks.filter((item) => item.id !== zone.id) })
              }
            >
              <Icon name="trash" size={12} />
              Retirer
            </button>
          </div>
        </Section>
      </>
    );
  }

  if (!clip) {
    const filter = getFilter(project.filterId);
    return (
      <>
        <Section title="Plan">
          {project.source ? (
            <div className="ed-card">
              <Kv k="Nom" v={project.source.name} />
              <Kv k="Image" v={`${project.source.width}×${project.source.height}`} />
              <Kv k="Durée" v={formatClock(project.source.duration)} />
              <Kv k="Filtre" v={filter.name} />
              <Kv
                k="Description"
                v={<span style={{ fontWeight: 400 }}>{filter.description}</span>}
              />
            </div>
          ) : (
            <p className="ed-note">Aucun plan : ouvre l'onglet Média pour importer une vidéo.</p>
          )}
          <div className="ed-btn-row" style={{ flexWrap: "wrap" }}>
            <button type="button" className="ed-btn ed-btn--sm" onClick={() => actions.addCue()}>
              <Icon name="plus" size={12} />
              Sous-titre ici
            </button>
            <button type="button" className="ed-btn ed-btn--sm" onClick={() => actions.addCut()}>
              <Icon name="crop" size={12} />
              Coupe ici
            </button>
          </div>
        </Section>
      </>
    );
  }

  const end = clip.start + clip.duration;

  return (
    <>
      <Section
        title={
          clip.track === "subs"
            ? "Sous-titre"
            : clip.track === "cuts"
              ? "Coupe"
              : clip.track === "dub"
                ? "Extrait de voix off"
                : "Plan"
        }
        action={
          <span className="ed-time-pill">
            {clip.track === "subs" ? "T1" : clip.track === "cuts" ? "C1" : "A1"}
          </span>
        }
      >
        {clip.track === "subs" ? (
          <textarea
            className="ed-textarea"
            aria-label="Texte du sous-titre"
            value={clip.text ?? ""}
            onChange={(event) =>
              actions.updateClip(clip.id, { text: event.target.value }, `cue:${clip.id}`)
            }
            onBlur={actions.endGesture}
            placeholder="Le texte incrusté à cet instant"
          />
        ) : null}

        {clip.sourceText ? (
          <p className="ed-note">
            <span style={{ color: "var(--ed-text-faint)" }}>Phrase d'origine · </span>
            {clip.sourceText}
          </p>
        ) : null}

        <div className="ed-grid-2">
          <NumberField
            label="Début"
            value={clip.start}
            min={0}
            max={Math.max(0, duration - 0.12)}
            step={0.05}
            onChange={(value) =>
              actions.updateClip(
                clip.id,
                { start: Math.min(value, duration - 0.12), duration: Math.max(0.12, end - value) },
                `time:${clip.id}`,
              )
            }
          />
          <NumberField
            label="Durée"
            value={clip.duration}
            min={0.12}
            max={Math.max(0.12, duration - clip.start)}
            step={0.05}
            onChange={(value) =>
              actions.updateClip(clip.id, { duration: value }, `time:${clip.id}`)
            }
          />
        </div>

        <div className="ed-btn-row" style={{ flexWrap: "wrap" }}>
          <IconButton
            icon="stepBack"
            label="Décalé d'une image vers la gauche"
            onClick={() => actions.nudge(-(1 / Math.max(1, project.source?.fps ?? 30)))}
          />
          <IconButton
            icon="stepFwd"
            label="Décalé d'une image vers la droite"
            onClick={() => actions.nudge(1 / Math.max(1, project.source?.fps ?? 30))}
          />
          <button
            type="button"
            className="ed-btn ed-btn--sm"
            onClick={actions.split}
            title="Couper ce bloc à la tête de lecture (S)"
          >
            <Icon name="scissors" size={12} />
            Couper
          </button>
          <button
            type="button"
            className="ed-btn ed-btn--sm"
            onClick={() => {
              const copy = {
                ...clip,
                id: `${clip.id}-copy-${Math.random().toString(36).slice(2, 7)}`,
                start: Math.min(duration - clip.duration, end + 0.02),
              };
              actions.patch({ clips: [...project.clips, copy] });
              dispatch({ type: "select", selection: onlySelection("clip", copy.id) });
            }}
            title="Dupliquer le bloc juste après"
          >
            <Icon name="layers" size={12} />
            Dupliquer
          </button>
          <button
            type="button"
            className="ed-btn ed-btn--sm ed-btn--danger"
            onClick={actions.remove}
          >
            <Icon name="trash" size={12} />
            Supprimer
          </button>
        </div>
      </Section>

      {clip.track === "subs" ? (
        <Section title="Ce bloc seulement" collapsible>
          <p className="ed-note">
            Ces réglages ne concernent que le bloc sélectionné ; le style de la piste reste inchangé
            pour les autres.
          </p>
          <Slider
            label="Corps"
            value={derived.preset.fontsize}
            min={20}
            max={170}
            format={(value) => `${value} px`}
            hint="Note : le corps est un réglage de piste, il s'applique donc à tous les blocs."
            onChange={(value) =>
              actions.patch({ overrides: { ...project.overrides, fontsize: value } }, "override")
            }
            onCommit={actions.endGesture}
          />
          <Switch
            label="Majuscules"
            checked={derived.preset.uppercase}
            onChange={(value) =>
              actions.patch({ overrides: { ...project.overrides, uppercase: value } })
            }
          />
        </Section>
      ) : null}

      {clip.track === "cuts" ? (
        <Section title="Effet de la coupe" collapsible>
          <div className="ed-card">
            <Kv k="Plage retirée" v={`${formatClock(clip.start)} → ${formatClock(end)}`} />
            <Kv k="Temps retiré" v={`${clip.duration.toFixed(2)} s`} />
            <Kv k="Sortie après coupe" v={formatClock(derived.outputSeconds)} />
          </div>
          <p className="ed-note">
            Un bloc de coupe se corrige à la poignée sur la piste : garde-la si la pause crée un
            silence comique, supprime-le sinon.
          </p>
        </Section>
      ) : null}

      {clip.track === "dub" && clip.audioUrl ? (
        <Section title="Écoute" collapsible>
          <audio src={clip.audioUrl} controls style={{ width: "100%" }} />
        </Section>
      ) : null}
    </>
  );
}

function StyleInspector() {
  const { project, derived } = useEditor();
  const actions = useEditorActions();
  const preset = derived.preset;

  return (
    <>
      <Section title="Preset">
        <Chips
          value={project.presetId}
          options={SUBTITLE_PRESETS.map((item) => ({ id: item.id, label: item.name }))}
          onChange={(value) => actions.patch({ presetId: value, overrides: {} })}
        />
      </Section>
      <Section title={preset.name}>
        <Slider
          label="Corps"
          value={preset.fontsize}
          min={20}
          max={170}
          onChange={(value) =>
            actions.patch({ overrides: { ...project.overrides, fontsize: value } }, "override")
          }
          onCommit={actions.endGesture}
        />
        <Slider
          label="Ancrage vertical"
          value={preset.yAnchor}
          min={0.05}
          max={0.95}
          step={0.01}
          format={(value) => `${Math.round(value * 100)} %`}
          onChange={(value) =>
            actions.patch({ overrides: { ...project.overrides, yAnchor: value } }, "override")
          }
          onCommit={actions.endGesture}
        />
        <Slider
          label="Opacité du fond"
          value={project.boxOpacity}
          min={0}
          max={1}
          step={0.05}
          format={(value) => `${Math.round(value * 100)} %`}
          onChange={(value) => actions.patch({ boxOpacity: value }, "opacity")}
          onCommit={actions.endGesture}
        />
      </Section>
    </>
  );
}

function AudioInspector() {
  const { project, derived } = useEditor();
  const actions = useEditorActions();
  return (
    <>
      <Section title="Mixage">
        <Switch
          label="Garder l'ambiance"
          checked={!project.removeOriginalAudio}
          onChange={(value) => actions.patch({ removeOriginalAudio: !value })}
        />
        {project.removeOriginalAudio ? null : (
          <Slider
            label="Volume du fond"
            value={project.ambienceLevel}
            min={0}
            max={1}
            step={0.05}
            format={(value) => `${Math.round(value * 100)} %`}
            onChange={(value) => actions.patch({ ambienceLevel: value }, "ambience")}
            onCommit={actions.endGesture}
          />
        )}
      </Section>
      <Section title="Piste" collapsible>
        <div className="ed-card">
          <Kv k="Blocs de texte" v={derived.subs.length} />
          <Kv k="Extraits de voix" v={project.clips.filter((c) => c.track === "dub").length} />
          <Kv k="Coupes" v={derived.removed.length} />
        </div>
      </Section>
    </>
  );
}

function ProjectInspector() {
  const { project, derived, ui } = useEditor();
  const actions = useEditorActions();
  return (
    <>
      <Section title="Sortie prévue">
        <div className="ed-card">
          <Kv
            k="Résolution"
            v={project.source ? `${project.source.width}×${project.source.height}` : "—"}
          />
          <Kv k="Durée montée" v={formatClock(derived.outputSeconds)} />
          <Kv k="Segments" v={Math.max(1, derived.keeps.length)} />
          <Kv k="Zones floutées" v={project.masks.filter((m) => m.enabled).length} />
          <Kv k="Cues incrustés" v={derived.cues.length} />
          <Kv k="Encodage" v={project.quality} />
        </div>
        <button
          type="button"
          className="ed-btn ed-btn--primary"
          onClick={() => actions.openExport(true)}
          disabled={!project.source}
        >
          <Icon name="download" size={13} />
          Ouvrir l'export
        </button>
      </Section>

      <Section title="Interface">
        <Chips
          value={ui.uiScale}
          options={[
            { id: "compact", label: "Compact", title: "Gagne de la place sur un petit écran" },
            { id: "confort", label: "Confort", title: "Réglage par défaut" },
            { id: "large", label: "Grande", title: "Textes et poignées agrandis" },
          ]}
          onChange={actions.setUiScale}
        />
        <p className="ed-note">
          Ne change que la taille des commandes et des textes : le zoom de la timeline reste
          indépendant, pour que les glissements collent à la souris.
        </p>
      </Section>

      <Section title="État du moteur" collapsible defaultOpen={false}>
        <p className="ed-note">
          {ui.busy
            ? ui.busy
            : "Le moteur de rendu (FFmpeg en WebAssembly) se charge au premier rendu, puis reste en mémoire pour la session."}
        </p>
      </Section>
    </>
  );
}
