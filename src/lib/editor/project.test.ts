import { describe, expect, it } from "vitest";

import { encodeWav } from "@/lib/video/audio/wav";
import { peaksForRanges, peaksFromSamples, readWav } from "./waveform";
import { SUBTITLE_PRESETS } from "@/lib/video/presets";

import {
  clampZone,
  clipRange,
  clipsOn,
  cutRanges,
  demoProject,
  EMPTY_PROJECT,
  ingestPipeline,
  makeClip,
  projectKeeps,
  projectPreset,
  resolvePresetById,
  fakePeaks,
} from "./project";
import { toRenderOptions } from "./types";
import type { Clip, SourceMedia } from "./types";
import type { Segment } from "@/lib/video/subtitles/cues";

const source: SourceMedia = {
  name: "clip.mp4",
  url: "blob:local/clip",
  bytes: null,
  size: 2048,
  duration: 12,
  width: 540,
  height: 960,
  fps: 30,
  hasAudio: true,
};

const segment = (start: number, end: number, fr: string, en: string): Segment => ({
  start,
  end,
  textFr: fr,
  textEn: en,
});

describe("clips", () => {
  it("range reconstruit la plage depuis début + durée", () => {
    expect(clipRange({ id: "a", track: "subs", start: 1.5, duration: 2, label: "" })).toEqual({
      start: 1.5,
      end: 3.5,
    });
  });

  it("clipsOn trie par position et filtre par piste", () => {
    const clips: Clip[] = [
      { id: "b", track: "subs", start: 5, duration: 1, label: "" },
      { id: "a", track: "subs", start: 1, duration: 1, label: "" },
      { id: "c", track: "cuts", start: 2, duration: 1, label: "" },
    ];
    expect(clipsOn(clips, "subs").map((c) => c.id)).toEqual(["a", "b"]);
    expect(clipsOn(clips, "dub")).toEqual([]);
  });

  it("cutRanges fusionne deux coupes qui se touchent", () => {
    const clips: Clip[] = [
      { id: "a", track: "cuts", start: 0, duration: 1, label: "" },
      { id: "b", track: "cuts", start: 1, duration: 1, label: "" },
    ];
    expect(cutRanges(clips)).toEqual([{ start: 0, end: 2 }]);
  });

  it("un libellé de coupe dit pourquoi elle existe", () => {
    expect(makeClip("cuts", { start: 1, end: 2 }, { reason: "silence" }).label).toBe("Silence");
    expect(makeClip("cuts", { start: 1, end: 2 }).label).toBe("Coupe");
  });
});

describe("ingestPipeline", () => {
  it("pose une phrase par segment, en langue cible", () => {
    const project = { ...EMPTY_PROJECT, source, clips: [] };
    const result = ingestPipeline(project, {
      segments: [
        segment(0, 2, "bonjour tout le monde", "hello world"),
        segment(3, 5, "ça va", "how are you"),
      ],
    });
    expect(result.cues).toBe(2);
    expect(result.clips[0]).toMatchObject({
      track: "subs",
      start: 0,
      duration: 2,
      text: "hello world",
      sourceText: "bonjour tout le monde",
    });
    expect(result.clips[1].text).toBe("how are you");
  });

  it("ignore les segments sans texte et signale le vide", () => {
    const project = { ...EMPTY_PROJECT, source, clips: [] };
    const result = ingestPipeline(project, { segments: [segment(0, 2, "", "  ")] });
    expect(result.clips).toHaveLength(0);
    expect(result.warnings.join(" ")).toMatch(/Aucun sous-titre/);
  });

  it("rogne un segment qui dépasserait la durée du plan", () => {
    const project = { ...EMPTY_PROJECT, source, clips: [] };
    const result = ingestPipeline(project, { segments: [segment(11, 40, "long", "long")] });
    const clip = result.clips[0];
    expect(clip.start + clip.duration).toBeLessThanOrEqual(source.duration + 0.001);
    expect(result.warnings.join(" ")).toMatch(/dépassaient la durée/);
  });

  it("remplace les pistes précédentes sans toucher aux coupes manuelles", () => {
    const manual: Clip = {
      id: "keep",
      track: "cuts",
      start: 1,
      duration: 0.5,
      label: "Coupe",
      reason: "manuel",
    };
    const project = { ...EMPTY_PROJECT, source, clips: [manual] };
    const result = ingestPipeline(project, { segments: [segment(0, 1, "a", "b")], cuts: [] });
    expect(result.clips.map((c) => c.id)).toContain("keep");
    // Une détection automatique ne doit pas effacer la coupe faite à la main :
    // les deux pistes portent des décisions différentes.
    expect(result.clips.filter((c) => c.track === "cuts")).toHaveLength(1);
  });

  it("materialise les coupes automatiques en blocs retirés", () => {
    const project = { ...EMPTY_PROJECT, source, clips: [] };
    const result = ingestPipeline(project, {
      segments: [segment(0, 2, "a", "b")],
      cuts: [{ start: 4, end: 4.8 }],
    });
    expect(result.cuts).toBe(1);
    expect(result.clips.find((c) => c.track === "cuts")).toMatchObject({
      start: 4,
      duration: 0.8,
      reason: "silence",
    });
  });
});

