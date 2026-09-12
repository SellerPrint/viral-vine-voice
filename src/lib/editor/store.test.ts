import { describe, expect, it } from "vitest";

import { EMPTY_PROJECT, makeClip, projectPreset } from "./project";
import { ancreLegende } from "@/lib/video/presets";
import type { MaskZone } from "@/lib/video/presets";
import { createEditorState, editorReducer, MIN_CLIP, type Action, type EditorState } from "./store";
import type { Clip, Project, SourceMedia } from "./types";

/**
 * Les gestes du monteur, testés sans navigateur.
 *
 * Chaque cas correspond à une façon bien précise de casser un montage : un trim
 * qui inverse le clip, une coupe qui dépasse la fin du média, un glisser qui
 * avale le voisin, un annuler qui annule trois gestes d'un coup.
 */

const source: SourceMedia = {
  name: "clip.mp4",
  url: "blob:local/clip",
  bytes: null,
  size: 1024,
  duration: 10,
  width: 540,
  height: 960,
  fps: 30,
  hasAudio: true,
};

const sub = (start: number, duration: number, text = "texte"): Clip => ({
  id: `sub-${start}`,
  track: "subs",
  start,
  duration,
  text,
  label: text,
});

function state(patches: {
  clips?: Clip[];
  project?: Partial<Project>;
  ui?: Partial<EditorState["ui"]>;
  selection?: EditorState["selection"];
}): EditorState {
  const project: Project = {
    ...EMPTY_PROJECT,
    source,
    masks: [],
    clips: patches.clips ?? [],
    ...patches.project,
  };
  const base = createEditorState(project);
  return {
    ...base,
    selection: patches.selection ?? null,
    ui: { ...base.ui, ...patches.ui },
  };
}

/** L'état de montage n'est jamais lu directement : il vit dans la pile. */
const p = (state: EditorState): Project => state.hist.present;

/** Plage d'un bloc au début du geste, comme le fait la timeline. */
const rangeOf = (project: Project, id: string) => {
  const clip = project.clips.find((c) => c.id === id)!;
  return { start: clip.start, end: clip.start + clip.duration };
};

const run = (state: EditorState, ...actions: Action[]) =>
  actions.reduce((current, action) => editorReducer(current, action), state);

