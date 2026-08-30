import { describe, expect, it } from "vitest";

import { describeTtsFailure } from "./narration";

describe("describeTtsFailure", () => {
  it("reconnaît une limite de débit, qui justifie un réessai", () => {
    expect(describeTtsFailure(new Error("HTTP 429 Too Many Requests"))).toBe(
      "limite de débit atteinte",
    );
    expect(describeTtsFailure(new Error("rate limit exceeded"))).toBe("limite de débit atteinte");
  });

  it("distingue une clé refusée d'un quota épuisé", () => {
    expect(describeTtsFailure(new Error("HTTP 401 Unauthorized"))).toBe("clé API refusée");
    expect(describeTtsFailure(new Error("insufficient credits"))).toBe("quota épuisé");
  });

  it("reconnaît une panne serveur et un souci réseau", () => {
    expect(describeTtsFailure(new Error("HTTP 503 Service Unavailable"))).toBe(
      "service indisponible",
    );
    expect(describeTtsFailure(new Error("network timeout"))).toBe("réseau instable");
  });

  it("tronque un message inconnu plutôt que de noyer l'interface", () => {
    const reason = describeTtsFailure(new Error("x".repeat(300)));
    expect(reason.length).toBeLessThanOrEqual(80);
  });

  it("accepte une valeur qui n'est pas une Error", () => {
    expect(describeTtsFailure("boom")).toBe("boom");
  });
});
