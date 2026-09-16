import { translateSegments } from "@/lib/ai.functions";
import { LIMITS } from "@/lib/ai.schemas";
import { isSameLanguage } from "@/lib/languages";

import type { Clip } from "./types";

/**
 * Traduire la piste Texte, sans relancer le doublage.
 *
 * Les horodatages, les ids et les autres pistes restent. Seul `text` change :
 * `sourceText` mémorise la ligne d'avant la première traduction, pour qu'un
 * Ctrl+Z ou un second passage ait encore l'original.
 */

export type CaptionToTranslate = {
  id: string;
  text: string;
  start: number;
  end: number;
};

/** Ligne envoyée au traducteur : le texte affiché, borné comme l'endpoint. */
export function captionLine(clip: Clip): string {
  return (clip.text ?? "").trim();
}

/**
 * Blocs à traduire, dans l'ordre de la piste.
 *
 * Les coupes et la voix off sont ignorées. Au-delà de `LIMITS.segmentCount`,
 * on s'arrête : l'endpoint refuserait le lot entier.
 */
export function captionsToTranslate(clips: readonly Clip[]): CaptionToTranslate[] {
  const out: CaptionToTranslate[] = [];
  for (const clip of clips) {
    if (clip.track !== "subs") continue;
    const text = captionLine(clip).slice(0, LIMITS.segmentText);
    if (!text) continue;
    out.push({
      id: clip.id,
      text,
      start: clip.start,
      end: clip.start + clip.duration,
    });
    if (out.length >= LIMITS.segmentCount) break;
  }
  return out;
}

export type TranslatedLine = { id: string; text: string };

/**
 * Réécrit `text` des blocs traduits. Pur : le tableau d'entrée n'est pas muté.
 */
export function applyTranslatedCaptions(
  clips: readonly Clip[],
  translations: readonly TranslatedLine[],
): { clips: Clip[]; changed: number } {
  const byId = new Map<string, string>();
  for (const item of translations) {
    const text = item.text.trim();
    if (text) byId.set(item.id, text);
  }

  let changed = 0;
  const next = clips.map((clip) => {
    const translated = byId.get(clip.id);
    if (translated === undefined || clip.track !== "subs") return clip;
    if (translated === captionLine(clip)) return clip;
    changed += 1;
    const previous = captionLine(clip);
    const kept = (clip.sourceText ?? "").trim();
    return {
      ...clip,
      text: translated,
      sourceText: kept && kept !== previous ? clip.sourceText : previous,
      label: translated.slice(0, 28),
    };
  });
  return { clips: next, changed };
}

export type TranslateCaptionsResult = {
  clips: Clip[];
  changed: number;
  untranslated: number;
  sent: number;
};

export async function translateCaptionTrack(input: {
  clips: Clip[];
  sourceLanguage: string;
  targetLanguage: string;
  turnstileToken?: string;
  signal?: AbortSignal;
}): Promise<TranslateCaptionsResult> {
  if (isSameLanguage(input.sourceLanguage, input.targetLanguage)) {
    return { clips: input.clips, changed: 0, untranslated: 0, sent: 0 };
  }

  const payload = captionsToTranslate(input.clips);
  if (payload.length === 0) {
    return { clips: input.clips, changed: 0, untranslated: 0, sent: 0 };
  }

  const { segments, untranslated } = await translateSegments({
    signal: input.signal,
    data: {
      segments: payload.map(({ text, start, end }) => ({ text, start, end })),
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      turnstileToken: input.turnstileToken,
    },
  });

  const translations: TranslatedLine[] = payload.map((item, index) => ({
    id: item.id,
    text: segments[index]?.textEn ?? item.text,
  }));

  const applied = applyTranslatedCaptions(input.clips, translations);
  return {
    clips: applied.clips,
    changed: applied.changed,
    untranslated: untranslated ?? 0,
    sent: payload.length,
  };
}
