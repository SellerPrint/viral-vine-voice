import type { Silence } from "./wav";

export type SpeechSpan = { start: number; end: number };

/** Marge conservée autour de la parole pour éviter les coupes sèches. */
const SPEECH_MARGIN = 0.1;

/** En deçà, la coupe s'entend comme un artefact plutôt qu'un rythme. */
const MIN_CUT = 0.25;

/** Bornes le nombre de coupes : chaque coupe ajoute des filtres au graphe. */
const MAX_CUTS = 40;

/**
 * Calcule les portions réellement coupables.
 *
 * Un silence détecté commence presque toujours à l'instant exact où la parole
 * s'arrête. Tester un simple chevauchement avec marge écartait donc chaque
 * silence, et la coupe ne se déclenchait jamais.
 *
 * On soustrait ici la parole (élargie de sa marge) du silence, et on conserve
 * ce qu'il en reste.
 */
export function planSilenceCuts(
  silences: Silence[],
  speech: SpeechSpan[],
  options: { margin?: number; minCut?: number; maxCuts?: number } = {},
): Silence[] {
  const margin = options.margin ?? SPEECH_MARGIN;
  const minCut = options.minCut ?? MIN_CUT;
  const maxCuts = options.maxCuts ?? MAX_CUTS;

  const blocked = speech
    .map((s) => ({ start: s.start - margin, end: s.end + margin }))
    .sort((a, b) => a.start - b.start);

  const cuts: Silence[] = [];

  for (const silence of silences) {
    // Retire de ce silence tout ce qui est couvert par la parole élargie.
    let pieces: Silence[] = [{ ...silence }];

    for (const span of blocked) {
      const next: Silence[] = [];
      for (const piece of pieces) {
        if (span.end <= piece.start || span.start >= piece.end) {
          next.push(piece);
          continue;
        }
        if (span.start > piece.start) next.push({ start: piece.start, end: span.start });
        if (span.end < piece.end) next.push({ start: span.end, end: piece.end });
      }
      pieces = next;
      if (!pieces.length) break;
    }

    for (const piece of pieces) {
      if (piece.end - piece.start >= minCut) cuts.push(piece);
    }
  }

  // Priorise les silences les plus longs, puis rétablit l'ordre chronologique.
  return cuts
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, maxCuts)
    .sort((a, b) => a.start - b.start);
}