describe("dragClip", () => {
  it("déplace un bloc en gardant sa durée", () => {
    const start = state({ clips: [sub(2, 2)], ui: { snap: false, zoom: 46 } });
    const next = run(start, {
      type: "dragClip",
      id: "sub-2",
      delta: 1.5,
      mode: "move",
      origin: rangeOf(p(start), "sub-2"),
    });
    expect(p(next).clips[0]).toMatchObject({ start: 3.5, duration: 2 });
  });

  it("bute en fin de média plutôt que de sortir du plan", () => {
    const start = state({ clips: [sub(8, 2)], ui: { snap: false, zoom: 46 } });
    const next = run(start, {
      type: "dragClip",
      id: "sub-8",
      delta: 6,
      mode: "move",
      origin: rangeOf(p(start), "sub-8"),
    });
    expect(p(next).clips[0].start).toBe(8);
    expect(p(next).clips[0].start + p(next).clips[0].duration).toBeLessThanOrEqual(10);
  });

  it("pousse le voisin immédiat, comme un insert", () => {
    const start = state({
      clips: [sub(0, 2), sub(3, 2)],
      ui: { snap: false, zoom: 46 },
    });
    const next = run(start, {
      type: "dragClip",
      id: "sub-0",
      delta: 2.5,
      mode: "move",
      origin: rangeOf(p(start), "sub-0"),
    });
    const [moved, pushed] = [...p(next).clips].sort((a, b) => a.start - b.start);
    expect(moved.start).toBe(2.5);
    expect(pushed.start).toBeGreaterThan(moved.start + moved.duration);
  });

  it("applique le delta depuis l'origine du geste, jamais en cumul", () => {
    // Deux événements de 0,5 puis 1,0 px·s⁻1 depuis l'appui doivent poser le
    // bloc à +1,0 s — pas à +1,5 s. Le geste est défini par la position du
    // curseur, pas par la somme des mouvements.
    const start = state({ clips: [sub(2, 2)], ui: { snap: false, zoom: 46 } });
    const next = run(
      start,
      {
        type: "dragClip",
        id: "sub-2",
        delta: 0.5,
        mode: "move",
        origin: rangeOf(p(start), "sub-2"),
      },
      {
        type: "dragClip",
        id: "sub-2",
        delta: 1,
        mode: "move",
        origin: rangeOf(p(start), "sub-2"),
      },
    );
    expect(p(next).clips[0].start).toBe(3);
  });

  it("aimante le bord sur la tête de lecture", () => {
    // À 46 px/s, la tolérance vaut ~0,17 s : 5,9 s doit coller à 6 s.
    const start = state({ clips: [sub(2, 2)], ui: { snap: true, zoom: 46, playhead: 6 } });
    const next = run(start, {
      type: "dragClip",
      id: "sub-2",
      delta: 3.9,
      mode: "move",
      origin: rangeOf(p(start), "sub-2"),
    });
    expect(p(next).clips[0].start).toBe(6);
  });

  it("un trim tiré trop loin ne retourne pas le bloc", () => {
    const start = state({ clips: [sub(4, 2)], ui: { snap: false, zoom: 46 } });
    const next = run(start, {
      type: "dragClip",
      id: "sub-4",
      delta: -9,
      mode: "trim-right",
      origin: rangeOf(p(start), "sub-4"),
    });
    const clip = p(next).clips[0];
    expect(clip.duration).toBeGreaterThanOrEqual(MIN_CLIP);
    expect(clip.start + clip.duration).toBeGreaterThan(clip.start);
  });

  it("le trim gauche garde la fin du bloc immobile", () => {
    const start = state({ clips: [sub(2, 4)], ui: { snap: false, zoom: 46 } });
    const next = run(start, {
      type: "dragClip",
      id: "sub-2",
      delta: 0.8,
      mode: "trim-left",
      origin: rangeOf(p(start), "sub-2"),
    });
    const clip = p(next).clips[0];
    expect(clip.start).toBeCloseTo(2.8, 2);
    expect(clip.start + clip.duration).toBeCloseTo(6, 2);
  });

  it("un glisser continu ne crée qu'une seule entrée d'annulation", () => {
    const start = state({ clips: [sub(2, 2)], ui: { snap: false, zoom: 46 } });
    const dragged = run(
      start,
      {
        type: "dragClip",
        id: "sub-2",
        delta: 0.4,
        mode: "move",
        origin: rangeOf(p(start), "sub-2"),
      },
      {
        type: "dragClip",
        id: "sub-2",
        delta: 0.9,
        mode: "move",
        origin: rangeOf(p(start), "sub-2"),
      },
      {
        type: "dragClip",
        id: "sub-2",
        delta: 1.4,
        mode: "move",
        origin: rangeOf(p(start), "sub-2"),
      },
    );
    expect(dragged.hist.past).toHaveLength(1);
    const undone = run(dragged, { type: "undo" });
    expect(p(undone).clips[0].start).toBe(2);
  });
});

