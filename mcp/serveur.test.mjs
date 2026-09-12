import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CONFIG_VERSION,
  CORPS,
  FILTRES,
  FORCES_MASQUE,
  LANGUES_CIBLES,
  LANGUES_SOURCE,
  MAX_LIGNES_MOTEUR,
  PRESETS_SOUS_TITRES,
  QUALITES,
  TRANSITIONS,
  UPSCALE,
} from "./regles.mjs";

import {
  ajouterBloc,
  couperAuRythme,
  depuisConfig,
  modifierBloc,
  nouveauProjet,
  reglerCadre,
  reglerOptions,
  reglerStyle,
  resumer,
  sortie,
  valider,
  versConfig,
  versDemandeRendu,
} from "./projet.mjs";

/**
 * Le serveur MCP, testé comme un client le verrait.
 *
 * Deux choses sont vérifiées ici, et les deux comptent.
 *
 * 1. **La parité des bornes.** `regles.mjs` est une copie assumée des
 *    constantes de l'application. Chaque comparaison échoue dès que l'une des
 *    deux listes bouge seule — c'est le seul rempart contre un outil qui
 *    promettrait un corps de 400 px à un moteur qui s'arrête à 170, ou un code
 *    de langue que l'import refuserait.
 *
 * 2. **La traversée du pont.** Toute configuration produite ici est passée dans
 *   `parseConfig` et `applyConfig`, les fonctions que l'atelier appelle sur le
 *    fichier importé. Un format que l'app aurait refusé en silence ferait
 *    échouer ce test, pas un export chez l'utilisateur.
 */

/* -------------------------------------------------------------------------- */
/* parite avec les constantes de l'application                                 */
/* -------------------------------------------------------------------------- */

describe("parité des règles avec l'application", () => {
  it("connaît les mêmes préréglages, dans le même ordre", async () => {
    const { SUBTITLE_PRESETS } = await import("@/lib/video/presets");
    expect(PRESETS_SOUS_TITRES).toEqual(SUBTITLE_PRESETS.map((p) => p.id));
  });

  it("reprennent les mêmes listes que les schémas d'options", async () => {
    const [{ TRANSITIONS: transitions }, { VIDEO_FILTERS, UPSCALE_MODES }] = await Promise.all([
      import("@/lib/video/transitions"),
      import("@/lib/video/filters"),
    ]);
    expect(TRANSITIONS).toEqual(transitions.map((x) => x.id));
    expect(FILTRES).toEqual(VIDEO_FILTERS.map((x) => x.id));
    expect(UPSCALE).toEqual(UPSCALE_MODES.map((x) => x.id));

    const { DEFAULT_RENDER_OPTIONS } = await import("@/lib/video/render-options");
    expect(FORCES_MASQUE).toContain(DEFAULT_RENDER_OPTIONS.maskStrength);
  });

  it("partage la version du format et le plafond de lignes du moteur", async () => {
    const config = await import("@/lib/config-io");
    const { MAX_CUES } = await import("@/lib/video/subtitles/cues");
    expect(CONFIG_VERSION).toBe(config.CONFIG_VERSION);
    expect(MAX_LIGNES_MOTEUR).toBe(MAX_CUES);
  });

  it("ne propose que les codes de langue que l'atelier sait lire", async () => {
    const [{ DEFAULT_SOURCE_LANGUAGE, SOURCE_LANGUAGES }, { TARGET_LANGUAGES }] = await Promise.all(
      [import("@/lib/languages"), import("@/lib/video/presets")],
    );
    expect(LANGUES_SOURCE).toEqual(SOURCE_LANGUAGES.map((l) => l.code));
    expect(LANGUES_CIBLES).toEqual(TARGET_LANGUAGES.map((l) => l.code));
    // le defaut du serveur doit exister cote app, sinon l'import rejette tout
    expect(LANGUES_SOURCE).toContain(DEFAULT_SOURCE_LANGUAGE.code);
    expect(LANGUES_CIBLES).toContain("fr");
  });

  it("borne le corps comme le schéma de l'app, aux deux extrémités", async () => {
    const { parseConfig } = await import("@/lib/config-io");
    const analyse = (fontsize) =>
      parseConfig(
        JSON.stringify({ app: "viraldub", version: CONFIG_VERSION, subtitle: { fontsize } }),
      ).ok;
    expect(analyse(CORPS.min)).toBe(true);
    expect(analyse(CORPS.max)).toBe(true);
    expect(analyse(CORPS.max + 1)).toBe(false);
    expect(analyse(CORPS.min - 1)).toBe(false);
  });

  it("ne promet ni débit ni cadence imposés, et reprend les qualités réelles", async () => {
    const { QUALITY_PRESETS } = await import("@/lib/editor/types");
    expect(QUALITES).toEqual(Object.keys(QUALITY_PRESETS));
    const rendu = versDemandeRendu(nouveauProjet({}));
    expect(rendu).not.toHaveProperty("bitrate");
    expect(rendu.options).not.toHaveProperty("fps");
  });
});

