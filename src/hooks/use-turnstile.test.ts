import { describe, expect, it } from "vitest";

import { describeTurnstileError } from "./use-turnstile";

describe("describeTurnstileError", () => {
  it("désigne le domaine non autorisé, la cause la plus fréquente en production", () => {
    const message = describeTurnstileError("110200");
    expect(message).toMatch(/domaine/i);
    expect(message).toMatch(/Hostname Management/);
  });

  it("distingue une clé invalide d'un domaine refusé", () => {
    for (const code of ["110100", "110110", "400020"]) {
      expect(describeTurnstileError(code)).toMatch(/VITE_TURNSTILE_SITE_KEY/);
    }
    expect(describeTurnstileError("400070")).toMatch(/désactivée/);
  });

  it("n'accuse le bloqueur de publicité que lorsque le script est vraiment bloqué", () => {
    expect(describeTurnstileError("script-load")).toMatch(/bloqueur/i);
    // Régression visée : un domaine non autorisé affichait « bloqueur de
    // publicité », ce qui envoyait l'utilisateur sur une fausse piste.
    expect(describeTurnstileError("110200")).not.toMatch(/bloqueur/i);
  });

  it("gère les codes hiérarchiques à suffixe", () => {
    expect(describeTurnstileError("110200.abc")).toMatch(/domaine/i);
    expect(describeTurnstileError("300010")).toMatch(/Réessaie/);
    expect(describeTurnstileError("600100")).toMatch(/Réessaie/);
  });

  it("reste informatif face à un code inconnu", () => {
    expect(describeTurnstileError("999999")).toContain("999999");
  });

  it("invite à réessayer quand la vérification a simplement expiré", () => {
    expect(describeTurnstileError("110620")).toMatch(/expiré/);
    expect(describeTurnstileError("200500")).toMatch(/challenges\.cloudflare\.com/);
  });
});
