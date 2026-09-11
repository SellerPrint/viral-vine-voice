/**
 * Mathématiques de la timeline — fonctions pures, sans DOM.
 *
 * Tout ce qui décale, coupe, aimante ou projette un instant vit ici : c'est la
 * partie de l'éditeur la plus facile à casser silencieusement (un arrondi de
 * 10 ms sur une série de coupes suffit à désynchroniser trente sous-titres), et
 * la plus facile à tester sans navigateur.
 */

export type Range = { start: number; end: number };

export const EPSILON = 1 / 1000;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Arrondit au centième de millième : évite les queues binaires dans l'UI. */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Tri, fusion des chevauchements, suppression des plages vides ou négatives. */
export function normalizeRanges(ranges: Range[]): Range[] {
  const valid = ranges
    .map((r) => ({
      start: round3(Math.min(r.start, r.end)),
      end: round3(Math.max(r.start, r.end)),
    }))
    .filter((r) => r.end - r.start > EPSILON)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: Range[] = [];
  for (const range of valid) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + EPSILON) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** Restreint une plage à `[0, duration]` ; `null` si elle sort du cadre. */
export function fitToSource(range: Range, duration: number): Range | null {
  const start = clamp(Math.min(range.start, range.end), 0, Math.max(0, duration));
  const end = clamp(Math.max(range.start, range.end), 0, Math.max(0, duration));
  return end - start > EPSILON ? { start: round3(start), end: round3(end) } : null;
}

/**
 * Plages conservées après retrait des coupes.
 *
 * C'est le pendant exact de `keptIntervals()` du moteur : mêmes bornes, mêmes
 * rejets des tronçons trop courts pour être encodés proprement.
 */
export function keptRanges(duration: number, removed: Range[], minLength = 0.05): Range[] {
  if (duration <= 0) return [];
  const blocks = normalizeRanges(removed)
    .map((r) => fitToSource(r, duration))
    .filter((r): r is Range => r !== null);

  const kept: Range[] = [];
  let cursor = 0;
  for (const block of blocks) {
    if (block.start > cursor + EPSILON)
      kept.push({ start: round3(cursor), end: round3(block.start) });
    cursor = Math.max(cursor, block.end);
  }
  if (duration > cursor + EPSILON) kept.push({ start: round3(cursor), end: round3(duration) });

  return kept.filter((k) => k.end - k.start >= minLength);
}

/** Somme des durées conservées : la longueur réelle de la vidéo exportée. */
export function outputDuration(duration: number, removed: Range[]): number {
  return round3(keptRanges(duration, removed).reduce((sum, k) => sum + (k.end - k.start), 0));
}

/** Temps source → temps dans la vidéo exportée (après coupes). */
export function sourceToTimeline(time: number, kept: Range[]): number {
  if (!kept.length) return round3(time);
  let accumulated = 0;
  for (const range of kept) {
    if (time <= range.start) return round3(accumulated);
    if (time <= range.end) return round3(accumulated + (time - range.start));
    accumulated += range.end - range.start;
  }
  return round3(accumulated);
}

/** Temps exporté → temps source, en sautant les plages retirées. */
export function timelineToSource(time: number, kept: Range[]): number {
  if (!kept.length) return round3(time);
  let accumulated = 0;
  for (const range of kept) {
    const length = range.end - range.start;
    if (time <= accumulated + length) {
      const inside = range.start + (time - accumulated);
      // Une valeur demandée dans une coupe (floating point près) retombe sur
      // la fin du segment conservé, jamais au-delà de la source.
      return round3(clamp(inside, range.start, range.end));
    }
    accumulated += length;
  }
  return round3(kept[kept.length - 1].end);
}

/** Plage qui contient `time`, ou `null`. */
export function rangeAt(time: number, ranges: Range[]): Range | null {
  return ranges.find((r) => time >= r.start - EPSILON && time <= r.end + EPSILON) ?? null;
}

