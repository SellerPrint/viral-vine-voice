import { useEffect, useRef, useState } from "react";

import { detectMaskZones } from "@/lib/video/detect";
import { VIDEO_FILTERS, UPSCALE_MODES } from "@/lib/video/filters";
import { VFX_CATEGORIES, VFX_EFFECTS } from "@/lib/video/vfx";
import { SUBTITLE_PRESETS, TARGET_LANGUAGES, type MaskZone } from "@/lib/video/presets";
import { TEXT_FX, TEXT_FX_CATEGORIES } from "@/lib/editor/text-fx";
import { isSameLanguage, SOURCE_LANGUAGES } from "@/lib/languages";
import { describe } from "@/lib/errors";
import { useTurnstile } from "@/hooks/use-turnstile";
import { translateCaptionTrack } from "@/lib/editor/translate-captions";
import { formatClock } from "@/lib/editor/edl";
import { renderPreviewFrame } from "@/lib/video/preview";
import { appliquerConfiguration, configurationDuProjet } from "@/lib/editor/appliquer-config";
import { clampZone, makeClip, resolvePresetById } from "@/lib/editor/project";
import { TRANSITION_CATEGORIES, TRANSITIONS } from "@/lib/video/transitions";
import {
  getSfx,
  peaksOf,
  SFX_CATEGORIES,
  SFX_LIBRARY,
  sfxObjectUrl,
  synthesizeSfx,
} from "@/lib/editor/sfx";
import { scanSilences } from "@/lib/editor/silences";
import {
  applyViralTemplate,
  matchingViralTemplate,
  VIRAL_TEMPLATES,
  type ViralTemplateId,
} from "@/lib/editor/templates";
import {
  clipsToSubtitleCues,
  detectSubtitleFormat,
  mergeSubtitleCues,
  parseSubtitles,
  toSrt,
  toVtt,
} from "@/lib/editor/subtitles-io";
import { applyCloneRecipe, CLONE_RECIPES, matchingCloneRecipe } from "@/lib/editor/clone-recipes";
import { configFileName, MAX_CONFIG_BYTES } from "@/lib/config-io";
import type { PanelTab } from "@/lib/editor/store";
import type { Clip } from "@/lib/editor/types";
import { isSelected, onlySelection } from "@/lib/editor/store";

import { AgentMcp } from "./AgentMcp";
import { Chips, Icon, IconButton, Kv, Notice, Section, Slider, Switch } from "./ui";
import { useEditor, useEditorActions } from "./editor-context";

/**
 * Panneau gauche : la « matière » et les réglages par lot.
 *
 * Les onglets d'outils (Média, Texte, Effets…) sont horizontaux, comme dans
 * CapCut Pro : changer de contexte ne fait jamais disparaître la timeline.
 */

const RAIL: { id: PanelTab; label: string; icon: string }[] = [
  { id: "media", label: "Média", icon: "film" },
  { id: "cuts", label: "Coupes", icon: "scissors" },
  { id: "subtitles", label: "Texte", icon: "text" },
  { id: "style", label: "Style", icon: "crop" },
  { id: "audio", label: "Audio", icon: "music" },
  { id: "effects", label: "Effets", icon: "sparkles" },
  { id: "transitions", label: "Fondus", icon: "transition" },
  { id: "outils", label: "Outils", icon: "layers" },
  { id: "masks", label: "Masques", icon: "mask" },
  { id: "project", label: "Projet", icon: "settings" },
];

export function LeftPanel() {
  const { ui, dispatch } = useEditor();
  const actions = useEditorActions();

  return (
    <div className="ed-left">
      <nav className="ed-rail" aria-label="Outils du monteur">
        {RAIL.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`ed-rail-btn${ui.tab === item.id ? " is-active" : ""}`}
            title={item.label}
            aria-current={ui.tab === item.id}
            onClick={() => actions.setTab(item.id)}
          >
            <Icon name={item.icon} size={16} />
            {item.label}
          </button>
        ))}
        <button
          type="button"
          className="ed-rail-btn"
          title="Nouveau projet (vide)"
          onClick={actions.closeProject}
        >
          <Icon name="plus" size={16} />
          Nouveau
        </button>
      </nav>

      <aside className="ed-panel ed-panel-wrap">
        <header className="ed-panel-head">
          <h2 className="ed-panel-title">
            {RAIL.find((item) => item.id === ui.tab)?.label ?? "Panneau"}
          </h2>
          <div className="ed-btn-row">
            <IconButton
              icon="close"
              label="Fermer le panneau"
              size={13}
              onClick={() => dispatch({ type: "ui", patch: { leftPanel: false } })}
            />
          </div>
        </header>
        <div className="ed-panel-body">
          {ui.tab === "media" ? <MediaTab /> : null}
          {ui.tab === "cuts" ? <CutsTab /> : null}
          {ui.tab === "subtitles" ? <SubtitlesTab /> : null}
          {ui.tab === "style" ? <StyleTab /> : null}
          {ui.tab === "audio" ? <AudioTab /> : null}
          {ui.tab === "effects" ? <EffectsTab /> : null}
          {ui.tab === "transitions" ? <TransitionsTab /> : null}
          {ui.tab === "outils" ? <OutilsTab /> : null}
          {ui.tab === "masks" ? <MasksTab /> : null}
          {ui.tab === "project" ? <ProjectTab /> : null}
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------- onglet média ------------------------------- */

