import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { getFilter } from "@/lib/video/filters";
import { formatClock } from "@/lib/editor/edl";
import type { MaskZone } from "@/lib/video/presets";
import { clampZone } from "@/lib/editor/project";

import type { Selection } from "@/lib/editor/store";

import { Icon, IconButton } from "./ui";
import { useEditor, useEditorActions } from "./editor-context";

/**
 * La scène : lecteur + calques éditables.
 *
 * Deux idées structurelles :
 *
 * 1. Le cadre `.ed-frame` porte l'_aspect-ratio_ de la source, donc son rectangle
 *    **est** l'image projetée. Les masques et les sous-titres se posent en
 *    pourcentages de ce cadre : ils restent alignés au pixel près quand la
 *    fenêtre change de taille, sans calcul de lettreboxing.
 * 2. Les sous-titres de l'aperçu imitent les bits de style de `drawtext`
 *    (`fontfile` → `font-family`, `fontsize` → taille relative à la largeur du
 *    plan, `borderw` → `-webkit-text-stroke` + `paint-order`). Un écart
 *    d'échelle ici se paierait en allers-retours de rendu complets.
 */

const SUBTITLE_FONT = 88; // référence du preset « discret », en px pour 1080 de large

type DragState = {
  id: string;
  mode: "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
  origin: MaskZone;
  startX: number;
  startY: number;
  boxW: number;
  boxH: number;
} | null;

