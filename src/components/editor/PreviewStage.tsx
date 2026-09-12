import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { getFilter } from "@/lib/video/filters";
import { formatClock } from "@/lib/editor/edl";
import { ancreLegende, type MaskZone } from "@/lib/video/presets";
import { clampZone } from "@/lib/editor/project";

import { isSelected } from "@/lib/editor/store";
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
  /** Zones entraînées par le geste, saisies à leur position de départ. */
  groupe?: { id: string; x: number; y: number }[];
} | null;

/** Le bord que tire cette poignée est-il déjà plaqué contre le cadre ? */
const BORDS_PAROIGNEE: Record<string, readonly ("gauche" | "droite" | "haut" | "bas")[]> = {
  nw: ["gauche", "haut"],
  n: ["haut"],
  ne: ["droite", "haut"],
  e: ["droite"],
  se: ["droite", "bas"],
  s: ["bas"],
  sw: ["gauche", "bas"],
  w: ["gauche"],
};

function bordPlaque(zone: MaskZone, coin: string) {
  const EPS = 0.002;
  const bords = {
    gauche: zone.x <= EPS,
    droite: zone.x + zone.w >= 1 - EPS,
    haut: zone.y <= EPS,
    bas: zone.y + zone.h >= 1 - EPS,
  };
  // Une poignée d'angle est libre tant qu'un seul de ses deux bords peut jouer :
  // sinon on éteindrait l'angle d'une zone collée à un bord mais pas à l'autre.
  return (BORDS_PAROIGNEE[coin] ?? []).every((bord) => bords[bord]);
}

