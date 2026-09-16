import { describe, expect, it } from "vitest";

import { applyViralTemplate, matchingViralTemplate, VIRAL_TEMPLATES } from "./templates";
import { EMPTY_PROJECT } from "./project";
import { cadreCouvrant } from "@/lib/video/presets";
import type { Clip, Project, SourceMedia } from "./types";

const source: SourceMedia = {
  name: "clip.mp4",
  url: "blob:local/clip",
  bytes: null,
  size: 1024,
  duration: 12,
  width: 540,
  height: 960,
  fps: 30,
  hasAudio: true,
};

function project(clips: Clip[] = []): Project {
  return { ...EMPTY_PROJECT, source, clips, masks: EMPTY_PROJECT.masks.map((m) => ({ ...m })) };
}

describe("formats viraux", () => {
  it("expose les quatre cadres 9:16", () => {
    expect(VIRAL_TEMPLATES.map((item) => item.id)).toEqual(["hook", "punch", "bandeau", "outro"]);
  });

  it("Hook 3 s pose le texte en haut, floute l'ancien ST, sans cadre couvrant", () => {
    const result = applyViralTemplate(project([]), "hook");
    expect(result.added).toBe(1);
    expect(result.patch.overrides?.yAnchor).toBeCloseTo(0.16);
    expect(cadreCouvrant(result.patch.masks ?? [])).toBeUndefined();
    expect(result.patch.masks?.find((m) => m.id === "st-origine")?.enabled).toBe(true);
    expect(result.patch.masks?.find((m) => m.id === "bottom")?.enabled).toBe(false);
    expect(result.patch.clips?.find((c) => c.track === "subs")?.text).toMatch(/hook/i);
    expect(matchingViralTemplate({ ...project([]), ...result.patch })).toBe("hook");
  });

  it("Hook 3 s ne remplace pas un sous-titre déjà dans les 3 premières secondes", () => {
    const existing: Clip = {
      id: "keep",
      track: "subs",
      start: 0.4,
      duration: 2,
      label: "déjà là",
      text: "déjà là",
    };
    const result = applyViralTemplate(project([existing]), "hook");
    expect(result.added).toBe(0);
    expect(result.patch.clips?.map((c) => c.id)).toEqual(["keep"]);
  });

  it("Zoom punch centre des légendes géantes, sans inventer un zoom caméra", () => {
    const result = applyViralTemplate(project(), "punch");
    expect(result.added).toBe(0);
    expect(result.patch.overrides?.yAnchor).toBeCloseTo(0.52);
    expect(result.patch.overrides?.fontsize).toBeGreaterThan(120);
    expect(result.patch.wordByWord).toBe(true);
    expect(result.patch.masks?.find((m) => m.id === "bottom")?.enabled).toBe(false);
    expect(cadreCouvrant(result.patch.masks ?? [])).toBeUndefined();
    expect(result.notice).toMatch(/Pas de zoom caméra/);
    expect(matchingViralTemplate({ ...project(), ...result.patch })).toBe("punch");
  });

  it("Bandeau bas allume la plaque et cale la légende dessus", () => {
    const result = applyViralTemplate(project(), "bandeau");
    const bottom = result.patch.masks?.find((m) => m.id === "bottom");
    expect(bottom?.enabled).toBe(true);
    expect((bottom?.y ?? 0) + (bottom?.h ?? 0)).toBeGreaterThan(0.9);
    expect(result.patch.presetId).toBe("capcut-classic");
    expect(cadreCouvrant(result.patch.masks ?? [])?.id).toBe("bottom");
    expect(matchingViralTemplate({ ...project(), ...result.patch })).toBe("bandeau");
  });

  it("Outro ajoute un bloc en fin de plan, sans toucher aux coupes", () => {
    const cut: Clip = {
      id: "cut",
      track: "cuts",
      start: 4,
      duration: 0.5,
      label: "Coupe",
      reason: "manuel",
    };
    const result = applyViralTemplate(project([cut]), "outro");
    expect(result.added).toBe(1);
    const outro = result.patch.clips?.find((c) => c.track === "subs");
    expect(outro?.start).toBeCloseTo(9.8);
    expect(result.patch.clips?.map((c) => c.id)).toContain("cut");
    expect(matchingViralTemplate({ ...project([cut]), ...result.patch })).toBe("outro");
  });

  it("Outro refuse un plan trop court", () => {
    const result = applyViralTemplate(
      { ...project(), source: { ...source, duration: 0.3 } },
      "outro",
    );
    expect(result.added).toBe(0);
    expect(result.notice).toMatch(/trop court/);
  });

  it("ne mute pas les masques du projet d'entrée", () => {
    const input = project();
    const before = input.masks.map((m) => m.enabled);
    applyViralTemplate(input, "hook");
    applyViralTemplate(input, "bandeau");
    expect(input.masks.map((m) => m.enabled)).toEqual(before);
  });
});
