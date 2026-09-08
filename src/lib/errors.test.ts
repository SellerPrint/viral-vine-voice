import { describe as vitestDescribe, expect, it } from "vitest";

import { describe, describeWithContext } from "./errors";

vitestDescribe("describe", () => {
  it("ne renvoie JAMAIS « [object Object] »", () => {
    // Le bug d'origine : `String(objet)` produisait cette chaine et
    // l'interface l'affichait telle quelle, sans aucune information utile.
    const hostiles = [
      {},
      { code: 500 },
      { foo: "bar" },
      Object.create(null),
      new Map(),
      Symbol("x"),
      () => undefined,
    ];

    for (const value of hostiles) {
      const message = describe(value);
      expect(message).not.toBe("[object Object]");
      expect(message).not.toMatch(/^\[object \w+\]$/);
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("prend le message d'une Error", () => {
    expect(describe(new Error("clé API invalide"))).toBe("clé API invalide");
  });

  it("récupère le message d'une Error sérialisée par le serveur", () => {
    // TanStack Start serialise les erreurs des fonctions serveur : cote client
    // ce n'est plus une instance d'`Error` mais un objet nu. C'est le chemin
    // exact qui produisait « [object Object] » en production.
    expect(describe({ message: "Quota ElevenLabs dépassé" })).toBe("Quota ElevenLabs dépassé");
  });

  it("accepte les autres noms de champ courants", () => {
    expect(describe({ error: "modèle indisponible" })).toBe("modèle indisponible");
    expect(describe({ detail: "clé absente" })).toBe("clé absente");
    expect(describe({ statusText: "Bad Gateway" })).toBe("Bad Gateway");
  });

  it("descend dans un objet imbriqué", () => {
    // Forme renvoyee par OpenAI et Google.
    expect(describe({ error: { message: "invalid_api_key" } })).toBe("invalid_api_key");
  });

  it("indique au moins le code HTTP d'une Response non lue", () => {
    expect(describe({ status: 502 })).toBe("Erreur 502");
    expect(describe({ statusCode: 429 })).toBe("Erreur 429");
  });

  it("prend la première anomalie d'un tableau Zod", () => {
    expect(describe([{ path: ["voiceId"], message: "voix inconnue" }])).toBe("voix inconnue");
  });

  it("traite une chaîne levée directement", () => {
    expect(describe("échec du rendu")).toBe("échec du rendu");
  });

  it("retombe sur le repli quand la valeur ne dit rien", () => {
    for (const vide of [null, undefined, "", "   ", {}, new Error("")]) {
      expect(describe(vide, "repli")).toBe("repli");
    }
  });

  it("ignore un message d'Error vide au profit du repli", () => {
    // Une `Error` sans message est aussi inutile qu'un objet nu.
    expect(describe(new Error("   "), "repli")).toBe("repli");
  });

  it("déplie une AggregateError", () => {
    const aggregate = new AggregateError([new Error("première cause")], "");
    expect(describe(aggregate)).toBe("première cause");
  });

  it("tronque un message interminable", () => {
    const long = describe(new Error("x".repeat(1000)));
    expect(long.length).toBeLessThanOrEqual(301);
    expect(long.endsWith("…")).toBe(true);
  });

  it("ne tronque pas un message de taille normale", () => {
    expect(describe(new Error("court")).endsWith("…")).toBe(false);
  });
});

vitestDescribe("describeWithContext", () => {
  it("préfixe par l'étape concernée", () => {
    expect(describeWithContext("Traduction", new Error("quota dépassé"))).toBe(
      "Traduction : quota dépassé",
    );
  });

  it("préfixe aussi le repli", () => {
    expect(describeWithContext("Voix off", {}, "cause inconnue")).toBe("Voix off : cause inconnue");
  });
});