export function PreviewStage() {
  const { project, ui, derived, dispatch, state } = useEditor();
  const actions = useEditorActions();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  /**
   * Le calque qui porte la légende : c'est sa hauteur que `top: x%` adresse.
   * Le geste de la légende doit donc se mesurer sur cette boîte, et non sur
   * l'`overlay` des zones — les deux ne coïncident pas toujours, et l'écart se
   * voyait : 70 px à la souris déplaçaient la ligne de 150 px.
   */
  const legendeBoiteRef = useRef<HTMLDivElement | null>(null);
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
  const gesteVue = useRef(false);
  const cadreDeplace = useRef(false);
  const legendeRepond = useRef(false);
  const legendeLaterale = useRef(false);

  /* ------------------------- la légende, à la main ------------------------- */
  // Le texte incrusté est une couche comme une autre : le tenir le déplace,
  // tenir sa poignée change son corps. Le cadran bleu reste la zone de
  // masquage ; les deux se suivent parce que le réducteur recadre la bande sur
  // l'ancre, donc aucune des deux mains ne décroche l'autre.
  const [geste, setGeste] = useState<{
    mode: "place" | "corps";
    x: number;
    y: number;
    ancre: number;
    corps: number;
    pas: number;
  } | null>(null);

  const debuterLegende = useCallback(
    (event: React.PointerEvent, mode: "place" | "corps") => {
      const element = legendeBoiteRef.current ?? overlayRef.current;
      if (!element) return;
      event.stopPropagation();
      event.preventDefault();
      (event.target as Element).setPointerCapture?.(event.pointerId);
      legendeRepond.current = false;
      legendeLaterale.current = false;
      setGeste({
        mode,
        x: event.clientX,
        y: event.clientY,
        // On part d'ou la ligne se voit, pas du reglage du style : avec un
        // bandeau actif, l'ancre affichee est le centre du cadre, et demarrer
        // sur `preset.yAnchor` faisait sauter la legende de 8 % de l'image au
        // premier pixel bouge.
        ancre: ancreLegende(project.masks, preset.yAnchor),
        corps: preset.fontsize,
        // Le denominateur du geste : la boite que `top: %` adresse, pas une
        // autre. `clientHeight` plutot que `scale` : l'ancre est une fraction de
        // la hauteur, le corps une fraction de la largeur.
        pas: element.clientHeight || 1,
      });
    },
    [preset.yAnchor, preset.fontsize, project.masks],
  );

  useEffect(() => {
    if (!geste) return;
    const onMove = (event: PointerEvent) => {
      const dx = event.clientX - geste.x;
      const dy = event.clientY - geste.y;
      if (Math.abs(dx) + Math.abs(dy) < 3) return;
      legendeLaterale.current = Math.abs(dx) > Math.abs(dy);

      if (geste.mode === "place") {
        // À la verticale seulement : `drawtext` centre la ligne
        // (`x=(w-text_w)/2`) et le contrat d'options n'a aucune ancre
        // horizontale — la promettre à la souris mentirait sur l'export.
        const cible =
          Math.round(Math.min(0.98, Math.max(0, geste.ancre + dy / geste.pas)) * 1000) / 1000;
        // Moins d'un pixel d'ecart : rien a ecrire. Sans ce seuil, l'arret a
        // trois decimales suffisait a declencher un patch invisible, et le
        // geste purement horizontal ne se signalait plus - la legende semblait
        // morte alors qu'elle etait seulement deja a sa place.
        if (Math.abs(cible - geste.ancre) * geste.pas < 1) return;
        legendeRepond.current = true;
        actions.patch({ overrides: { ...project.overrides, yAnchor: cible } }, "legende");
        return;
      }

      // Le corps se lit en pixels de la *source* : la scène affiche
      // `fontsize × (largeur du cadre / largeur de la source)`, donc un pixel
      // parcouru à l'écran vaut `1 / cette proportion` dans l'option. Les bornes
      // sont celles du curseur de l'inspecteur, même réglage, même plage.
      const proportion = scale > 0.05 ? scale : 1;
      const cible = Math.round(Math.min(170, Math.max(20, geste.corps - dy / proportion)));
      if (cible === geste.corps) return;
      legendeRepond.current = true;
      actions.patch({ overrides: { ...project.overrides, fontsize: cible } }, "legende");
    };
    const onUp = () => {
      // Un glissement à plat ne obtenait rien et ressemblait à une couche morte.
      if (!legendeRepond.current && legendeLaterale.current) {
        actions.notify({
          kind: "info",
          text: "La légende se règle à la verticale : le moteur centre chaque ligne, il n'existe pas d'ancre de gauche à droite.",
        });
      }
      legendeRepond.current = false;
      setGeste(null);
      actions.endGesture();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [geste, actions, project.overrides, scale]);

  const beginDrag = useCallback(
    (event: React.PointerEvent, zone: MaskZone, mode: NonNullable<DragState>["mode"]) => {
      event.stopPropagation();
      const element = overlayRef.current;
      if (!element) return;
      (event.target as Element).setPointerCapture?.(event.pointerId);

      // Maj (ou Ctrl) ajoute la zone à la sélection au lieu de la remplacer :
      // c'est ce qui permet de pousser trois logos d'un seul geste. Un
      // Maj-clic sur une zone seule sélectionnée la désélectionne — le geste
      // inverse doit exister, sinon on ne sait plus sortir d'une sélection.
      // La sélection se recalcule ici et non via `toggleSelect` : le geste a
      // besoin des positions de départ des zones entraînées dans la seconde
      // même que l'appui est reçu.
      // Deux témoins de geste : le curseur a-t-il quitté le point d'appui, et
      // la zone a-t-elle bougé pour autant. Les deux ensemble disent le seul cas
      // où l'utilisateur a l'impression que rien ne répond.
      gesteVue.current = false;
      cadreDeplace.current = false;

      const additif = event.shiftKey || event.ctrlKey || event.metaKey;
      const dejaPrise = isSelected(state.selection, "mask", zone.id);
      const groupe = state.selection?.kind === "mask" ? state.selection.ids : [];
      const ids = additif
        ? dejaPrise
          ? groupe.filter((x) => x !== zone.id)
          : [...groupe, zone.id]
        : dejaPrise
          ? groupe
          : [zone.id];

      dispatch({
        type: "select",
        selection: ids.length ? { kind: "mask", ids } : null,
      });

      setDrag({
        id: zone.id,
        mode,
        origin: { ...zone },
        startX: event.clientX,
        startY: event.clientY,
        boxW: element.clientWidth,
        boxH: element.clientHeight,
        groupe: (() => {
          // Les positions de départ, jamais les positions courantes : le delta
          // serait sinon rejoué à chaque événement sur une zone déjà déplacée.
          const tenues = new Set(ids.length ? ids : [zone.id]);
          const bases = project.masks
            .filter((m) => tenues.has(m.id))
            .map((m) => ({ id: m.id, x: m.x, y: m.y }));
          return bases.length > 1 ? bases : undefined;
        })(),
      });
    },
    [dispatch, state.selection, project.masks],
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

      // Un déplacement de groupe suit l'écart voulu du cadre tenu — pas sa
      // valeur finale bornée : sinon la première zone collée au bord ferait
      // traîner les autres. Le redimensionnement, lui, reste une affaire de
      // bord à bord : étirer trois zones de largeurs différentes à la fois
      // ne veut rien dire de précis.
      const groupe =
        drag.mode === "move" && drag.groupe ? new Map(drag.groupe.map((g) => [g.id, g])) : null;
      const pas = { x: zone.x - drag.origin.x, y: zone.y - drag.origin.y };

      if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 3) {
        gesteVue.current = true;
      }

      dispatch({
        type: "setMasks",
        masks: project.masks.map((m) => {
          if (m.id === drag.id) {
            const applique = clampZone({ ...m, ...zone });
            if (
              Math.abs(applique.x - drag.origin.x) +
                Math.abs(applique.y - drag.origin.y) +
                Math.abs(applique.w - drag.origin.w) +
                Math.abs(applique.h - drag.origin.h) >
              0.0005
            ) {
              cadreDeplace.current = true;
            }
            return applique;
          }
          const base = groupe?.get(m.id);
          if (base) return clampZone({ ...m, x: base.x + pas.x, y: base.y + pas.y });
          return m;
        }),
        mergeKey: `mask:${drag.id}`,
      });
    };
    const onUp = () => {
      // Le geste a eu lieu, la zone n'a pas bougé d'un pixel : c'est le bord du
      // cadre qui la retient. Sans ce mot, le geste ressemble à une interface
      // morte — et c'est exactement le reproche reçu.
      if (gesteVue.current && !cadreDeplace.current) {
        actions.notify({
          kind: "info",
          text: "La zone touche un bord du cadre : elle ne peut pas s'en écarter. Glisse le bord opposé, ou ramène-la d'abord vers l'intérieur.",
        });
      }
      gesteVue.current = false;
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
      // La même règle que les trois pipelines : le centre du cadre couvrant,
      // à défaut du réglage du style. C'est ce qui fait qu'étirer la hauteur du
      // bandeau à la souris déplace bel et bien le texte incrusté.
      top: `${ancreLegende(project.masks, preset.yAnchor) * 100}%`,
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
              {/* Sous-titres d'aperçu, tels qu'incrustés. Cette couche de
                  découpe rend comme le moteur : un bloc ancré sur `yAnchor`
                  grandit vers le bas, et le cadrage rogne ce qui dépasse du
                  plan. Le cadre ne rogne plus lui-même — depuis que les
                  poignées des zones doivent déborder — donc le calque de texte
                  porte son propre `overflow: hidden`. */}
              <div className="ed-subtitle-clip" ref={legendeBoiteRef}>
                {ui.showSubs && !ui.compare && derived.visibleCue ? (
                  <div
                    className="ed-subtitle"
                    style={subtitleStyle(preset.fontsize || SUBTITLE_FONT)}
                    data-geste={geste?.mode}
                  >
                    {/* Le geste pend sur la ligne, pas sur le bloc : la largeur
                        du cadran recouvrait les poignées du bandeau et leur
                        volait le geste — tirer le texte écrasait sa hauteur. */}
                    <span
                      className="ed-subtitle-text"
                      onPointerDown={(event) => debuterLegende(event, "place")}
                      title="Légende — glisse la ligne pour la monter ou la descendre, la poignée blanche pour changer son corps"
                    >
                      {derived.visibleCue.text}
                    </span>
                    <span
                      className="ed-subtitle-grip"
                      data-geste="corps"
                      onPointerDown={(event) => debuterLegende(event, "corps")}
                      title={`Corps : ${preset.fontsize} px — glisse vers le haut pour agrandir`}
                    />
                  </div>
                ) : null}
              </div>

              {/* Zones à masquer, manipulables à la souris. */}
              {ui.showMasks && !ui.compare
                ? project.masks
                    .filter((m) => m.enabled)
                    .map((zone) => (
                      <div
                        key={zone.id}
                        className={`ed-mask${maskSelected(state.selection, zone.id) ? " is-selected" : ""}`}
                        // Un bandeau pleine largeur ne peut pas glisser
                        // horizontalement (le cadre le contraint) : le curseur
                        // doit le dire, sinon on insiste sur un axe muet.
                        data-axis={zone.w >= 0.995 ? "y" : zone.h >= 0.995 ? "x" : undefined}
                        style={{
                          left: `${zone.x * 100}%`,
                          top: `${zone.y * 100}%`,
                          width: `${zone.w * 100}%`,
                          height: `${zone.h * 100}%`,
                        }}
                        onPointerDown={(event) => beginDrag(event, zone, "move")}
                        title={`${zone.label} — glisse pour déplacer, les poignées pour redimensionner, Maj-clic pour ajouter à la sélection`}
                      >
                        <span className={`ed-mask-label${zone.y < 0.05 ? " below" : ""}`}>
                          {zone.label}
                        </span>
                        {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map((corner) => (
                          <span
                            key={corner}
                            className="ed-mask-handle"
                            data-corner={corner}
                            // Un bord collé au cadre ne peut pas s'en écarter : le
                            // geste y est vide. Le dire vaut mieux qu'un curseur qui
                            // insistait — c'est ce qui faisait dire « impossible de
                            // déplacer » à une zone qui ne demandait qu'à rentrer.
                            data-pinned={bordPlaque(zone, corner) || undefined}
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
  return isSelected(selection, "mask", id);
}
