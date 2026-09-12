#!/usr/bin/env node
/**
 * Serveur MCP de l'Atelier ViralDub — `node mcp/serveur.mjs`.
 *
 * ## Ce que c'est
 *
 * Un modèle (Claude, Cursor, tout client MCP) piloter le montage par ce canal :
 * il pose des blocs sur les trois pistes, coupe au rythme, règle les cadres de
 * masquage, le style de légende et les options de sortie, puis écrit un fichier
 * que l'atelier importe (Réglages → Importer un fichier de configuration).
 *
 * ## Ce que ce n'est pas
 *
 * Ni un rendu, ni un accès au plan vidéo. Le serveur ne voit que des nombres et
 * du texte : le média reste sur le disque de l'utilisateur, l'export se déclenche
 * dans l'atelier. Aucun secret ne passe ici — `clonedVoiceId`, les clés API et le
 * jeton Turnstile ne sont ni lus ni écrits, exactement comme dans le format de
 * configuration que l'application valide elle-même.
 *
 * ## Le fil du protocole
 *
 * JSON-RPC 2.0, une ligne par message, sur stdin/stdout — ni dépendance, ni
 * build. Les méthodes traitées : `initialize`, `notifications/*`, `ping`,
 * `tools/list`, `tools/call`. Le reste répond `-32601`, et une erreur de
 * programmation interne ne ferme pas le fil : elle revient en `isError`.
 *
 * ## Drift
 *
 * Les bornes vivent dans `regles.mjs`, copie assumée de celles de l'app.
 * `mcp/serveur.test.mjs` les compare aux constantes réelles et passe toute
 * configuration produite ici dans `parseConfig` : un écart fait rougir un test,
 * pas un montage raté chez l'utilisateur.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAbsolute, relative, resolve } from "node:path";

import {
  ajouterBloc,
  ajouterCadre,
  ajouterCoupe,
  couperAuRythme,
  depuisConfig,
  modifierBloc,
  nouveauProjet,
  reglerCadre,
  reglerOptions,
  reglerStyle,
  resumer,
  supprimerBloc,
  supprimerCoupe,
  valider,
  versConfig,
  versDemandeRendu,
  viderPistes,
} from "./projet.mjs";
import {
  CADRES_PAR_DEFAUT,
  CORPS,
  LANGUES_CIBLES,
  LANGUES_SOURCE,
  QUALITES,
  FILTRES,
  FORCES_MASQUE,
  FOURNISSEURS_VOIX,
  LIGNES,
  OPACITE,
  PISTES,
  PRESETS_SOUS_TITRES,
  TRANSITIONS,
  UPSCALE,
} from "./regles.mjs";

/**
 * Les versions de protocole que ce serveur sait tenir. Un client qui en demande
 * une autre recoit la notre : faire semblant de parler une langue qu'on
 * n'implemente pas produit un client qui se branche et ne comprend rien.
 */
export const VERSIONS_PROTOCOLE = ["2024-11-05", "2025-03-26", "2025-06-18"];
export const NOM_SERVEUR = "viraldub-monteur";
export const VERSION = "0.1.0";

/* -------------------------------------------------------------------------- */
/* les outils                                                                  */
/* -------------------------------------------------------------------------- */

const objet = (proprietes, requis = []) => ({
  type: "object",
  properties: proprietes,
  ...(requis.length ? { required: requis } : {}),
  additionalProperties: false,
});

const nombre = (description, extra = {}) => ({ type: "number", description, ...extra });
const chaine = (description, extra = {}) => ({ type: "string", description, ...extra });
const booleen = (description) => ({ type: "boolean", description });
const liste = (description, items) => ({ type: "array", description, items });

/**
 * Les recettes de tempo, bornées : le serveur ne promet que ce que le moteur
 * rend. `gardee` est une fraction d'un temps, pas une durée absolue, pour que
 * 174 BPM et 82 BPM donnent le même caractère.
 */
