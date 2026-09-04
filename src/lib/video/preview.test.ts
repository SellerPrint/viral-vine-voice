import { describe, expect, it } from "vitest";

import { buildBlurChain, type Rect } from "./ffmpeg/graph";
import { buildPreviewArgs } from "./preview";

const rect = (over: Partial<Rect> = {}): Rect => ({ x: 0, y: 1050, w: 720, h: 180, ...over });

describe("buildBlurChain", () => {
  it("n'assombrit pas la zone en intensité faible ou moyenne", () => {
    // C'est le cœur du probleme signale : l'ancien traitement plaquait un
    // rectangle noir a 55 % qui detruisait la scene bien au-dela du texte.
    expect(buildBlurChain("light", rect())).not.toContain("drawbox");
    expect(buildBlurChain("medium", rect())).not.toContain("drawbox");
  });

  it("ajoute une plaque légère en intensité forte", () => {
    const chain = buildBlurChain("strong", rect());
    expect(chain).toContain("drawbox");
    // Nettement plus doux que l'ancien 0.55.
    expect(chain).toContain("black@0.35");
  });

  it("intensifie le flou du plus faible au plus fort", () => {
    const radius = (s: Parameters<typeof buildBlurChain>[0]) =>
      Number(/boxblur=(\d+)/.exec(buildBlurChain(s, rect()))?.[1]);

    expect(radius("light")).toBeLessThan(radius("medium"));
    expect(radius("medium")).toBeLessThan(radius("strong"));
  });

  it("proportionne le rayon à la taille de la zone", () => {
    // Un rayon fixe est le defaut de conception d'origine : `boxblur=40` reduit
    // un petit bandeau en bouillie et se voit a peine sur une zone 4K.
    const radius = (w: number, h: number) =>
      Number(/boxblur=(\d+)/.exec(buildBlurChain("medium", rect({ w, h })))?.[1]);

    expect(radius(200, 60)).toBeLessThan(radius(720, 180));
    expect(radius(720, 180)).toBeLessThan(radius(2160, 800));

    // Verrouille la proportionnalite elle-meme : un rayon constant borne par
    // la zone satisferait les inegalites ci-dessus sans etre proportionnel.
    expect(radius(200, 60)).toBe(Math.round(60 * 0.08));
    expect(radius(2160, 800)).toBe(Math.round(800 * 0.08));
  });

  it("garde un rayon valide sur une zone minuscule", () => {
    // `boxblur` refuse un rayon superieur a la moitie de la dimension : un
    // depassement fait echouer tout le rendu, pas seulement le masque.
    for (const size of [16, 20, 32]) {
      const chain = buildBlurChain("strong", rect({ w: size, h: size }));
      const radius = Number(/boxblur=(\d+)/.exec(chain)?.[1]);

      expect(radius).toBeGreaterThanOrEqual(1);
      expect(radius).toBeLessThanOrEqual(Math.floor(size / 2) - 1);
    }
  });
});

describe("buildPreviewArgs", () => {
  it("utilise un simple -vf quand aucune zone n'est floutée", () => {
    const args = buildPreviewArgs([], ["eq=contrast=1.1"], "eq=contrast=1.1", "medium");
    expect(args).toEqual(["-vf", "eq=contrast=1.1"]);
  });

  it("ne produit aucun argument sans filtre ni masque", () => {
    expect(buildPreviewArgs([], [], "", "medium")).toEqual([]);
  });

  it("bascule en -filter_complex dès qu'une zone est floutée", () => {
    // `crop` + `overlay` sont impossibles dans un `-vf` lineaire.
    const args = buildPreviewArgs([rect()], [], "", "medium");
    expect(args[0]).toBe("-filter_complex");
    expect(args).toContain("-map");
    expect(args).toContain("[vout]");
  });

  it("floute la zone puis la réincruste à sa position exacte", () => {
    const graph = buildPreviewArgs([rect()], [], "", "medium")[1];
    expect(graph).toContain("crop=720:180:0:1050");
    expect(graph).toContain("overlay=0:1050");
  });

  it("applique le texte APRÈS les masques", () => {
    // Sinon l'apercu flouterait le sous-titre que l'application vient
    // d'incruster — l'inverse du but recherche.
    const graph = buildPreviewArgs([rect()], ["drawtext=text='x'"], "", "medium")[1];
    expect(graph.indexOf("overlay=")).toBeLessThan(graph.indexOf("drawtext"));
  });

  it("applique le filtre couleur AVANT les masques", () => {
    const graph = buildPreviewArgs([rect()], ["eq=contrast=1.1"], "eq=contrast=1.1", "medium")[1];
    // Le look est dans la branche source, donc avant le split.
    expect(graph.indexOf("eq=contrast")).toBeLessThan(graph.indexOf("split="));
  });

  it("relie [masked] à [vout] même sans filtre de texte", () => {
    // Un graphe dont la sortie n'est pas reliee fait echouer ffmpeg.
    const graph = buildPreviewArgs([rect()], [], "", "medium")[1];
    expect(graph).toContain("[masked]null[vout]");
  });

  it("chaîne correctement plusieurs zones", () => {
    const zones = [rect(), rect({ y: 0, h: 100 }), rect({ x: 500, w: 200 })];
    const graph = buildPreviewArgs(zones, [], "", "medium")[1];

    // Une sortie par zone, plus la base.
    expect(graph).toContain("split=4[base][z0][z1][z2]");
    // Les overlays se chainent, le dernier produit [masked].
    expect(graph).toContain("[base][b0]overlay");
    expect(graph).toContain("[o0][b1]overlay");
    expect(graph).toContain("[o1][b2]overlay=500:1050[masked]");
  });

  it("respecte l'intensité demandée", () => {
    const fort = buildPreviewArgs([rect()], [], "", "strong")[1];
    const doux = buildPreviewArgs([rect()], [], "", "light")[1];

    expect(fort).toContain("drawbox");
    expect(doux).not.toContain("drawbox");
  });

  it("reproduit exactement la chaîne de floutage du rendu final", () => {
    // L'apercu ne vaut que s'il est fidele : toute divergence entre les deux
    // chaines redonnerait un apercu mensonger.
    const zone = rect();
    const graph = buildPreviewArgs([zone], [], "", "medium")[1];
    expect(graph).toContain(buildBlurChain("medium", zone));
  });
});
