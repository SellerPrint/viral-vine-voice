import { describe, expect, it } from "vitest";

import { applyCloneRecipe, CLONE_RECIPES, matchingCloneRecipe } from "./clone-recipes";
import { EMPTY_PROJECT } from "./project";

describe("recettes clones", () => {
  it("expose une recette par origine connue", () => {
    const origins = new Set(CLONE_RECIPES.map((item) => item.origin));
    expect(origins.has("CapCut")).toBe(true);
    expect(origins.has("OpenCut")).toBe(true);
    expect(origins.has("Omniclip")).toBe(true);
    expect(origins.has("Shotcut")).toBe(true);
    expect(origins.has("Kdenlive")).toBe(true);
  });

  it("n'écrit que des champs de look, pas les clips", () => {
    const result = applyCloneRecipe(EMPTY_PROJECT, "opencut-clean");
    expect(result).not.toBeNull();
    expect(result?.patch.clips).toBeUndefined();
    expect(result?.patch.presetId).toBe("discret");
    expect(result?.patch.filterId).toBe("pure");
    expect(result?.notice).toMatch(/OpenCut/);
  });

  it("reconnaît la recette appliquée", () => {
    const result = applyCloneRecipe(EMPTY_PROJECT, "shotcut-mono");
    const next = { ...EMPTY_PROJECT, ...result?.patch };
    expect(matchingCloneRecipe(next)).toBe("shotcut-mono");
  });

  it("ignore un id inconnu", () => {
    expect(applyCloneRecipe(EMPTY_PROJECT, "inconnu")).toBeNull();
  });
});