export type SnapResult = { time: number; target: number | null };

/**
 * Aimantation d'un instant vers des cibles (playhead, bords voisins, secondes).
 *
 * `tolerance` s'exprime en secondes : le composant la calcule depuis le zoom
 * (`pxParSeconde`) pour que la sensation reste d'environ huit pixels quel que
 * soit le niveau de grossissement.
 */
export function snapTime(time: number, targets: number[], tolerance: number): SnapResult {
  if (tolerance <= 0 || targets.length === 0) return { time, target: null };
  let best: number | null = null;
  let bestDistance = tolerance;
  for (const target of targets) {
    const distance = Math.abs(target - time);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = target;
    }
  }
  return best === null ? { time, target: null } : { time: round3(best), target: best };
}

export type DragOutcome = {
  start: number;
  end: number;
  /** Ce qui a borné le geste, pour l'afficher dans la bulle d'aide. */
  constrainedBy: "début" | "fin" | null;
};

/**
 * Déplacement d'un bloc avec butées.
 *
 * `mode === "trim-left"` garde la fin fixe, `"trim-right"` garde le début,
 * `"move"` conserve la durée. Le minimum empêche un clip de disparaître d'un
 * simple frôlement de poignée.
 */
export function dragRange(
  range: Range,
  delta: number,
  mode: "move" | "trim-left" | "trim-right",
  bounds: { min: number; max: number },
  minLength = 0.08,
): DragOutcome {
  if (mode === "move") {
    const length = range.end - range.start;
    let start = range.start + delta;
    let constrainedBy: DragOutcome["constrainedBy"] = null;
    if (start < bounds.min) {
      start = bounds.min;
      constrainedBy = "début";
    }
    if (start + length > bounds.max) {
      start = bounds.max - length;
      constrainedBy = "fin";
    }
    return { start: round3(start), end: round3(start + length), constrainedBy };
  }

  if (mode === "trim-left") {
    const requested = range.start + delta;
    return {
      start: round3(clamp(requested, bounds.min, range.end - minLength)),
      end: round3(range.end),
      constrainedBy: requested < bounds.min ? "début" : null,
    };
  }

  const requested = range.end + delta;
  return {
    start: round3(range.start),
    end: round3(clamp(requested, range.start + minLength, bounds.max)),
    constrainedBy: requested > bounds.max ? "fin" : null,
  };
}

/** Deux plages se touchent (au seuil numérique près). */
export function overlaps(a: Range, b: Range): boolean {
  return a.start < b.end - EPSILON && b.start < a.end - EPSILON;
}

/**
 * Coupe une plage en deux en `at`.
 *
 * `null` si le point est hors du bloc ou y laisse un fragment inexploitable :
 * couper à 20 ms du bord ne veut rien dire, mieux vaut ne rien faire que créer
 * un clip fantôme impossible à saisir à la souris.
 */
export function splitRange(range: Range, at: number, minFragment = 0.12): [Range, Range] | null {
  const inner = at;
  if (inner - range.start < minFragment || range.end - inner < minFragment) return null;
  return [
    { start: round3(range.start), end: round3(inner) },
    { start: round3(inner), end: round3(range.end) },
  ];
}

/**
 * Écarte les voisins d'un clip déplacé, dans l'ordre de la timeline.
 *
 * Le glisser-déposer d'un sous-titre sur un autre ne doit pas les superposer :
 * CapCut pousse la suite. On ne ripple que vers la droite, les pistes de
 * sous-titres n'ayant pas de sens « insérer avant ».
 */
