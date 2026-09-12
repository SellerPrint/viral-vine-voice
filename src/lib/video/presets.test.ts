import { describe, expect, it } from "vitest";

import {
  ancreLegende,
  boiteDeTexte,
  cadreCouvrant,
  couleurCss,
  plaqueDeBandeau,
  SUBTITLE_PRESETS,
  type MaskZone,
} from "./presets";

/**
 * Le cadre couvrant et l'ancre qu'il impose.
 *
 * Ces deux règles décident de ce que « déplacer la bande de sous-titres » veut
 * dire — à l'écran comme au rendu. Elles vivaient recopiées dans les trois
 * pipelines, assez pour que l'aperçu chante une autre Partition.
 */

const zone = (surcharges: Partial<MaskZone>): MaskZone => ({
  id: "bottom",
  label: "bas",
  x: 0,
  y: 0.8,
  w: 1,
  h: 0.2,
  enabled: true,
  ...surcharges,
});

describe("cadreCouvrant", () => {
  it("retient le premier des deux bandeaux, dans l'ordre des zones", () => {
    // Le moteur fait un `find` sur la liste : c'est l'ordre qui tranche, pas un
    // privilège du bas. L'aperçu doit rendre le même arbitrage, sinon les deux
    // cadres activeux s'attribuent l'ancre chacun de leur côté.
    const haut = zone({ id: "top", y: 0.05 });
    expect(cadreCouvrant([zone({}), haut])?.id).toBe("bottom");
    expect(cadreCouvrant([haut, zone({})])?.id).toBe("top");
    expect(cadreCouvrant([haut])?.id).toBe("top");
  });

  it("ignore un cadre désactivé et les zones qui ne couvrent rien", () => {
    expect(cadreCouvrant([zone({ enabled: false })])).toBeUndefined();
    expect(cadreCouvrant([zone({ id: "logo", label: "logo" })])).toBeUndefined();
  });
});

describe("ancreLegende", () => {
  it("suit le centre du cadre couvrant", () => {
    expect(ancreLegende([zone({ y: 0.8, h: 0.2 })], 0.5)).toBeCloseTo(0.9, 6);
    // Étirer la hauteur du bandeau descend donc la légende : c'est le geste que
    // la scène promettait sans le tenir — jusqu'à la borne, et pas au-delà.
    expect(ancreLegende([zone({ y: 0.8, h: 0.24 })], 0.5)).toBeCloseTo(0.92, 6);
    expect(ancreLegende([zone({ y: 0.8, h: 0.4 })], 0.5)).toBe(0.94);
  });

  it("ne laisse jamais la ligne sortir de l'image", () => {
    // Le `drawtext` du moteur borne à 0,06…0,94 ; l'aperçu doit buter au même
    // endroit, sinon il montrerait une ligne que le rendu ne produit pas.
    expect(ancreLegende([zone({ y: 0.95, h: 0.2 })], 0.5)).toBe(0.94);
    expect(ancreLegende([zone({ y: -0.2, h: 0.2 })], 0.5)).toBe(0.06);
  });

  it("retombe sur le réglage du style quand aucun cadre ne couvre", () => {
    expect(ancreLegende([zone({ enabled: false })], 0.42)).toBe(0.42);
    expect(ancreLegende([], 0.42)).toBe(0.42);
  });
});

describe("boiteDeTexte", () => {
  const avecFond = SUBTITLE_PRESETS.find((p) => p.useBox)!;

  it("garde la couleur du préréglage et la marge de `boxborderw`", () => {
    const boite = boiteDeTexte(avecFond)!;
    expect(boite.couleur).toBe(avecFond.boxColor.replace(/@[\d.]+$/, ""));
    expect(boite.bordure).toBe(Math.max(avecFond.boxBorderW, 16));
    expect(boite.opacite).toBe(Math.min(1, avecFond.boxOpacity ?? 0.95));
  });

  it("s'éteint sous 1 % d'opacité", () => {
    expect(boiteDeTexte({ ...avecFond, boxOpacity: 0.005 })).toBeNull();
  });

  it("un réglage explicite réveille un préréglage sans fond", () => {
    // Sans cette échappe, le curseur « Opacité du fond » ne commandait rien sur
    // le style par défaut, qui déclare `useBox: false` — on voyait son effet
    // dans l'aperçu et jamais dans le fichier.
    const sobre = SUBTITLE_PRESETS.find((p) => p.useBox === false)!;
    expect(boiteDeTexte(sobre)).toBeNull();
    expect(boiteDeTexte({ ...sobre, boxOpacity: 0.4 })?.opacite).toBe(0.4);
  });
});

describe("couleurCss", () => {
  it("convertit une couleur FFmpeg en rgba", () => {
    expect(couleurCss("black@0.55")).toBe("rgba(0,0,0,0.55)");
    expect(couleurCss("#FF0050")).toBe("rgba(255,0,80,1)");
    expect(couleurCss("#0f8", 0.5)).toBe("rgba(0,255,136,0.5)");
  });

  it("ignore une valeur qu'il ne peut pas rendre, plutôt que d'inventer", () => {
    expect(couleurCss("peinture-murale@0.5")).toBeNull();
    expect(couleurCss("#GG0050")).toBeNull();
  });
});

describe("plaqueDeBandeau", () => {
  const preset = SUBTITLE_PRESETS.find((p) => p.useBox)!;

  it("reprend le rectangle du cadre couvrant et l'alpha de la plaque", () => {
    const plaque = plaqueDeBandeau([zone({ x: 0.05, y: 0.7, w: 0.9, h: 0.2 })], preset)!;
    expect(plaque).toMatchObject({ x: 0.05, y: 0.7, w: 0.9, h: 0.2 });
    expect(plaque.opacite).toBe(Math.min(1, preset.plateOpacity ?? 0.92));
    expect(plaque.couleur).toBe(preset.boxColor.replace(/@[\d.]+$/, ""));
  });

  it("ne peint rien quand aucun bandeau ne couvre", () => {
    expect(plaqueDeBandeau([zone({ enabled: false })], preset)).toBeNull();
    expect(plaqueDeBandeau([zone({ id: "logo-haut", label: "logo" })], preset)).toBeNull();
  });
});
