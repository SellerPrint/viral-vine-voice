import { useCallback, useEffect, useRef, useState } from "react";

import { describe } from "@/lib/errors";
import { runPipeline } from "@/lib/video/pipeline";
import { releaseFfmpeg } from "@/lib/video/ffmpeg-client";
import type { PipelineOptions } from "@/lib/video/presets";
import { toRenderOptions } from "@/lib/editor/types";
import { useTurnstile } from "@/hooks/use-turnstile";
import { clipsToCues } from "@/lib/editor/cues";
import { formatClock } from "@/lib/editor/edl";
import { ingestPipeline, makeClip } from "@/lib/editor/project";
import { keepsFromProject, renderProjectLocally } from "@/lib/editor/render-local";
import { peaksFromSamples, readWav } from "@/lib/editor/waveform";
import { exactArrayBuffer } from "@/lib/base64";

import { Chips, Icon, IconButton, Kv, Notice, Section } from "./ui";
import { useEditor, useEditorActions } from "./editor-context";

/**
 * Export.
 *
 * Deux chemins, parce qu'ils n'ont pas le même coût :
 *
 * - **Rendu local** — n'appelle aucun service. Il emballe ce que la timeline
 *   contient : coupes validées, sous-titres déplacés, zones floutées, filtre.
 *   C'est lui qui permet d'itérer trois fois sur un calage sans consommer un
 *   quota de transcription.
 * - **Doublage complet** — transcription, traduction, voix off, puis rendu.
 *   Lourd, payant chez le fournisseur, et seul chemin qui crée du contenu.
 *
 * Le second rend ses pistes dans le monteur à la fin : on ne repart pas d'une
 * page blanche après la machine, on corrige.
 */

const LOCAL_STEPS = [
  { key: "engine", label: "Chargement du moteur vidéo" },
  { key: "burn", label: "Incrustation des sous-titres" },
  { key: "encode", label: "Encodage du montage" },
];

const IA_STEPS = [
  { key: "ffmpeg", label: "Chargement du moteur vidéo" },
  { key: "extract", label: "Extraction de l'audio" },
  { key: "silence", label: "Détection des silences" },
  { key: "transcribe", label: "Transcription de la source" },
  { key: "translate", label: "Traduction" },
  { key: "tts", label: "Génération de la voix off" },
  { key: "compose", label: "Montage & rendu final" },
];

type Mode = "local" | "ia";

type Result = { url: string; bytes: Uint8Array | null; warnings: string[]; note: string };