function MediaTab() {
  const { project, ui, derived, dispatch } = useEditor();
  const actions = useEditorActions();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const source = project.source;

  return (
    <>
      <div
        className={`ed-dropzone${over ? " is-over" : ""}`}
        style={{ padding: "12px 10px" }}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void actions.importFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter") inputRef.current?.click();
        }}
      >
        <span className="ed-drop-cta">
          <span className="ed-drop-plus" aria-hidden="true">
            <Icon name="plus" size={14} />
          </span>
          Importer
        </span>
        <div className="ed-note">Glisse des vidéos, photos ici — MP4 · MOV · WEBM, 60 Mo max</div>
      </div>
      <input
        ref={inputRef}
        id="ed-import-media"
        type="file"
        accept="video/*"
        className="sr-only"
        style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
        aria-label="Importer une vidéo"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void actions.importFile(file);
          event.target.value = "";
        }}
      />

      {source ? (
        <Section title="Médiathèque">
          <div className="ed-media-grid">
            <button
              type="button"
              className="ed-media-card is-active"
              onClick={() => dispatch({ type: "select", selection: { kind: "source" } })}
              title={source.name}
            >
              <video
                src={source.url}
                muted
                playsInline
                preload="metadata"
                onLoadedData={(event) => {
                  const el = event.currentTarget;
                  if (el.duration > 0.4) el.currentTime = 0.4;
                }}
              />
              <span className="ed-media-duration">{formatClock(source.duration)}</span>
              <span className="ed-media-card-meta">
                <b>{source.name}</b>
                {source.width}×{source.height}
              </span>
            </button>
          </div>
        </Section>
      ) : null}

      <button
        type="button"
        className="ed-btn"
        onClick={() => void actions.loadDemo()}
        disabled={Boolean(ui.busy)}
      >
        <Icon name="film" size={13} />
        Ouvrir la démo (16 s, vertical)
      </button>

      {source ? (
        <Section title="Plan source" collapsible defaultOpen={false}>
          <div className="ed-card">
            <Kv k="Fichier" v={source.name} />
            <Kv k="Durée" v={formatClock(source.duration)} />
            <Kv k="Sortie" v={`${formatClock(derived.outputSeconds)} après coupes`} />
            <Kv k="Image" v={`${source.width}×${source.height} · ${source.fps} i/s`} />
            <Kv k="Audio" v={source.hasAudio ? "présent" : "aucune piste"} />
            <Kv k="Poids" v={`${Math.round(source.size / 1024 / 1024)} Mo`} />
          </div>
        </Section>
      ) : null}

      <Section title="Sur la table" collapsible>
        {project.clips.length === 0 ? (
          <p className="ed-note">
            Aucune piste remplie. « Coupes » pour retirer les silences, « Texte » pour poser des
            sous-titres, ou lance le doublage IA pour que la machine remplisse les pistes.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {(["subs", "cuts", "dub", "sfx"] as const).map((track) => {
              const clips = project.clips.filter((clip) => clip.track === track);
              if (!clips.length) return null;
              return (
                <button
                  key={track}
                  type="button"
                  className="ed-list-row"
                  onClick={() =>
                    actions.setTab(
                      track === "subs" ? "subtitles" : track === "cuts" ? "cuts" : "audio",
                    )
                  }
                >
                  <Icon
                    name={track === "subs" ? "text" : track === "cuts" ? "scissors" : "music"}
                    size={13}
                  />
                  <span style={{ flex: 1 }}>{clips.length} bloc(s)</span>
                  <span className="ed-time-pill">
                    {track === "subs" ? "sous-titres" : track === "cuts" ? "coupes" : "voix off"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Section>
    </>
  );
}

/* ------------------------------ onglet coupes ------------------------------ */

function CutsTab() {
  const { project, derived, dispatch } = useEditor();
  const actions = useEditorActions();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = async () => {
    if (!project.source?.bytes) {
      setError("Ce plan n'a pas été copié en mémoire : réimporte-le pour analyser l'audio.");
      return;
    }
    setScanning(true);
    setError(null);
    actions.setBusy("Analyse des silences…");
    try {
      const analysis = await scanSilences(project.source.bytes, {
        duration: project.source.duration,
        onProgress: (detail) => actions.setBusy(detail),
      });
      const clips: Clip[] = analysis.silences.map((silence) => ({
        id: `cut-${Math.round(silence.start * 1000)}`,
        track: "cuts",
        start: silence.start,
        duration: Math.max(0.08, silence.end - silence.start),
        label: "Silence",
        reason: "silence",
      }));
      if (!clips.length) {
        setError("Aucune pause assez longue détectée : la vidéo garde son rythme d'origine.");
      }
      actions.patch({ clips: [...project.clips.filter((c) => c.track !== "cuts"), ...clips] });
      actions.notify({
        kind: "ok",
        text: `${clips.length} pause(s) repérée(s) et placées sur la piste « Coupes ». Retire celles qui ne te plaisent pas avec la touche Suppr.`,
      });
    } catch (cause) {
      setError(describe(cause, "L'analyse audio a échoué."));
    } finally {
      setScanning(false);
      actions.setBusy(null);
    }
  };

  const cuts = project.clips.filter((clip) => clip.track === "cuts");

  return (
    <>
      <Section title="Détection">
        <button
          type="button"
          className="ed-btn ed-btn--primary"
          onClick={() => void scan()}
          disabled={scanning || !project.source}
        >
          <Icon name="wand" size={13} />
          {scanning ? "Analyse en cours…" : "Analyser les silences du plan"}
        </button>
        {error ? (
          <Notice notice={{ kind: "warn", text: error }} onDismiss={() => setError(null)} />
        ) : null}
        <p className="ed-note">
          Le découpage « viral » consiste à supprimer chaque white space de plus de 400 ms.
          L'analyse écoute le plan, propose les plages, et tu les valides une à une — c'est toi qui
          gardes ou non le souffle d'une phrase.
        </p>
      </Section>

      <Section title={`Plages retirées (${cuts.length})`}>
        {cuts.length === 0 ? (
          <p className="ed-note">Aucune coupe. Le montage sortira le plan entier.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {cuts.map((clip, index) => (
              <div key={clip.id} className="ed-list-row" style={{ cursor: "default" }}>
                <span style={{ width: 16, color: "var(--ed-text-faint)" }}>{index + 1}</span>
                <button
                  type="button"
                  style={{ flex: 1, textAlign: "left", color: "var(--ed-text)" }}
                  onClick={() => dispatch({ type: "seek", time: clip.start })}
                  title="Amener la tête de lecture ici"
                >
                  {formatClock(clip.start)} → {formatClock(clip.start + clip.duration)}
                  <span className="ed-note" style={{ marginLeft: 6 }}>
                    −{clip.duration.toFixed(2)}s
                  </span>
                </button>
                <IconButton
                  icon="trash"
                  label="Garder cette plage"
                  size={12}
                  onClick={() => {
                    actions.patch({ clips: project.clips.filter((c) => c.id !== clip.id) });
                  }}
                />
              </div>
            ))}
          </div>
        )}
        <div className="ed-btn-row">
          <button type="button" className="ed-btn ed-btn--sm" onClick={actions.addCut}>
            <Icon name="plus" size={12} />
            Coupe à la tête de lecture
          </button>
          <button
            type="button"
            className="ed-btn ed-btn--sm"
            disabled={!cuts.length}
            onClick={() =>
              actions.patch({ clips: project.clips.filter((c) => c.track !== "cuts") })
            }
          >
            Tout restaurer
          </button>
        </div>
      </Section>

      <Section title="Sortie" collapsible>
        <div className="ed-card">
          <Kv k="Segments conservés" v={Math.max(1, derived.keeps.length)} />
          <Kv k="Durée source" v={formatClock(derived.sourceDuration)} />
          <Kv k="Durée montée" v={formatClock(derived.outputSeconds)} />
          <Kv
            k="Gain"
            v={
              derived.sourceDuration > 0
                ? `−${Math.round(((derived.sourceDuration - derived.outputSeconds) / derived.sourceDuration) * 100)} %`
                : "—"
            }
          />
        </div>
        <Switch
          label="Compter les coupes dans le doublage IA"
          hint="Décoché, le pipeline IA garde le rythme d'origine et ignore cette piste."
          checked={project.cutSilences}
          onChange={(value) => actions.patch({ cutSilences: value })}
        />
      </Section>
    </>
  );
}

function downloadText(filename: string, body: string, mime: string) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function SubtitleFiles() {
  const { project } = useEditor();
  const actions = useEditorActions();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cues = clipsToSubtitleCues(project.clips);

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const raw = await file.text();
    const parsed = parseSubtitles(raw);
    if (!parsed.length) {
      actions.notify({
        kind: "error",
        text: "Aucun cue lisible : un SRT ou un WebVTT avec des plages horaires est attendu.",
      });
      return;
    }
    actions.patch({ clips: mergeSubtitleCues(project.clips, parsed) });
    actions.notify({
      kind: "ok",
      text: `${parsed.length} légende(s) importées (${detectSubtitleFormat(raw).toUpperCase()}). Coupes et voix off inchangées.`,
    });
  };

  const exportFile = (kind: "srt" | "vtt") => {
    if (!cues.length) {
      actions.notify({ kind: "warn", text: "Aucune légende à exporter." });
      return;
    }
    const stem = (project.name || "legendes").replace(/[^\w\-]+/g, "-");
    if (kind === "srt") downloadText(`${stem}.srt`, toSrt(cues), "application/x-subrip");
    else downloadText(`${stem}.vtt`, toVtt(cues), "text/vtt");
    actions.notify({
      kind: "ok",
      text: `${cues.length} légende(s) exportées en ${kind.toUpperCase()} — lisible par OpenCut, Shotcut, Kdenlive.`,
    });
  };

  return (
    <Section title="Fichier SRT · VTT">
      <div className="ed-btn-row" style={{ flexWrap: "wrap" }}>
        <button
          type="button"
          className="ed-btn ed-btn--sm"
          onClick={() => inputRef.current?.click()}
        >
          <Icon name="upload" size={12} />
          Importer
        </button>
        <button
          type="button"
          className="ed-btn ed-btn--sm"
          onClick={() => exportFile("srt")}
          disabled={!cues.length}
        >
          <Icon name="download" size={12} />
          SRT
        </button>
        <button
          type="button"
          className="ed-btn ed-btn--sm"
          onClick={() => exportFile("vtt")}
          disabled={!cues.length}
        >
          <Icon name="download" size={12} />
          VTT
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".srt,.vtt,text/vtt,application/x-subrip,text/plain"
          className="sr-only"
          style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
          aria-label="Importer un fichier SRT ou WebVTT"
          onChange={(event) => {
            void importFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      <p className="ed-note" style={{ margin: 0 }}>
        Formats ouverts d'OpenCut, Shotcut, Kdenlive, Aegisub. Les temps restent, le graphe
        d'encodage ne bouge pas.
      </p>
    </Section>
  );
}

/* ------------------------------ onglet sous-titres ------------------------------ */

function SubtitlesTab() {
  const { project, derived } = useEditor();
  const actions = useEditorActions();
  const turnstile = useTurnstile();
  const abortRef = useRef<AbortController | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const cues = derived.subs;
  const sameLanguage = isSameLanguage(project.sourceLanguage.name, project.targetLanguage.name);

  const translateTrack = async () => {
    if (!cues.length || sameLanguage || translating) return;
    setTranslateError(null);
    setTranslating(true);
    const controller = new AbortController();
    abortRef.current = controller;
    actions.setBusy("Traduction des légendes…");
    try {
      const result = await translateCaptionTrack({
        clips: project.clips,
        sourceLanguage: project.sourceLanguage.name,
        targetLanguage: project.targetLanguage.name,
        turnstileToken: turnstile.token,
        signal: controller.signal,
      });
      actions.patch({ clips: result.clips });
      const extra = result.untranslated
        ? ` ${result.untranslated} bloc(s) ont gardé le texte d'origine.`
        : "";
      actions.notify({
        kind: result.changed ? "ok" : "warn",
        text: result.changed
          ? `${result.changed} légende(s) traduites en ${project.targetLanguage.name} — les temps restent, pas de voix off.${extra}`
          : extra.trim() || "Rien à traduire : les blocs sont déjà dans cette langue, ou vides.",
      });
    } catch (cause) {
      if (controller.signal.aborted) return;
      setTranslateError(describe(cause, "La traduction a échoué."));
    } finally {
      abortRef.current = null;
      setTranslating(false);
      actions.setBusy(null);
      turnstile.reset?.();
    }
  };

  return (
    <>
      <button
        type="button"
        className="ed-btn ed-btn--primary"
        disabled={!project.source}
        onClick={() => actions.openCaptions(true)}
      >
        <Icon name="wand" size={13} />
        Auto sous-titres
      </button>
      <p className="ed-note" style={{ margin: 0 }}>
        Un clic transcrit le plan et pose les légendes mot à mot. Le doublage IA
        (traduction + voix) reste dans Exporter.
      </p>

      <Section title="Traduire les légendes">
        <Chips
          value={project.targetLanguage.code}
          options={TARGET_LANGUAGES.map((item) => ({ id: item.code, label: item.label }))}
          onChange={(code) => {
            const language = TARGET_LANGUAGES.find((item) => item.code === code);
            if (language) actions.patch({ targetLanguage: language });
          }}
        />
        <button
          type="button"
          className="ed-btn"
          disabled={
            translating ||
            cues.length === 0 ||
            sameLanguage ||
            (turnstile.enabled && !turnstile.ready)
          }
          onClick={() => void translateTrack()}
        >
          <Icon name="text" size={13} />
          {translating ? "Traduction…" : "Traduire les légendes"}
        </button>
        <p className="ed-note" style={{ margin: 0 }}>
          {cues.length} bloc(s) · {project.sourceLanguage.label} → {project.targetLanguage.label}.
          Les horodatages restent. Pas de voix off.
        </p>
        {sameLanguage ? (
          <Notice
            notice={{
              kind: "warn",
              text: "Même langue de départ et d'arrivée : change la langue du doublage pour traduire.",
            }}
          />
        ) : null}
        {translateError ? (
          <Notice
            notice={{ kind: "error", text: translateError }}
            onDismiss={() => setTranslateError(null)}
          />
        ) : null}
        {turnstile.enabled ? (
          <div>
            <div ref={turnstile.containerRef} />
            {turnstile.failed ? (
              <p className="ed-note" style={{ color: "#ffb4b4" }}>
                {turnstile.errorMessage ?? "Le widget anti-robot n'a pas pu se charger."}
              </p>
            ) : null}
          </div>
        ) : null}
        {translating ? (
          <button
            type="button"
            className="ed-btn ed-btn--sm ed-btn--danger"
            onClick={() => abortRef.current?.abort()}
          >
            Annuler
          </button>
        ) : null}
      </Section>
      <SubtitleFiles />
      <Section
        title={`Blocs (${cues.length})`}
        action={
          <button type="button" className="ed-btn ed-btn--sm" onClick={actions.addCue}>
            <Icon name="plus" size={12} />
            Bloc
          </button>
        }
      >
        {cues.length === 0 ? (
          <p className="ed-note">
            Aucun sous-titre. Double-clique sur la piste pour en poser un, ou lance le doublage IA
            pour transcrire le plan.
          </p>
        ) : (
          <div className="flex flex-col gap-1" style={{ maxHeight: 340, overflow: "auto" }}>
            {cues.map((clip, index) => (
              <CueRow key={clip.id} clip={clip} index={index} next={cues[index + 1] ?? null} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Découpage" collapsible>
        <Switch
          label="Mot par mot"
          hint="Chaque mot s'affiche seul, calé sur sa durée de prononciation : c'est le rythme des légendes qui retiennent l'œil."
          checked={project.wordByWord}
          onChange={(value) => actions.patch({ wordByWord: value })}
        />
        <Slider
          label="Caractères par ligne"
          value={derived.preset.maxCharsPerLine}
          min={10}
          max={40}
          onChange={(value) =>
            actions.patch(
              { overrides: { ...project.overrides, maxCharsPerLine: value } },
              "override",
            )
          }
          onCommit={actions.endGesture}
        />
        <Slider
          label="Lignes maximum"
          value={derived.preset.maxLines}
          min={1}
          max={4}
          onChange={(value) =>
            actions.patch({ overrides: { ...project.overrides, maxLines: value } }, "override")
          }
          onCommit={actions.endGesture}
        />
        {cues.length > 200 ? (
          <Notice
            notice={{
              kind: "warn",
              text: `${cues.length} cues après découpage : au-delà de 320, le moteur retombe sur les phrases entières pour ne pas saturer le graphe de filtres.`,
            }}
          />
        ) : null}
      </Section>
    </>
  );
}

function CueRow({ clip, index, next }: { clip: Clip; index: number; next: Clip | null }) {
  const { state, dispatch } = useEditor();
  const actions = useEditorActions();
  const selected = isSelected(state.selection, "clip", clip.id);

  return (
    <div
      className={`ed-list-row${selected ? " is-active" : ""}`}
      style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: 4 }}
    >
      <button
        type="button"
        style={{ color: "var(--ed-text-faint)", textAlign: "left" }}
        onClick={(event) => {
          const multi = event.shiftKey || event.ctrlKey || event.metaKey;
          // Deux actions distinctes, pas un objet à moitié commun : l'union
          // discriminée du réducteur ne se reconstitue pas toute seule.
          if (multi) dispatch({ type: "toggleSelect", kind: "clip", id: clip.id });
          else dispatch({ type: "select", selection: onlySelection("clip", clip.id) });
          dispatch({ type: "seek", time: clip.start });
        }}
        title="Aller à ce bloc"
      >
        {index + 1}
      </button>
      <textarea
        value={clip.text ?? ""}
        rows={1}
        aria-label={`Texte du sous-titre ${index + 1}`}
        className="ed-textarea"
        style={{ minHeight: 30, padding: "4px 6px" }}
        onFocus={() => dispatch({ type: "select", selection: onlySelection("clip", clip.id) })}
        onChange={(event) =>
          actions.updateClip(clip.id, { text: event.target.value }, `cue:${clip.id}`)
        }
        onBlur={actions.endGesture}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            (event.target as HTMLTextAreaElement).blur();
            // Entrée = bloc suivant, comme dans un tableur de montage.
            if (next) {
              dispatch({ type: "select", selection: onlySelection("clip", next.id) });
              dispatch({ type: "seek", time: next.start });
            }
          }
        }}
      />
      <span className="ed-time-pill" style={{ gridColumn: "2", justifySelf: "start" }}>
        {formatClock(clip.start)} · {clip.duration.toFixed(2)}s
      </span>
    </div>
  );
}

/* -------------------------------- onglet style ------------------------------- */

function StyleTab() {
  const { project, derived, ui, dispatch } = useEditor();
  const actions = useEditorActions();
  const preset = derived.preset;
  const activeTemplate = matchingViralTemplate(project);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  const applyTemplate = (id: ViralTemplateId) => {
    const result = applyViralTemplate(project, id);
    actions.patch(result.patch);
    const added = result.patch.clips?.find(
      (clip) => clip.track === "subs" && !project.clips.some((item) => item.id === clip.id),
    );
    if (added) {
      dispatch({ type: "select", selection: onlySelection("clip", added.id) });
      dispatch({ type: "seek", time: added.start });
    } else if (id === "hook") {
      dispatch({ type: "seek", time: 0.15 });
    } else if (id === "outro" && project.source?.duration) {
      dispatch({ type: "seek", time: Math.max(0, project.source.duration - 2.2) });
    }
    actions.notify({
      kind: /trop court|n'a pas été remplacé/.test(result.notice) ? "warn" : "ok",
      text: result.notice,
    });
  };

  // L'image de contrôle est calculée à la demande et jetée dès qu'on quitte
  // l'onglet : c'est un `blob:` de plus dans la mémoire de l'onglet.
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const renderStill = async () => {
    const bytes = project.source?.bytes;
    if (!bytes) return;
    setRendering(true);
    setPreviewError(null);
    try {
      const sample =
        derived.subs.find(
          (clip) => clip.start <= ui.playhead && clip.start + clip.duration >= ui.playhead,
        )?.text ??
        derived.subs[0]?.text ??
        "Aperçu du style";
      const url = await renderPreviewFrame(bytes, {
        filterId: project.filterId,
        vfxId: project.vfxId,
        upscale: project.upscale,
        videoWidth: project.source?.width,
        videoHeight: project.source?.height,
        sampleText: sample,
        preset: derived.preset,
        subYAnchor: preset.yAnchor,
        atSecond: Math.max(0.1, ui.playhead),
        languageCode: project.targetLanguage.code,
        masks: project.masks,
        maskStrength: project.maskStrength,
      });
      setPreviewUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return url;
      });
    } catch (error) {
      setPreviewError(describe(error, "L'image de contrôle n'a pas pu être rendue."));
    } finally {
      setRendering(false);
    }
  };

  return (
    <>
      <Section title="Formats viraux 9:16">
        <p className="ed-note" style={{ margin: 0 }}>
          Un clic pose le cadre — hook, punch, bandeau, outro. Ce n'est pas un style de police.
        </p>
        <div className="ed-grid-2">
          {VIRAL_TEMPLATES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`ed-tpl-card${activeTemplate === item.id ? " is-active" : ""}`}
              title={item.tagline}
              onClick={() => applyTemplate(item.id)}
            >
              <span className="ed-tpl-phone" aria-hidden="true">
                <span
                  className="ed-tpl-bar"
                  data-pos={item.caption}
                  style={{ background: item.accent }}
                />
              </span>
              <span className="ed-tpl-name">{item.name}</span>
              <span className="ed-tpl-tag">{item.tagline}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Animations de texte">
        <p className="ed-note" style={{ margin: 0 }}>
          Entrées CapCut sur la légende. L'aperçu les joue ; l'export FFmpeg pose le texte tel quel.
        </p>
        <TextFxGrid />
      </Section>

      <Section title="Presets (glisse sur la timeline)">
        <div className="ed-grid-2">
          {SUBTITLE_PRESETS.map((item) => (
            <div
              key={item.id}
              className={`ed-style-card${project.presetId === item.id ? " is-active" : ""}`}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData("application/x-viraldub-style", item.id);
                event.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => actions.patch({ presetId: item.id, overrides: {} })}
              title={`${item.name} — clique pour appliquer, glisse sur la piste pour l'incruster`}
            >
              <div
                className="ed-style-sample"
                style={{
                  color: item.fontColor === "white" ? "#fff" : item.fontColor,
                  textTransform: item.uppercase ? "uppercase" : "none",
                  WebkitTextStroke: `${Math.max(0.5, (item.borderW ?? 0) / 12)}px ${item.borderColor ?? "#000"}`,
                  paintOrder: "stroke fill",
                  textShadow: item.shadowColor ? "0 1px 2px rgba(0,0,0,.8)" : undefined,
                  background: item.useBox ? "rgba(0,0,0,.55)" : undefined,
                  padding: item.useBox ? "2px 6px" : undefined,
                  fontSize: Math.max(13, Math.min(18, item.fontsize / 6)),
                }}
              >
                Hey
              </div>
              <div style={{ fontSize: 10.5, color: "var(--ed-text-dim)", marginTop: 4 }}>
                {item.name}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Taille et placement">
        <Slider
          label="Corps"
          value={preset.fontsize}
          min={28}
          max={160}
          format={(value) => `${value} px`}
          hint="Échelle du plan source : l'aperçu suit la largeur réelle de l'image."
          onChange={(value) =>
            actions.patch({ overrides: { ...project.overrides, fontsize: value } }, "override")
          }
          onCommit={actions.endGesture}
        />
        <Slider
          label="Hauteur d'ancrage"
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
          label="Contour"
          value={preset.borderW ?? 0}
          min={0}
          max={18}
          format={(value) => `${value} px`}
          onChange={(value) =>
            actions.patch(
              { presetId: project.presetId, overrides: { ...project.overrides, borderW: value } },
              "override",
            )
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
          hint="0 % : aucun bandeau — contour et ombre suffisent sur une image contrastée."
          onChange={(value) => actions.patch({ boxOpacity: value }, "opacity")}
          onCommit={actions.endGesture}
        />
        <Switch
          label="Majuscules"
          checked={preset.uppercase}
          onChange={(value) =>
            actions.patch({ overrides: { ...project.overrides, uppercase: value } })
          }
        />
        <div className="ed-btn-row" style={{ flexWrap: "wrap" }}>
          {[
            { id: "white", label: "Blanc", css: "#fff" },
            { id: "yellow", label: "Jaune", css: "#ffd400" },
            { id: "#FF0050", label: "Rose", css: "#FF0050" },
            { id: "#00f2ea", label: "Cyan", css: "#00f2ea" },
            { id: "black", label: "Noir", css: "#000" },
          ].map((color) => (
            <button
              key={color.id}
              type="button"
              className="ed-swatch"
              title={color.label}
              aria-label={`Couleur ${color.label}`}
              style={{ background: color.css }}
              onClick={() =>
                actions.patch({ overrides: { ...project.overrides, fontColor: color.id } })
              }
            />
          ))}
        </div>
      </Section>

      <Section title="Aperçu fidèle">
        <p className="ed-note">
          L'aperçu de la scène imite le style en CSS. Pour juger au pixel — `unsharp`,
          `colortemperature` et le floutage des zones n'ont pas d'équivalent CSS exact — FFmpeg rend
          une seule image avec la chaîne du rendu final.
        </p>
        <div className="ed-btn-row">
          <button
            type="button"
            className="ed-btn ed-btn--sm"
            disabled={!project.source?.bytes || rendering}
            onClick={() => void renderStill()}
          >
            <Icon name="film" size={12} />
            {rendering ? "Rendu de l'image…" : "Image de contrôle (FFmpeg)"}
          </button>
          <button
            type="button"
            className="ed-btn ed-btn--sm"
            onClick={() => actions.patch({ overrides: {} })}
          >
            Revenir au preset
          </button>
        </div>
        {previewError ? (
          <Notice
            notice={{ kind: "error", text: previewError }}
            onDismiss={() => setPreviewError(null)}
          />
        ) : null}
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Image de contrôle produite par FFmpeg : filtre, sous-titres et zones floutées"
            style={{ width: "100%", borderRadius: 8, border: "1px solid var(--ed-line)" }}
          />
        ) : null}
      </Section>
    </>
  );
}

/* -------------------------------- onglet audio ------------------------------- */

function AudioTab() {
  const { project, derived } = useEditor();
  const actions = useEditorActions();
  const dubs = project.clips.filter((clip) => clip.track === "dub");
  const sfxCount = project.clips.filter((clip) => clip.track === "sfx").length;

  return (
    <>
      <Section title={`Bruitages CapCut (${sfxCount})`}>
        <p className="ed-note" style={{ margin: 0 }}>
          Clique pour poser le son sur la tête de lecture. Ils se mixent à l'export.
        </p>
        <SfxLibrary />
      </Section>

      <Section title="Voix d'origine">
        <Switch
          label="Supprimer l'ambiance du plan"
          hint="Sans fond audible, la voix de doublage flotte : on la garde en général, à bas volume."
          checked={project.removeOriginalAudio}
          onChange={(value) => actions.patch({ removeOriginalAudio: value })}
        />
        {!project.removeOriginalAudio ? (
          <Slider
            label="Volume de l'ambiance"
            value={project.ambienceLevel}
            min={0}
            max={1}
            step={0.05}
            format={(value) => `${Math.round(value * 100)} %`}
            hint="Le fond baisse automatiquement dès que la voix parle (ducking), puis remonte."
            onChange={(value) => actions.patch({ ambienceLevel: value }, "ambience")}
            onCommit={actions.endGesture}
          />
        ) : null}
      </Section>

      <Section title="Moteur de doublage">
        <Chips
          value={project.ttsProvider}
          options={[
            { id: "elevenlabs", label: "Voix IA (ElevenLabs)" },
            { id: "ai33", label: "Voix clonée (ai33.pro)" },
          ]}
          onChange={(value) => actions.patch({ ttsProvider: value })}
        />
        {project.ttsProvider === "ai33" ? (
          <input
            className="ed-input"
            placeholder="ID de ta voix clonée ai33.pro"
            aria-label="Identifiant de voix clonée"
            value={project.clonedVoiceId}
            onChange={(event) => actions.patch({ clonedVoiceId: event.target.value }, "voiceid")}
            onBlur={actions.endGesture}
          />
        ) : null}
        <p className="ed-note">
          Quatre voix sont autorisées côté serveur, une par locuteur détecté. Le clone vocal se
          choisit ici mais reste lié à ton compte : il n'est jamais exporté dans un fichier de
          configuration.
        </p>
      </Section>

      <Section title={`Extraits générés (${dubs.length})`} collapsible>
        {dubs.length === 0 ? (
          <p className="ed-note">
            Lance un doublage IA pour obtenir les extraits. Ils resteront ici, écoutables avant
            export.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {dubs.map((clip) => (
              <div key={clip.id} className="ed-list-row">
                <Icon name="music" size={13} />
                <span style={{ flex: 1 }}>
                  {clip.label} · {clip.duration.toFixed(2)}s
                </span>
                {clip.audioUrl ? (
                  <a
                    href={clip.audioUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ed-btn ed-btn--sm"
                    title="Écouter l'extrait"
                  >
                    <Icon name="play" size={11} />
                    Écouter
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Calage" collapsible>
        <div className="ed-card">
          <Kv k="Blocs de texte" v={derived.subs.length} />
          <Kv k="Cues incrustés" v={derived.cues.length} />
          <Kv
            k="Débit moyen"
            v={
              derived.sourceDuration > 0
                ? `${(derived.subs.length / (derived.sourceDuration / 60)).toFixed(0)} blocs/min`
                : "—"
            }
          />
        </div>
      </Section>
    </>
  );
}

/* ------------------------------- onglet effets ------------------------------ */

function EffectsTab() {
  const { project } = useEditor();
  const actions = useEditorActions();
  const [vfxCat, setVfxCat] = useState("all");
  const vfxItems =
    vfxCat === "all" ? VFX_EFFECTS : VFX_EFFECTS.filter((item) => item.category === vfxCat);

  return (
    <>
      <Section title="Effets visuels">
        <p className="ed-note" style={{ margin: 0 }}>
          Catalogue CapCut Pro — {VFX_EFFECTS.length - 1} VFX, empilés sur le filtre. Aperçu CSS,
          export ffmpeg.wasm.
        </p>
        <Chips
          value={vfxCat}
          options={[
            { id: "all", label: "Tous" },
            ...VFX_CATEGORIES.map((item) => ({ id: item.id, label: item.label })),
          ]}
          onChange={setVfxCat}
        />
        <div className="ed-vfx-grid">
          {vfxItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`ed-vfx-card${project.vfxId === item.id ? " is-active" : ""}`}
              title={item.description}
              onClick={() => actions.patch({ vfxId: item.id })}
            >
              <span
                className={`ed-vfx-sample ed-vfx-sample--${item.category}${item.motion ? ` ed-vfx-${item.motion}` : ""}`}
                style={{ filter: item.css === "none" ? undefined : item.css }}
              />
              <span className="ed-vfx-name">{item.name}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Animations de texte">
        <TextFxGrid />
      </Section>

      <Section title="Bruitages">
        <SfxLibrary />
      </Section>

      <Section title="Filtres">
        <div className="ed-grid-2">
          {VIDEO_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`ed-filter-card${project.filterId === item.id ? " is-active" : ""}`}
              title={item.description}
              onClick={() => actions.patch({ filterId: item.id })}
            >
              <span
                className="ed-filter-sample"
                style={{ filter: item.css, opacity: project.filterId === item.id ? 1 : 0.85 }}
              />
              <span className="ed-filter-name">{item.name}</span>
            </button>
          ))}
        </div>
        <p className="ed-note">
          L'aperçu applique l'équivalent CSS du filtre FFmpeg : nuance près, c'est ce qui sera
          encodé. « Noir & blanc » et « Chaud » modifient vraiment l'image, les autres la nettoient
          seulement.
        </p>
      </Section>

      <Section title="Définition">
        <Chips
          value={project.upscale}
          options={UPSCALE_MODES.map((mode) => ({
            id: mode.id,
            label: mode.name,
            title: mode.note,
          }))}
          onChange={(value) => actions.patch({ upscale: value })}
        />
        {project.upscale === "2160" ? (
          <Notice
            notice={{
              kind: "warn",
              text: "La 4K multiplie par quatre le temps d'encodage et peut échouer sur mobile : si le rendu échoue, le moteur repasse à la définition d'origine.",
            }}
          />
        ) : null}
      </Section>

      <Section title="Cadrage">
        <Switch
          label="Effet miroir"
          hint="Retourne l'image horizontalement. Utile pour échapper à la détection de doublon, gênant si un texte est incrusté à l'endroit."
          checked={project.mirror}
          onChange={(value) => actions.patch({ mirror: value })}
        />
      </Section>
    </>
  );
}

/* ----------------------------- onglet transitions ---------------------------- */

function TransitionsTab() {
  const { project, derived } = useEditor();
  const actions = useEditorActions();
  const needsCuts = derived.removed.length < 2;
  const [cat, setCat] = useState("all");
  const items =
    cat === "all" ? TRANSITIONS : TRANSITIONS.filter((item) => item.category === cat);

  return (
    <>
      <Section title="Entre les coupes">
        <p className="ed-note" style={{ margin: 0 }}>
          {TRANSITIONS.length - 1} fondus xfade FFmpeg — le raccord raccourcit la sortie, les
          légendes sont recalées.
        </p>
        <Chips
          value={cat}
          options={[
            { id: "all", label: "Tous" },
            ...TRANSITION_CATEGORIES.map((item) => ({ id: item.id, label: item.label })),
          ]}
          onChange={setCat}
        />
        <div className="ed-xfade-grid">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`ed-xfade-card${project.transition === item.id ? " is-active" : ""}`}
              title={item.description}
              onClick={() => actions.patch({ transition: item.id })}
            >
              <span className={`ed-xfade-sample ed-xfade-sample--${item.category}`} aria-hidden="true">
                <i className="a" />
                <i className="b" />
              </span>
              <span className="ed-xfade-name">{item.name}</span>
            </button>
          ))}
        </div>
        {project.transition !== "none" ? (
          <Slider
            label="Durée du fondu"
            value={project.transitionDuration}
            min={0.1}
            max={1}
            step={0.05}
            format={(value) => `${value.toFixed(2)} s`}
            onChange={(value) => actions.patch({ transitionDuration: value }, "transition")}
            onCommit={actions.endGesture}
          />
        ) : null}
      </Section>

      {needsCuts ? (
        <Notice
          notice={{
            kind: "warn",
            text: "Une transition relie deux segments : sans au moins deux coupes, il n'y a rien à raccorder et le réglage restera sans effet.",
          }}
        />
      ) : null}

      <p className="ed-note">
        Un fondu fait se recouvrir les deux segments : la vidéo finale raccourcit d'autant, et les
        sous-titres sont re-calés pour ne pas dériver. C'est le moteur qui recalcule, pas un simple
        décalage constant.
      </p>
    </>
  );
}

function TextFxGrid() {
  const { project } = useEditor();
  const actions = useEditorActions();
  return (
    <div className="ed-sfx-grid">
      {TEXT_FX.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`ed-sfx-card${project.textFxId === item.id ? " is-active" : ""}`}
          title={item.description}
          onClick={() => actions.patch({ textFxId: item.id })}
        >
          <b>{item.name}</b>
          <span>{item.description}</span>
        </button>
      ))}
    </div>
  );
}

function SfxLibrary() {
  const { project, ui } = useEditor();
  const actions = useEditorActions();
  const [cat, setCat] = useState("all");
  const items =
    cat === "all" ? SFX_LIBRARY : SFX_LIBRARY.filter((item) => item.category === cat);

  const poser = (id: string) => {
    const def = getSfx(id);
    const samples = synthesizeSfx(id);
    const url = sfxObjectUrl(id);
    const start = Math.max(0, ui.playhead);
    const clip = makeClip(
      "sfx",
      { start, end: start + def.duration },
      {
        label: def.name,
        sfxId: id,
        audioUrl: url,
        peaks: peaksOf(samples),
      },
    );
    actions.patch({ clips: [...project.clips, clip] });
    actions.notify({ kind: "ok", text: `${def.name} posé à ${formatClock(start)}.` });
    const preview = new Audio(url);
    void preview.play().catch(() => {});
  };

  return (
    <>
      <Chips
        value={cat}
        options={[
          { id: "all", label: "Tous" },
          ...SFX_CATEGORIES.map((item) => ({ id: item.id, label: item.label })),
        ]}
        onChange={setCat}
      />
      <div className="ed-sfx-grid">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="ed-sfx-card"
            title={item.description}
            onClick={() => poser(item.id)}
          >
            <b>{item.name}</b>
            <span>{item.duration.toFixed(2)} s</span>
          </button>
        ))}
      </div>
    </>
  );
}

