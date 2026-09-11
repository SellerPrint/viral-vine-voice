import { describe, expect, it } from "vitest";

import {
  canRedo,
  canUndo,
  commit,
  createHistory,
  HISTORY_LIMIT,
  redo,
  resetHistory,
  seal,
  undo,
} from "./history";

type State = { value: number };

describe("commit", () => {
  it("empile l'état précédent et vide l'avenir", () => {
    let history = createHistory<State>({ value: 0 });
    history = commit(history, { value: 1 });
    expect(history.past).toEqual([{ value: 0 }]);
    expect(history.present).toEqual({ value: 1 });
    expect(history.future).toEqual([]);
  });

  it("ignore un état identique", () => {
    const history = createHistory<State>({ value: 0 });
    expect(commit(history, history.present)).toBe(history);
  });

  it("fusionne les gestes portant la même clé", () => {
    let history = createHistory<State>({ value: 0 });
    for (const value of [1, 2, 3]) {
      history = commit(history, { value }, { mergeKey: "slider" });
    }
    // Un curseur glissé ne doit pas offrir trente « annuler » pour un geste.
    expect(history.past).toEqual([{ value: 0 }]);
    expect(history.present).toEqual({ value: 3 });
    expect(undo(history).present).toEqual({ value: 0 });
  });

  it("une clé différente rouvre une entrée", () => {
    let history = createHistory<State>({ value: 0 });
    history = commit(history, { value: 1 }, { mergeKey: "a" });
    history = commit(history, { value: 2 }, { mergeKey: "b" });
    expect(history.past).toHaveLength(2);
  });

  it("plafonne la profondeur pour protéger la mémoire", () => {
    let history = createHistory<State>({ value: 0 });
    for (let i = 1; i <= HISTORY_LIMIT + 40; i++) history = commit(history, { value: i });
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0].value).toBe(40);
  });
});

describe("undo / redo", () => {
  it("revient en arrière puis repart en avant", () => {
    let history = createHistory<State>({ value: 0 });
    history = commit(history, { value: 1 });
    history = commit(history, { value: 2 });
    const back = undo(history);
    expect(back.present).toEqual({ value: 1 });
    expect(canRedo(back)).toBe(true);
    expect(redo(back).present).toEqual({ value: 2 });
  });

  it("ne fait rien sur une pile vide", () => {
    const history = createHistory<State>({ value: 0 });
    expect(undo(history)).toBe(history);
    expect(canUndo(history)).toBe(false);
  });

  it("un nouveau geste après un annuler jette l'avenir", () => {
    let history = createHistory<State>({ value: 0 });
    history = commit(history, { value: 1 });
    history = commit(history, { value: 2 });
    const branched = commit(undo(history), { value: 9 });
    expect(branched.future).toEqual([]);
    expect(branched.present).toEqual({ value: 9 });
  });
});

describe("seal / resetHistory", () => {
  it("seal ferme la séquence en cours", () => {
    let history = createHistory<State>({ value: 0 });
    history = commit(history, { value: 1 }, { mergeKey: "drag" });
    history = seal(history);
    history = commit(history, { value: 2 }, { mergeKey: "drag" });
    expect(history.past).toHaveLength(2);
  });

  it("resetHistory repart d'un état sans futur", () => {
    let history = createHistory<State>({ value: 0 });
    history = commit(history, { value: 1 });
    history = resetHistory(history, { value: 5 });
    expect(history.present).toEqual({ value: 5 });
    expect(history.future).toEqual([]);
    expect(undo(history).present).toEqual({ value: 1 });
  });
});
