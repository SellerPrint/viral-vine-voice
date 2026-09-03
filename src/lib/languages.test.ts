import { describe, expect, it } from "vitest";

import { isSameLanguage, SOURCE_LANGUAGES } from "./languages";
import { TARGET_LANGUAGES } from "./video/presets";

describe("TARGET_LANGUAGES", () => {
  it("propose le francais comme langue finale", () => {
    const french = TARGET_LANGUAGES.find((l) => l.code === "fr");
    expect(french).toBeDefined();
    // `name` alimente le prompt de traduction : une faute ici et le modele
    // traduirait vers autre chose.
    expect(french?.name).toBe("French");
  });

  it("n'a ni code ni libelle en double", () => {
    const codes = TARGET_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);

    const labels = TARGET_LANGUAGES.map((l) => l.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("utilise des codes ISO 639-1, attendus par la selection de police", () => {
    // `fontUrlForLanguage` indexe sur ces codes : « fra » au lieu de « fr »
    // ferait silencieusement retomber sur Roboto.
    for (const language of TARGET_LANGUAGES) {
      expect(language.code).toMatch(/^[a-z]{2}$/);
    }
  });
});

describe("isSameLanguage", () => {
  it("detecte l'aller-retour vers la meme langue malgre des codes differents", () => {
    // Les sources sont en ISO 639-3 (« fra »), les cibles en ISO 639-1
    // (« fr ») : comparer les codes ne detecterait jamais l'egalite.
    const source = SOURCE_LANGUAGES.find((l) => l.code === "fra");
    const target = TARGET_LANGUAGES.find((l) => l.code === "fr");
    expect(isSameLanguage(source?.name, target?.name)).toBe(true);
  });

  it("ignore la precision regionale entre parentheses", () => {
    // « Portuguese » cote source, « Portuguese (Brazil) » cote cible.
    expect(isSameLanguage("Portuguese", "Portuguese (Brazil)")).toBe(true);
  });

  it("laisse passer une vraie traduction", () => {
    expect(isSameLanguage("French", "English")).toBe(false);
    expect(isSameLanguage("English", "French")).toBe(false);
  });

  it("ne signale rien si une langue est absente", () => {
    expect(isSameLanguage(undefined, "French")).toBe(false);
    expect(isSameLanguage("French", undefined)).toBe(false);
  });
});

describe("couplage source / cible", () => {
  it("permet l'anglais vers le francais dans les deux sens", () => {
    // La demande d'origine : EN -> FR. L'inverse existait deja.
    const englishSource = SOURCE_LANGUAGES.find((l) => l.code === "eng");
    const frenchTarget = TARGET_LANGUAGES.find((l) => l.code === "fr");
    expect(englishSource).toBeDefined();
    expect(frenchTarget).toBeDefined();
    expect(isSameLanguage(englishSource?.name, frenchTarget?.name)).toBe(false);

    const frenchSource = SOURCE_LANGUAGES.find((l) => l.code === "fra");
    const englishTarget = TARGET_LANGUAGES.find((l) => l.code === "en");
    expect(frenchSource).toBeDefined();
    expect(englishTarget).toBeDefined();
  });
});
