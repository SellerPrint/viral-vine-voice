import { describe, expect, it } from "vitest";

import { getTextFx, TEXT_FX } from "./text-fx";

describe("animations de légende CapCut", () => {
  it("a un identifiant unique, et « none » n'ajoute aucune classe", () => {
    const ids = TEXT_FX.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(20);
    expect(getTextFx("none").cssClass).toBe("");
    expect(getTextFx("pop").cssClass).toBe("ed-textfx-pop");
    expect(getTextFx("neon").category).toBe("loop");
    expect(getTextFx("explode").cssClass).toBe("ed-textfx-explode");
    expect(getTextFx("inconnu").id).toBe("none");
  });
});