const RECETTES = {
  doux: {
    gardee: 0.75,
    transition: "fade",
    dureeTransition: 0.35,
    motParMot: false,
    preset: "capcut-classic",
  },
  nerveux: {
    gardee: 0.58,
    transition: "fade",
    dureeTransition: 0.18,
    motParMot: true,
    preset: "capcut-pop",
  },
  hache: {
    gardee: 0.38,
    transition: "dissolve",
    dureeTransition: 0.1,
    motParMot: true,
    preset: "capcut-highlight",
  },
};

export const OUTILS = [
  {
    name: "etat",
    description:
      "Résumé du montage en cours : plan, durée de sortie après coupes, blocs par piste, cadres, style, avertissements. À appeler entre deux séries de gestes.",
    inputSchema: objet({}),
    run: (projet) => ({ projet, etat: resumer(projet) }),
  },
  {
    name: "valider",
    description:
      "Liste les problèmes du montage (blocs qui se recouvrent, segment hors du plan, transition sans coupe, sortie muette…) sans rien modifier.",
    inputSchema: objet({}),
    run: (projet) => ({
      projet,
      etat: { problemes: valider(projet), dureeSortie: resumer(projet).dureeSortie },
    }),
  },
  {
    name: "nouveau_projet",
    description:
      "Repart d'une feuille vide. `duree` est la durée du plan tel qu'il sera importé dans l'atelier : tous les blocs doivent tenir dedans.",
    inputSchema: objet({
      nom: chaine("Nom du montage", { maxLength: 80 }),
      duree: nombre("Durée du plan en secondes", { minimum: 0.5, maximum: 3600 }),
      largeur: nombre("Largeur du plan", { minimum: 16, maximum: 4096 }),
      hauteur: nombre("Hauteur du plan", { minimum: 16, maximum: 4096 }),
      fps: nombre("Images par seconde", { minimum: 12, maximum: 60 }),
    }),
    run: (projet, entrees) => {
      const suivant = nouveauProjet(entrees);
      return {
        projet: suivant,
        avis: `nouveau plan « ${suivant.nom} » : ${suivant.largeur}×${suivant.hauteur}, ${suivant.duree} s à ${suivant.cadence} i/s — les blocs de l'ancien montage sont perdus`,
      };
    },
  },
  {
    name: "ajouter_bloc",
    description:
      "Pose un bloc sur une piste. `subs` = texte incrusté (le seul dont la légende dépend), `dub` = réplique doublée, `video` = segment visuel. Temps en secondes depuis le début du plan.",
    inputSchema: objet(
      {
        piste: { type: "string", enum: PISTES, description: "Piste cible" },
        debut: nombre("Début en secondes", { minimum: 0 }),
        duree: nombre("Durée en secondes", { minimum: 0.12 }),
        texte: chaine("Texte du sous-titre (piste subs)", { maxLength: 300 }),
        locution: chaine("Phrase à doubler (piste dub)", { maxLength: 300 }),
        locuteur: chaine("Identifiant de voix (piste dub)", { maxLength: 64 }),
        label: chaine("Étiquette affichée dans le plan", { maxLength: 120 }),
      },
      ["piste", "debut", "duree"],
    ),
    run: (projet, entrees) => {
      // `ajouterBloc` rend le bloc qu'il vient de creer : pas besoin de le
      // retrouver par difference d'ensembles, qui raterait des deux blocs
      // identiques.
      const { projet: suivant, bloc } = ajouterBloc(projet, entrees);
      return {
        projet: suivant,
        avis: `bloc ${bloc.id} sur ${bloc.track} : ${bloc.start} s → ${Math.round((bloc.start + bloc.duree) * 100) / 100} s`,
        id: bloc.id,
      };
    },
  },
  {
    name: "modifier_bloc",
    description: "Déplace, allonge ou raccourcit un bloc existant ; `id` vient de `etat`.",
    inputSchema: objet({
      id: chaine("Identifiant du bloc", { maxLength: 64 }),
      debut: nombre("Nouveau début", { minimum: 0 }),
      duree: nombre("Nouvelle durée", { minimum: 0.12 }),
      texte: chaine("Nouveau texte", { maxLength: 300 }),
      label: chaine("Nouvelle étiquette", { maxLength: 120 }),
    }),
    run: (projet, entrees) => ({
      projet: modifierBloc(projet, entrees),
      avis: `bloc ${entrees.id} ajusté`,
    }),
  },
  {
    name: "supprimer_bloc",
    description: "Retire un bloc de la piste.",
    inputSchema: objet({ id: chaine("Identifiant du bloc", { maxLength: 64 }) }, ["id"]),
    run: (projet, entrees) => ({
      projet: supprimerBloc(projet, entrees.id),
      avis: `bloc ${entrees.id} retiré`,
    }),
  },
  {
    name: "vider_pistes",
    description:
      "Retire tous les blocs des pistes données (`subs`, `dub`, `video`). Utile avant de recomposer un montage depuis zéro.",
    inputSchema: objet({
      pistes: liste("Pistes à vider", { type: "string", enum: PISTES }),
    }),
    run: (projet, entrees) => {
      const suivant = viderPistes(projet, entrees.pistes ?? ["subs", "dub"]);
      return {
        projet: suivant,
        avis: `${projet.blocs.length - suivant.blocs.length} bloc(s) retiré(s) de ${(entrees.pistes ?? ["subs", "dub"]).join(", ")}`,
      };
    },
  },
  {
    name: "ajouter_coupe",
    description:
      "Coupe une plage : à l'export, `duration` secondes sont retirées de la source à partir de `debut`. C'est le seul geste de montage visuel que le moteur applique vraiment.",
    inputSchema: objet({
      debut: nombre("Début de la coupe", { minimum: 0 }),
      duree: nombre("Ce qui saute, en secondes", { minimum: 0.12, maximum: 600 }),
    }),
    run: (projet, entrees) => {
      const suivant = ajouterCoupe(projet, entrees);
      const total = resumer(suivant).dureeSortie;
      return {
        projet: suivant,
        avis: `coupe de ${entrees.duree} s à ${entrees.debut} s · sortie ${total} s`,
      };
    },
  },
  {
    name: "supprimer_coupe",
    description: "Annule une coupe posée par erreur.",
    inputSchema: objet({ id: chaine("Identifiant de la coupe", { maxLength: 64 }) }, ["id"]),
    run: (projet, entrees) => ({
      projet: supprimerCoupe(projet, entrees.id),
      avis: `coupe ${entrees.id} annulée`,
    }),
  },
  {
    name: "couper_au_rythme",
    description:
      "Montage rythmique : autour de chaque temps de `bpm`, on garde `gardee` secondes d'image et on coupe le reste. Les blocs de texte sont resynchronisés. C'est ce qui fait un montage qui avance, plutôt qu'un plan fixe.",
    inputSchema: objet({
      bpm: nombre("Tempo", { minimum: 60, maximum: 200 }),
      gardee: nombre("Ce qui reste visible autour de chaque temps", { minimum: 0.2, maximum: 4 }),
      decalage: nombre("Décalage du premier temps, en secondes (un creux avant le beat)", {
        minimum: -4,
        maximum: 4,
      }),
      debut: nombre("Début de la plage rythmée", { minimum: 0 }),
      fin: nombre("Fin de la plage rythmée (défaut : fin du plan)", { minimum: 0 }),
    }),
    run: (projet, entrees) => {
      const { projet: suivant, avis } = couperAuRythme(projet, entrees);
      return { projet: suivant, avis, etat: resumer(suivant) };
    },
  },
  {
    name: "regler_cadres",
    description:
      "Cadres de masquage, en fractions d'image : `x`, `y` = coin haut-gauche, `w`, `h` = taille. Une plaque couvrante recouvre les sous-titres d'origine ET, si elle touche le bas ou le haut, elle aspire la légende à son centre — c'est la règle partagée du moteur. Les bords plaqués sur le cadre ne bougent pas davantage qu'à la souris.",
    inputSchema: objet({
      cadres: liste(
        "Un réglage par cadre existant",
        objet(
          {
            id: chaine("Identifiant du cadre (`bottom`, `top`, `tl`, `tr`…)", { maxLength: 40 }),
            x: nombre("Bord gauche, 0 à 1", { minimum: 0, maximum: 1 }),
            y: nombre("Bord haut, 0 à 1", { minimum: 0, maximum: 1 }),
            w: nombre("Largeur, 0 à 1", { minimum: 0.03, maximum: 1 }),
            h: nombre("Hauteur, 0 à 1", { minimum: 0.03, maximum: 1 }),
            actif: booleen("false = cadre désactivé"),
          },
          ["id"],
        ),
      ),
      ajouter: liste(
        "Nouveaux cadres à créer",
        objet({
          id: chaine("Identifiant optionnel", { maxLength: 40 }),
          label: chaine("Nom lisible", { maxLength: 60 }),
          x: nombre("Bord gauche, 0 à 1", { minimum: 0, maximum: 1 }),
          y: nombre("Bord haut, 0 à 1", { minimum: 0, maximum: 1 }),
          w: nombre("Largeur", { minimum: 0.03, maximum: 1 }),
          h: nombre("Hauteur", { minimum: 0.03, maximum: 1 }),
        }),
      ),
    }),
    run: (projet, entrees) => {
      let suivant = projet;
      const lignes = [];
      const tords = [];
      for (const reglage of entrees.cadres ?? []) {
        const regle = reglerCadre(suivant, reglage);
        suivant = regle.projet;
        tords.push(...regle.tords.map((t) => `${reglage.id} : ${t}`));
        const cadre = suivant.cadres.find((c) => c.id === reglage.id);
        lignes.push(
          `${reglage.id} → ${Math.round(cadre.x * 100)}%, ${Math.round(cadre.y * 100)}% · ${Math.round(cadre.w * 100)}×${Math.round(cadre.h * 100)} %${cadre.actif ? "" : " (inactif)"}`,
        );
      }
      for (const nouveau of entrees.ajouter ?? []) {
        suivant = ajouterCadre(suivant, nouveau);
        lignes.push(`cadre ${nouveau.label ?? nouveau.id ?? "ajouté"} créé`);
      }
      if (!lignes.length) throw new RangeError("rien à régler : donne `cadres` ou `ajouter`");
      return {
        projet: suivant,
        avis: lignes.join(" · "),
        ...(tords.length
          ? { bornes: `${tords.join(" · ")} — ramené dans l'image, comme le geste à la souris` }
          : {}),
      };
    },
  },
  {
    name: "regler_style",
    description:
      "Le cachet de la légende. Un préréglage remet les surcharges à zéro ; ensuite chaque champ donné écrase le préréglage, comme les curseurs de l'inspecteur. Pas d'ancrage horizontal : le moteur centre la ligne, promettre autre chose mentirait sur l'export.",
    inputSchema: objet({
      preset: { type: "string", enum: PRESETS_SOUS_TITRES, description: "Base typographique" },
      corps: nombre("Corps en pixels", CORPS),
      ancrage: nombre("Ancrage vertical, 0 = haut, 0.98 = bas", { minimum: 0, maximum: 0.98 }),
      charsParLigne: nombre("Longueur de ligne avant retour à la ligne", {
        minimum: LIGNES.minChars,
        maximum: LIGNES.maxChars,
      }),
      lignesMax: nombre("Lignes acceptées", { minimum: LIGNES.minLines, maximum: LIGNES.maxLines }),
      majuscules: booleen("Tout en capitales"),
      couleurTexte: chaine("Couleur du texte : #rrggbb ou un nom, suivi de @0.x si besoin"),
      couleurFond: chaine("Couleur du fond de la légende, même forme"),
      opaciteFond: nombre("Opacité du fond de la légende", OPACITE),
    }),
    run: (projet, entrees) => {
      const { projet: suivant, avertissement } = reglerStyle(projet, entrees);
      const sur = Object.keys(suivant.style.surcharges);
      return {
        projet: suivant,
        avis: `style « ${suivant.style.preset} »${sur.length ? ` + ${sur.join(", ")} surchargé(s)` : ""}`,
        ...(avertissement ? { avertissement } : {}),
      };
    },
  },
  {
    name: "regler_options",
    description:
      "Options de sortie : mot à mot, silence coupé, voix originale retirée, ambiance, transition, filtre, agrandissement, force du masquage, langues.",
    inputSchema: objet({
      motParMot: booleen("Un mot à la fois à l'écran"),
      couperSilences: booleen("Retirer les blancs de la source"),
      retirerSonOriginal: booleen("Muet d'origine (la voix off doit suivre)"),
      miroir: booleen("Retourner horizontalement"),
      niveauAmbiance: nombre("Musique d'ambiance, 0 à 1", OPACITE),
      opaciteFond: nombre("Opacité du fond de légende, 0 à 1", OPACITE),
      forceMasque: {
        type: "string",
        enum: FORCES_MASQUE,
        description: "Effacement des zones masquées",
      },
      fournisseurVoix: {
        type: "string",
        enum: FOURNISSEURS_VOIX,
        description: "Moteur de doublage",
      },
      transition: { type: "string", enum: TRANSITIONS, description: "Transition entre deux plans" },
      dureeTransition: nombre("Durée de la transition", { minimum: 0.1, maximum: 3 }),
      filtre: { type: "string", enum: FILTRES, description: "Filtre d'image" },
      upscale: { type: "string", enum: UPSCALE, description: "Agrandissement" },
      qualite: { type: "string", enum: QUALITES, description: "Réglage d'encodage du moteur" },
      langueSource: {
        type: "string",
        enum: LANGUES_SOURCE,
        description: "Code langue parlée dans le plan (liste de transcription)",
      },
      langueCible: {
        type: "string",
        enum: LANGUES_CIBLES,
        description: "Code langue du doublage et des sous-titres",
      },
    }),
    run: (projet, entrees) => {
      const suivant = reglerOptions(projet, entrees);
      const touches = Object.keys(entrees);
      return {
        projet: suivant,
        avis: touches.length
          ? `${touches.length} option(s) réglée(s) : ${touches.join(", ")}`
          : "aucune option transmise",
      };
    },
  },
  {
    name: "montage_energetique",
    description:
      "Recette de monteur : coupe au rythme, typographie nerveuse, bandeau rehaussé hors de la zone du visage, mot à mot, transition courte. Un bon point de départ, jamais un rendu fini — relis avec `valider` et ajuste.",
    inputSchema: objet({
      bpm: nombre("Tempo du plan sonore", { minimum: 60, maximum: 200 }),
      intensite: {
        type: "string",
        enum: Object.keys(RECETTES),
        description: "Doux, nerveux, ou haché",
      },
      preset: { type: "string", enum: PRESETS_SOUS_TITRES, description: "Base typographique" },
      debut: nombre("Début de la plage rythmée", { minimum: 0 }),
      fin: nombre("Fin de la plage (défaut : fin du plan)", { minimum: 0 }),
    }),
    run: (projet, entrees) => {
      const recette = RECETTES[entrees.intensite ?? "nerveux"];
      const pas = 60 / (entrees.bpm ?? 120);
      // Le corps reste celui du préréglage (70 à 112 px selon le style) : c'est
      // lui qui a été réglé à l'œil sur un 1080×1920, pas un nombre rond.
      let suivant = reglerStyle(projet, {
        preset: entrees.preset ?? recette.preset,
        majuscules: recette.gardee < 0.7,
        charsParLigne: recette.gardee >= 0.7 ? 26 : 18,
        lignesMax: 2,
      }).projet;
      suivant = reglerOptions(suivant, {
        motParMot: recette.motParMot,
        transition: recette.transition,
        dureeTransition: recette.dureeTransition,
        couperSilences: true,
        forceMasque: "strong",
      });
      const { projet: rythmee, avis } = couperAuRythme(suivant, {
        bpm: entrees.bpm ?? 120,
        gardee: Math.min(4, Math.max(0.2, pas * recette.gardee)),
        decalage: pas * 0.12,
        debut: entrees.debut ?? 0,
        fin: entrees.fin ?? suivant.duree,
      });
      // Le bandeau descend sous la zone du visage et remonte au-dessus du
      // tiers bas : à 1080×1920, 70 % de haut pour 16 % de haut couvre la
      // légende sans bouffer le sujet.
      const { projet: cadre } = reglerCadre(rythmee, {
        id: "bottom",
        y: 0.7,
        w: 1,
        h: 0.16,
        actif: true,
      });
      const final = ajouterCadre(cadre, {
        label: "Zone vive (logo bas-droite)",
        x: 0.72,
        y: 0.88,
        w: 0.28,
        h: 0.1,
      });
      return {
        projet: final,
        avis: `${avis} · typographie ${final.style.preset}${recette.gardee < 0.7 ? " en capitales" : ""} · bandeau 70–86 % + logo bas-droite posés · transition ${recette.transition} ${recette.dureeTransition} s${recette.motParMot ? " · mot à mot" : ""}`,
        etat: resumer(final),
      };
    },
  },
  {
    name: "options_rendu",
    description:
      "La demande de rendu en trois blocs : `options` (ce que l'API accepte), `moteur` (préréglage, surcharges, cadres) et `encodage`. Aucun identifiant de voix clonée, aucun secret. À relire avant de déclencher l'export dans l'atelier.",
    inputSchema: objet({}),
    run: (projet) => ({
      projet,
      rendu: versDemandeRendu(projet),
      note: "le plan vidéo lui-même ne passe jamais par ce canal : l'export se déclenche dans l'atelier, sur le fichier de l'utilisateur",
    }),
  },
  {
    name: "exporter_config",
    description:
      "Le fichier de configuration de l'atelier (version 2, `timeline` et `subtitle` compris). Avec `chemin`, l'écrit sur le disque ; sinon le renvoie en texte. À faire importer dans Réglages → Importer un fichier de configuration.",
    inputSchema: objet({
      chemin: chaine("Chemin d'écriture, sous le dossier du projet, se terminant par .json"),
    }),
    run: (projet, entrees, contexte = {}) => {
      const config = versConfig(projet);
      const texte = JSON.stringify(config, null, 2);
      if (!entrees.chemin) return { projet, config, octets: Buffer.byteLength(texte, "utf8") };
      if (contexte.disque === false) {
        throw new RangeError(
          "ce fil n'écrit pas sur le disque : rappelle exporter_config sans `chemin`, " +
            "le document revient dans la réponse à chaque appel",
        );
      }
      const cible = cheminAutorise(entrees.chemin);
      writeFileSync(cible, `${texte}\n`, "utf8");
      return {
        projet,
        avis: `écrit dans ${relative(process.cwd(), cible) || cible} (${Buffer.byteLength(texte, "utf8")} o) — à importer dans l'atelier, onglet Projet`,
        octets: Buffer.byteLength(texte, "utf8"),
      };
    },
  },
  {
    name: "importer_config",
    description:
      "Reprend un fichier de configuration déjà produit par l'atelier (ou par ce serveur) pour continuer un montage. `chemin` ou `config` en texte.",
    inputSchema: objet({
      chemin: chaine("Chemin du fichier, sous le dossier du projet"),
      config: chaine("Le JSON lui-même", { maxLength: 70000 }),
    }),
    run: (projet, entrees, contexte = {}) => {
      if (entrees.chemin && contexte.disque === false) {
        throw new RangeError(
          "ce fil ne lit pas le disque : passe le JSON dans `config`, pas un chemin",
        );
      }
      const brut = entrees.config ?? readFileSync(cheminAutorise(entrees.chemin), "utf8");
      if (Buffer.byteLength(brut, "utf8") > 64 * 1024)
        throw new RangeError("fichier trop volumineux pour une configuration");
      let analyse;
      try {
        analyse = JSON.parse(brut);
      } catch {
        throw new RangeError("ce n'est pas du JSON valide");
      }
      if (analyse?.app !== "viraldub")
        throw new RangeError(
          "app != viraldub : ce fichier n'est pas une configuration de l'atelier",
        );
      const suivant = depuisConfig(analyse);
      return {
        projet: suivant,
        avis: `montage repris : ${suivant.blocs.length} bloc(s), ${suivant.coupes.length} coupe(s) sur un plan de ${suivant.duree} s`,
        etat: resumer(suivant),
      };
    },
  },
];

