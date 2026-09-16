import { useEffect, useRef, useState } from "react";

import { useTurnstile } from "@/hooks/use-turnstile";
import { transcribePlan } from "@/lib/editor/auto-captions";
import { ingestCaptions } from "@/lib/editor/project";
import { describe } from "@/lib/errors";
import { SOURCE_LANGUAGES } from "@/lib/languages";
import { SUBTITLE_PRESETS } from "@/lib/video/presets";

import { Chips, Icon, IconButton, Notice, Switch } from "./ui";
import { useEditor, useEditorActions } from "./editor-context";

/**
 * Auto sous-titres — le geste viral.
 *
 * Un clic ouvre cette feuille ; Générer extrait l'audio, le transcrit, et pose
 * les phrases sur la piste Texte (mot à mot, style CapCut). Ce n'est pas le
 * doublage : pas de traduction, pas de voix off.
 */

const STYLE_CHOICES = SUBTITLE_PRESETS.filter((item) =>
  ["capcut-pop", "capcut-classic", "capcut-highlight", "discret"].includes(item.id),
).map((item) => ({ id: item.id, label: item.name.replace(/^CapCut /, "") }));

export function AutoCaptionsButton({
  variant = "default",
}: {
  variant?: "default" | "primary" | "banner";
}) {
  const { project, derived } = useEditor();
  const actions = useEditorActions();
  const empty = derived.subs.length === 0;

  if (variant === "banner" && (!empty || !project.source)) return null;

  const className =
    variant === "banner"
      ? "ed-btn ed-btn--primary ed-btn--sm"
      : variant === "primary"
        ? "ed-btn ed-btn--primary"
        : "ed-btn";

  return (
    <button
      type="button"
      className={className}
      disabled={!project.source}
      title="Transcrire le plan et poser les légendes (sans doublage)"
      onClick={() => actions.openCaptions(true)}
    >
      <Icon name="text" size={13} />
      Auto sous-titres
    </button>
  );
}

export function AutoCaptionsDialog() {
  const { project, derived, ui, dispatch } = useEditor();
  const actions = useEditorActions();
  const turnstile = useTurnstile();
  const abortRef = useRef<AbortController | null>(null);

  const [styleId, setStyleId] = useState(project.presetId);
  const [wordByWord, setWordByWord] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!ui.captionsOpen) return;
    setError(null);
    setStyleId(
      project.presetId === "discret" ||
        !STYLE_CHOICES.some((item) => item.id === project.presetId)
        ? "capcut-pop"
        : project.presetId,
    );
    setWordByWord(true);
  }, [ui.captionsOpen, project.presetId]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  if (!ui.captionsOpen) return null;

  const close = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    dispatch({ type: "ui", patch: { captionsOpen: false, busy: null } });
  };

  const run = async () => {
    const bytes = project.source?.bytes;
    if (!bytes) {
      setError("Le plan n'est pas en mémoire : réimporte-le pour transcrire.");
      return;
    }
    if (!project.source?.hasAudio) {
      setError("Ce plan n'a pas de piste audio : rien à transcrire.");
      return;
    }

    setError(null);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    actions.setBusy("Auto sous-titres…");

    try {
      const segments = await transcribePlan({
        bytes,
        languageCode: project.sourceLanguage.code,
        turnstileToken: turnstile.token,
        signal: controller.signal,
        onProgress: (message) => actions.setBusy(message),
      });
      const ingest = ingestCaptions(project, segments);
      actions.patch({
        clips: ingest.clips,
        wordByWord,
        presetId: styleId,
        overrides: styleId === project.presetId ? project.overrides : {},
      });
      dispatch({
        type: "ui",
        patch: {
          captionsOpen: false,
          tab: "subtitles",
          inspectorTab: "style",
          showSubs: true,
          playhead: ingest.clips.find((clip) => clip.track === "subs")?.start ?? ui.playhead,
        },
      });
      const extra = ingest.warnings[0] ? ` ${ingest.warnings[0]}` : "";
      actions.notify({
        kind: ingest.cues ? "ok" : "warn",
        text: ingest.cues
          ? `${ingest.cues} sous-titre(s) posés — mot à mot, style ${STYLE_CHOICES.find((s) => s.id === styleId)?.label ?? styleId}. Corrige un bloc d'un double-clic.${extra}`
          : extra || "Aucune parole détectée.",
      });
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(describe(cause, "La transcription a échoué."));
    } finally {
      abortRef.current = null;
      setRunning(false);
      actions.setBusy(null);
      turnstile.reset?.();
    }
  };

  const existing = derived.subs.length;

  return (
    <div
      className="ed-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Auto sous-titres"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !running) close();
      }}
    >
      <div className="ed-modal ed-modal--captions" style={{ width: "min(440px, 94vw)" }}>
        <header className="ed-modal-head">
          <div className="ed-btn-row">
            <Icon name="text" size={15} />
            <h2 className="ed-panel-title" style={{ fontSize: 14 }}>
              Auto sous-titres
            </h2>
          </div>
          <IconButton icon="close" label="Fermer (Échap)" onClick={close} />
        </header>

        <div className="ed-modal-body" style={{ gap: 12 }}>
          <p className="ed-note" style={{ margin: 0 }}>
            On transcrit la parole du plan et on la pose sur la piste Texte. La
            vidéo ne quitte pas l'onglet : seul l'audio extrait part à la
            transcription. Pas de traduction, pas de voix off.
          </p>

          {existing > 0 ? (
            <Notice
              notice={{
                kind: "warn",
                text: `${existing} sous-titre(s) déjà sur la piste : ils seront remplacés.`,
              }}
            />
          ) : null}

          {error ? (
            <Notice notice={{ kind: "error", text: error }} onDismiss={() => setError(null)} />
          ) : null}

          <div className="ed-section">
            <div className="ed-section-title">Langue parlée</div>
            <Chips
              value={project.sourceLanguage.code}
              options={SOURCE_LANGUAGES.map((item) => ({ id: item.code, label: item.label }))}
              onChange={(code) => {
                const language = SOURCE_LANGUAGES.find((item) => item.code === code);
                if (language) actions.patch({ sourceLanguage: language });
              }}
            />
          </div>

          <div className="ed-section">
            <div className="ed-section-title">Style</div>
            <Chips value={styleId} options={STYLE_CHOICES} onChange={setStyleId} />
          </div>

          <Switch
            label="Mot par mot"
            hint="Chaque mot s'affiche seul, calé sur sa durée — le rythme des légendes virales."
            checked={wordByWord}
            onChange={setWordByWord}
          />

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

          <div className="ed-btn-row" style={{ marginTop: 4 }}>
            <button
              type="button"
              className="ed-btn ed-btn--primary"
              disabled={
                running ||
                !project.source?.bytes ||
                (turnstile.enabled && !turnstile.ready)
              }
              onClick={() => void run()}
            >
              <Icon name="wand" size={13} />
              {running ? "Transcription…" : "Générer les sous-titres"}
            </button>
            {running ? (
              <button type="button" className="ed-btn ed-btn--danger" onClick={close}>
                Annuler
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
