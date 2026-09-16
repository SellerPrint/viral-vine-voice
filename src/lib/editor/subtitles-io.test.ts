import { describe, expect, it } from "vitest";

import {
  clipsToSubtitleCues,
  detectSubtitleFormat,
  formatTimestamp,
  mergeSubtitleCues,
  parseSrt,
  parseSubtitles,
  parseTimestamp,
  parseVtt,
  toSrt,
  toVtt,
} from "./subtitles-io";
import type { Clip } from "./types";

const SRT = `1
00:00:00,000 --> 00:00:01,500
Bonjour le monde

2
00:00:01,800 --> 00:00:03,000
Deuxième ligne
sur deux rangs
`;

const VTT = `WEBVTT

00:00:00.000 --> 00:00:01.500
Bonjour le monde

00:00:01.800 --> 00:00:03.000
Deuxième ligne
sur deux rangs
`;

describe("horodatage", () => {
  it("lit les virgules SRT et les points VTT", () => {
    expect(parseTimestamp("00:00:01,500")).toBe(1.5);
    expect(parseTimestamp("00:00:01.500")).toBe(1.5);
    expect(parseTimestamp("01:02:03,040")).toBe(3723.04);
  });

  it("écrit un horodatage borné", () => {
    expect(formatTimestamp(1.5, ",")).toBe("00:00:01,500");
    expect(formatTimestamp(1.5, ".")).toBe("00:00:01.500");
  });
});

describe("SRT / VTT", () => {
  it("parse un SRT à deux cues", () => {
    const cues = parseSrt(SRT);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 0, end: 1.5, text: "Bonjour le monde" });
    expect(cues[1].text).toBe("Deuxième ligne\nsur deux rangs");
  });

  it("parse un VTT et ignore WEBVTT", () => {
    const cues = parseVtt(VTT);
    expect(cues).toHaveLength(2);
    expect(detectSubtitleFormat(VTT)).toBe("vtt");
    expect(detectSubtitleFormat(SRT)).toBe("srt");
  });

  it("choisit le parseur selon l'en-tête", () => {
    expect(parseSubtitles(VTT)[0].text).toBe("Bonjour le monde");
    expect(parseSubtitles(SRT)).toHaveLength(2);
  });

  it("rond-trip SRT puis VTT", () => {
    const cues = parseSrt(SRT);
    expect(parseSrt(toSrt(cues))).toEqual(cues);
    expect(parseVtt(toVtt(cues))).toEqual(cues);
    expect(toVtt(cues).startsWith("WEBVTT")).toBe(true);
  });

  it("ignore un bloc sans texte", () => {
    expect(parseSrt("1\n00:00:00,000 --> 00:00:01,000\n\n")).toEqual([]);
  });
});

describe("fusion sur la piste", () => {
  it("remplace les sous-titres et conserve les coupes", () => {
    const clips: Clip[] = [
      {
        id: "cut-1",
        track: "cuts",
        start: 4,
        duration: 1,
        label: "Silence",
        reason: "silence",
      },
      {
        id: "sub-old",
        track: "subs",
        start: 0,
        duration: 2,
        label: "Ancien",
        text: "Ancien",
      },
    ];
    const next = mergeSubtitleCues(clips, [{ start: 0.2, end: 1.4, text: "Nouveau" }]);
    expect(next.filter((clip) => clip.track === "cuts")).toHaveLength(1);
    const subs = next.filter((clip) => clip.track === "subs");
    expect(subs).toHaveLength(1);
    expect(subs[0].text).toBe("Nouveau");
    expect(clipsToSubtitleCues(next)[0].text).toBe("Nouveau");
  });
});
