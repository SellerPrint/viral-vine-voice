import { describe, expect, it } from "vitest";

import { MAX_VIDEO_BYTES, validateVideoFile, avertissementDecodage } from "./media";

/**
 * Garde-fous d'import.
 *
 * Ils protègent la mémoire de l'onglet — un `arrayBuffer()` sur un fichier de
 * 2 Go suffit à le faire tomber — et doivent rester efficaces même quand le
 * navigateur ne déclare pas un type MIME fiable (c'est le cas de beaucoup de
 * fichiers mov côté macOS).
 */

const file = (name: string, size: number, type: string) => ({ name, size, type });

describe("avertissementDecodage", () => {
  it("se tait quand l'image est décodée", () => {
    expect(avertissementDecodage({ width: 1080, height: 1920 })).toBeNull();
  });

  it("nomme le 0×0 d'un HEVC que Chromium ne décode pas", () => {
    const avis = avertissementDecodage({ width: 0, height: 0 });
    expect(avis).toContain("non décodée");
    expect(avis).toContain("H.264");
  });

  it("signale aussi la hauteur seule manquante", () => {
    expect(avertissementDecodage({ width: 1080, height: 0 })).not.toBeNull();
  });
});

describe("validateVideoFile", () => {
  it("accepte une vidéo avec ou sans type déclaré", () => {
    expect(validateVideoFile(file("plan.mp4", 1024, "video/mp4"))).toBeNull();
    expect(validateVideoFile(file("plan.mov", 1024, ""))).toBeNull();
    expect(validateVideoFile(file("plan.webm", 1024, "application/octet-stream"))).toBeNull();
  });

  it("refuse ce qui n'est pas une vidéo", () => {
    expect(validateVideoFile(file("budget.xlsx", 1024, "application/vnd.ms-excel"))).toMatch(
      /vidéo/i,
    );
  });

  it("refuse un fichier vide avec une explication actionnable", () => {
    expect(validateVideoFile(file("plan.mp4", 0, "video/mp4"))).toMatch(/vide ou illisible/);
  });

  it("refuse au-delà de la limite, avec la limite dans le message", () => {
    const message = validateVideoFile(file("gros.mp4", MAX_VIDEO_BYTES + 1, "video/mp4"));
    expect(message).toMatch(/trop lourd/i);
    expect(message).toMatch(/60 Mo/);
  });
});