/* -------------------------------------------------------------------------- */
/* les operations                                                              */
/* -------------------------------------------------------------------------- */

const projetAnime = () => {
  let p = nouveauProjet({ nom: "vertical", duree: 24, largeur: 1080, hauteur: 1920 });
  for (const [debut, duree, texte] of [
    [0.4, 2.1, "ça, personne l'a vu venir"],
    [3.2, 1.8, "trois secondes et tout bascule"],
    [6, 2.4, "regarde la main, pas le visage"],
    [9.2, 2, "c'est là que ça fait mal"],
  ]) {
    p = ajouterBloc(p, { piste: "subs", debut, duree, texte }).projet;
  }
  return p;
};

describe("opérations de montage", () => {
  it("refuse un bloc qui déborde du plan, accepte celui qui le frôle", () => {
    const p = projetAnime();
    expect(() => ajouterBloc(p, { piste: "subs", debut: 23.5, duree: 2, texte: "x" })).toThrow(
      /deborde du plan/,
    );
    expect(ajouterBloc(p, { piste: "subs", debut: 21.9, duree: 2, texte: "x" }).bloc).toBeTruthy();
  });

  it("coupe au rythme sans décrocher les blocs de la source", () => {
    const avant = projetAnime();
    const { projet: apres, avis } = couperAuRythme(avant, { bpm: 120, gardee: 0.3 });
    const coupes = apres.coupes;
    expect(coupes.length).toBeGreaterThan(4);
    // triées et disjointes : deux coupes qui se chevauchent produiraient un
    // `concat` incohérent dans le graphe FFmpeg
    for (let i = 1; i < coupes.length; i += 1) {
      expect(coupes[i].start).toBeGreaterThanOrEqual(
        coupes[i - 1].start + coupes[i - 1].duree - 1e-6,
      );
    }
    // les blocs restent aux mêmes instants source : c'est `remap` qui les recolle
    expect(apres.blocs.map((b) => b.start)).toEqual(avant.blocs.map((b) => b.start));
    expect(avis).toMatch(/durée sortie/);
    expect(sortie(apres)).toBeCloseTo(24 - coupes.reduce((a, c) => a + c.duree, 0), 2);
  });

  it("signale le bloc que la coupe avale entièrement", () => {
    // à 60 BPM avec 0,2 s gardées, la première troue part de 1,9 s : un bloc posé
    // à 2 s y tombe pile dessus
    const p = ajouterBloc(nouveauProjet({ duree: 10 }), {
      piste: "subs",
      debut: 2,
      duree: 0.5,
      texte: "avalé",
    }).projet;
    const { avis } = couperAuRythme(p, { bpm: 60, gardee: 0.2, debut: 1.7, fin: 3 });
    expect(avis).toMatch(/touchent une coupe/);
  });

  it("refuse un rythme où rien ne tient, plutôt que de poser zéro coupe", () => {
    expect(() => couperAuRythme(projetAnime(), { bpm: 60, gardee: 4 })).toThrow(
      /garde moins qu.un temps/,
    );
  });

  it("borne un cadre hors image au lieu de le refuser, et le dit", () => {
    const { projet, tords } = reglerCadre(projetAnime(), {
      id: "bottom",
      x: -0.4,
      y: 0.6,
      w: 1.6,
      h: 0.2,
    });
    const bas = projet.cadres.find((c) => c.id === "bottom");
    expect(bas).toMatchObject({ x: 0, y: 0.6, w: 1, h: 0.2 });
    expect(tords).toEqual(["x -0.4→0", "w 1.6→1"]);
  });

  it("ne laisse jamais un cadre dépasser le bord qu'il touche", () => {
    const { projet } = reglerCadre(projetAnime(), { id: "tl", y: 0.9, h: 0.5 });
    const haut = projet.cadres.find((c) => c.id === "tl");
    expect(haut.h).toBe(0.5);
    expect(haut.y).toBe(0.5);
  });

  it("prévient quand un bandeau actif aspire l'ancrage de la légende", () => {
    // les cadres naissent desactivés, comme dans l'atelier : c'est l'acte de
    // les allumer qui crée l'aspiration
    const allume = reglerCadre(projetAnime(), { id: "bottom", actif: true }).projet;
    expect(projetAnime().cadres.every((c) => !c.actif)).toBe(true);
    const { avertissement } = reglerStyle(allume, { ancrage: 0.2 });
    expect(avertissement).toMatch(/centre la légende/);
    expect(avertissement).toContain("89");
    // et sans bandeau, l'ancrage se pose sans bruit
    const libre = reglerStyle({ ...projetAnime(), cadres: [] }, { ancrage: 0.2 });
    expect(libre.avertissement).toBeUndefined();
    expect(libre.projet.style.surcharges.yAnchor).toBe(0.2);
  });

  it("repasse la main au préréglage quand on change de style", () => {
    const surcharge = reglerStyle(projetAnime(), { corps: 96 }).projet;
    expect(surcharge.style.surcharges.fontsize).toBe(96);
    const apres = reglerStyle(surcharge, { preset: "capcut-minimal" }).projet;
    expect(apres.style.surcharges).toEqual({});
    expect(apres.style.preset).toBe("capcut-minimal");
  });

  it("refuse un preset, une langue ou un fournisseur inconnus", () => {
    expect(() => reglerStyle(projetAnime(), { preset: "énorme" })).toThrow(/choix :/);
    expect(() => reglerOptions(projetAnime(), { fournisseurVoix: "openai" })).toThrow(
      /fournisseurVoix/,
    );
    // « fr » en source se refusait ici : l'import, lui, aurait jeté tout le fichier
    expect(() => reglerOptions(projetAnime(), { langueSource: "fr" })).toThrow(/langueSource/);
    expect(reglerOptions(projetAnime(), { langueSource: "fra" }).langues.source).toBe("fra");
  });

  it("signale le montage vide, la sortie muette et la transition sans coupe", () => {
    const vide = nouveauProjet({ duree: 8 });
    expect(valider(vide).join("\n")).toMatch(/montage est vide/);
    const muet = reglerOptions(vide, { retirerSonOriginal: true, niveauAmbiance: 0 });
    expect(valider(muet).join("\n")).toMatch(/sortie sera muette/);
    const sansCoupe = reglerOptions(projetAnime(), { transition: "fade" });
    expect(valider(sansCoupe).join("\n")).toMatch(/sans aucune coupe/);
  });

  it("avertit au-delà du plafond de lignes que le moteur incruste", () => {
    let p = nouveauProjet({ duree: (MAX_LIGNES_MOTEUR + 8) * 0.5 });
    for (let i = 0; i < MAX_LIGNES_MOTEUR + 5; i += 1) {
      p = ajouterBloc(p, { piste: "subs", debut: i * 0.5, duree: 0.4, texte: `ligne ${i}` }).projet;
    }
    expect(valider(p).join("\n")).toMatch(/n'en incruste que/);
  });

  it("résume ce que l'humain verrait dans le plan", () => {
    const etat = resumer(projetAnime());
    expect(etat.plan).toBe("1080×1920 · 24 s · 30 i/s");
    expect(etat.pistes).toEqual([{ piste: "subs", blocs: 4 }]);
  });

  it("décale un bloc à la demande, et jamais tout seul", () => {
    const p = projetAnime();
    const apres = modifierBloc(p, { id: p.blocs[1].id, debut: 4.5 });
    expect(apres.blocs[1].start).toBe(4.5);
    expect(() => modifierBloc(p, { id: "qui-nexiste-pas", debut: 1 })).toThrow(/introuvable/);
  });
});

/* -------------------------------------------------------------------------- */
/* le pont avec l'atelier                                                      */
/* -------------------------------------------------------------------------- */

describe("le fichier produit passe dans l'atelier", () => {
  it("accepte la configuration d'un montage rythmé complet", async () => {
    const { parseConfig, applyConfig } = await import("@/lib/config-io");
    const { projet } = couperAuRythme(
      reglerStyle(projetAnime(), { corps: 74, majuscules: true, couleurFond: "black@0.6" }).projet,
      { bpm: 128 },
    );
    const cadre = reglerCadre(projet, { id: "bottom", y: 0.7, w: 1, h: 0.16 }).projet;
    const config = versConfig(cadre);
    const texte = JSON.stringify(config);
    const analyse = parseConfig(texte);
    expect(analyse.ok).toBe(true);
    if (!analyse.ok) throw new Error(texte);

    const courant = {
      presetId: "discret",
      sourceLanguage: "fra",
      targetLanguage: "fr",
      options: {},
      masks: [{ id: "bottom", label: "bas", x: 0, y: 0.9, w: 1, h: 0.05, enabled: true }],
      overrides: {},
    };
    const fusion = applyConfig(analyse.config, courant);
    expect(fusion.timeline?.clips).toHaveLength(4);
    expect(fusion.timeline?.cuts?.length).toBeGreaterThan(4);
    expect(fusion.overrides).toMatchObject({
      fontsize: 74,
      uppercase: true,
      boxColor: "black@0.6",
    });
    expect(fusion.masks.find((m) => m.id === "bottom")).toMatchObject({ y: 0.7, h: 0.16 });
    expect(fusion.presetId).toBe("capcut-pop");
    // un import ne doit jamais emporter l'identifiant de voix, même absent du
    // fichier : la cle reste celle de la session en cours
    expect(fusion.options.clonedVoiceId).toBeUndefined();
  });

  it("n'écrit que des clés que le schéma de l'app connaît", async () => {
    const { parseConfig } = await import("@/lib/config-io");
    const config = versConfig(reglerStyle(projetAnime(), { corps: 70 }).projet);
    expect(Object.keys(config).sort()).toEqual(
      [
        "app",
        "masks",
        "options",
        "presetId",
        "sourceLanguage",
        "subtitle",
        "targetLanguage",
        "timeline",
        "version",
      ].sort(),
    );
    expect(parseConfig(JSON.stringify({ ...config, genre: "clip" })).ok).toBe(false);
  });

  it("ne fait jamais voyager un identifiant de voix ni un secret", () => {
    const texte = JSON.stringify(versConfig(projetAnime()));
    expect(texte).not.toMatch(/voiceId|apiKey|token/i);
    const rendu = JSON.stringify(versDemandeRendu(projetAnime()));
    expect(rendu).not.toMatch(/clonedVoiceId|turnstile/i);
  });

  it("rend des options qui s'affectent au contrat de l'app", async () => {
    const { DEFAULT_RENDER_OPTIONS } = await import("@/lib/video/render-options");
    const rendu = versDemandeRendu(
      reglerOptions(projetAnime(), { transition: "fade", miroir: true }),
    );
    for (const cle of Object.keys(rendu.options)) {
      expect(DEFAULT_RENDER_OPTIONS).toHaveProperty(cle);
    }
    expect(rendu.options.mirror).toBe(true);
    expect(rendu.options.transition).toBe("fade");
    expect(rendu.moteur.masks.every((m) => typeof m.enabled === "boolean")).toBe(true);
    expect(rendu.encodage.qualite).toBe("standard");
  });

  it("reprend son propre fichier sans dérive", () => {
    const original = versConfig(projetAnime());
    expect(versConfig(depuisConfig(original))).toEqual(original);
  });

  it("étend la durée du plan à la reprise, si un bloc va plus loin", () => {
    const config = versConfig(projetAnime());
    config.timeline.clips.push({ track: "subs", start: 40, duration: 3, text: "loin" });
    const reprise = depuisConfig(config);
    expect(reprise.duree).toBeGreaterThanOrEqual(43);
    expect(reprise.blocs).toHaveLength(5);
  });
});

/* -------------------------------------------------------------------------- */
/* le fil du protocole                                                         */
/* -------------------------------------------------------------------------- */

const CHEMIN_SERVEUR = fileURLToPath(new URL("./serveur.mjs", import.meta.url));

function branche() {
  const fils = spawn(process.execPath, [CHEMIN_SERVEUR], { stdio: ["pipe", "pipe", "inherit"] });
  let tampon = "";
  const enAttente = new Map();

  fils.stdout.on("data", (morceau) => {
    tampon += morceau.toString();
    let saut;
    while ((saut = tampon.indexOf("\n")) >= 0) {
      const ligne = tampon.slice(0, saut).trim();
      tampon = tampon.slice(saut + 1);
      if (!ligne) continue;
      const message = JSON.parse(ligne);
      const attente = enAttente.get(message.id);
      if (attente) {
        enAttente.delete(message.id);
        attente(message);
      }
    }
  });

  let sequence = 0;
  const envoyer = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const minuterie = setTimeout(() => {
        if (enAttente.has(id)) {
          enAttente.delete(id);
          reject(new Error(`aucune réponse à « ${method} » en 4 s`));
        }
      }, 4000);
      enAttente.set(id, (message) => {
        clearTimeout(minuterie);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      });
      fils.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });

  return {
    envoyer,
    outil: async (name, args = {}) => {
      const reponse = await envoyer("tools/call", { name, arguments: args });
      return {
        ...reponse,
        donnees: reponse.content?.[0] ? JSON.parse(reponse.content[0].text) : null,
      };
    },
    fermer: () => fils.kill(),
  };
}

