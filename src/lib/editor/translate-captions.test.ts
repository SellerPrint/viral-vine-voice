import { describe, expect, it } from "vitest";

import { LIMITS } from "@/lib/ai.schemas";

import { applyTranslatedCaptions, captionLine, captionsToTranslate } from "./translate-captions";
import type { Clip } from "./types";

const sub = (id: string, text: string, extra: Partial<Clip> = {}): Clip => ({
  id,
  track: "subs",
  start: extra.start ?? 0,
  duration: extra.duration ?? 1.2,
  label: text.slice(0, 28),
  text,
  ...extra,
});

describe("captionsToTranslate", () => {
  it("ne prend que la piste Texte, dans l'ordre, et ignore le vide", () => {
    const cut: Clip = {
      id: "cut",
      track: "cuts",
      start: 1,
      duration: 0.4,
      label: "Coupe",
      reason: "manuel",
    };
    const dub: Clip = { id: "dub", track: "dub", start: 0, duration: 2, label: "Voix" };
    const payload = captionsToTranslate([
      sub("b", "deuxième", { start: 2 }),
      cut,
      sub("a", "  premier  ", { start: 0.2 }),
      sub("vide", "   "),
      dub,
    ]);
    expect(payload.map((item) => item.id)).toEqual(["b", "a"]);
    expect(payload[1]).toMatchObject({ id: "a", text: "premier", start: 0.2, end: 1.4 });
  });

  it("borne le texte et le nombre de blocs aux limites de l'endpoint", () => {
    const long = "x".repeat(LIMITS.segmentText + 40);
    expect(captionsToTranslate([sub("long", long)])[0].text).toHaveLength(LIMITS.segmentText);

    const many = Array.from({ length: LIMITS.segmentCount + 10 }, (_, i) => sub(`c${i}`, `ligne ${i}`));
    expect(captionsToTranslate(many)).toHaveLength(LIMITS.segmentCount);
  });
});

describe("applyTranslatedCaptions", () => {
  it("réécrit le texte, garde les temps, et mémorise l'original", () => {
    const clips: Clip[] = [
      sub("a", "bonjour", { start: 0.4, duration: 2, speakerId: "0" }),
      { id: "cut", track: "cuts", start: 3, duration: 0.5, label: "Coupe", reason: "manuel" },
    ];
    const result = applyTranslatedCaptions(clips, [{ id: "a", text: " hello " }]);
    expect(result.changed).toBe(1);
    expect(result.clips[0]).toMatchObject({
      id: "a",
      start: 0.4,
      duration: 2,
      speakerId: "0",
      text: "hello",
      sourceText: "bonjour",
    });
    expect(result.clips[1].id).toBe("cut");
    expect(clips[0].text).toBe("bonjour");
  });

  it("ne remplace pas un original déjà mémorisé lors d'une seconde passe", () => {
    const clip = sub("a", "hello", { sourceText: "bonjour" });
    const result = applyTranslatedCaptions([clip], [{ id: "a", text: "hola" }]);
    expect(result.clips[0]).toMatchObject({ text: "hola", sourceText: "bonjour" });
  });

  it("laisse intact un bloc dont la traduction est identique ou absente", () => {
    const clips = [sub("a", "bonjour"), sub("b", "ça va")];
    const result = applyTranslatedCaptions(clips, [
      { id: "a", text: "bonjour" },
      { id: "inconnu", text: "nope" },
    ]);
    expect(result.changed).toBe(0);
    expect(result.clips).toEqual(clips);
  });
});

describe("captionLine", () => {
  it("ignore les espaces", () => {
    expect(captionLine(sub("a", "  hey  "))).toBe("hey");
    expect(captionLine(sub("a", "   "))).toBe("");
  });
});
