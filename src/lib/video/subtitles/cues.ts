import type { VoiceDirection } from "@/lib/ai.server";

export type Word = { text: string; start: number; end: number; speakerId?: string };

export type Segment = {
  start: number;
  end: number;
  textFr: string;
  textEn: string;
  direction?: VoiceDirection;
  speakerId?: string;
};

export type Cue = { text: string; start: number; end: number };

/** Au-delà, le graphe de filtres FFmpeg devient ingérable. */
export const MAX_CUES = 320;

/**
 * Regroupe des mots horodatés en segments de sous-titres.
 *
 * Coupe sur fin de phrase après 1,5 s, ou de force au-delà de 7 s.
 */
export function groupWordsToSegments(
  words: Word[],
): { text: string; start: number; end: number; speakerId: string }[] {
  const out: { text: string; start: number; end: number; speakerId: string }[] = [];
  if (!words.length) return out;

  let current: Word[] = [];

  const flush = () => {
    if (!current.length) return;

    // Locuteur majoritaire, en une passe et de façon déterministe.
    // L'implémentation précédente triait le tableau tout en le lisant dans le
    // comparateur, ce qui produisait un résultat dépendant du moteur JS.
    const counts = new Map<string, number>();
    for (const word of current) {
      const id = word.speakerId || "0";
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    let speakerId = "0";
    let best = -1;
    for (const [id, count] of counts) {
      if (count > best) {
        best = count;
        speakerId = id;
      }
    }

    out.push({
      text: current
        .map((w) => w.text)
        .join(" ")
        .replace(/\s+([,.!?;:])/g, "$1")
        .trim(),
      start: current[0].start,
      end: current[current.length - 1].end,
      speakerId,
    });
    current = [];
  };

  for (const word of words) {
    current.push(word);
    const duration = current[current.length - 1].end - current[0].start;
    const endsSentence = /[.!?…]$/.test(word.text.trim());
    if ((endsSentence && duration > 1.5) || duration > 7) flush();
  }
  flush();

  return out;
}

/** Découpe un texte en lignes sans dépasser `maxLines`. */
export function wrapLines(raw: string, maxChars: number, maxLines: number): string[] {
  const words = raw.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current.length) current = word;
    else if ((current + " " + word).length <= maxChars) current += " " + word;
    // Sur la dernière ligne autorisée, on continue d'accumuler plutôt que de
    // tronquer : mieux vaut une ligne longue qu'un mot perdu.
    else if (lines.length === maxLines - 1) current += " " + word;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length) lines.push(current);

  return lines;
}

/**
 * Construit les cues affichables.
 *
 * En mode mot-à-mot, la durée de chaque mot est proportionnelle à sa longueur.
 * Au-delà de `MAX_CUES`, on retombe sur un affichage par segment.
 */
export function buildCues(segments: Segment[], wordByWord: boolean): Cue[] {
  const visible = segments.filter((s) => s.textEn.trim()).sort((a, b) => a.start - b.start);

  const segmentCues = (): Cue[] =>
    visible.map((segment, index) => {
      const next = visible[index + 1];
      return {
        text: segment.textEn.trim(),
        start: segment.start,
        end: next ? Math.min(segment.end, next.start - 0.02) : segment.end,
      };
    });

  if (!wordByWord) return segmentCues().filter((c) => c.end - c.start > 0.04);

  const cues: Cue[] = [];
  visible.forEach((segment, index) => {
    const next = visible[index + 1];
    const segmentEnd = next ? Math.min(segment.end, next.start - 0.02) : segment.end;
    const span = Math.max(0.2, segmentEnd - segment.start);
    const words = segment.textEn.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return;

    const weights = words.map((w) => Math.max(2, w.length));
    const total = weights.reduce((a, b) => a + b, 0);
    let cursor = segment.start;

    words.forEach((word, wordIndex) => {
      const duration = (weights[wordIndex] / total) * span;
      cues.push({
        text: word,
        start: cursor,
        end: Math.min(segmentEnd, cursor + duration),
      });
      cursor += duration;
    });
  });

  const result = cues.length > MAX_CUES ? segmentCues() : cues;
  return result.filter((c) => c.end - c.start > 0.04);
}