describe("le fil MCP", () => {
  it("se présente, liste ses outils, et répond à un appel", async () => {
    const client = branche();
    try {
      const infos = await client.envoyer("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "vitest" },
      });
      expect(infos.protocolVersion).toBe("2025-06-18");
      expect(infos.serverInfo.name).toBe("viraldub-monteur");
      expect(infos.instructions).toMatch(/valider/);

      const { tools } = await client.envoyer("tools/list", {});
      expect(tools.length).toBeGreaterThanOrEqual(17);
      expect(tools.map((t) => t.name)).toContain("montage_energetique");
      for (const outil of tools) {
        expect(outil.description.length).toBeGreaterThan(24);
        expect(outil.inputSchema.type).toBe("object");
        expect(outil).not.toHaveProperty("run");
      }

      await client.envoyer("tools/call", {
        name: "nouveau_projet",
        arguments: { duree: 12 },
      });
      const appel = await client.outil("ajouter_bloc", {
        piste: "subs",
        debut: 1,
        duree: 2,
        texte: "salut",
      });
      expect(appel.isError).toBe(false);
      expect(appel.donnees.id).toMatch(/^subs-/);

      const rythme = await client.outil("montage_energetique", { bpm: 140, intensite: "hache" });
      expect(rythme.isError).toBe(false);
      expect(rythme.donnees.etat.coupes).toBeGreaterThan(2);
    } finally {
      client.fermer();
    }
  });

  it("accepte une version de protocole inconnue en renvoyant la sienne", async () => {
    const client = branche();
    try {
      const infos = await client.envoyer("initialize", { protocolVersion: "1999-01-01" });
      expect(infos.protocolVersion).toBe("2024-11-05");
    } finally {
      client.fermer();
    }
  });

  it("refuse une écriture hors du dossier, en isError et sans toucher au disque", async () => {
    const client = branche();
    try {
      await client.outil("nouveau_projet", { duree: 6 });
      const appel = await client.outil("exporter_config", { chemin: "../../echappe-mcp.json" });
      expect(appel.isError).toBe(true);
      expect(appel.donnees.refus).toMatch(/hors du dossier/);
      const { existsSync } = await import("node:fs");
      expect(existsSync(fileURLToPath(new URL("../../echappe-mcp.json", import.meta.url)))).toBe(
        false,
      );
    } finally {
      client.fermer();
    }
  });

  it("garde l'état entre deux appels et répond au ping", async () => {
    const client = branche();
    try {
      expect(await client.envoyer("ping", {})).toEqual({});
      await client.outil("nouveau_projet", { nom: "session", duree: 30 });
      await client.outil("ajouter_bloc", {
        piste: "dub",
        debut: 0.5,
        duree: 1.2,
        locution: "une phrase",
      });
      const etat = await client.outil("etat");
      expect(etat.donnees.etat.nom).toBe("session");
      expect(etat.donnees.etat.pistes).toContainEqual({ piste: "dub", blocs: 1 });
    } finally {
      client.fermer();
    }
  });

  it("lit une configuration exportée par l'atelier et continue le montage", async () => {
    const client = branche();
    try {
      const config = versConfig(couperAuRythme(projetAnime(), { bpm: 100 }).projet);
      const repris = await client.outil("importer_config", { config: JSON.stringify(config) });
      expect(repris.isError).toBe(false);
      expect(repris.donnees.etat.coupes).toBeGreaterThan(2);
      const apres = await client.outil("ajouter_bloc", {
        piste: "subs",
        debut: 0,
        duree: 1,
        texte: "rajout",
      });
      expect(apres.isError).toBe(false);
      const cible = "mcp/.sortie-test.json"; // relatif au cwd du serveur, la racine du depot
      const ecrit = await client.outil("exporter_config", { chemin: cible });
      expect(ecrit.donnees.avis).toMatch(/sortie-test.json/);
      // le fichier doit etre relisible par l'app, tel quel
      const { parseConfig } = await import("@/lib/config-io");
      const { readFileSync, rmSync } = await import("node:fs");
      const lu = readFileSync(fileURLToPath(new URL(`../${cible}`, import.meta.url)), "utf8");
      expect(parseConfig(lu).ok).toBe(true);
      rmSync(fileURLToPath(new URL(`../${cible}`, import.meta.url)));
    } finally {
      client.fermer();
    }
  });

  it("répond une erreur JSON-RPC lisible sur une méthode qu'il ne connaît pas", async () => {
    const client = branche();
    try {
      await expect(client.envoyer("prompts/list", {})).rejects.toThrow(/non prise en charge/);
    } finally {
      client.fermer();
    }
  });
});

