import { describe, expect, it } from "vitest";

import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "./site";

describe("SITE_URL", () => {
  it("ne pointe pas sur le domaine inexistant viraldub.app", () => {
    // Le repli d'origine annoncait une image Open Graph sur un domaine non
    // enregistre : tout partage sur un reseau social affichait une vignette
    // vide, sans erreur visible cote application.
    expect(SITE_URL).not.toContain("viraldub.app");
  });

  it("est une URL absolue en https, sans barre oblique finale", () => {
    expect(SITE_URL).toMatch(/^https:\/\/[^/]+$/);
  });

  it("permet de construire une URL d'image valide", () => {
    expect(`${SITE_URL}/og-image.png`).toMatch(/^https:\/\/[^/]+\/og-image\.png$/);
  });
});

describe("métadonnées", () => {
  it("expose un nom et une description non vides", () => {
    expect(SITE_NAME.trim().length).toBeGreaterThan(0);
    // Une description Open Graph au-dela de ~200 caracteres est tronquee.
    expect(SITE_DESCRIPTION.length).toBeGreaterThan(20);
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(200);
  });
});