export function ExportDialog() {
  const { project, derived, dispatch, ui } = useEditor();
  const actions = useEditorActions();
  const [mode, setMode] = useState<Mode>("local");
  const [step, setStep] = useState<string>("");
  const [detail, setDetail] = useState("");
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const turnstile = useTurnstile();

  const source = project.source;
  const running = step !== "" && step !== "done";

  const clearResult = useCallback(() => {
    setResult((previous) => {
      if (previous) URL.revokeObjectURL(previous.url);
      return null;
    });
  }, []);

  // Au démontage : on coupe le traitement en vol et on rend la mémoire du
  // tas WebAssembly, sinon l'onglet la garde jusqu'à la fin de la session.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      releaseFfmpeg();
    };
  }, []);

  // L'onglet demandé par le bouton d'ouverture (« Doublage IA » vs
  // « Exporter ») ; sans ça, le CTA IA ouvrait le rendu local.
  useEffect(() => {
    if (ui.exportOpen) setMode(ui.exportMode);
  }, [ui.exportOpen, ui.exportMode]);

  useEffect(() => {
    if (!ui.exportOpen) {
      abortRef.current?.abort();
      abortRef.current = null;
      setStep("");
      setDetail("");
      setPct(0);
      turnstile.reset?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.exportOpen]);

  const close = () => dispatch({ type: "ui", patch: { exportOpen: false } });

  const runLocal = async () => {
    if (!source?.bytes) {
      setError("Ce plan n'a pas été copié en mémoire : réimporte-le pour lancer un rendu local.");
      return;
    }
    setError(null);
    clearResult();
    setStep("engine");
    setDetail("Préparation du moteur…");
    setPct(0.02);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const cues = clipsToCues(derived.subs, {
        wordByWord: project.wordByWord,
        duration: derived.sourceDuration,
      });
      const outcome = await renderProjectLocally({
        project,
        cues,
        keeps: keepsFromProject(project),
        onProgress: (message, progress) => {
          setDetail(message);
          if (progress !== undefined) setPct(Math.max(0.05, Math.min(1, progress)));
          if (progress !== undefined && progress > 0.3) setStep("encode");
          if (cues.length && progress !== undefined && progress > 0.2) setStep("burn");
        },
        signal: controller.signal,
      });

      const url = URL.createObjectURL(outcome.blob);
      setResult({
        url,
        bytes: outcome.bytes,
        warnings: outcome.degradations.length
          ? [`Le moteur a simplifié le rendu : ${outcome.degradations.join(", ")} non appliqué(s).`]
          : [],
        note: `Graphe retenu : ${outcome.attempt}`,
      });
      setStep("done");
      setPct(1);
      dispatch({
        type: "ui",
        patch: { renderUrl: url, renderNote: outcome.attempt, compare: true },
      });
      actions.notify({
        kind: "ok",
        text: "Rendu local terminé. Bascule sur le rendu avec la touche « calques » de la scène.",
      });
    } catch (cause) {
      if (controller.signal.aborted) {
        setStep("");
        setDetail("");
        setPct(0);
      } else {
        setError(describe(cause, "Le rendu local a échoué."));
        setStep("error");
      }
    } finally {
      abortRef.current = null;
    }
  };

  const runIa = async () => {
    if (!source?.bytes) {
      setError("Le doublage travaille sur les octets du plan : réimporte-le avant de lancer.");
      return;
    }
    setError(null);
    clearResult();
    setStep("ffmpeg");
    setPct(0.02);
    const controller = new AbortController();
    abortRef.current = controller;

    const options: PipelineOptions = {
      preset: derived.preset,
      overrides: { ...project.overrides, boxOpacity: project.boxOpacity },
      masks: project.masks,
      sourceLanguage: project.sourceLanguage,
      targetLanguage: project.targetLanguage,
      signal: controller.signal,
      turnstileToken: turnstile.token,
      ...toRenderOptions(project),
      // Une transition sans coupe n'a rien à raccorder.
      transition: derived.removed.length > 1 ? project.transition : "none",
      transitionDuration: project.transitionDuration,
    };

    try {
      const outcome = await runPipeline(
        { name: source.name, bytes: source.bytes },
        (nextStep, nextDetail, nextPct) => {
          setStep(nextStep);
          if (nextDetail !== undefined) setDetail(nextDetail);
          if (nextPct !== undefined) setPct(nextPct);
        },
        options,
      );

      const url = URL.createObjectURL(outcome.videoBlob);
      setResult({
        url,
        bytes: null,
        warnings: outcome.warnings,
        note: `${outcome.segments.length} segment(s) traduits · ${outcome.silenceCuts.length} coupe(s) automatique(s).`,
      });
      setStep("done");
      setPct(1);
      dispatch({ type: "ui", patch: { renderUrl: url, compare: true } });

      // Le résultat alimente le monteur : chaque phrase devient un bloc, chaque
      // silence une coupe refusables.
      const ingest = ingestPipeline(project, {
        segments: outcome.segments,
        cuts: outcome.silenceCuts,
      });
      const dub = outcome.narrationWav
        ? [
            makeClip(
              "dub",
              { start: 0, end: derived.sourceDuration || 1 },
              {
                label: "Voix off (mix complet)",
                audioUrl: URL.createObjectURL(
                  new Blob([outcome.narrationWav as unknown as BlobPart], { type: "audio/wav" }),
                ),
                peaks: peaksFromSamples(
                  readWav(outcome.narrationWav)?.samples ?? new Float32Array(0),
                  Math.min(220, Math.max(24, Math.round((derived.sourceDuration || 1) * 14))),
                ),
              },
            ),
          ]
        : [];
      actions.patch({ clips: [...ingest.clips, ...dub] });
      actions.notify({
        kind: "ok",
        text: `Doublage terminé : ${ingest.cues} sous-titres et ${ingest.cuts} coupes placés sur les pistes.`,
      });
    } catch (cause) {
      if (controller.signal.aborted) {
        setStep("");
        setDetail("");
        setPct(0);
      } else {
        setError(describe(cause, "Le doublage a échoué."));
        setStep("error");
      }
    } finally {
      abortRef.current = null;
      turnstile.reset?.();
      releaseFfmpeg();
    }
  };

  const steps = mode === "local" ? LOCAL_STEPS : IA_STEPS;
  const currentIndex = steps.findIndex((item) => item.key === step);

  return (
    <div
      className="ed-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Exporter le montage"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="ed-modal">
        <header className="ed-modal-head">
          <div className="ed-btn-row">
            <Icon name="download" size={15} />
            <h2 className="ed-panel-title" style={{ fontSize: 14 }}>
              Exporter «&nbsp;{project.name}&nbsp;»
            </h2>
          </div>
          <div className="ed-btn-row">
            <Chips
              value={mode}
              size="sm"
              options={[
                { id: "local", label: "Rendu local" },
                { id: "ia", label: "Doublage complet" },
              ]}
              onChange={(value) => {
                setMode(value);
                setStep("");
                setDetail("");
                setPct(0);
                setError(null);
              }}
            />
            <IconButton icon="close" label="Fermer (Échap)" onClick={close} />
          </div>
        </header>

        <div className="ed-modal-body">
          <section className="ed-section">
            {result ? (
              <>
                <video
                  src={result.url}
                  controls
                  className="ed-frame"
                  style={{
                    width: "100%",
                    aspectRatio: `${source?.width || 9}/${source?.height || 16}`,
                  }}
                />
                <div className="ed-btn-row" style={{ marginTop: 10 }}>
                  <a
                    className="ed-btn ed-btn--primary"
                    href={result.url}
                    download={`${project.name.replace(/[^\w-]+/g, "-").toLowerCase() || "montage"}-${Date.now()}.mp4`}
                  >
                    <Icon name="download" size={13} />
                    Télécharger le MP4
                  </a>
                  <button
                    type="button"
                    className="ed-btn"
                    onClick={() => dispatch({ type: "ui", patch: { compare: true } })}
                  >
                    <Icon name="layers" size={13} />
                    Afficher dans la scène
                  </button>
                  <button
                    type="button"
                    className="ed-btn"
                    onClick={() => {
                      clearResult();
                      setStep("");
                      setPct(0);
                    }}
                  >
                    Relancer
                  </button>
                </div>
                {result.note ? (
                  <p className="ed-note" style={{ marginTop: 8 }}>
                    {result.note}
                  </p>
                ) : null}
                {result.warnings.length ? (
                  <div style={{ marginTop: 8 }}>
                    {result.warnings.map((warning) => (
                      <Notice key={warning} notice={{ kind: "warn", text: warning }} />
                    ))}
                  </div>
                ) : null}
              </>
            ) : running ? (
              <>
                <div className="ed-progress">
                  <i style={{ width: `${Math.round(pct * 100)}%` }} />
                </div>
                <ol
                  className="flex flex-col gap-0.5"
                  style={{ margin: "10px 0 0", padding: 0, listStyle: "none" }}
                >
                  {steps.map((item, index) => {
                    const active = item.key === step;
                    const done = currentIndex >= 0 && index < currentIndex;
                    return (
                      <li
                        key={item.key}
                        className={`ed-step${active ? " is-active" : ""}${done ? " is-done" : ""}`}
                      >
                        <span className="ed-dot">{done ? "✓" : active ? "•" : index + 1}</span>
                        <span style={{ flex: 1 }}>
                          {item.label}
                          {active && detail ? (
                            <span className="ed-note" style={{ marginLeft: 6 }}>
                              {detail}
                            </span>
                          ) : null}
                        </span>
                        {active ? (
                          <span className="ed-value">{Math.round(pct * 100)} %</span>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
                <div className="ed-btn-row" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="ed-btn ed-btn--danger"
                    onClick={() => {
                      abortRef.current?.abort();
                      setDetail("Annulation…");
                    }}
                  >
                    Annuler le traitement
                  </button>
                </div>
                <p className="ed-note" style={{ marginTop: 8 }}>
                  Garde cet onglet au premier plan : le rendu tourne dans le navigateur et un onglet
                  en arrière-plan est mis en veille par le navigateur.
                </p>
              </>
            ) : (
              <>
                {error ? (
                  <Notice
                    notice={{ kind: "error", text: error }}
                    onDismiss={() => setError(null)}
                  />
                ) : null}
                {mode === "local" ? (
                  <Section title="Ce qui sera incrusté">
                    <div className="ed-card">
                      <Kv
                        k="Sous-titres"
                        v={`${derived.subs.length} bloc(s), ${derived.cues.length} cue(s)`}
                      />
                      <Kv
                        k="Coupes"
                        v={
                          derived.removed.length
                            ? `${derived.removed.length} plage(s) retirées`
                            : "aucune"
                        }
                      />
                      <Kv k="Zones floutées" v={project.masks.filter((m) => m.enabled).length} />
                      <Kv k="Filtre" v={project.filterId} />
                      <Kv k="Durée de sortie" v={formatClock(derived.outputSeconds)} />
                    </div>
                    <p className="ed-note">
                      Aucun appel réseau : le plan est encodé ici, tel quel. La piste de voix off
                      n'est pas ré-encodée par ce chemin — elle sort du doublage complet, dont le
                      fichier contient déjà le mixage.
                    </p>
                    <p className="ed-note">
                      FFmpeg encode dans l'onglet, sur un seul cœur (le cœur multi-thread est
                      désactivé, voir `ffmpeg-client.ts`) : compte 10 à 20 s par seconde de vidéo à
                      {source?.width ?? 0}×{source?.height ?? 0}, soit environ{" "}
                      {formatClock(derived.outputSeconds * 12)} pour les{" "}
                      {formatClock(derived.outputSeconds)} de ce montage. Un rendu 4K se compte en
                      dizaines de minutes — lance-le sur un clip court.
                    </p>
                    <Chips
                      value={project.quality}
                      options={[
                        { id: "draft", label: "Rapide" },
                        { id: "standard", label: "Standard" },
                        { id: "high", label: "Qualité" },
                      ]}
                      onChange={(value) => actions.patch({ quality: value })}
                    />
                  </Section>
                ) : (
                  <Section title="Doublage complet">
                    <div className="ed-card">
                      <Kv k="Langue source" v={project.sourceLanguage.label} />
                      <Kv k="Doublage en" v={project.targetLanguage.label} />
                      <Kv
                        k="Voix"
                        v={project.ttsProvider === "ai33" ? "clonée (ai33.pro)" : "ElevenLabs"}
                      />
                      <Kv
                        k="Audio du plan"
                        v={
                          source?.hasAudio
                            ? "présent"
                            : "absent — la transcription n'aura rien à écouter"
                        }
                      />
                    </div>
                    <p className="ed-note">
                      La vidéo ne quitte pas le navigateur : seuls l'audio extrait et le texte sont
                      envoyés aux services d'IA. À la fin du traitement, les phrases traduites et
                      les silences repérés sont posés sur tes pistes, corrigeables.
                    </p>
                    {turnstile.enabled ? (
                      <div>
                        <div ref={turnstile.containerRef} />
                        {turnstile.failed ? (
                          <p className="ed-note" style={{ color: "#ffb4b4" }}>
                            {turnstile.errorMessage ??
                              "Le widget anti-robot n'a pas pu se charger."}{" "}
                            Le lancement reste possible : le serveur refusera la requête si le jeton
                            est obligatoire.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </Section>
                )}
                <div className="ed-btn-row" style={{ marginTop: 4 }}>
                  <button
                    type="button"
                    className="ed-btn ed-btn--primary"
                    onClick={() => void (mode === "local" ? runLocal() : runIa())}
                    disabled={
                      !source?.bytes || (mode === "ia" && turnstile.enabled && !turnstile.ready)
                    }
                  >
                    <Icon name={mode === "local" ? "download" : "wand"} size={13} />
                    {mode === "local" ? "Lancer le rendu local" : "Lancer le doublage"}
                  </button>
                  {ui.renderUrl ? (
                    <button type="button" className="ed-btn" onClick={close}>
                      Revenir au dernier rendu
                    </button>
                  ) : null}
                </div>
                {!source?.bytes ? (
                  <p className="ed-note" style={{ color: "#ffdca3" }}>
                    Le plan doit être copié en mémoire pour être encodé.
                  </p>
                ) : null}
              </>
            )}
          </section>

          <aside className="ed-section">
            <Section title="Récapitulatif">
              <div className="ed-card">
                <Kv k="Projet" v={project.name} />
                <Kv k="Plan" v={source ? `${source.width}×${source.height}` : "—"} />
                <Kv k="Source" v={formatClock(derived.sourceDuration)} />
                <Kv k="Monté" v={formatClock(derived.outputSeconds)} />
                <Kv k="Style" v={derived.preset.name} />
                <Kv k="Miroir" v={project.mirror ? "oui" : "non"} />
              </div>
            </Section>
            {result?.bytes ? (
              <Section title="Fichier" collapsible>
                <div className="ed-card">
                  <Kv k="Poids" v={`${(result.bytes.byteLength / 1024 / 1024).toFixed(2)} Mo`} />
                  <Kv k="Conteneur" v="MP4 · H.264 + AAC" />
                  <button
                    type="button"
                    className="ed-btn ed-btn--sm"
                    onClick={() => {
                      if (!result.bytes) return;
                      const blob = new Blob([exactArrayBuffer(result.bytes)], {
                        type: "video/mp4",
                      });
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = `${project.name || "montage"}.mp4`;
                      link.click();
                      setTimeout(() => URL.revokeObjectURL(url), 4000);
                    }}
                  >
                    Enregistrer une copie
                  </button>
                </div>
              </Section>
            ) : null}
            <p className="ed-note">
              Raccourcis : <b>Ctrl+E</b> ouvre et ferme cette fenêtre, <b>Échap</b> la ferme.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
