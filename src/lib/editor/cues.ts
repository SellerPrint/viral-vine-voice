import type { Cue } from "@/lib/video/subtitles/cues";
import type { Clip } from "./types";
import { round3 } from "./edl";

/**
 * Traduit la piste de sous-titres en cues prêts à incruster.
 *
 * Le moteur attend `Cue[]` (texte + plage visible). Deux règles sont reprises
 * du pipeline pour que l'aperçu du monteur et le rendu disent la même chose :
 *
 * 1. un cue s'arrête à l'entrée du suivant, jamais au-delà — deux phrases qui
 *    se chevauchent illisiblement est le principal défaut des légendes
 *    automatiques ;
 * 2. en mode « mot par mot », la durée du bloc est répartie au poids de chaque
 *    mot (les mots longs occupent plus de temps à l'écran).
 */

const MAX_CUES = 320;

export type CueOptions = {
  /** Répartit le texte mot par mot sur la durée du bloc. */
  wordByWord?: boolean;
  /** Durée totale de la source : borne supérieure, évite les cues hors champ. */
  duration?: number;
};

export function clipsToCues(clips: Clip[], options: CueOptions = {}): Cue[] {
  const duration = options.duration ?? Number.POSITIVE_INFINITY;
  const ordered = clips
    .filter((clip) => clip.track === "subs")
    .filter((clip) => (clip.text ?? "").trim().length > 0)
    .map((clip) => ({
      text: clip.text?.trim() ?? "",
      start: round3(Math.max(0, clip.start)),
      end: round3(Math.min(duration, clip.start + clip.duration)),
    }))
    .filter((cue) => cue.end - cue.start > 0.04)
    .sort((a, b) => a.start - b.start);

  const bounded = ordered.map((cue, index) => {
    const next = ordered[index + 1];
    return next && next.start < cue.end
      ? { ...cue, end: round3(Math.max(cue.start + 0.05, next.start - 0.02)) }
      : cue;
  });

  if (!options.wordByWord) return bounded;

  const words: Cue[] = [];
  for (const cue of bounded) {
    const parts = cue.text.split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    if (parts.length === 1) {
      words.push(cue);
      continue;
    }
    const span = Math.max(0.2, cue.end - cue.start);
    const weights = parts.map((word) => Math.max(2, word.length));
    const total = weights.reduce((a, b) => a + b, 0);
    let cursor = cue.start;
    parts.forEach((word, index) => {
      const length = (weights[index] / total) * span;
      const end = index === parts.length - 1 ? cue.end : Math.min(cue.end, cursor + length);
      words.push({ text: word, start: round3(cursor), end: round3(Math.max(cursor + 0.05, end)) });
      cursor = end;
    });
  }

  // Au-delà de la borne, `drawtext` produit un graphe de filtres démesuré :
  // le pipeline retombe déjà sur les phrases entières, on fait pareil.
  const result = words.length > MAX_CUES ? bounded : words;
  return result.filter((cue) => cue.end - cue.start > 0.04);
}

/** Temps d'affichage d'un bloc donné, pour l'aperçu de la scène. */
export function activeCue(cues: Cue[], time: number): Cue | null {
  return cues.find((cue) => time >= cue.start - 1 / 1000 && time <= cue.end + 1 / 1000) ?? null;
}