describe("projectKeeps / presets", () => {
  it("sans coupe, un seul segment conservé", () => {
    expect(projectKeeps({ ...EMPTY_PROJECT, source, clips: [] })).toEqual([{ start: 0, end: 12 }]);
  });

  it("les coupes redessinent les segments conservés", () => {
    const clips: Clip[] = [{ id: "c", track: "cuts", start: 2, duration: 1, label: "" }];
    expect(projectKeeps({ ...EMPTY_PROJECT, source, clips })).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 12 },
    ]);
  });

  it("un preset résolu applique les surcharges sans muter la base", () => {
    const base = SUBTITLE_PRESETS[0];
    const resolved = resolvePresetById(base.id, { fontsize: base.fontsize + 10 });
    expect(resolved.fontsize).toBe(base.fontsize + 10);
    expect(base.fontsize).not.toBe(resolved.fontsize);
    expect(
      projectPreset({
        ...EMPTY_PROJECT,
        presetId: base.id,
        overrides: { uppercase: !base.uppercase },
      }).uppercase,
    ).toBe(!base.uppercase);
  });

  it("un preset inconnon retombe sur le premier, jamais sur undefined", () => {
    expect(projectPreset({ ...EMPTY_PROJECT, presetId: "nimporte-quoi" }).id).toBe(
      SUBTITLE_PRESETS[0].id,
    );
  });
});

describe("clampZone", () => {
  it("garde la zone dans le cadre", () => {
    expect(
      clampZone({ id: "z", label: "z", x: 0.9, y: 0.95, w: 0.5, h: 0.5, enabled: true }),
    ).toEqual({
      id: "z",
      label: "z",
      x: 0.5,
      y: 0.5,
      w: 0.5,
      h: 0.5,
      enabled: true,
    });
  });

  it("refuse une zone trop petite pour être saisie", () => {
    const zone = clampZone(
      { id: "z", label: "z", x: 0.2, y: 0.2, w: 0.001, h: 0.001, enabled: true },
      0.03,
    );
    expect(zone.w).toBe(0.03);
    expect(zone.h).toBe(0.03);
  });
});

describe("toRenderOptions", () => {
  it("expose au pipeline les mêmes clés que l'ancien formulaire", () => {
    const options = toRenderOptions({ ...EMPTY_PROJECT, filterId: "vivid", ambienceLevel: 0.4 });
    expect(options).toMatchObject({
      filterId: "vivid",
      ambienceLevel: 0.4,
      ttsProvider: "elevenlabs",
      upscale: "none",
      transition: "none",
      wordByWord: true,
      maskStrength: "medium",
    });
    // Un identifiant de voix clonée ne part jamais dans les options par défaut.
    expect(options.clonedVoiceId).toBe("");
  });
});

describe("démo", () => {
  const demoSource: SourceMedia = { ...source, duration: 16 };

  it("charge six blocs, des masques actifs et un style CapCut", () => {
    const project = demoProject(demoSource);
    expect(project.clips.filter((c) => c.track === "subs")).toHaveLength(6);
    expect(project.presetId).toBe("capcut-pop");
    expect(project.masks.filter((m) => m.enabled).map((m) => m.id)).toEqual(
      expect.arrayContaining(["bottom", "tl", "tr"]),
    );
    // Les blocs doivent tenir dans le plan, sinon ils sont inatteignables.
    for (const clip of project.clips) {
      expect(clip.start + clip.duration).toBeLessThanOrEqual(demoSource.duration + 0.001);
    }
  });

  it("ne pose aucun bloc hors champ sur un plan plus court", () => {
    const project = demoProject({ ...source, duration: 7 });
    expect(project.clips.length).toBeGreaterThan(0);
    for (const clip of project.clips) {
      expect(clip.start).toBeLessThan(7);
      expect(clip.start + clip.duration).toBeLessThanOrEqual(7.001);
    }
  });

  it("une forme d'onde de remplissage reste normalisée", () => {
    const peaks = fakePeaks(2.4, 3);
    expect(peaks.length).toBeGreaterThan(10);
    expect(Math.max(...peaks)).toBeLessThanOrEqual(1);
    expect(Math.min(...peaks)).toBeGreaterThanOrEqual(0);
  });
});

describe("waveform", () => {
  it("extrait des crêtes bornées même sur un signal muet", () => {
    expect(peaksFromSamples(new Float32Array(0), 10)).toEqual([]);
    expect(peaksFromSamples(new Float32Array(200), 8).every((p) => p === 0)).toBe(true);
  });

  it("découpe la forme d'onde par plage de clip", () => {
    const all = [0, 1, 2, 3, 4, 5, 6, 7];
    const slices = peaksForRanges(
      [
        { start: 0, duration: 2 },
        { start: 2, duration: 2 },
      ],
      all,
      4,
    );
    expect(slices[0].length).toBeGreaterThan(0);
    expect(slices[1][0]).toBeGreaterThan(slices[0][0]);
  });
});

describe("encodeWav ↔ readWav (aller-retour de la piste voix off)", () => {
  it("relit les échantillons écrits par le moteur", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25]);
    const bytes = encodeWav(samples, 16000);
    const back = readWav(bytes);
    expect(back?.sampleRate).toBe(16000);
    expect(Array.from(back?.samples ?? []).map((v) => Number(v.toFixed(3)))).toEqual([
      0, 0.5, -0.5, 1, -1, 0.25,
    ]);
  });
});