/**
 * Un chemin d'écriture, restreint au dossier du projet.
 *
 * Le serveur tourne avec les droits de celui qui le lance : accepter
 * `/home/x/.ssh/cle` d'un trait de prompt n'a aucun sens. Les variables
 * d'environnement ne sont pas lisibles par ce canal, et un chemin absolu hors du
 * projet est refusé, `..` compris.
 */
function cheminAutorise(entree) {
  if (typeof entree !== "string" || !entree) throw new RangeError("chemin attendu");
  if (!entree.toLowerCase().endsWith(".json"))
    throw new RangeError("chemin : un fichier .json seulement");
  const racine = resolve(process.cwd());
  const cible = isAbsolute(entree) ? resolve(entree) : resolve(racine, entree);
  const ecart = relative(racine, cible);
  if (ecart.startsWith("..") || isAbsolute(ecart)) {
    throw new RangeError(`chemin hors du dossier du projet : ${entree}`);
  }
  // Ecraser un fichier deja la est normal : entre deux essais on rejoue le
  // meme nom. Ce qui est refuse, c'est de sortir du dossier du projet.
  return cible;
}

/* -------------------------------------------------------------------------- */
/* le fil JSON-RPC                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Une session : un document de montage, et le fil JSON-RPC qui le lit.
 *
 * Le `traiteur` ne connait ni stdin ni stdout — il reçoit un message et rend la
 * réponse. C'est ce qui permet au fil stdio (`mcp/serveur.mjs`) et au fil HTTP
 * (`mcp/http.mjs`, donc Vercel) de partager exactement le même protocole : un
 * seul endroit où `initialize`, `tools/list` et `tools/call` sont écrits, donc
 * aucun écart possible entre le bureau et le déploiement.
 *
 * `disque` ferme les deux outils qui touchent au système de fichiers. Sur
 * Vercel le système de fichiers est la temporaire du froid : promettre
 * `exporter_config` là-bas ferait croire à un fichier que personne ne retrouvera
 * — le document revient donc dans la réponse, et c'est tout.
 */