/* -------------------- onglet outils OSS / clones CapCut -------------------- */

function OutilsTab() {
  const { project } = useEditor();
  const actions = useEditorActions();
  const active = matchingCloneRecipe(project);

  return (
    <>
      <p className="ed-note" style={{ margin: 0 }}>
        Outils libres déjà dans le moteur, plus des looks calqués sur les clones CapCut. Rien n'est
        envoyé : ffmpeg.wasm, SRT et MCP restent dans le navigateur.
      </p>

      <Section title="Moteur libre">
        <div className="ed-tool-grid">
          <button
            type="button"
            className="ed-tool-card"
            disabled={!project.source}
            onClick={() => actions.openCaptions(true)}
          >
            <b>Whisper-like</b>
            <span>Auto sous-titres — transcription locale via l'API, sans doublage.</span>
          </button>
          <button type="button" className="ed-tool-card" onClick={() => actions.setTab("cuts")}>
            <b>LosslessCut</b>
            <span>Analyse des silences et coupes sur la piste, comme le NLE OSS.</span>
          </button>
          <button type="button" className="ed-tool-card" onClick={() => actions.setTab("project")}>
            <b>MCP</b>
            <span>Pilote l'atelier depuis un agent — déjà câblé dans Projet.</span>
          </button>
          <button
            type="button"
            className="ed-tool-card"
            disabled={!project.source}
            onClick={() => actions.openExport(true)}
          >
            <b>ffmpeg.wasm</b>
            <span>Rendu local dans le navigateur, MIT, sans compte.</span>
          </button>
        </div>
      </Section>

      <SubtitleFiles />

      <Section title="Looks des clones CapCut">
        <div className="ed-tool-grid">
          {CLONE_RECIPES.map((recipe) => (
            <button
              key={recipe.id}
              type="button"
              className={`ed-tool-card${active === recipe.id ? " is-active" : ""}`}
              title={`${recipe.origin} · ${recipe.license}`}
              onClick={() => {
                const result = applyCloneRecipe(project, recipe.id);
                if (!result) return;
                actions.patch(result.patch);
                actions.notify({ kind: "ok", text: result.notice });
              }}
            >
              <span className="ed-tool-origin">
                {recipe.origin} · {recipe.license}
              </span>
              <b>{recipe.name}</b>
              <span>{recipe.blurb}</span>
            </button>
          ))}
        </div>
        <p className="ed-note" style={{ margin: 0 }}>
          Une recette n'écrit que filtre, style de légende et fondu. Pas de code propriétaire, pas
          de nouveau graphe.
        </p>
      </Section>
    </>
  );
}