export function PreviewStage() {
  const { project, ui, derived, dispatch, state } = useEditor();
  const actions = useEditorActions();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 });
  const [drag, setDrag] = useState<DragState>(null);
  const [showGuides, setShowGuides] = useState(false);

  const source = project.source;
  const src = ui.compare && ui.renderUrl ? ui.renderUrl : (source?.url ?? null);
  const preset = derived.preset;
  const scale = source?.width ? boxSize.width / source.width : 0;
  const filter = getFilter(project.filterId);

  /* --------------------------- suivi de la taille --------------------------- */
  useLayoutEffect(() => {
    const element = overlayRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setBoxSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [src]);

  /* ------------------------------ lecture/pause ----------------------------- */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (ui.playing) {
      // Une lecture refusée (politique autoplay, source absente) ne doit pas
      // laisser l'interface en état « playing » : on recolle l'icône sur la
      // réalité.
      video.play().catch(() => dispatch({ type: "ui", patch: { playing: false } }));
    } else {
      video.pause();
    }
  }, [ui.playing, src, dispatch]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const target = ui.playhead;
    if (Math.abs(video.currentTime - target) > 0.35 && !ui.playing) {
      video.currentTime = target;
    }
  }, [ui.playhead, ui.playing, src]);

  /* --------- boucle : le playhead suit l'horloge, et saute les coupes ------- */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !ui.playing || !source) return;

    let frame = 0;
    let lastDispatch = 0;
    const removed = derived.removed;
    const keeps = derived.keeps;

    const step = (now: number) => {
      const time = video.currentTime;

      // Tête de lecture dans une plage retirée : on saute à sa fin, exactement
      // ce que produira `trim` + `concat` au rendu.
      const hole = removed.find((range) => time >= range.start && time < range.end - 0.02);
      if (hole) {
        video.currentTime = Math.min(source.duration, hole.end + 0.01);
        dispatch({ type: "seek", time: video.currentTime });
        frame = requestAnimationFrame(step);
        return;
      }

      if (now - lastDispatch > 33) {
        lastDispatch = now;
        if (Math.abs(time - ui.playhead) > 0.01) dispatch({ type: "seek", time });
      }

      if (video.ended) {
        dispatch({ type: "ui", patch: { playing: false } });
        if (keeps.length) dispatch({ type: "seek", time: keeps[0].start });
        return;
      }
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [ui.playing, ui.playhead, source, derived.removed, derived.keeps, dispatch]);

  /* --------------------------- glisser des masques -------------------------- */
  const beginDrag = useCallback(
    (event: React.PointerEvent, zone: MaskZone, mode: NonNullable<DragState>["mode"]) => {
      event.stopPropagation();
      const element = overlayRef.current;
      if (!element) return;
      (event.target as Element).setPointerCapture?.(event.pointerId);
      setDrag({
        id: zone.id,
        mode,
        origin: { ...zone },
        startX: event.clientX,
        startY: event.clientY,
        boxW: element.clientWidth,
        boxH: element.clientHeight,
      });
      dispatch({ type: "select", selection: { kind: "mask", id: zone.id } });
    },
    [dispatch],
  );

  useEffect(() => {
    if (!drag) return;
    const onMove = (event: PointerEvent) => {
      const dx = (event.clientX - drag.startX) / (drag.boxW || 1);
      const dy = (event.clientY - drag.startY) / (drag.boxH || 1);
      const zone = { ...drag.origin };

      if (drag.mode === "move" || drag.mode.includes("w") || drag.mode.includes("e")) {
        if (drag.mode === "move") zone.x = drag.origin.x + dx;
        else if (drag.mode.includes("e")) zone.w = drag.origin.w + dx;
        else {
          zone.x = drag.origin.x + dx;
          zone.w = drag.origin.w - dx;
        }
      }
      if (drag.mode === "move" || drag.mode.includes("n") || drag.mode.includes("s")) {
        if (drag.mode === "move") zone.y = drag.origin.y + dy;
        else if (drag.mode.includes("s")) zone.h = drag.origin.h + dy;
        else {
          zone.y = drag.origin.y + dy;
          zone.h = drag.origin.h - dy;
        }
      }

      dispatch({
        type: "setMasks",
        masks: project.masks.map((m) => (m.id === drag.id ? clampZone({ ...m, ...zone }) : m)),
        mergeKey: `mask:${drag.id}`,
      });
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
  }, [drag, project.masks, dispatch, actions]);

  /* ------------------------------ transport bas ----------------------------- */
  const cueBounds = derived.cues.map((cue) => cue.start);
  const jump = (direction: -1 | 1) => {
    const current = ui.playhead;
    const sorted = [...cueBounds, 0, derived.timelineDuration].sort((a, b) => a - b);
    const next =
      direction > 0
        ? sorted.find((time) => time > current + 0.02)
        : [...sorted].reverse().find((time) => time < current - 0.05);
    dispatch({ type: "seek", time: next ?? (direction > 0 ? 0 : derived.timelineDuration) });
  };

  const subtitleStyle = (fontsize: number) =>
    ({
      fontSize: `${Math.max(9, fontsize * (scale || 1))}px`,
      color: preset.fontColor === "white" ? "#fff" : preset.fontColor,
      textTransform: preset.uppercase ? "uppercase" : "none",
      top: `${preset.yAnchor * 100}%`,
      letterSpacing: `${0.4 * (scale || 1)}px`,
      lineHeight: 1.1,
      ...(preset.borderW
        ? {
            WebkitTextStroke: `${Math.max(0.5, (preset.borderW ?? 0) * (scale || 1) * 0.55)}px ${
              preset.borderColor ?? "#000"
            }`,
            paintOrder: "stroke fill",
          }
        : {}),
      ...(preset.shadowColor
        ? {
            textShadow: `${(preset.shadowX ?? 2) * (scale || 1)}px ${
              (preset.shadowY ?? 2) * (scale || 1) * 1.4
            }px ${4 * (scale || 1)}px rgba(0,0,0,.75)`,
          }
        : {}),
      ...(preset.useBox && project.boxOpacity > 0.02
        ? {
            background: `rgba(0,0,0,${project.boxOpacity})`,
            padding: `${6 * (scale || 1)}px ${10 * (scale || 1)}px`,
            borderRadius: 4,
          }
        : {}),
    }) as React.CSSProperties;

  return (
    <div className="ed-stage">
      <div className="ed-stage-canvas">
        {source ? (
          <div
            className="ed-frame"
            style={{
              aspectRatio: `${source.width || 9}/${source.height || 16}`,
              maxHeight: "100%",
              maxWidth: "100%",
              width: "auto",
              height: "100%",
            }}
            onDoubleClick={() => dispatch({ type: "ui", patch: { playing: !ui.playing } })}
          >
            <video
              ref={videoRef}
              src={src ?? undefined}
              playsInline
              muted={project.removeOriginalAudio}
              preload="auto"
              style={{
                filter: ui.compare ? "none" : filter.css,
                transform: project.mirror && !ui.compare ? "scaleX(-1)" : undefined,
                background: "#000",
              }}
              onLoadedMetadata={(event) => {
                const element = event.currentTarget;
                if (!source.width || Math.abs(source.duration - element.duration) > 0.2) {
                  actions.patch({
                    source: {
                      ...source,
                      duration: element.duration || source.duration,
                      width: element.videoWidth || source.width,
                      height: element.videoHeight || source.height,
                    },
                  });
                }
              }}
            />

            <div ref={overlayRef} className="ed-overlay">
              {/* Sous-titres d'aperçu, tels qu'incrustés. */}
              {ui.showSubs && !ui.compare && derived.visibleCue ? (
                <div
                  className="ed-subtitle"
                  style={subtitleStyle(preset.fontsize || SUBTITLE_FONT)}
                >
                  {derived.visibleCue.text}
                </div>
              ) : null}

              {/* Zones à masquer, manipulables à la souris. */}
              {ui.showMasks && !ui.compare
                ? project.masks
                    .filter((m) => m.enabled)
                    .map((zone) => (
                      <div
                        key={zone.id}
                        className={`ed-mask${maskSelected(state.selection, zone.id) ? " is-selected" : ""}`}
                        style={{
                          left: `${zone.x * 100}%`,
                          top: `${zone.y * 100}%`,
                          width: `${zone.w * 100}%`,
                          height: `${zone.h * 100}%`,
                        }}
                        onPointerDown={(event) => beginDrag(event, zone, "move")}
                        title={`${zone.label} — glisse pour déplacer, les poignées pour redimensionner`}
                      >
                        <span className={`ed-mask-label${zone.y < 0.05 ? " below" : ""}`}>
                          {zone.label}
                        </span>
                        {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map((corner) => (
                          <span
                            key={corner}
                            className="ed-mask-handle"
                            style={{
                              left: corner.includes("w")
                                ? 0
                                : corner.includes("e")
                                  ? "100%"
                                  : "50%",
                              top: corner.includes("n") ? 0 : corner.includes("s") ? "100%" : "50%",
                              cursor:
                                corner.length === 1
                                  ? corner === "n" || corner === "s"
                                    ? "ns-resize"
                                    : "ew-resize"
                                  : corner === "nw" || corner === "se"
                                    ? "nwse-resize"
                                    : "nesw-resize",
                            }}
                            onPointerDown={(event) => beginDrag(event, zone, corner)}
                          />
                        ))}
                      </div>
                    ))
                : null}

              {showGuides ? (
                <div className="ed-guide">
                  <i style={{ left: "5%", top: 0, bottom: 0, width: 1 }} />
                  <i style={{ right: "5%", top: 0, bottom: 0, width: 1 }} />
                  <i style={{ top: "9%", left: 0, right: 0, height: 1 }} />
                  <i style={{ bottom: "18%", left: 0, right: 0, height: 1 }} />
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <EmptyStage />
        )}
      </div>

      {/* ------------------------------- transport ------------------------------ */}
      <div className="ed-transport">
        <div className="ed-btn-row" style={{ position: "absolute", left: 12 }}>
          <IconButton
            icon="eye"
            label="Afficher les sous-titres (V)"
            active={ui.showSubs}
            onClick={() => dispatch({ type: "ui", patch: { showSubs: !ui.showSubs } })}
          />
          <IconButton
            icon="mask"
            label="Afficher les zones de masquage"
            active={ui.showMasks}
            onClick={() => dispatch({ type: "ui", patch: { showMasks: !ui.showMasks } })}
          />
          <IconButton
            icon="crop"
            label="Repères de zone sûre"
            active={showGuides}
            onClick={() => setShowGuides((value) => !value)}
          />
          {ui.renderUrl ? (
            <IconButton
              icon="layers"
              label={ui.compare ? "Revenir à la source" : "Comparer avec le dernier rendu"}
              active={ui.compare}
              onClick={() => dispatch({ type: "ui", patch: { compare: !ui.compare } })}
            />
          ) : null}
        </div>

        <div className="ed-btn-row">
          <IconButton icon="prev" label="Séquence précédente" onClick={() => jump(-1)} />
          <IconButton
            icon={ui.playing ? "stepBack" : "prev"}
            label="Image précédente (Alt+←)"
            onClick={() =>
              dispatch({
                type: "seek",
                time: Math.max(0, ui.playhead - 1 / Math.max(1, source?.fps ?? 30)),
              })
            }
          />
          <button
            type="button"
            className="ed-btn ed-btn--primary"
            style={{ width: 34, justifyContent: "center", padding: 0 }}
            onClick={actions.togglePlay}
            aria-label={ui.playing ? "Pause" : "Lecture"}
          >
            <Icon name={ui.playing ? "pause" : "play"} size={14} />
          </button>
          <IconButton
            icon={ui.playing ? "stepFwd" : "next"}
            label="Image suivante (Alt+→)"
            onClick={() =>
              dispatch({
                type: "seek",
                time: Math.min(
                  derived.timelineDuration,
                  ui.playhead + 1 / Math.max(1, source?.fps ?? 30),
                ),
              })
            }
          />
          <IconButton icon="next" label="Séquence suivante" onClick={() => jump(1)} />
          <span className="ed-timecode" style={{ marginLeft: 8 }}>
            <b>{formatClock(ui.playhead)}</b> / {formatClock(derived.timelineDuration)}
            {derived.removed.length > 0 ? (
              <span style={{ marginLeft: 8, color: "var(--ed-text-faint)" }}>
                sortie {formatClock(derived.outputSeconds)} · à{" "}
                {formatClock(derived.outputPlayhead)}
              </span>
            ) : null}
          </span>
        </div>

        <div className="ed-btn-row" style={{ position: "absolute", right: 12 }}>
          <span className="ed-badge" title="Résolution mesurée du plan importé">
            {source ? `${source.width}×${source.height}` : "—"}
          </span>
          {ui.compare ? (
            <span
              className="ed-badge"
              style={{ color: "#8fd9b8", borderColor: "rgba(80,220,160,.4)" }}
            >
              RENDU
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EmptyStage() {
  const actions = useEditorActions();
  return (
    <div className="ed-empty" style={{ maxWidth: 420 }}>
      <Icon name="film" size={26} />
      <div style={{ fontSize: 14, color: "var(--ed-text)" }}>Aucun plan dans le projet</div>
      <p className="ed-note" style={{ margin: 0 }}>
        Glisse une vidéo dans le panneau de gauche, ou ouvre la démo pour essayer tout de suite le
        montage : coupes, masques, sous-titres et rendu local.
      </p>
      <button
        type="button"
        className="ed-btn ed-btn--primary"
        onClick={() => actions.setTab("media")}
      >
        <Icon name="upload" size={13} />
        Importer une vidéo
      </button>
    </div>
  );
}

/** La zone actuellement saisie dans l'inspecteur. */
function maskSelected(selection: Selection, id: string): boolean {
  return selection?.kind === "mask" && selection.id === id;
}