describe("splitAtPlayhead", () => {
  it("partage le bloc sélectionné et sélectionne la seconde moitié", () => {
    const clip = sub(0, 4, "une phrase");
    const start = state({
      clips: [clip],
      ui: { playhead: 1.5 },
      selection: { kind: "clip", ids: [clip.id] },
    });
    const next = run(start, { type: "splitAtPlayhead" });
    expect(p(next).clips).toHaveLength(2);
    expect(
      p(next)
        .clips.map((c) => c.duration)
        .sort(),
    ).toEqual([1.5, 2.5]);
    expect(p(next).clips.every((c) => c.text === "une phrase")).toBe(true);
    expect(next.selection).toEqual({ kind: "clip", ids: [p(next).clips[1].id] });
  });

  it("ne coupe pas à moins d'un fragment exploitable du bord", () => {
    const clip = sub(0, 4, "une phrase");
    const start = state({
      clips: [clip],
      ui: { playhead: 0.05 },
      selection: { kind: "clip", ids: [clip.id] },
    });
    expect(p(run(start, { type: "splitAtPlayhead" })).clips).toHaveLength(1);
  });

  it("à défaut de sélection, coupe le bloc sous la tête de lecture", () => {
    const start = state({ clips: [sub(0, 4, "a"), sub(5, 4, "b")], ui: { playhead: 6 } });
    const next = run(start, { type: "splitAtPlayhead" });
    expect(p(next).clips).toHaveLength(3);
    expect(p(next).clips.filter((c) => c.text === "b")).toHaveLength(2);
  });

  it("ne fait rien si la tête de lecture ne touche aucun bloc", () => {
    const start = state({ clips: [sub(0, 1, "a")], ui: { playhead: 8 } });
    expect(p(run(start, { type: "splitAtPlayhead" })).clips).toHaveLength(1);
  });
});

describe("blocs et coupes", () => {
  it("ajoute un sous-titre à la tête de lecture et le sélectionne", () => {
    const next = run(state({ ui: { playhead: 3 } }), { type: "addCueAtPlayhead" });
    expect(p(next).clips[0]).toMatchObject({ track: "subs", start: 3, duration: 2 });
    expect(next.selection).toEqual({ kind: "clip", ids: [p(next).clips[0].id] });
  });

  it("rogné le bloc ajouté près de la fin au lieu de le laisser déborder", () => {
    const next = run(state({ ui: { playhead: 9.4 } }), { type: "addCueAtPlayhead" });
    const clip = p(next).clips[0];
    expect(clip.start).toBeCloseTo(9.4, 2);
    expect(clip.duration).toBeLessThanOrEqual(0.6 + 1e-6);
  });

  it("une coupe marque une plage retirée, pas un segment supprimé", () => {
    const next = run(state({ ui: { playhead: 2 } }), { type: "addCutAtPlayhead", seconds: 0.5 });
    expect(p(next).clips[0]).toMatchObject({ track: "cuts", start: 2, duration: 0.5 });
  });

  it("supprime le bloc sélectionné et rend la sélection", () => {
    const clip = sub(1, 2);
    const next = run(state({ clips: [clip], selection: { kind: "clip", ids: [clip.id] } }), {
      type: "deleteSelection",
    });
    expect(p(next).clips).toHaveLength(0);
    expect(next.selection).toBeNull();
  });

  it("une zone masquante se désactive plutôt que de disparaître", () => {
    const base = state({ clips: [] });
    const withMask = run(base, { type: "addMask" });
    const id = p(withMask).masks[0].id;
    expect(p(withMask).masks[0].enabled).toBe(true);
    const off = run(
      { ...withMask, selection: { kind: "mask", ids: [id] } },
      { type: "deleteSelection" },
    );
    expect(p(off).masks).toHaveLength(1);
    expect(p(off).masks[0].enabled).toBe(false);
  });
});

