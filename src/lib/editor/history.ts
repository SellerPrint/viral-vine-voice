/**
 * Pile d'annulation.
 *
 * Un éditeur de vidéo sans `Ctrl+Z` n'est pas un éditeur : chaque geste
 * approximatif (une poignée de trim tirée de trente millisecondes de trop)
 * serait définitif. La pile est volontairement simple — un tableau d'états
 * complets — parce qu'un projet de montage pèse quelques kilo-octets : la
 * complexité d'un patch inverse ne serait payée de personne.
 *
 * Le `mergeKey` est la pièce qui rend l'expérience supportable : un curseur
 * glissé émet soixante événements par seconde, et chacun d'eux comme une
 * entrée d'historique rendrait le « annuler » inutile. Deux commits portant la
 * même clé ne forment qu'une seule entrée.
 */

export type History<S> = {
  past: S[];
  present: S;
  future: S[];
  /** Clé du dernier commit, pour fusionner les gestes continus. */
  mergeKey: string | null;
};

export const HISTORY_LIMIT = 80;

export function createHistory<S>(initial: S): History<S> {
  return { past: [], present: initial, future: [], mergeKey: null };
}

export type CommitOptions = { mergeKey?: string; limit?: number };

export function commit<S>(history: History<S>, next: S, options: CommitOptions = {}): History<S> {
  const { mergeKey, limit = HISTORY_LIMIT } = options;
  if (Object.is(next, history.present)) return history;

  // Même geste en cours : on remplace l'instant présent sans empiler.
  if (mergeKey && history.mergeKey === mergeKey) {
    return { ...history, present: next, future: [] };
  }

  const past = history.past.concat(history.present);
  return {
    past: past.length > limit ? past.slice(past.length - limit) : past,
    present: next,
    future: [],
    mergeKey: mergeKey ?? null,
  };
}

/** Termine une séquence fusionnée : le prochain geste repart d'une nouvelle entrée. */
export function seal<S>(history: History<S>): History<S> {
  return history.mergeKey === null ? history : { ...history, mergeKey: null };
}

export function undo<S>(history: History<S>): History<S> {
  if (!history.past.length) return history;
  const past = [...history.past];
  const present = past.pop() as S;
  return { past, present, future: [history.present, ...history.future], mergeKey: null };
}

export function redo<S>(history: History<S>): History<S> {
  if (!history.future.length) return history;
  const [present, ...future] = history.future;
  return {
    past: [...history.past, history.present],
    present: present as S,
    future,
    mergeKey: null,
  };
}

/** Oublie l'avenir (après un `undo` suivi d'un nouveau geste) ou repart de zéro. */
export function resetHistory<S>(history: History<S>, present: S): History<S> {
  return { past: [...history.past, history.present], present, future: [], mergeKey: null };
}

export const canUndo = <S>(history: History<S>): boolean => history.past.length > 0;
export const canRedo = <S>(history: History<S>): boolean => history.future.length > 0;

/** Libellé du dernier état annulable, pour l'info-bulle des boutons. */
export function historyDepth<S>(history: History<S>): { undo: number; redo: number } {
  return { undo: history.past.length, redo: history.future.length };
}