/* -------------------------------- onglet masques ----------------------------- */

function MasksTab() {
  const { project, dispatch, state } = useEditor();
  const actions = useEditorActions();
  const [detecting, setDetecting] = useState(false);

  const autoDetect = async () => {
    if (!project.source?.bytes) {
      actions.notify({
        kind: "warn",
        text: "La détection lit les pixels du plan : réimporte la vidéo pour l'utiliser.",
      });
      return;
    }
    setDetecting(true);
    try {
      const blob = new Blob([project.source.bytes as unknown as BlobPart], { type: "video/mp4" });
      const zones = await detectMaskZones(blob);
      const merged = project.masks.map(
        (zone) => zones.find((found) => found.id === zone.id) ?? zone,
      );
      actions.patch({ masks: merged });
      actions.notify({
        kind: zones.length ? "ok" : "warn",
        text: zones.length
          ? "Zones proposées par analyse de l'image. Ajuste-les à la souris dans la scène."
          : "Aucune bande horizontale nette détectée : place les zones toi-même.",
      });
    } catch (error) {
      actions.notify({ kind: "error", text: describe(error, "La détection a échoué.") });
    } finally {
      setDetecting(false);
    }
  };

  const setZone = (id: string, patch: Partial<MaskZone>, mergeKey?: string) =>
    dispatch({
      type: "setMasks",
      masks: project.masks.map((zone) =>
        zone.id === id ? clampZone({ ...zone, ...patch }) : zone,
      ),
      mergeKey,
    });

  return (
    <>
      <Section title="Zones à flouter">
        <p className="ed-note">
          Huit poignées agrippent chaque bord dans la scène, au pixel près. Une zone qui occupe
          toute la largeur ne se déplace que verticalement : le cadre la retient sur les côtés, et
          le curseur le signale.
        </p>
        <div className="ed-btn-row">
          <button
            type="button"
            className="ed-btn ed-btn--sm"
            onClick={() => void autoDetect()}
            disabled={detecting || !project.source}
          >
            <Icon name="wand" size={12} />
            {detecting ? "Analyse…" : "Détection auto"}
          </button>
          <button type="button" className="ed-btn ed-btn--sm" onClick={actions.addMask}>
            <Icon name="plus" size={12} />
            Zone
          </button>
        </div>

        <Chips
          value={project.maskStrength}
          options={[
            { id: "light", label: "Léger", title: "Adoucit sans effacer" },
            { id: "medium", label: "Moyen", title: "Texte illisible, scène préservée" },
            { id: "strong", label: "Fort", title: "Flou maximal et léger assombrissement" },
          ]}
          onChange={(value) => actions.patch({ maskStrength: value })}
        />

        <div className="flex flex-col gap-1">
          {project.masks.map((zone) => {
            const selected = isSelected(state.selection, "mask", zone.id);
            return (
              <div
                key={zone.id}
                className={`ed-list-row${selected ? " is-active" : ""}`}
                style={{ alignItems: "flex-start" }}
              >
                <input
                  type="checkbox"
                  checked={zone.enabled}
                  aria-label={`Activer ${zone.label}`}
                  style={{ accentColor: "#00e5c8", marginTop: 3 }}
                  onChange={(event) => setZone(zone.id, { enabled: event.target.checked })}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <button
                    type="button"
                    style={{ color: "var(--ed-text)", fontSize: 12.5, fontWeight: 600 }}
                    onClick={(event) =>
                      dispatch(
                        event.shiftKey || event.ctrlKey || event.metaKey
                          ? { type: "toggleSelect", kind: "mask", id: zone.id }
                          : { type: "select", selection: onlySelection("mask", zone.id) },
                      )
                    }
                    title="Sélectionner pour ajuster dans la scène"
                  >
                    {zone.label}
                  </button>
                  {zone.enabled ? (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 2,
                        marginTop: 4,
                      }}
                    >
                      {(
                        [
                          ["x", "X"],
                          ["y", "Y"],
                          ["w", "L"],
                          ["h", "H"],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 10, color: "var(--ed-text-faint)", width: 10 }}>
                            {label}
                          </span>
                          <input
                            className="ed-input"
                            style={{ padding: "2px 4px", fontSize: 11 }}
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={Math.round(zone[key] * 100)}
                            onChange={(event) =>
                              setZone(
                                zone.id,
                                { [key]: (parseFloat(event.target.value) || 0) / 100 },
                                `mask:${zone.id}:${key}`,
                              )
                            }
                            onBlur={actions.endGesture}
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="ed-note">éteinte</div>
                  )}
                </div>
                <IconButton
                  icon="trash"
                  label="Retirer la zone"
                  size={12}
                  onClick={() =>
                    actions.patch({ masks: project.masks.filter((item) => item.id !== zone.id) })
                  }
                />
              </div>
            );
          })}
        </div>

        <p className="ed-note">
          Une zone ne cache pas : elle rend illisible. Les nouveaux sous-titres s'incrusteront par
          dessus, donc ne masque que ce qui gêne vraiment.
        </p>
      </Section>
    </>
  );
}