describe("nudge, seek, annulation", () => {
  it("décale le bloc sélectionné image par image", () => {
    const clip = sub(2, 1);
    const next = run(state({ clips: [clip], selection: { kind: "clip", ids: [clip.id] } }), {
      type: "nudgeSelection",
      seconds: 1 / 30,
    });
    expect(p(next).clips[0].start).toBeCloseTo(2 + 1 / 30, 3);
  });

  it("refuse de sortir du média", () => {
    const clip = sub(9.6, 1);
    const next = run(state({ clips: [clip], selection: { kind: "clip", ids: [clip.id] } }), {
      type: "nudgeSelection",
      seconds: 2,
    });
    expect(p(next).clips[0].start).toBe(9);
  });

  it("borne la tête de lecture à la durée du plan", () => {
    const next = run(state({}), { type: "seek", time: 99 });
    expect(next.ui.playhead).toBe(10);
    expect(run(state({}), { type: "seek", time: -4 }).ui.playhead).toBe(0);
  });

  it("annuler puis rétablir revient à l'état courant", () => {
    const start = state({ clips: [sub(1, 1)] });
    const edited = run(start, { type: "addCueAtPlayhead" }, { type: "addCueAtPlayhead" });
    expect(p(edited).clips).toHaveLength(3);
    const undone = run(edited, { type: "undo" }, { type: "undo" });
    expect(p(undone).clips).toHaveLength(1);
    const redone = run(undone, { type: "redo" }, { type: "redo" });
    expect(p(redone).clips).toHaveLength(3);
  });

  it("le chargement d'un nouveau plan vide la pile", () => {
    const edited = run(state({ clips: [sub(1, 1)] }), { type: "addCueAtPlayhead" });
    const loaded = run(edited, { type: "loadProject", project: { ...EMPTY_PROJECT, source } });
    expect(loaded.hist.past).toHaveLength(0);
    expect(loaded.ui.playhead).toBe(0);
    expect(p(loaded).clips).toHaveLength(0);
  });
});

describe("setMasks", () => {
  it("un glisser de zone répété ne crée qu'une entrée d'historique", () => {
    const base = run(state({}), { type: "addMask" });
    const id = p(base).masks[0].id;
    const dragged = run(base, { type: "select", selection: { kind: "mask", ids: [id] } });
    const merged = run(
      dragged,
      { type: "setMasks", masks: [{ ...p(dragged).masks[0], x: 0.3 }], mergeKey: `mask:${id}` },
      { type: "setMasks", masks: [{ ...p(dragged).masks[0], x: 0.35 }], mergeKey: `mask:${id}` },
    );
    expect(merged.hist.past).toHaveLength(dragged.hist.past.length + 1);
    expect(p(merged).masks[0].x).toBe(0.35);
  });
});

describe("makeClip", () => {
  it("borne une durée nulle à une durée saisissable", () => {
    const clip = makeClip("subs", { start: 1, end: 1 }, { text: "x" });
    expect(clip.duration).toBeGreaterThan(0);
    expect(clip.label).toBe("x");
  });

  it("normalise une plage inversée", () => {
    const clip = makeClip("cuts", { start: 5, end: 2 });
    expect(clip.start).toBe(2);
    expect(clip.duration).toBe(3);
  });
});