export function CREER_SESSION(options = {}) {
  const { disque = true, cheminProjet, cheminConfig, surGeste } = options;
  let projet = options.projet ?? nouveauProjet({ nom: "montage" });
  if (cheminConfig && existsSync(cheminConfig)) {
    projet = depuisConfig(JSON.parse(readFileSync(cheminConfig, "utf8")));
  } else if (cheminProjet && existsSync(cheminProjet)) {
    projet = JSON.parse(readFileSync(cheminProjet, "utf8"));
  }

  const OUTILS_PAR_NOM = new Map(OUTILS.map((o) => [o.name, o]));
  const reponse = (id, result) => ({ id, result });
  const erreur = (id, code, message) => ({ id, error: { code, message } });

  /** Traite un message JSON-RPC et rend la réponse à écrire, ou `null`. */
  function traiter(message) {
    const { id, method, params } = message ?? {};

    if (method === "initialize") {
      return reponse(id, {
        protocolVersion: VERSIONS_PROTOCOLE.includes(params?.protocolVersion)
          ? params.protocolVersion
          : VERSIONS_PROTOCOLE[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: NOM_SERVEUR,
          title: "Atelier ViralDub — montage",
          version: VERSION,
        },
        instructions: [
          "Tu composes un plan de montage, tu ne rends rien : les nombres et le texte que tu poses décrivent un fichier que l'humain importe dans l'atelier.",
          "Ordre qui marche : etat → (vider_pistes si besoin) → blocs de texte et de voix → couper_au_rythme ou ajouter_coupe → regler_cadres → regler_style → regler_options → valider → exporter_config.",
          "Trois règles que le moteur applique et que tu ne peux pas contourner : la légende se centre horizontalement (aucun ancrage de ce côté) ; un cadre actif touchant le bas ou le haut du plan aspire la légende à son centre ; une taille de cadre plaquée sur un bord ne peut pas s'en écarter.",
          "Après chaque série de gestes, appelle valider : une sortie muette ou un bloc hors du plan s'y voit, pas dans un message d'erreur d'export.",
        ].join("\n"),
      });
    }

    if (method === "ping") return reponse(id, {});

    if (method === "tools/list") {
      return reponse(id, { tools: OUTILS.map(({ run, ...description }) => description) });
    }

    if (method === "tools/call") {
      const nom = params?.name;
      const outil = OUTILS_PAR_NOM.get(nom);
      if (!outil) {
        return erreur(id, -32602, `outil inconnu : ${String(nom)}`);
      }
      try {
        const sortieOutil = outil.run(projet, params?.arguments ?? {}, { disque });
        if (sortieOutil.projet) {
          projet = sortieOutil.projet;
          if (disque && cheminProjet) sauvegarder(cheminProjet, projet);
          if (surGeste) surGeste(projet);
        }
        const { projet: _omis, ...reste } = sortieOutil;
        return reponse(id, {
          content: [{ type: "text", text: JSON.stringify(reste, null, 2) }],
          isError: false,
        });
      } catch (e) {
        // Un refus borné n'est pas une panne : le modèle doit le lire et corriger,
        // pas perdre la session.
        return reponse(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify({ refus: e instanceof Error ? e.message : String(e) }, null, 2),
            },
          ],
          isError: true,
        });
      }
    }

    if (typeof method === "string" && method.startsWith("notifications/")) return null;

    return erreur(id ?? null, -32601, `méthode non prise en charge : ${String(method)}`);
  }

  /** Le document courant, tel que `exporter_config` sans chemin le rendrait. */
  const document = () => versConfig(projet);

  return { traiter, document, projetCourant: () => projet };
}