/* ------------------------------- onglet projet ------------------------------- */

function ProjectTab() {
  const { project, derived } = useEditor();
  const actions = useEditorActions();
  const configInputRef = useRef<HTMLInputElement | null>(null);

  const exportConfigFile = () => {
    const json = configurationDuProjet(project);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = configFileName();
    link.click();
    URL.revokeObjectURL(url);
    actions.notify({
      kind: "ok",
      text: "Configuration exportée : réglages et montage, aucun identifiant.",
    });
  };

  const importConfigFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_CONFIG_BYTES) {
      actions.notify({ kind: "error", text: "Fichier de configuration trop volumineux." });
      return;
    }
    // Lecture ici, application partagée : `appliquerConfiguration` est aussi la
    // porte par laquelle entre le document rendu par le fil MCP. Une seule
    // fusion, donc un seul endroit où se glisserait un bug.
    appliquerConfiguration(await file.text(), project, actions, "fichier");
  };

  return (
    <>
      <Section title="Traduction">
        <div className="ed-section-title" style={{ marginTop: 4 }}>
          Langue parlée dans le plan
        </div>
        <Chips
          value={project.sourceLanguage.code}
          options={SOURCE_LANGUAGES.map((item) => ({ id: item.code, label: item.label }))}
          onChange={(code) => {
            const language = SOURCE_LANGUAGES.find((item) => item.code === code);
            if (language) actions.patch({ sourceLanguage: language });
          }}
        />
        <div className="ed-section-title" style={{ marginTop: 6 }}>
          Langue du doublage
        </div>
        <Chips
          value={project.targetLanguage.code}
          options={TARGET_LANGUAGES.map((item) => ({ id: item.code, label: item.label }))}
          onChange={(code) => {
            const language = TARGET_LANGUAGES.find((item) => item.code === code);
            if (language) actions.patch({ targetLanguage: language });
          }}
        />
        {isSameLanguage(project.sourceLanguage.name, project.targetLanguage.name) ? (
          <Notice
            notice={{
              kind: "warn",
              text: "Même langue de départ et d'arrivée : le plan sera retranscrit et redoublé sans être traduit.",
            }}
          />
        ) : null}
      </Section>

      <Section title="Encodage">
        <Chips
          value={project.quality}
          options={[
            { id: "draft", label: "Rapide", title: "ultrafast · CRF 30" },
            { id: "standard", label: "Standard", title: "veryfast · CRF 26" },
            { id: "high", label: "Qualité", title: "slow · CRF 20" },
          ]}
          onChange={(value) => actions.patch({ quality: value })}
        />
        <p className="ed-note">
          {resolvePresetById(project.presetId, project.overrides).name} ·{" "}
          {derived.keeps.length > 1 ? `${derived.keeps.length} segments` : "plan entier"}
        </p>
      </Section>

      <Section title="Fichier de réglages" collapsible>
        <div className="ed-btn-row">
          <button type="button" className="ed-btn ed-btn--sm" onClick={exportConfigFile}>
            <Icon name="download" size={12} />
            Exporter
          </button>
          <button
            type="button"
            className="ed-btn ed-btn--sm"
            onClick={() => configInputRef.current?.click()}
          >
            <Icon name="upload" size={12} />
            Importer
          </button>
          <input
            ref={configInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            aria-label="Importer un fichier de configuration"
            onChange={(event) => {
              void importConfigFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
        <p className="ed-note">
          Un fichier de configuration ne contient que des réglages : ni clé d'API, ni identifiant de
          voix clonée, ni vidéo.
        </p>
      </Section>

      <AgentMcp />

      <Section title="Raccourcis" collapsible defaultOpen={false}>
        <div className="ed-card">
          {[
            ["Espace / K", "lecture, pause"],
            ["← →", "image par image"],
            ["Alt + ← →", "un vingtième de seconde"],
            ["J / L", "reculer, avancer de 3 s"],
            ["S", "couper le bloc sous la tête de lecture"],
            ["C / X", "nouveau sous-titre, nouvelle coupe"],
            ["Suppr", "supprimer la sélection"],
            ["M", "aimantation"],
            ["V", "aperçu des sous-titres"],
            ["F", "replier les volets : le plan prend la place"],
            ["+ / −", "zoom timeline"],
            ["Ctrl + Z", "annuler"],
            ["Ctrl + E", "exporter"],
          ].map(([key, label]) => (
            <Kv key={key} k={key} v={label} />
          ))}
        </div>
      </Section>
    </>
  );
}