describe("sélection multiple", () => {
  it("ajoute, retire, et rend une sélection vide à null", () => {
    const start = state({ clips: [sub(1, 2), sub(4, 2), sub(7, 2)] });

    const un = run(start, { type: "toggleSelect", kind: "clip", id: "sub-4" });
    expect(un.selection).toEqual({ kind: "clip", ids: ["sub-4"] });

    const deux = run(un, { type: "toggleSelect", kind: "clip", id: "sub-7" });
    expect(deux.selection).toEqual({ kind: "clip", ids: ["sub-4", "sub-7"] });

    const retire = run(deux, { type: "toggleSelect", kind: "clip", id: "sub-4" });
    expect(retire.selection).toEqual({ kind: "clip", ids: ["sub-7"] });

    expect(run(retire, { type: "toggleSelect", kind: "clip", id: "sub-7" }).selection).toBeNull();
  });

  it("une sélection de zones ne se laisse pas voler par un bloc de texte", () => {
    // Changer de nature à chaque Maj-clic aurait fait défiler l'inspecteur d'un
    // panneau à l'autre pendant qu'on tient une sélection de blocs.
    const zones = run(state({}), { type: "toggleSelect", kind: "mask", id: "bottom" });
    const melange = run(zones, { type: "toggleSelect", kind: "clip", id: "sub-1" });
    expect(melange.selection).toEqual({ kind: "clip", ids: ["sub-1"] });
  });

  it("un groupe avance d'un même écart, le bloc laissé de côté ne bouge pas", () => {
    const start = state({
      clips: [sub(1, 2), sub(4, 2), sub(7, 2)],
      ui: { snap: false, zoom: 46 },
      selection: { kind: "clip", ids: ["sub-1", "sub-4"] },
    });
    const next = run(start, {
      type: "dragClip",
      id: "sub-1",
      delta: 1,
      mode: "move",
      origin: rangeOf(p(start), "sub-1"),
      groupe: [
        { id: "sub-1", start: 1 },
        { id: "sub-4", start: 4 },
      ],
    });
    expect(p(next).clips.map((c) => c.start)).toEqual([2, 5, 7]);
  });

  it("deux événements consécutifs ne cumulent pas l'écart du groupe", () => {
    // Le reproche mesuré une première fois sur les zones : l'écart était
    // ajouté à la position déjà déplacée, donc la zone suiveuse partait deux
    // fois plus loin que la zone tenue. Chaque événement doit se relire depuis
    // les origines du geste.
    const start = state({
      clips: [sub(1, 2), sub(4, 2)],
      ui: { snap: false, zoom: 46 },
    });
    const groupe = [
      { id: "sub-1", start: 1 },
      { id: "sub-4", start: 4 },
    ];
    const geste = {
      type: "dragClip",
      id: "sub-1",
      mode: "move",
      origin: { start: 1, end: 3 },
      groupe,
    } as const;
    const un = run(start, { ...geste, delta: 0.5 });
    const deux = run(un, { ...geste, delta: 1 });
    expect(p(deux).clips.map((c) => c.start)).toEqual([2, 5]);
  });

  it("un trim ne se propage pas au groupe", () => {
    // Étirer la fin de trois blocs de trois contenus différents n'est pas un
    // geste volontaire : la poignée reste une affaire de bord à bord.
    const start = state({
      clips: [sub(1, 2), sub(4, 2)],
      ui: { snap: false, zoom: 46 },
      selection: { kind: "clip", ids: ["sub-1", "sub-4"] },
    });
    const next = run(start, {
      type: "dragClip",
      id: "sub-1",
      delta: 0.5,
      mode: "trim-right",
      origin: rangeOf(p(start), "sub-1"),
      groupe: [
        { id: "sub-1", start: 1 },
        { id: "sub-4", start: 4 },
      ],
    });
    expect(p(next).clips.map((c) => [c.start, c.duration])).toEqual([
      [1, 2.5],
      [4, 2],
    ]);
  });

  it("Suppr efface le groupe entier, et les zones sélectionnées s'éteignent", () => {
    const groupes = state({
      clips: [sub(1, 2), sub(4, 2), sub(7, 2)],
      selection: { kind: "clip", ids: ["sub-1", "sub-7"] },
    });
    const apres = run(groupes, { type: "deleteSelection" });
    expect(p(apres).clips.map((c) => c.id)).toEqual(["sub-4"]);
    expect(apres.selection).toBeNull();

    const zone = (id: string): MaskZone => ({
      id,
      label: id,
      x: 0,
      y: 0.1,
      w: 0.4,
      h: 0.1,
      enabled: true,
    });
    const deuxZones = state({
      project: { masks: [zone("a"), zone("b"), zone("c")] },
      selection: { kind: "mask", ids: ["a", "c"] },
    });
    const eteintes = run(deuxZones, { type: "deleteSelection" });
    expect(p(eteintes).masks.map((m) => m.enabled)).toEqual([false, true, false]);
    expect(p(eteintes).masks).toHaveLength(3);
  });
});

