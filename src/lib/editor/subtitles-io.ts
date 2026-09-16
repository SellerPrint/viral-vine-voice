import { makeClip } from "./project";
import type { Clip } from "./types";

/**
 * Échange de légendes en formats ouverts.
 *
 * SRT et WebVTT sont le dénominateur commun de CapCut, OpenCut, Shotcut,
 * Kdenlive, Aegisub : on les lit et on les écrit sans dépendre d'une lib
 * tierce. Les temps restent en secondes source, comme le reste du monteur.
 */

export type SubtitleCue = {
  start: number;
  end: number;
  text: string;
};

export type SubtitleFormat = "srt" | "vtt";

const TIMESTAMP =
  /(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/;

export function parseTimestamp(raw: string): number {
  const match = raw.trim().match(TIMESTAMP);
  if (!match) return 0;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = match[4].padEnd(3, "0").slice(0, 3);
  return hours * 3600 + minutes * 60 + seconds + Number(fraction) / 1000;
}

export function formatTimestamp(seconds: number, decimal: "," | "."): string {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const whole = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(whole)}${decimal}${pad(millis, 3)}`;
}

function cueBlocks(raw: string): string[] {
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

const ARROW = /-->/;

function parseBlock(block: string): SubtitleCue | null {
  const lines = block.split("\n").map((line) => line.trimEnd());
  const arrowIndex = lines.findIndex((line) => ARROW.test(line));
  if (arrowIndex < 0) return null;
  const timing = lines[arrowIndex];
  const [startRaw, endRaw] = timing.split(ARROW);
  if (!startRaw || !endRaw) return null;
  const start = parseTimestamp(startRaw);
  const end = parseTimestamp(endRaw);
  const text = lines
    .slice(arrowIndex + 1)
    .filter((line) => !/^NOTE\b/i.test(line) && !/^STYLE\b/i.test(line))
    .join("\n")
    .replace(/<[^>]+>/g, "")
    .trim();
  if (!text || end - start < 0.04) return null;
  return { start, end, text };
}

export function detectSubtitleFormat(raw: string): SubtitleFormat {
  return /^\s*WEBVTT/i.test(raw.replace(/^\uFEFF/, "")) ? "vtt" : "srt";
}

export function parseSrt(raw: string): SubtitleCue[] {
  return cueBlocks(raw)
    .map(parseBlock)
    .filter((cue): cue is SubtitleCue => cue !== null);
}

export function parseVtt(raw: string): SubtitleCue[] {
  const stripped = raw.replace(/^\uFEFF/, "").replace(/^WEBVTT[^\n]*\n/i, "");
  return cueBlocks(stripped)
    .filter((block) => !/^(NOTE|STYLE|REGION)\b/i.test(block))
    .map(parseBlock)
    .filter((cue): cue is SubtitleCue => cue !== null);
}

export function parseSubtitles(raw: string): SubtitleCue[] {
  return detectSubtitleFormat(raw) === "vtt" ? parseVtt(raw) : parseSrt(raw);
}

export function toSrt(cues: SubtitleCue[]): string {
  return cues
    .map((cue, index) => {
      const body = cue.text.replace(/\n+/g, "\n").trim();
      return `${index + 1}\n${formatTimestamp(cue.start, ",")} --> ${formatTimestamp(cue.end, ",")}\n${body}`;
    })
    .join("\n\n")
    .concat(cues.length ? "\n" : "");
}

export function toVtt(cues: SubtitleCue[]): string {
  const body = cues
    .map((cue) => {
      const text = cue.text.replace(/\n+/g, "\n").trim();
      return `${formatTimestamp(cue.start, ".")} --> ${formatTimestamp(cue.end, ".")}\n${text}`;
    })
    .join("\n\n");
  return `WEBVTT\n\n${body}${cues.length ? "\n" : ""}`;
}

/** Remplace la piste de sous-titres, laisse coupes et voix off intactes. */
export function mergeSubtitleCues(clips: Clip[], cues: SubtitleCue[]): Clip[] {
  const kept = clips.filter((clip) => clip.track !== "subs");
  const next = cues.map((cue) =>
    makeClip(
      "subs",
      { start: cue.start, end: cue.end },
      { text: cue.text, sourceText: cue.text, label: cue.text.slice(0, 28) },
    ),
  );
  return [...kept, ...next];
}

export function clipsToSubtitleCues(clips: Clip[]): SubtitleCue[] {
  return clips
    .filter((clip) => clip.track === "subs" && (clip.text ?? "").trim())
    .map((clip) => ({
      start: clip.start,
      end: clip.start + clip.duration,
      text: (clip.text ?? "").trim(),
    }))
    .sort((a, b) => a.start - b.start);
}