describe("les clés que les outils acceptent", () => {
  it("reconnaît les noms du fichier de configuration, en alias", () => {
    // Un modèle lit `wordByWord` et `fontsize` dans le fichier exporté par
    // l'atelier : il les renverra tels quels. La passerelle est là pour ça.
    const base = nouveauProjet({ duree: 12 });
    const style = reglerStyle(base, { fontsize: 90, uppercase: true, boxOpacity: 0.4 });
    expect(style.projet.style.surcharges).toMatchObject({ fontsize: 90, uppercase: true });
    expect(style.projet.options.opaciteFond).toBeCloseTo(0.4, 2);
    const cadre = reglerCadre(base, { id: "bottom", largeur: 1, hauteur: 0.16 });
    expect(cadre.projet.cadres.find((c) => c.id === "bottom")).toMatchObject({ w: 1, h: 0.16 });
    const options = reglerOptions(base, { wordByWord: true, maskStrength: "strong" });
    expect(options.options).toMatchObject({ motParMot: true, forceMasque: "strong" });
  });

  it("nomme la clé inventée au lieu de l'ignorer", () => {
    // Une clé ignorée en silence, c'est un réglage que le modèle croit passé et
    // que l'export ne montre jamais — la classe même de plainte que l'atelier a
    // entendue côté souris.
    const base = nouveauProjet({ duree: 12 });
    expect(() => reglerStyle(base, { taillePolice: 80 })).toThrow(/« taillePolice » inconnue/);
    expect(() => reglerStyle(base, { taillePolice: 80 })).toThrow(/acceptees : preset, corps/);
    expect(() => reglerOptions(base, { bitrate: 8000 })).toThrow(/« bitrate » inconnue/);
    expect(() => reglerCadre(base, { id: "bottom", volume: 0.5 })).toThrow(/« volume » inconnue/);
  });

  it("le serveur rend la clé inconnue lisible, sans casser la session", async () => {
    const client = branche();
    try {
      await client.outil("nouveau_projet", { duree: 12 });
      const appel = await client.outil("regler_cadres", {
        cadres: [{ id: "bottom", volume: 0.5 }],
      });
      expect(appel.isError).toBe(true);
      expect(appel.donnees.refus).toMatch(/« volume » inconnue/);
      // la session tient : l'outil suivant passe, et le cadre n'a pas bougé
      const suite = await client.outil("etat", {});
      expect(suite.isError).toBe(false);
      const bas = suite.donnees.etat.cadres.find((c) => c.id === "bottom");
      expect(bas.w).toBeGreaterThan(0);
    } finally {
      client.fermer();
    }
  });
});