describe("bandeau des sous-titres et ancre de la légende", () => {
  const bande = (y: number, h = 0.14, id = "bottom"): MaskZone => ({
    id,
    label: id === "bottom" ? "Sous-titres FR (bas)" : "Sous-titres FR (haut)",
    x: 0,
    y,
    w: 1,
    h,
    enabled: true,
  });
  const avecBande = () => state({ project: { masks: [bande(0.82)] } });

  it("tirer le bandeau ne réécrit pas l'ancre : c'est le cadre qui dicte", () => {
    // L'aperçu et les trois pipelines calculent l'ancre depuis le centre du
    // cadre couvrant. Écrire la même grandeur à deux endroits la ferait
    // s'entredétruire entre le rail et l'inspecteur.
    const start = avecBande();
    const ancre = projectPreset(p(start)).yAnchor;
    const next = run(start, { type: "setMasks", masks: [bande(0.72)] });
    expect(projectPreset(p(next)).yAnchor).toBe(ancre);
    // Et la légende a bien suivi, d'autant que le centre du cadre a bougé.
    expect(ancreLegende(p(next).masks, ancre)).toBeCloseTo(0.72 + 0.14 / 2, 4);
    expect(ancreLegende(p(start).masks, ancre)).toBeCloseTo(0.82 + 0.14 / 2, 4);
  });

  it("régler la légende dans le style recentre le bandeau sur l'ancre", () => {
    const start = avecBande();
    const monte = run(start, { type: "patch", patch: { overrides: { yAnchor: 0.6 } } });
    expect(p(monte).masks[0].y).toBeCloseTo(0.6 - 0.07, 4);

    // Le bandeau ne se laisse pas pousser à moitié hors de l'image ; l'ancre
    // demandée reste inscrite au projet, telle que le style l'a voulue.
    const descendu = run(start, { type: "patch", patch: { overrides: { yAnchor: 0.99 } } });
    expect(p(descendu).masks[0].y).toBeCloseTo(1 - 0.14, 4);
    expect(projectPreset(p(descendu)).yAnchor).toBeCloseTo(0.99, 4);
  });

  it("un geste qui change les deux à la fois est respecté tel quel", () => {
    // Un plan importé, un préréglage appliqué : les deux valeurs viennent du
    // même choix, les recaler l'une sur l'autre les abîmerait.
    const start = avecBande();
    const next = run(start, {
      type: "patch",
      patch: { masks: [bande(0.5)], overrides: { yAnchor: 0.2 } },
    });
    expect(p(next).masks[0].y).toBe(0.5);
    expect(projectPreset(p(next)).yAnchor).toBe(0.2);
  });

  it("glisser la légende dans la scène déplace le bandeau sans l'écraser", () => {
    // Le geste sur le cadran de la légende écrit `overrides.yAnchor`. Le bandeau
    // doit le suivre — mais pas y laisser sa hauteur : mesuré en direct dans le
    // navigateur, il passait de 14,5 % à 3 %, le plancher toléré, et la plaque de
    // recouvrement devenait un trait.
    const base = state({ project: { masks: [bande(0.75, 0.145)], overrides: {} } });
    const apres = run(base, {
      type: "patch",
      patch: { overrides: { yAnchor: 0.638 } },
      mergeKey: "legende",
    });
    expect(p(apres).masks[0]).toMatchObject({ y: 0.566, h: 0.145, w: 1, x: 0 });
    // et l'ancre que le moteur retiendra est bien celle demandee, pas le plancher
    expect(ancreLegende(p(apres).masks, 0.638)).toBeCloseTo(0.6385, 4);
  });

  it("sans cadre couvrant actif, le curseur d'ancre ne déplace rien", () => {
    const start = state({
      project: { masks: [{ ...bande(0.82), enabled: false }, bande(0.1, 0.1, "other")] },
    });
    const ancre = projectPreset(p(start)).yAnchor;
    const next = run(start, { type: "patch", patch: { overrides: { yAnchor: ancre - 0.05 } } });
    expect(p(next).masks[0].y).toBe(0.82);
    expect(p(next).masks[1].y).toBe(0.1);
  });

  it("le bandeau du haut commande la légende à l'identique", () => {
    // `cadreCouvrant` retient le bas en priorité, le haut à défaut : la règle
    // d'ancrage doit suivre le cadre réellement retenu, pas un id en dur.
    const haut = state({ project: { masks: [bande(0.02, 0.12, "top")] } });
    const next = run(haut, { type: "patch", patch: { overrides: { yAnchor: 0.2 } } });
    expect(p(next).masks[0].y).toBeCloseTo(0.2 - 0.06, 4);
    expect(ancreLegende(p(next).masks, 0.9)).toBeCloseTo(0.2, 4);
  });
});
