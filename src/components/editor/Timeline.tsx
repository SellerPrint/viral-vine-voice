import { useCallback, useEffect, useRef, useState } from "react";

import { buildThumbs, releaseThumbs, type Thumb } from "@/lib/editor/thumbs";
import { decodeMediaPeaks, peaksForRanges } from "@/lib/editor/waveform";
import { buildTicks, formatClock, round3 } from "@/lib/editor/edl";
import { TRACK_LAYOUT, type Clip, type Project, type TrackId } from "@/lib/editor/types";

import { IconButton } from "./ui";
import { useEditor, useEditorActions } from "./editor-context";

/**
 * La timeline.
 *
 * C'est elle qui fait d'un formulaire un monteur. Tout y est positionné dans le
 * temps source, et tout se corrige à la souris : tirer une poignée pour ajuster
 * une prise, glisser un bloc pour le décaler, amener la tête de lecture sur une
 * syllabe et couper. Les plages retirées apparaissent en creux sur le plan
 * vidéo, parce que c'est exactement ce que le moteur en fait : `trim` puis
 * `concat`.
 */

type DragSpec = {
  id: string;
  mode: "move" | "trim-left" | "trim-right";
  startX: number;
  started: boolean;
  /** Plage au début du geste : le delta s'y applique, jamais à la position courante. */
  origin: { start: number; end: number };
};