export function pushApart<T extends { id: string; start: number; duration: number }>(
  clips: T[],
  movedId: string,
  minGap = 0.02,
): T[] {
  const ordered = [...clips].sort((a, b) => a.start - b.start);
  const index = ordered.findIndex((c) => c.id === movedId);
  if (index < 0) return clips;

  const fixed = new Map<string, { start: number; duration: number }>();
  let cursor = ordered[index].start + ordered[index].duration + minGap;
  for (let i = index + 1; i < ordered.length; i++) {
    const clip = ordered[i];
    if (clip.start < cursor - EPSILON) {
      fixed.set(clip.id, { start: round3(cursor), duration: clip.duration });
      cursor += clip.duration + minGap;
    } else {
      cursor = clip.start + clip.duration + minGap;
    }
  }

  if (!fixed.size) return clips;
  return clips.map((clip) => {
    const patch = fixed.get(clip.id);
    return patch ? { ...clip, ...patch } : clip;
  });
}

export type Tick = { time: number; major: boolean; label?: string };

/**
 * Graduations de la règle.
 *
 * Le pas est choisi parmi une suite « douce » (1-2-5 × 10^n) pour que les
 * graduations principales restent espacées d'environ `targetPx` pixels : à 200×
 * de zoom, la règle affiche des dixièmes ; dézoomée, des minutes.
 */
export function buildTicks(duration: number, pxPerSecond: number, targetPx = 90): Tick[] {
  if (!(duration > 0) || !(pxPerSecond > 0)) return [];
  const secondsPerTarget = targetPx / pxPerSecond;
  const pow = Math.pow(10, Math.floor(Math.log10(secondsPerTarget)));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * pow).find((candidate) => candidate >= secondsPerTarget) ??
    10 * pow;

  const minor = step / 5;
  const ticks: Tick[] = [];
  // `+ EPSILON` : sans lui, un pas de 0,5 peut sauter la dernière graduation
  // à cause d'un arrondi flottant sur `duration`.
  for (let t = 0; t <= duration + EPSILON; t += minor) {
    const rounded = round3(t);
    const isMajor = Math.abs(rounded / step - Math.round(rounded / step)) < 0.001;
    ticks.push({
      time: rounded,
      major: isMajor,
      label: isMajor ? formatClock(rounded) : undefined,
    });
  }
  return ticks;
}

/** `0:07.40` — l'usage du montage web, plus lisible que le timecode SMPTE. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
}

/** `00:00:07:12` — timecode à l'image, pour les ajustements au frame près. */
export function formatTimecode(seconds: number, fps = 30): string {
  const total = Math.max(0, seconds);
  const frames = Math.round((total % 1) * fps);
  const whole = Math.floor(total);
  const parts = [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60];
  return [...parts.map((p) => String(p).padStart(2, "0")), String(frames).padStart(2, "0")].join(
    ":",
  );
}

/** Clip visible à un instant donné (le premier en cas de chevauchement). */
export function findActive<T extends { start: number; duration: number }>(
  clips: T[],
  time: number,
): T | null {
  return (
    clips.find((c) => time >= c.start - EPSILON && time <= c.start + c.duration + EPSILON) ?? null
  );
}

/**
 * Décale une liste de plages d'un delta, en gardant les longueurs.
 * Utilisé par « tout décaler » quand l'utilisateur repositionne un bloc.
 */
export function shiftRanges(ranges: Range[], delta: number, duration: number): Range[] {
  return normalizeRanges(
    ranges
      .map((r) => ({ start: r.start + delta, end: r.end + delta }))
      .map((r) => fitToSource(r, duration))
      .filter((r): r is Range => r !== null),
  );
}

/** Insère `range` dans `ranges` en coupant les chevauchements (les coupes se fusionnent). */
export function unionRanges(ranges: Range[], range: Range): Range[] {
  return normalizeRanges([...ranges, range]);
}

export function subtractRange(ranges: Range[], hole: Range): Range[] {
  const out: Range[] = [];
  for (const range of ranges) {
    if (!overlaps(range, hole)) {
      out.push(range);
      continue;
    }
    if (hole.start > range.start) out.push({ start: range.start, end: hole.start });
    if (hole.end < range.end) out.push({ start: hole.end, end: range.end });
  }
  return normalizeRanges(out);
}
