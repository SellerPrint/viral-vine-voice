import { describe, expect, it } from "vitest";

import { buildCues, groupWordsToSegments, wrapLines, type Segment, type Word } from "./cues";

const word = (text: string, start: number, end: number, speakerId = "0"): Word => ({
  text,
  start,
  end,
  speakerId,
});

describe("groupWordsToSegments", () => {
  it("retourne un tableau vide sans mots", () => {
    expect(groupWordsToSegments([])).toEqual([]);
  });

  it("regroupe les mots en une phrase", () => {
    const result = groupWordsToSegments([
      word("Bonjour", 0, 0.5),
      word("tout", 0.5, 0.8),
      word("le", 0.8, 1),
      word("monde", 1, 1.4),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ text: "Bonjour tout le monde", start: 0, end: 1.4 });
  });

  it("coupe sur une fin de phrase au-delà de 1,5 s", () => {
    const result = groupWordsToSegments([
      word("Salut", 0, 0.5),
      word("les", 0.5, 0.8),
      word("amis.", 0.8, 2.0),
      word("Aujourd'hui", 2.0, 2.6),
      word("on", 2.6, 2.8),
      word("teste.", 2.8, 4.5),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("Salut les amis.");
  });

  it("ne coupe pas sur une fin de phrase trop précoce", () => {
    const result = groupWordsToSegments([
      word("Oui.", 0, 0.4),
      word("Vraiment", 0.4, 1.0),
      word("bien.", 1.0, 2.2),
    ]);
    expect(result).toHaveLength(1);
  });

  it("coupe de force au-delà de 7 secondes", () => {
    const words = Array.from({ length: 30 }, (_, i) => word(`mot${i}`, i * 0.4, i * 0.4 + 0.4));
    const result = groupWordsToSegments(words);
    expect(result.length).toBeGreaterThan(1);
    expect(result.every((s) => s.end - s.start <= 7.5)).toBe(true);
  });

  it("recolle la ponctuation sans espace parasite", () => {
    const result = groupWordsToSegments([
      word("Bonjour", 0, 0.5),
      word(",", 0.5, 0.6),
      word("toi", 0.6, 1),
    ]);
    expect(result[0].text).toBe("Bonjour, toi");
  });

  it("attribue le locuteur majoritaire", () => {
    const result = groupWordsToSegments([
      word("un", 0, 0.3, "1"),
      word("deux", 0.3, 0.6, "1"),
      word("trois", 0.6, 0.9, "1"),
      word("quatre", 0.9, 1.2, "0"),
    ]);
    expect(result[0].speakerId).toBe("1");
  });

  it("reste déterministe sur plusieurs exécutions", () => {
    // L'implémentation précédente triait le tableau tout en le lisant dans le
    // comparateur : le résultat dépendait du moteur JavaScript.
    const words = [
      word("a", 0, 0.2, "0"),
      word("b", 0.2, 0.4, "1"),
      word("c", 0.4, 0.6, "1"),
      word("d", 0.6, 0.8, "2"),
      word("e", 0.8, 1.0, "1"),
    ];
    const runs = Array.from(
      { length: 50 },
      () => groupWordsToSegments(words.map((w) => ({ ...w })))[0].speakerId,
    );
    expect(new Set(runs).size).toBe(1);
    expect(runs[0]).toBe("1");
  });

  it("retombe sur le locuteur 0 quand aucun n'est renseigné", () => {
    const result = groupWordsToSegments([
      { text: "sans", start: 0, end: 0.4 },
      { text: "locuteur", start: 0.4, end: 0.9 },
    ]);
    expect(result[0].speakerId).toBe("0");
  });
});

describe("wrapLines", () => {
  it("garde une ligne courte intacte", () => {
    expect(wrapLines("Bonjour toi", 20, 2)).toEqual(["Bonjour toi"]);
  });

  it("coupe au-delà de la largeur maximale", () => {
    expect(wrapLines("un deux trois quatre", 10, 3)).toEqual(["un deux", "trois", "quatre"]);
  });

  it("accumule sur la dernière ligne autorisée plutôt que de tronquer", () => {
    const result = wrapLines("un deux trois quatre cinq", 8, 2);
    expect(result).toHaveLength(2);
    expect(result.join(" ")).toBe("un deux trois quatre cinq");
  });

  it("ne perd jamais un mot", () => {
    const input = "alpha bravo charlie delta echo foxtrot golf";
    expect(wrapLines(input, 12, 3).join(" ").split(/\s+/)).toEqual(input.split(" "));
  });

  it("gère une chaîne vide", () => {
    expect(wrapLines("", 20, 2)).toEqual([]);
  });

  it("gère un mot plus long que la largeur maximale", () => {
    expect(wrapLines("anticonstitutionnellement", 10, 2)).toEqual(["anticonstitutionnellement"]);
  });
});

describe("buildCues", () => {
  const segment = (textEn: string, start: number, end: number): Segment => ({
    start,
    end,
    textEn,
    textFr: "",
  });

  it("produit une cue par segment hors mode mot-à-mot", () => {
    const cues = buildCues([segment("hello world", 0, 2), segment("second one", 3, 5)], false);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe("hello world");
  });

  it("produit une cue par mot en mode mot-à-mot", () => {
    const cues = buildCues([segment("one two three", 0, 3)], true);
    expect(cues.map((c) => c.text)).toEqual(["one", "two", "three"]);
  });

  it("maintient les cues dans les bornes du segment", () => {
    const cues = buildCues([segment("alpha bravo charlie", 1, 4)], true);
    expect(cues[0].start).toBeGreaterThanOrEqual(1);
    expect(cues[cues.length - 1].end).toBeLessThanOrEqual(4.001);
  });

  it("ordonne les cues chronologiquement", () => {
    const cues = buildCues([segment("b", 5, 6), segment("a", 1, 2)], false);
    expect(cues[0].text).toBe("a");
  });

  it("évite le chevauchement entre segments adjacents", () => {
    const cues = buildCues([segment("first", 0, 2.5), segment("second", 2, 4)], false);
    expect(cues[0].end).toBeLessThanOrEqual(cues[1].start);
  });

  it("ignore les segments vides", () => {
    expect(buildCues([segment("   ", 0, 2), segment("ok", 3, 4)], false)).toHaveLength(1);
  });

  it("retombe sur un affichage par segment au-delà du plafond de cues", () => {
    // 60 segments × 8 mots = 480 cues, au-dessus de MAX_CUES (320)
    const many = Array.from({ length: 60 }, (_, i) =>
      segment("un deux trois quatre cinq six sept huit", i * 2, i * 2 + 1.8),
    );
    const cues = buildCues(many, true);
    expect(cues).toHaveLength(60);
    expect(cues[0].text).toBe("un deux trois quatre cinq six sept huit");
  });

  it("écarte les cues trop brèves pour être lisibles", () => {
    const cues = buildCues([segment("x", 0, 0.01)], false);
    expect(cues).toHaveLength(0);
  });
});