export function Timeline() {
  const { project, ui, derived, dispatch, state } = useEditor();
  const actions = useEditorActions();
  const innerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const headsRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragSpec | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [dropLane, setDropLane] = useState<TrackId | null>(null);
  const [hidden, setHidden] = useState<Set<TrackId>>(() => new Set());
  const [locked, setLocked] = useState<Set<TrackId>>(() => new Set());

  const px = ui.zoom;
  const duration = derived.timelineDuration;
  const width = Math.max(320, duration * px + 64);
  const thumbs = useThumbs(project.source);
  const wave = useSourceWaveform(project.source);
  const ticks = buildTicks(duration, px);

  const timeAt = useCallback(
    (clientX: number) => {
      const rect = innerRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      return Math.max(0, (clientX - rect.left) / px);
    },
    [px],
  );

  const seekFrom = useCallback(
    (clientX: number) => dispatch({ type: "seek", time: timeAt(clientX) }),
    [dispatch, timeAt],
  );

  /* ------------------------------ molette ------------------------------ */
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const factor = Math.exp(-event.deltaY / 240);
        dispatch({
          type: "ui",
          patch: { zoom: Math.round(Math.max(4, Math.min(460, px * factor))) },
        });
        return;
      }
      // Une molette verticale au-dessus d'une timeline est une attente de
      // défilement horizontal, pas de zoom : c'est le geste de tout un chacun.
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        event.preventDefault();
        element.scrollLeft += event.deltaY;
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [dispatch, px, ui.playhead]);

  /* --------------------------- glisser des clips -------------------------- */
  useEffect(() => {
    if (!drag) return;
    const onMove = (event: PointerEvent) => {
      const delta = (event.clientX - drag.startX) / px;
      if (!drag.started && Math.abs(event.clientX - drag.startX) < 3) return;
      dispatch({ type: "dragClip", id: drag.id, delta, mode: drag.mode, origin: drag.origin });
      if (!drag.started) setDrag({ ...drag, started: true });
    };
    const onUp = () => {
      setDrag(null);
      actions.endGesture();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, px, dispatch, actions]);

  const beginClipDrag = (event: React.PointerEvent, clip: Clip, mode: DragSpec["mode"]) => {
    if (locked.has(clip.track) || !project.source) return;
    event.stopPropagation();
    event.preventDefault();
    dispatch({ type: "select", selection: { kind: "clip", id: clip.id } });
    if (clip.track === "subs") dispatch({ type: "ui", patch: { inspectorTab: "clip" } });
    setDrag({
      id: clip.id,
      mode,
      startX: event.clientX,
      started: false,
      origin: { start: clip.start, end: clip.start + clip.duration },
    });
  };

  const onDropStyle = (event: React.DragEvent, track: TrackId) => {
    event.preventDefault();
    setDropLane(null);
    const presetId = event.dataTransfer.getData("application/x-viraldub-style");
    if (presetId) {
      actions.patch({ presetId });
      actions.notify({ kind: "ok", text: "Style appliqué à toute la piste de sous-titres." });
      return;
    }
    const file = event.dataTransfer.files?.[0];
    if (file && track === "video") void actions.importFile(file);
  };

  const dragged = drag ? project.clips.find((clip) => clip.id === drag.id) : undefined;

  return (
    <div className="ed-timeline">
      {/* ------------------------------- outils ------------------------------- */}
      <div className="ed-tl-toolbar">
        <IconButton
          icon="scissors"
          label="Couper au niveau de la tête de lecture (S)"
          onClick={actions.split}
          disabled={!derived.subs.length && !derived.removed.length}
        />
        <IconButton
          icon="plus"
          label="Ajouter un sous-titre à la tête de lecture (C)"
          onClick={actions.addCue}
        />
        <IconButton
          icon="crop"
          label="Marquer une coupe à la tête de lecture (X)"
          onClick={actions.addCut}
        />
        <IconButton
          icon="trash"
          label="Supprimer la sélection (Suppr)"
          onClick={actions.remove}
          disabled={!state.selection}
        />
        <span style={{ width: 1, height: 18, background: "var(--ed-line)", margin: "0 4px" }} />
        <IconButton
          icon="magnet"
          label={ui.snap ? "Aimantation activée (M)" : "Aimantation désactivée (M)"}
          active={ui.snap}
          onClick={() => dispatch({ type: "ui", patch: { snap: !ui.snap } })}
        />
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

        <span className="ed-timecode" style={{ marginLeft: 6 }}>
          source <b>{formatClock(duration)}</b> · sortie <b>{formatClock(derived.outputSeconds)}</b>
          {derived.removed.length ? (
            <span style={{ color: "#ff9aa4" }}> · {derived.removed.length} coupe(s)</span>
          ) : null}
        </span>

        <div style={{ flex: 1 }} />

        <IconButton icon="zoomOut" label="Dézoomer (-)" onClick={() => actions.zoomBy(1 / 1.25)} />
        <input
          className="ed-slider"
          style={{ width: 96 }}
          type="range"
          min={4}
          max={460}
          step={1}
          value={px}
          aria-label="Zoom de la timeline"
          onChange={(event) =>
            dispatch({ type: "ui", patch: { zoom: parseFloat(event.target.value) } })
          }
        />
        <IconButton icon="zoomIn" label="Zoomer (+)" onClick={() => actions.zoomBy(1.25)} />
        <IconButton icon="fit" label="Ajuster à la fenêtre" onClick={actions.fitTimeline} />
      </div>

      <div className="ed-tl-body">
        {/* ---------------------------- en-têtes ---------------------------- */}
        <div className="ed-track-heads" ref={headsRef}>
          <div style={{ height: 24, borderBottom: "1px solid var(--ed-line)" }} />
          {TRACK_LAYOUT.map((track) => {
            const count = project.clips.filter((clip) => clip.track === track.id).length;
            const isSubs = track.id === "subs";
            const visible = isSubs ? ui.showSubs : !hidden.has(track.id);
            return (
              <div
                key={track.id}
                className={`ed-track-head${dropLane === track.id ? " is-active" : ""}`}
                style={{ height: track.height }}
                title={track.hint}
              >
                <span className="ed-track-name">{track.label}</span>
                {count > 0 ? <span className="ed-time-pill">{count}</span> : null}
                {isSubs ? (
                  <IconButton
                    icon="eye"
                    label={
                      ui.showSubs
                        ? "Masquer l'aperçu des sous-titres"
                        : "Afficher l'aperçu des sous-titres"
                    }
                    onClick={() => dispatch({ type: "ui", patch: { showSubs: !ui.showSubs } })}
                    size={13}
                  />
                ) : (
                  <IconButton
                    icon={visible ? "eye" : "eyeOff"}
                    label={visible ? "Masquer la piste" : "Afficher la piste"}
                    onClick={() =>
                      setHidden((current) => {
                        const next = new Set(current);
                        if (visible) next.add(track.id);
                        else next.delete(track.id);
                        return next;
                      })
                    }
                    size={12}
                  />
                )}
                <IconButton
                  icon="lock"
                  label={locked.has(track.id) ? "Déverrouiller la piste" : "Verrouiller la piste"}
                  active={locked.has(track.id)}
                  onClick={() =>
                    setLocked((current) => {
                      const next = new Set(current);
                      if (locked.has(track.id)) next.delete(track.id);
                      else next.add(track.id);
                      return next;
                    })
                  }
                  size={12}
                />
              </div>
            );
          })}
        </div>

        {/* --------------------------- bande défilante --------------------------- */}
        <div
          className="ed-tl-scroll"
          data-tl-scroll
          ref={scrollRef}
          onScroll={(event) => {
            // Les en-têtes de pistes suivent le défilement vertical : ils sont
            // hors du conteneur défilant (ils doivent rester à gauche quand on
            // scrolle horizontalement), donc l'alignement est tenu à la main.
            if (headsRef.current) headsRef.current.scrollTop = event.currentTarget.scrollTop;
          }}
        >
          <div className="ed-tl-inner" ref={innerRef} style={{ width }}>
            {/* règle */}
            <div
              className="ed-ruler"
              onPointerDown={(event) => {
                setScrubbing(true);
                seekFrom(event.clientX);
              }}
              onPointerMove={(event) => {
                if (scrubbing) seekFrom(event.clientX);
              }}
              onPointerUp={() => setScrubbing(false)}
              onPointerLeave={() => setScrubbing(false)}
            >
              {ticks.map((tick) => (
                <span
                  key={tick.time}
                  className={`ed-tick${tick.major ? " is-major" : ""}`}
                  style={{
                    left: tick.time * px,
                    height: tick.major ? "100%" : "34%",
                    top: "auto",
                    bottom: 0,
                  }}
                >
                  {tick.label ? <span className="ed-tick-label">{tick.label}</span> : null}
                </span>
              ))}
            </div>

            {/* piste vidéo : segments conservés + creux des coupes */}
            <Lane
              track="video"
              px={px}
              onPointerDownBackground={seekFrom}
              onDragOver={(event) => allowDrop(event, "video", setDropLane)}
              onDragLeave={() => setDropLane(null)}
              onDrop={(event) => onDropStyle(event, "video")}
            >
              {(derived.keeps.length ? derived.keeps : [{ start: 0, end: duration }]).map(
                (piece, index) => (
                  <div
                    key={`${piece.start}-${index}`}
                    className={`ed-clip ed-clip--video${state.selection?.kind === "source" ? " is-selected" : ""}`}
                    style={{
                      left: piece.start * px,
                      width: Math.max(2, (piece.end - piece.start) * px),
                    }}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      dispatch({ type: "select", selection: { kind: "source" } });
                      seekFrom(event.clientX);
                    }}
                    onDoubleClick={() =>
                      dispatch({ type: "ui", patch: { inspectorTab: "project" } })
                    }
                    title="Plan source — double-clic pour ouvrir les réglages d'image"
                  >
                    <ThumbStrip thumbs={thumbs} piece={piece} px={px} />
                    {wave.length > 1 ? (
                      <WaveStrip wave={wave} piece={piece} duration={duration} px={px} />
                    ) : null}
                    {index === 0 ? (
                      <span
                        className="ed-clip-body"
                        style={{ position: "relative", textShadow: "0 1px 2px #000" }}
                      >
                        {project.source?.name ?? "aucun plan"}
                      </span>
                    ) : null}
                  </div>
                ),
              )}
              {derived.removed.map((hole, index) => (
                <div
                  key={`gap-${index}`}
                  className="ed-clip ed-clip--gap"
                  style={{
                    left: hole.start * px,
                    width: Math.max(2, (hole.end - hole.start) * px),
                  }}
                  title={`Plage retirée ${formatClock(hole.start)} → ${formatClock(hole.end)}`}
                >
                  <span
                    className="ed-clip-body"
                    style={{ justifyContent: "center", opacity: 0.75 }}
                  >
                    coupé
                  </span>
                </div>
              ))}
            </Lane>

            {/* coupes */}
            {!hidden.has("cuts") ? (
              <Lane
                track="cuts"
                px={px}
                onPointerDownBackground={seekFrom}
                onDragOver={(event) => allowDrop(event, "cuts", setDropLane)}
                onDragLeave={() => setDropLane(null)}
                onDrop={(event) => onDropStyle(event, "cuts")}
              >
                {derived.removed.map((hole) => {
                  const clip = project.clips.find(
                    (candidate) =>
                      candidate.track === "cuts" &&
                      Math.abs(candidate.start - hole.start) < 0.02 &&
                      Math.abs(candidate.duration - (hole.end - hole.start)) < 0.05,
                  );
                  if (!clip) return null;
                  return (
                    <ClipBox
                      key={clip.id}
                      clip={clip}
                      px={px}
                      selected={state.selection?.kind === "clip" && state.selection.id === clip.id}
                      onPointerDown={(event, mode) => beginClipDrag(event, clip, mode)}
                      label={`${clip.reason === "silence" ? "silence" : "coupe"} ${round3(clip.duration).toFixed(2)}s`}
                      onDoubleClick={() => dispatch({ type: "deleteSelection" })}
                    />
                  );
                })}
              </Lane>
            ) : (
              <EmptyLane height={TRACK_LAYOUT[1].height} />
            )}

            {/* sous-titres */}
            {!hidden.has("subs") ? (
              <Lane
                track="subs"
                px={px}
                onPointerDownBackground={seekFrom}
                onDragOver={(event) => allowDrop(event, "subs", setDropLane)}
                onDragLeave={() => setDropLane(null)}
                onDrop={(event) => onDropStyle(event, "subs")}
              >
                {derived.subs.map((clip) => (
                  <ClipBox
                    key={clip.id}
                    clip={clip}
                    px={px}
                    selected={state.selection?.kind === "clip" && state.selection.id === clip.id}
                    onPointerDown={(event, mode) => beginClipDrag(event, clip, mode)}
                    label={clip.text ?? clip.label}
                    modifier={clip.start + clip.duration}
                  />
                ))}
                {/* Repère visuel du style actif, sous la piste. */}
              </Lane>
            ) : (
              <EmptyLane height={TRACK_LAYOUT[2].height} />
            )}

            {/* voix off */}
            {!hidden.has("dub") ? (
              <Lane track="dub" px={px} onPointerDownBackground={seekFrom}>
                {project.clips
                  .filter((clip) => clip.track === "dub")
                  .map((clip) => (
                    <ClipBox
                      key={clip.id}
                      clip={clip}
                      px={px}
                      selected={state.selection?.kind === "clip" && state.selection.id === clip.id}
                      onPointerDown={(event, mode) => beginClipDrag(event, clip, mode)}
                      label={clip.label}
                      peaks={clip.peaks}
                      onDoubleClick={() => {
                        if (clip.audioUrl) window.open(clip.audioUrl, "_blank", "noopener");
                      }}
                    />
                  ))}
              </Lane>
            ) : (
              <EmptyLane height={TRACK_LAYOUT[3].height} />
            )}

            {/* tête de lecture */}
            <div className="ed-playhead" style={{ left: ui.playhead * px }} />
            <div
              className="ed-playhead-grab"
              style={{ left: ui.playhead * px, top: 0 }}
              onPointerDown={(event) => {
                setScrubbing(true);
                seekFrom(event.clientX);
              }}
              onPointerMove={(event) => {
                if (scrubbing) seekFrom(event.clientX);
              }}
              onPointerUp={() => setScrubbing(false)}
              title="Tête de lecture — glisse pour naviguer"
            />

            {dragged && drag?.started ? (
              <div
                className="ed-drag-badge"
                style={{ left: dragged.start * px, top: 24, transform: "none" }}
              >
                {formatClock(dragged.start)} → {formatClock(dragged.start + dragged.duration)}
                {drag?.mode === "move" ? "" : ` (${dragged.duration.toFixed(2)}s)`}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Lane({
  track,
  px,
  children,
  onPointerDownBackground,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  track: TrackId;
  px: number;
  children: React.ReactNode;
  onPointerDownBackground?: (clientX: number) => void;
  onDragOver?: (event: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (event: React.DragEvent) => void;
}) {
  const meta = TRACK_LAYOUT.find((t) => t.id === track)!;
  return (
    <div
      className="ed-lane"
      data-lane={track}
      style={{ height: meta.height, ["--ed-grid-step" as string]: `${Math.max(24, px)}px` }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && onPointerDownBackground) {
          onPointerDownBackground(event.clientX);
        }
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
    </div>
  );
}

function EmptyLane({ height }: { height: number }) {
  return <div className="ed-lane" style={{ height }} />;
}

function allowDrop(event: React.DragEvent, track: TrackId, setter: (value: TrackId) => void) {
  event.preventDefault();
  event.dataTransfer.dropEffect = event.dataTransfer.types.includes("Files")
    ? track === "video"
      ? "copy"
      : "none"
    : "copy";
  setter(track);
}

function ClipBox({
  clip,
  px,
  selected,
  onPointerDown,
  label,
  peaks,
  modifier,
  onDoubleClick,
}: {
  clip: Clip;
  px: number;
  selected: boolean;
  onPointerDown: (event: React.PointerEvent, mode: "move" | "trim-left" | "trim-right") => void;
  label: string;
  peaks?: number[];
  modifier?: number;
  onDoubleClick?: () => void;
}) {
  const width = Math.max(3, clip.duration * px);
  return (
    <div
      className={`ed-clip ed-clip--${clip.track === "video" ? "video" : clip.track}${selected ? " is-selected" : ""}`}
      style={{ left: clip.start * px, width }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        onPointerDown(event, "move");
      }}
      onDoubleClick={onDoubleClick}
      title={`${label} — ${formatClock(clip.start)} à ${formatClock(clip.start + clip.duration)}${
        modifier ? " · glisser pour repositionner" : ""
      }`}
      data-clip={clip.id}
    >
      {peaks && peaks.length ? (
        <span className="ed-wave" aria-hidden="true">
          {peaks.map((peak, index) => (
            <i key={index} style={{ height: `${Math.max(8, peak * 92)}%` }} />
          ))}
        </span>
      ) : null}
      <span className="ed-clip-body">{label}</span>
      <span
        className="ed-clip-handle"
        style={{ left: 0 }}
        onPointerDown={(event) => onPointerDown(event, "trim-left")}
        role="separator"
        aria-label="Début du bloc"
      />
      <span
        className="ed-clip-handle right"
        onPointerDown={(event) => onPointerDown(event, "trim-right")}
        role="separator"
        aria-label="Fin du bloc"
      />
    </div>
  );
}

function ThumbStrip({
  thumbs,
  piece,
  px,
}: {
  thumbs: Thumb[];
  piece: { start: number; end: number };
  px: number;
}) {
  if (!thumbs.length) return null;
  const spacing = thumbs.length > 1 ? thumbs[1].time - thumbs[0].time : 1;
  const inside = thumbs.filter(
    (thumb) => thumb.time >= piece.start - spacing && thumb.time < piece.end,
  );
  return (
    <span className="ed-thumbs" aria-hidden="true">
      {inside.map((thumb) => (
        <img
          key={thumb.time}
          className="ed-thumb"
          src={thumb.url}
          alt=""
          loading="lazy"
          style={{
            position: "absolute",
            left: (thumb.time - piece.start) * px,
            width: Math.max(6, spacing * px + 1),
            height: "100%",
            objectFit: "cover",
          }}
        />
      ))}
    </span>
  );
}

/**
 * Forme d'onde du plan, en bas de la piste vidéo.
 *
 * C'est ce qui permet de caler une coupe sur une syllabe plutôt qu'à l'oreille :
 * le montage d'un plan court se juge à l'amplitude autant qu'à l'image. Le
 * décodage complet est unique par média et n'utilise que le décodeur natif.
 */
function useSourceWaveform(source: Project["source"] | null): number[] {
  const [wave, setWave] = useState<number[]>([]);
  const url = source?.url;
  useEffect(() => {
    if (!url || url.startsWith("data:")) return;
    let alive = true;
    void decodeMediaPeaks(url, 240).then((peaks) => {
      if (alive) setWave(peaks);
    });
    return () => {
      alive = false;
    };
  }, [url]);
  return wave;
}

function WaveStrip({
  wave,
  piece,
  duration,
  px,
}: {
  wave: number[];
  piece: { start: number; end: number };
  duration: number;
  px: number;
}) {
  const [slice] = peaksForRanges(
    [{ start: piece.start, duration: piece.end - piece.start }],
    wave,
    duration,
  );
  if (!slice || slice.length < 2) return null;
  const bars = Math.min(
    slice.length,
    Math.max(8, Math.floor(((piece.end - piece.start) * px) / 2)),
  );
  const step = slice.length / bars;
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 14,
        display: "flex",
        alignItems: "flex-end",
        gap: 1,
        padding: "0 2px 1px",
        background: "linear-gradient(to top, rgba(0,0,0,.55), transparent)",
      }}
    >
      {Array.from({ length: bars }, (_, i) => (
        <i
          key={i}
          style={{
            flex: 1,
            height: `${Math.max(8, (slice[Math.floor(i * step)] ?? 0) * 100)}%`,
            background: "rgba(120, 220, 255, 0.75)",
            borderRadius: 1,
            minWidth: 1,
          }}
        />
      ))}
    </span>
  );
}

/** Vignettes du plan importé, fabriquées une fois par média. */
function useThumbs(source: Project["source"] | null): Thumb[] {
  const [thumbs, setThumbs] = useState<Thumb[]>([]);
  const url = source?.url;
  const duration = source?.duration ?? 0;

  useEffect(() => {
    if (!url || !(duration > 0)) {
      setThumbs([]);
      return;
    }
    let alive = true;
    const controller = new AbortController();
    const count = Math.max(6, Math.min(26, Math.round(duration * 1.4)));
    void buildThumbs(url, duration, { count, signal: controller.signal }).then((result) => {
      if (!alive) {
        releaseThumbs(result);
        return;
      }
      // Les vignettes du média précédent sont des `blob:` : sans libération,
      // chaque import suivant garderait l'image en mémoire pour la session.
      setThumbs((previous) => {
        releaseThumbs(previous);
        return result;
      });
    });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [url, duration]);

  const latest = useRef<Thumb[]>([]);
  latest.current = thumbs;
  useEffect(() => () => releaseThumbs(latest.current), []);

  return thumbs;
}
