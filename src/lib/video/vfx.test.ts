import { describe, expect, it } from "vitest";

import { buildLookFilters } from "./filters";
import { buildVfxFilter, composeLookChain, getVfx, VFX_EFFECTS } from "./vfx";

describe("VFX CapCut", () => {
  it("a un identifiant unique par effet, et « none » ne produit rien", () => {
    const ids = VFX_EFFECTS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(buildVfxFilter("none")).toBe("");
    expect(buildVfxFilter("inconnu")).toBe("");
    expect(getVfx("glow").name).toBe("Lueur");
  });

  it("empile look + VFX sans virgule orpheline", () => {
    const look = buildLookFilters("vivid", "none", 1080, 1920);
    const vfx = buildVfxFilter("grain");
    expect(look).toBeTruthy();
    expect(vfx).toBeTruthy();
    expect(composeLookChain(look, vfx)).toBe(`${look},${vfx}`);
    expect(composeLookChain("", vfx)).toBe(vfx);
    expect(composeLookChain(look, "")).toBe(look);
    expect(composeLookChain("", "")).toBe("");
  });

  it("ne change pas les dimensions sauf mosaïque (scale aller-retour)", () => {
    expect(VFX_EFFECTS.length).toBeGreaterThan(40);
    for (const item of VFX_EFFECTS) {
      const chain = item.ffmpeg(1080, 1920);
      if (!chain) continue;
      if (/scale=/.test(chain)) {
        expect(chain).toMatch(/scale=\d+:\d+:flags=neighbor,scale=1080:1920:flags=neighbor/);
      }
      // Rien qui fermerait un filtre et injecterait un graphe.
      expect(chain).not.toMatch(/[;'"]/);
    }
  });

  it("pixel sans dimensions retombe sur un flou, pas un scale 0", () => {
    expect(buildVfxFilter("pixel", 0, 0)).toBe("gblur=sigma=3.5");
    expect(buildVfxFilter("glow", 0, 0)).toContain("unsharp");
  });
});