function sauvegarder(chemin, document) {
  try {
    writeFileSync(chemin, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  } catch {
    /* une sauvegarde qui n'écrit pas ne doit pas casser la session */
  }
}

/* -------------------------------------------------------------------------- */
/* le fil stdio — et rien d'autre au-dessous : importer ce fichier ne doit    */
/* jamais ouvrir stdin ni ouvrir un port, sinon le transport HTTP se bat avec */
/* lui dans la même fonction serveur.                                          */
/* -------------------------------------------------------------------------- */

/** `--projet chemain` -> "chemain" ; `--http` -> undefined. */
function valeurDArgument(listeArgs, drapeau) {
  const index = listeArgs.indexOf(drapeau);
  return index >= 0 ? listeArgs[index + 1] : undefined;
}

const args = process.argv.slice(2);

if (args.includes("--outils")) {
  // échappatoire de debug : `node mcp/serveur.mjs --outils` liste le contrat
  process.stdout.write(
    `${JSON.stringify(
      OUTILS.map(({ run, ...d }) => d),
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

const EST_POINT_ENTREE =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (EST_POINT_ENTREE && args.includes("--http")) {
  const { CREER_SERVEUR_NODE } = await import("./http.mjs");
  await CREER_SERVEUR_NODE({
    port: Number(valeurDArgument(args, "--port") ?? process.env.PORT ?? 4750),
    secret: valeurDArgument(args, "--secret") ?? process.env.MCP_TOKEN,
    session: CREER_SESSION({
      disque: true,
      cheminProjet: valeurDArgument(args, "--projet"),
      cheminConfig: valeurDArgument(args, "--config"),
    }),
  });
} else if (EST_POINT_ENTREE) {
  const session = CREER_SESSION({
    disque: true,
    cheminProjet: valeurDArgument(args, "--projet"),
    cheminConfig: valeurDArgument(args, "--config"),
  });
  const ecrire = (message) => {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  };
  let tampon = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (morceau) => {
    tampon += morceau;
    let saut;
    while ((saut = tampon.indexOf("\n")) >= 0) {
      const ligne = tampon.slice(0, saut).trim();
      tampon = tampon.slice(saut + 1);
      if (!ligne) continue;
      let message;
      try {
        message = JSON.parse(ligne);
      } catch {
        ecrire(erreur(null, -32700, "Ligne illisible : attendu un objet JSON-RPC par ligne."));
        continue;
      }
      if (Array.isArray(message)) {
        for (const un of message) {
          const reponse = session.traiter(un);
          if (reponse) ecrire(reponse);
        }
      } else {
        const reponse = session.traiter(message);
        if (reponse) ecrire(reponse);
      }
    }
  });
  process.stdin.on("end", () => {
    process.exit(0);
  });
}
