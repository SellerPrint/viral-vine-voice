/**
 * Le document de montage que manipule le serveur MCP, et ses opérations.
 *
 * ## Ce que c'est, et ce que ce n'est pas
 *
 * C'est le même vocabulaire que l'atelier : des blocs sur trois pistes (plan,
 * voix off, texte incrusté), des coupes qui retirent une plage à la source, des
 * cadres de masquage en fractions d'image, un style de sous-titres, des options
 * de sortie. Pas d'effet inventé : ce que ce fichier ne sait pas décrire, le
 * moteur FFmpeg du projet ne le rendrait pas — le promettre produirait un
 * montage qui n'existe qu'à l'écran.
 *
 * ## Le format de sortie
 *
 * `versConfig` écrit exactement le fichier que l'atelier importe (Réglages →
 * Importer un fichier de configuration), schéma validé par `config-io.ts` côté
 * application. C'est le seul pont nécessaire : l'humain garde la main sur le
 * plan vidéo, qui ne voyage jamais par ce canal.
 */

import {
  ANCRAGE,
  CADRES_PAR_DEFAUT,
  CONFIG_VERSION,
  CORPS,
  FILTRES,
  FORCES_MASQUE,
  FOURNISSEURS_VOIX,
  LIGNES,
  MAX_BLOCS,
  LANGUES_CIBLES,
  LANGUES_SOURCE,
  MAX_CADRES,
  MAX_COUPES,
  MAX_LIGNES_MOTEUR,
  MAX_DUREE,
  OPACITE,
  PISTES,
  QUALITES,
  PRESETS_SOUS_TITRES,
  PRESET_PAR_DEFAUT,
  RAISONS_COUPURE,
  RYTHME,
  TRANSITIONS,
  UPSCALE,
} from "./regles.mjs";

/* -------------------------------------------------------------------------- */
/* bornes communes                                                             */
/* -------------------------------------------------------------------------- */

const arrondi = (v) => Math.round(Number(v) * 1000) / 1000;
const bornee = (v, min, max) => Math.min(max, Math.max(min, v));

function nombre(vaut, libelle, { min, max, entier = false } = {}) {
  const n = Number(vaut);
  if (!Number.isFinite(n))
    throw new TypeError(`${libelle} : nombre attendu, reçu ${JSON.stringify(vaut)}`);
  if (entier && Math.abs(n - Math.round(n)) > 1e-9)
    throw new TypeError(`${libelle} : entier attendu`);
  if (min !== undefined && n < min) throw new RangeError(`${libelle} : minimum ${min}`);
  if (max !== undefined && n > max) throw new RangeError(`${libelle} : maximum ${max}`);
  return arrondi(n);
}

function chaine(vaut, libelle, max) {
  if (vaut === undefined || vaut === null) return undefined;
  const s = String(vaut);
  if (max !== undefined && s.length > max)
    throw new RangeError(`${libelle} : ${max} caractères au plus`);
  return s;
}

/**
 * Une couleur de texte ou de fond, au format que le graphe ffmpeg digère :
 * `#rrggbb` ou un nom, suivi éventuellement de `@alpha`. Jamais une virgule ni
 * un `=` : ces deux caractères fermeraient l'argument `drawtext` et ouvriraient
 * la porte à n'importe quel filtre.
 */
function couleur(vaut, libelle) {
  const c = String(vaut);
  if (!/^(#[0-9a-fA-F]{6}|[a-zA-Z]{3,12})(@0?\.\d{1,2})?$/.test(c)) {
    throw new RangeError(
      `${libelle} : « ${c} » n'est pas une couleur du moteur (#rrggbb, nom, ou l'un suivi de @0.x)`,
    );
  }
  return c;
}

function dans(liste, vaut, libelle) {
  if (!liste.includes(vaut)) {
    throw new RangeError(`${libelle} : « ${vaut} » n'existe pas — choix : ${liste.join(", ")}`);
  }
  return vaut;
}

let compteur = 0;
const identifiant = (racine) =>
  `${racine}-${Date.now().toString(36)}-${(compteur += 1).toString(36)}`;

/* -------------------------------------------------------------------------- */
/* le document                                                                 */
/* -------------------------------------------------------------------------- */

export function nouveauProjet(entrees = {}) {
  const duree = nombre(entrees.duree ?? 30, "duree", { min: 0.5, max: MAX_DUREE });
  return {
    nom: chaine(entrees.nom ?? "montage", "nom", 80) ?? "montage",
    duree,
    largeur: nombre(entrees.largeur ?? 1080, "largeur", { min: 16, max: 4096, entier: true }),
    hauteur: nombre(entrees.hauteur ?? 1920, "hauteur", { min: 16, max: 4096, entier: true }),
    cadence: nombre(entrees.fps ?? entrees.cadence ?? 30, "fps", {
      min: 12,
      max: 60,
      entier: true,
    }),
    blocs: [],
    coupes: [],
    cadres: CADRES_PAR_DEFAUT.map((c) => ({ ...c })),
    style: { preset: PRESET_PAR_DEFAUT, surcharges: {} },
    // « fra », pas « fr » : les codes de la source viennent de la liste de
    // transcription, ceux de la cible de la liste de doublage.
    langues: { source: "fra", cible: "fr" },
    options: {
      motParMot: false,
      retirerSonOriginal: false,
      couperSilences: true,
      miroir: false,
      fournisseurVoix: "elevenlabs",
      niveauAmbiance: 0.25,
      opaciteFond: 0.92,
      forceMasque: "medium",
      transition: "none",
      dureeTransition: 0.25,
      filtre: "none",
      upscale: "none",
      qualite: "standard",
    },
  };
}

/* -------------------------------------------------------------------------- */
/* opérations sur les pistes                                                   */
/* -------------------------------------------------------------------------- */

export function ajouterBloc(projet, entrees = {}) {
  const piste = dans(PISTES, entrees.track ?? entrees.piste ?? "subs", "piste");
  const duree = nombre(entrees.duree ?? entrees.duration ?? 1.6, "duree", {
    min: 0.12,
    max: MAX_DUREE,
  });
  const debut = nombre(entrees.debut ?? entrees.start ?? 0, "debut", { min: 0, max: MAX_DUREE });
  if (debut + duree > projet.duree + 0.01) {
    throw new RangeError(
      `le bloc deborde du plan : ${arrondi(debut + duree)} s > ${projet.duree} s (plan « ${projet.nom} »)`,
    );
  }
  if (piste !== "video" && projet.blocs.length + projet.coupes.length >= MAX_BLOCS + MAX_COUPES) {
    throw new RangeError(`trop de segments sur le projet (${MAX_BLOCS} blocs au plus)`);
  }
  const texte = chaine(entrees.texte ?? entrees.text, "texte", 300);
  const bloc = {
    id: identifiant(piste),
    track: piste,
    start: debut,
    duree,
    label: chaine(entrees.label, "label", 120) ?? (piste === "subs" ? (texte ?? "bloc") : piste),
    ...(texte ? { texte } : {}),
    ...(entrees.locution || entrees.sourceText
      ? { locution: String(entrees.locution ?? entrees.sourceText).slice(0, 300) }
      : {}),
    ...(entrees.locuteur || entrees.speakerId
      ? { locuteur: String(entrees.locuteur ?? entrees.speakerId).slice(0, 64) }
      : {}),
  };
  return {
    projet: { ...projet, blocs: [...projet.blocs, bloc].sort((a, b) => a.start - b.start) },
    bloc,
  };
}

export function modifierBloc(projet, entrees = {}) {
  const index = projet.blocs.findIndex((b) => b.id === entrees.id);
  if (index < 0) throw new RangeError(`bloc « ${entrees.id} » introuvable`);
  const actuel = projet.blocs[index];
  const suivant = { ...actuel };
  if (entrees.debut !== undefined)
    suivant.start = nombre(entrees.debut, "debut", { min: 0, max: MAX_DUREE });
  if (entrees.duree !== undefined)
    suivant.duree = nombre(entrees.duree, "duree", { min: 0.12, max: MAX_DUREE });
  if (entrees.texte !== undefined) suivant.texte = chaine(entrees.texte, "texte", 300);
  if (entrees.label !== undefined) suivant.label = chaine(entrees.label, "label", 120);
  if (suivant.start + suivant.duree > projet.duree + 0.01) {
    throw new RangeError(`le bloc deborde du plan : ${arrondi(suivant.start + suivant.duree)} s`);
  }
  const blocs = [...projet.blocs];
  blocs[index] = suivant;
  return { ...projet, blocs: blocs.sort((a, b) => a.start - b.start) };
}

export function supprimerBloc(projet, id) {
  const blocs = projet.blocs.filter((b) => b.id !== id);
  if (blocs.length === projet.blocs.length) throw new RangeError(`bloc « ${id} » introuvable`);
  return { ...projet, blocs };
}

export function viderPistes(projet, pistes = ["subs", "dub"]) {
  const choisis = pistes.map((p) => dans(PISTES, p, "piste à vider"));
  return { ...projet, blocs: projet.blocs.filter((b) => !choisis.includes(b.track)) };
}

export function ajouterCoupe(projet, entrees = {}) {
  const debut = nombre(entrees.debut ?? entrees.start ?? 0, "debut", { min: 0, max: MAX_DUREE });
  const duree = nombre(entrees.duree ?? entrees.duration ?? 0.6, "duree", { min: 0.12, max: 600 });
  if (debut + duree > projet.duree + 0.01) {
    throw new RangeError(`la coupe sort du plan : ${arrondi(debut + duree)} s > ${projet.duree} s`);
  }
  if (projet.coupes.length >= MAX_COUPES)
    throw new RangeError(`trop de coupes (${MAX_COUPES} au plus)`);
  const raison = entrees.raison ? dans(RAISONS_COUPURE, entrees.raison, "raison") : "manuel";
  const coupe = { id: identifiant("coupe"), start: debut, duree, raison };
  return { ...projet, coupes: [...projet.coupes, coupe].sort((a, b) => a.start - b.start) };
}

export function supprimerCoupe(projet, id) {
  const coupes = projet.coupes.filter((c) => c.id !== id);
  if (coupes.length === projet.coupes.length) throw new RangeError(`coupe « ${id} » introuvable`);
  return { ...projet, coupes };
}

/**
 * Le montage rythmique : garder une fenêtre autour de chaque temps, couper le
 * reste. C'est le geste de base d'un montage « dynamique » — la respiration
 * entre les temps part, l'image avance par à-coups volontaires.
 *
 * Les blocs de texte existants sont décalés d'autant que les coupes qui les
 * précédent ont retiré de matière, pour qu'un sous-titre reste collé à la
 * phrase qu'il commente.
 */
export function couperAuRythme(projet, entrees = {}) {
  const bpm = nombre(entrees.bpm ?? 120, "bpm", { min: RYTHME.bpmMin, max: RYTHME.bpmMax });
  const pas = 60 / bpm;
  const gardee = nombre(entrees.gardee ?? Math.min(2, pas * 0.62), "gardee", {
    min: RYTHME.gardeeMin,
    max: RYTHME.gardeeMax,
  });
  const decalage = nombre(entrees.decalage ?? 0, "decalage", {
    min: -RYTHME.decalageMax,
    max: RYTHME.decalageMax,
  });
  const debut = nombre(entrees.debut ?? 0, "debut", { min: 0, max: MAX_DUREE });
  const fin = nombre(entrees.fin ?? projet.duree, "fin", { min: 0, max: MAX_DUREE });
  if (fin <= debut) throw new RangeError("la fin doit suivre le début");

  const coupes = [];
  let signale = 0;
  for (let t = debut + decalage + gardee / 2; t + gardee / 2 <= fin; t += pas) {
    const debutCoupe = t + gardee / 2;
    const finCoupe = Math.min(fin, t + pas - gardee / 2);
    if (finCoupe - debutCoupe < 0.12) {
      signale += 1;
      continue;
    }
    coupes.push({
      id: identifiant("coupe"),
      start: arrondi(debutCoupe),
      duree: arrondi(finCoupe - debutCoupe),
      raison: "manuel",
    });
  }
  if (!coupes.length) {
    throw new RangeError(
      `aucune coupe trouvable à ${bpm} BPM entre ${debut} s et ${fin} s : un temps dure ${Math.round(pas * 1000) / 1000} s et tu en gardes ${gardee} s — garde moins qu'un temps, ou remonte le tempo`,
    );
  }

  // Les blocs ne bougent PAS. La règle de l'atelier est en temps SOURCE, et
  // `graph.ts` remape déjà chaque ligne sur la sortie : recaler ici détacherait
  // les sous-titres de l'image au lieu de les coller.
  const avant = coupes.sort((a, b) => a.start - b.start);
  const apres = { ...projet, coupes: [...projet.coupes, ...avant] };
  // Un bloc qui tombe sous une coupe n'est pas supprime : il est tronque a
  // l'export, le graphe remappe ses bornes sur la sortie. Le dire ici vaut
  // mieux qu'une ligne a moitie visible decouverte trois minutes plus tard.
  const chevauche = (b, c) =>
    b.start < c.start + c.duree - 0.02 && b.start + b.duree > c.start + 0.02;
  const engloutis = projet.blocs.filter((b) => avant.some((c) => chevauche(b, c)));

  return {
    projet: apres,
    avis:
      `${avant.length} coupe(s) posée(s) à ${bpm} BPM, ${gardee} s gardées par temps` +
      `${signale ? `, ${signale} temps trop serrés ignorés` : ""}` +
      ` · durée sortie ≈ ${sortie(apres).toFixed(2)} s` +
      `${engloutis.length ? ` · ${engloutis.length} bloc(s) touchent une coupe : la ligne sera tronquee a l'export, cale-la entre deux temps` : ""}`,
    idsEngloutis: engloutis.map((b) => b.id),
  };
}

/* -------------------------------------------------------------------------- */
/* cadres, style, options                                                      */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* cles d'entree                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Les noms du fichier de configuration de l'atelier, acceptes en alias.
 *
 * Un modele lit `wordByWord` dans `options` et `fontsize` dans `subtitle` : il
 * les renverra tels quels. Sans passerelle, il faudrait tout deviner ; avec,
 * le silence reste impossible — une cle qui ne correspond a rien leve une
 * erreur nommee, au lieu d'etre ignoree et de laisser croire que le reglage
 * est passe.
 */
const ALIAS_CHAMPS = {
  // cadres
  largeur: "w",
  hauteur: "h",
  bord_gauche: "x",
  bord_haut: "y",
  enabled: "actif",
  active: "actif",
  // style
  fontsize: "corps",
  yAnchor: "ancrage",
  uppercase: "majuscules",
  maxCharsPerLine: "charsParLigne",
  maxLines: "lignesMax",
  fontColor: "couleurTexte",
  boxColor: "couleurFond",
  boxOpacity: "opaciteFond",
  // options
  wordByWord: "motParMot",
  removeOriginalAudio: "retirerSonOriginal",
  cutSilences: "couperSilences",
  mirror: "miroir",
  ttsProvider: "fournisseurVoix",
  maskStrength: "forceMasque",
  transitionDuration: "dureeTransition",
  filterId: "filtre",
  ambienceLevel: "niveauAmbiance",
  subtitleOpacity: "opaciteFond",
  sourceLanguage: "langueSource",
  targetLanguage: "langueCible",
};

const CHAMPS_PAR_OUTIL = {
  reglerCadre: ["id", "x", "y", "w", "h", "actif"],
  ajouterCadre: ["id", "label", "x", "y", "w", "h", "actif"],
  reglerStyle: [
    "preset",
    "corps",
    "ancrage",
    "majuscules",
    "charsParLigne",
    "lignesMax",
    "couleurTexte",
    "couleurFond",
    "opaciteFond",
  ],
  reglerOptions: [
    "motParMot",
    "retirerSonOriginal",
    "couperSilences",
    "miroir",
    "fournisseurVoix",
    "forceMasque",
    "transition",
    "dureeTransition",
    "filtre",
    "upscale",
    "niveauAmbiance",
    "opaciteFond",
    "qualite",
    "langueSource",
    "langueCible",
  ],
};

/** Remet chaque entree sous le nom que l'operation lit, ou le dit. */
export function entreesPropres(outil, entrees = {}) {
  const autorisees = CHAMPS_PAR_OUTIL[outil];
  const out = {};
  for (const [cle, valeur] of Object.entries(entrees ?? {})) {
    const cible = autorisees.includes(cle) ? cle : ALIAS_CHAMPS[cle];
    if (cible === undefined || !autorisees.includes(cible)) {
      throw new RangeError(
        `${outil} : cle « ${cle} » inconnue — acceptees : ${autorisees.join(", ")}`,
      );
    }
    out[cible] = valeur;
  }
  return out;
}

export function reglerCadre(projet, brut = {}) {
  const entrees = entreesPropres("reglerCadre", brut);
  const index = projet.cadres.findIndex((c) => c.id === entrees.id);
  if (index < 0) {
    throw new RangeError(
      `cadre « ${entrees.id} » introuvable — connus : ${projet.cadres.map((c) => c.id).join(", ")}`,
    );
  }
  const actuel = projet.cadres[index];
  const suivant = { ...actuel };
  const tords = [];
  for (const cle of ["x", "y", "w", "h"]) {
    if (entrees[cle] === undefined) continue;
    // Une valeur hors image n'est pas une erreur : `clampZone` de l'atelier la
    // ramènerait déjà. Un modèle qui écrit `w: 1.6` pour « pleine largeur » doit
    // obtenir la pleine largeur, pas un refus — mais il doit savoir que la
    // valeur a été tordue, sinon il relit celle qu'il avait envoyée.
    const brut = nombre(entrees[cle], cle, { min: -4, max: 4 });
    suivant[cle] = Math.min(1, Math.max(0, brut));
    if (Math.abs(suivant[cle] - brut) > 1e-9) tords.push(`${cle} ${brut}→${suivant[cle]}`);
  }
  if (entrees.actif !== undefined) suivant.actif = Boolean(entrees.actif);
  // Les mêmes bornes que `clampZone` côté atelier : jamais à moitié hors image,
  // jamais plus petite que 3 % du cadre.
  for (const cle of ["w", "h"]) {
    if (suivant[cle] < 0.03) {
      tords.push(`${cle} ${suivant[cle]}→0.03`);
      suivant[cle] = 0.03;
    }
  }
  for (const cle of ["x", "y"]) {
    const plafond = arrondi(1 - suivant[cle === "x" ? "w" : "h"]);
    if (suivant[cle] > plafond) {
      tords.push(`${cle} ${suivant[cle]}→${plafond}`);
      suivant[cle] = plafond;
    }
  }
  for (const cle of ["x", "y", "w", "h"]) suivant[cle] = arrondi(suivant[cle]);
  const cadres = [...projet.cadres];
  cadres[index] = suivant;
  return { projet: { ...projet, cadres }, tords };
}

export function ajouterCadre(projet, brut = {}) {
  const entrees = entreesPropres("ajouterCadre", brut);
  if (projet.cadres.length >= MAX_CADRES) throw new RangeError(`${MAX_CADRES} cadres au plus`);
  const cadre = {
    id: chaine(entrees.id, "id", 40) ?? identifiant("cadre"),
    label: chaine(entrees.label, "label", 60) ?? "Zone de masquage",
    x: arrondi(bornee(Number(entrees.x ?? 0.1), 0, 0.97)),
    y: arrondi(bornee(Number(entrees.y ?? 0.1), 0, 0.97)),
    w: 0.3,
    h: 0.08,
    actif: entrees.actif === undefined ? true : Boolean(entrees.actif),
  };
  cadre.x = bornee(cadre.x, 0, 1 - cadre.w);
  cadre.y = bornee(cadre.y, 0, 1 - cadre.h);
  return { ...projet, cadres: [...projet.cadres, cadre] };
}

/** Surcharges de style : `null` rend la main au préréglage, comme dans l'app. */
export function reglerStyle(projet, brut = {}) {
  const entrees = entreesPropres("reglerStyle", brut);
  let courant = projet;
  // Changer de préréglage remet la typographie à zéro, comme dans l'atelier
  // (`patch({ presetId, overrides: {} })`) : sinon l'ancien corps survit sous le
  // nouveau style et le résultat ne ressemble à aucun des deux. Les champs donnés
  // dans le même appel s'appliquent ensuite, sur la base fraiche.
  if (entrees.preset !== undefined) {
    courant = {
      ...projet,
      style: {
        preset: dans(PRESETS_SOUS_TITRES, entrees.preset, "preset de sous-titres"),
        surcharges: {},
      },
    };
  }
  const surcharges = { ...courant.style.surcharges };
  if (entrees.corps !== undefined) surcharges.fontsize = nombre(entrees.corps, "corps", CORPS);
  if (entrees.ancrage !== undefined)
    surcharges.yAnchor = nombre(entrees.ancrage, "ancrage", ANCRAGE);
  if (entrees.majuscules !== undefined) surcharges.uppercase = Boolean(entrees.majuscules);
  if (entrees.charsParLigne !== undefined)
    surcharges.maxCharsPerLine = nombre(entrees.charsParLigne, "charsParLigne", {
      min: LIGNES.minChars,
      max: LIGNES.maxChars,
      entier: true,
    });
  if (entrees.lignesMax !== undefined)
    surcharges.maxLines = nombre(entrees.lignesMax, "lignesMax", {
      min: LIGNES.minLines,
      max: LIGNES.maxLines,
      entier: true,
    });
  if (entrees.couleurTexte !== undefined)
    surcharges.fontColor = couleur(entrees.couleurTexte, "couleurTexte");
  if (entrees.couleurFond !== undefined)
    surcharges.boxColor = couleur(entrees.couleurFond, "couleurFond");
  if (entrees.opaciteFond !== undefined) {
    courant = {
      ...courant,
      options: {
        ...courant.options,
        opaciteFond: nombre(entrees.opaciteFond, "opaciteFond", OPACITE),
      },
    };
  }
  // La règle partagée du moteur : un cadre actif touchant le bas ou le haut du
  // plan impose l'ancrage de la légende à son centre. Écrire `yAnchor` dans ce
  // cas n'est pas une erreur, mais cela ne se verra jamais au rendu — autant le
  // dire ici que de laisser chercher pourquoi la ligne n'a pas bougé.
  const couvert = courant.cadres.find((c) => c.actif && (c.id === "bottom" || c.id === "top"));
  const avertissement =
    couvert && surcharges.yAnchor !== undefined
      ? `l'ancrage demandé (${surcharges.yAnchor}) est écarté par le cadre « ${couvert.id} » : le moteur centre la légende à ${Math.round((couvert.y + couvert.h / 2) * 100)} % du plan. Ramène le cadre vers l'intérieur, ou désactive-le.`
      : undefined;
  return {
    projet: { ...courant, style: { ...courant.style, surcharges: objetClean(surcharges) } },
    avertissement,
  };
}

export function reglerOptions(projet, brut = {}) {
  const entrees = entreesPropres("reglerOptions", brut);
  const options = { ...projet.options };
  const booleens = ["motParMot", "retirerSonOriginal", "couperSilences", "miroir"];
  for (const cle of booleens) if (entrees[cle] !== undefined) options[cle] = Boolean(entrees[cle]);
  if (entrees.fournisseurVoix !== undefined)
    options.fournisseurVoix = dans(FOURNISSEURS_VOIX, entrees.fournisseurVoix, "fournisseurVoix");
  if (entrees.forceMasque !== undefined)
    options.forceMasque = dans(FORCES_MASQUE, entrees.forceMasque, "forceMasque");
  if (entrees.transition !== undefined)
    options.transition = dans(TRANSITIONS, entrees.transition, "transition");
  if (entrees.dureeTransition !== undefined)
    options.dureeTransition = nombre(entrees.dureeTransition, "dureeTransition", {
      min: 0.1,
      max: 3,
    });
  if (entrees.filtre !== undefined) options.filtre = dans(FILTRES, entrees.filtre, "filtre");
  if (entrees.upscale !== undefined) options.upscale = dans(UPSCALE, entrees.upscale, "upscale");
  if (entrees.niveauAmbiance !== undefined)
    options.niveauAmbiance = nombre(entrees.niveauAmbiance, "niveauAmbiance", OPACITE);
  if (entrees.opaciteFond !== undefined)
    options.opaciteFond = nombre(entrees.opaciteFond, "opaciteFond", OPACITE);
  if (entrees.qualite !== undefined) options.qualite = dans(QUALITES, entrees.qualite, "qualite");
  const langues = { ...projet.langues };
  if (entrees.langueSource !== undefined)
    langues.source = dans(LANGUES_SOURCE, entrees.langueSource, "langueSource");
  if (entrees.langueCible !== undefined)
    langues.cible = dans(LANGUES_CIBLES, entrees.langueCible, "langueCible");
  return { ...projet, options, langues };
}

const objetClean = (o) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));

/* -------------------------------------------------------------------------- */
/* lecture du document                                                         */
/* -------------------------------------------------------------------------- */

/** Ce que le montage dure une fois les coupes retirées (comme le moteur). */
export function sortie(projet, coupes = projet.coupes) {
  const retire = coupes.reduce(
    (acc, c) =>
      acc + (c.start + c.duree <= projet.duree ? c.duree : Math.max(0, projet.duree - c.start)),
    0,
  );
  return Math.max(0, projet.duree - retire);
}

export function valider(projet) {
  const problemes = [];
  const total = sortie(projet);
  if (projet.blocs.length === 0) problemes.push("aucun bloc sur les pistes : le montage est vide");
  const lignes = projet.blocs.filter((b) => b.track === "subs").length;
  if (lignes > MAX_LIGNES_MOTEUR) {
    problemes.push(
      `${lignes} blocs de légende : le moteur n'en incruste que ${MAX_LIGNES_MOTEUR}, le reste manquera à l'export`,
    );
  }
  if (projet.duree > 0 && total < 1)
    problemes.push(`durée de sortie Inferieure à la seconde (${total.toFixed(2)} s)`);

  const aplat = [...projet.blocs].sort((a, b) => a.start - b.start);
  for (let i = 1; i < aplat.length; i += 1) {
    const avant = aplat[i - 1];
    const ici = aplat[i];
    if (avant.track === ici.track && ici.start < avant.start + avant.duree - 0.02) {
      problemes.push(
        `blocs qui se recouvrent piste ${ici.track} : ${avant.id} [${avant.start}–${arrondi(avant.start + avant.duree)}] et ${ici.id} [${ici.start}–${arrondi(ici.start + ici.duree)}]`,
      );
    }
  }
  for (const b of projet.blocs) {
    if (b.track === "subs" && !b.texte)
      problemes.push(`bloc ${b.id} : sans texte, rien ne sera incrusté`);
    if (b.start < 0 || b.start + b.duree > projet.duree + 0.01)
      problemes.push(`bloc ${b.id} hors du plan (${b.start} + ${b.duree} s)`);
  }
  const couvrent = projet.cadres.filter((c) => c.actif);
  if (!couvrent.length)
    problemes.push("aucun cadre actif : le filigrane d'origine restera visible");
  if (projet.options.retirerSonOriginal && projet.options.niveauAmbiance === 0) {
    problemes.push(
      "son original retiré et ambiance à 0 : la sortie sera muette tant que la voix off n'est pas posée",
    );
  }
  if (projet.options.transition !== "none" && projet.coupes.length === 0) {
    problemes.push(
      `transition « ${projet.options.transition} » sans aucune coupe : elle ne se verra pas`,
    );
  }
  return problemes;
}

export function resumer(projet) {
  const parPiste = PISTES.map((p) => ({
    piste: p,
    blocs: projet.blocs.filter((b) => b.track === p).length,
  }));
  return {
    nom: projet.nom,
    plan: `${projet.largeur}×${projet.hauteur} · ${projet.duree} s · ${projet.cadence} i/s`,
    dureeSortie: arrondi(sortie(projet)),
    coupes: projet.coupes.length,
    pistes: parPiste.filter((p) => p.blocs > 0),
    style: {
      preset: projet.style.preset,
      surcharges: objetClean(projet.style.surcharges),
    },
    cadres: projet.cadres.map((c) => ({
      id: c.id,
      actif: c.actif,
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
    })),
    langues: projet.langues,
    avertissements: valider(projet),
  };
}

/* -------------------------------------------------------------------------- */
/* les deux formats de sortie                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Le fichier que l'atelier importe. Aucun identifiant de voix clonée n'y figure :
 * `config-io.ts` l'écarte à l'import comme à l'export, et il n'est jamais reçu ici.
 */
export function versConfig(projet) {
  return {
    app: "viraldub",
    version: CONFIG_VERSION,
    presetId: projet.style.preset,
    sourceLanguage: projet.langues.source,
    targetLanguage: projet.langues.cible,
    options: objetClean({
      wordByWord: projet.options.motParMot,
      removeOriginalAudio: projet.options.retirerSonOriginal,
      cutSilences: projet.options.couperSilences,
      mirror: projet.options.miroir,
      ttsProvider: projet.options.fournisseurVoix,
      filterId: projet.options.filtre,
      upscale: projet.options.upscale,
      transition: projet.options.transition,
      transitionDuration: clampNumber(projet.options.dureeTransition, 0.1, 3),
      subtitleOpacity: clampNumber(projet.options.opaciteFond, 0, 1),
      ambienceLevel: clampNumber(projet.options.niveauAmbiance, 0, 1),
      maskStrength: projet.options.forceMasque,
    }),
    masks: projet.cadres.map((c) => ({
      id: c.id,
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
      enabled: Boolean(c.actif),
    })),
    timeline: {
      clips: projet.blocs
        .filter((b) => b.track !== "cuts")
        .map((b) =>
          objetClean({
            track: b.track,
            start: b.start,
            duration: b.duree,
            label: b.label,
            text: b.texte,
            sourceText: b.locution,
            speakerId: b.locuteur,
          }),
        ),
      cuts: projet.coupes.map((c) => ({ start: c.start, duration: c.duree })),
    },
    // Le style de légende, sous la clef que l'atelier sait lire. Un champ qui ne
    // figure pas dans `subtitleSchema` serait rejeté à l'import : `CLEFS_STYLE`
    // sert de filtre, et le test de parité vérifie qu'elle couvre le schéma.
    ...(Object.keys(surchargesStyle(projet)).length ? { subtitle: surchargesStyle(projet) } : {}),
  };
}

const clampNumber = (v, min, max) => bornee(Number(v) || 0, min, max);

/** Les seules surcharges que `config-io.ts` accepte de lire. */
export const CLEFS_STYLE = [
  "fontsize",
  "maxCharsPerLine",
  "maxLines",
  "yAnchor",
  "uppercase",
  "fontColor",
  "boxColor",
  "boxOpacity",
  "borderW",
];

const surchargesStyle = (projet) =>
  objetClean(
    Object.fromEntries(
      CLEFS_STYLE.filter((cle) => cle in projet.style.surcharges).map((cle) => [
        cle,
        projet.style.surcharges[cle],
      ]),
    ),
  );

/**
 * Ce que l'atelier mettrait dans sa requête, en trois blocs distincts — parce
 * que ce ne sont pas les mêmes destinataires.
 *
 * - `options` : exactement les clés de `RenderOptions` (testé contre
 *   `DEFAULT_RENDER_OPTIONS`), donc la partie que `config-io` valide.
 *   `clonedVoiceId` n'y figure jamais : c'est l'identifiant du compte de
 *   l'utilisateur, il ne sort pas par ce canal.
 * - `moteur` : ce que `PipelineOptions` ajoute par-dessus (préréglage résolu,
 *   surcharges, cadres).
 * - `encodage` : le seul choix d'encodage que le moteur lise vraiment.
 *
 * Ni `fps` ni `bitrate` : le premier vient du sondage de la source, le second
 * n'existe nulle part dans le contrat. Un outil qui les proposerait ferait
 * croire à un réglage qui ne fait rien.
 */
export function versDemandeRendu(projet) {
  return {
    options: objetClean({
      wordByWord: projet.options.motParMot,
      removeOriginalAudio: projet.options.retirerSonOriginal,
      cutSilences: projet.options.couperSilences,
      mirror: projet.options.miroir,
      ttsProvider: projet.options.fournisseurVoix,
      filterId: projet.options.filtre,
      upscale: projet.options.upscale,
      transition: projet.options.transition,
      transitionDuration: projet.options.dureeTransition,
      subtitleOpacity: projet.options.opaciteFond,
      ambienceLevel: projet.options.niveauAmbiance,
      maskStrength: projet.options.forceMasque,
    }),
    moteur: {
      preset: projet.style.preset,
      overrides: objetClean(surchargesStyle(projet)),
      masks: projet.cadres.map(({ id, label, x, y, w, h, actif }) => ({
        id,
        label,
        x,
        y,
        w,
        h,
        enabled: Boolean(actif),
      })),
      sourceLanguage: projet.langues.source,
      targetLanguage: projet.langues.cible,
    },
    encodage: { qualite: projet.options.qualite },
    plan: {
      largeur: projet.largeur,
      hauteur: projet.hauteur,
      cadence: projet.cadence,
      duree: projet.duree,
      dureeSortie: arrondi(sortie(projet)),
    },
  };
}

/**
 * Une configuration de l'atelier → le document du serveur.
 *
 * Les blocs importés sont repris tels quels (l'atelier les a déjà bornés à son
 * plan) ; la durée du plan est déduite de la fin du dernier segment, faute de
 * medium réel côté serveur.
 */
export function depuisConfig(config) {
  const projet = nouveauProjet({ nom: "depuis-atelier" });
  const clips = config?.timeline?.clips ?? [];
  const cuts = config?.timeline?.cuts ?? [];
  const fin = clips.reduce((max, c) => Math.max(max, Number(c.start) + Number(c.duration)), 0);
  projet.duree = Math.max(
    0.5,
    arrondi(Math.max(fin, ...cuts.map((c) => Number(c.start) + Number(c.duration)), 0.5)),
  );
  projet.blocs = clips.map((c, i) =>
    objetClean({
      id: `import-${i + 1}`,
      track: PISTES.includes(c.track) ? c.track : "subs",
      start: nombre(c.start, "start", { min: 0, max: MAX_DUREE }),
      duree: nombre(c.duration, "duration", { min: 0.12, max: MAX_DUREE }),
      label: c.label ?? "bloc",
      texte: c.text,
      locution: c.sourceText,
      locuteur: c.speakerId,
    }),
  );
  projet.coupes = cuts.map((c, i) => ({
    id: `coupe-import-${i + 1}`,
    start: nombre(c.start, "start", { min: 0, max: MAX_DUREE }),
    duree: nombre(c.duration, "duration", { min: 0.12, max: 600 }),
    raison: "manuel",
  }));
  if (Array.isArray(config?.masks) && config.masks.length) {
    projet.cadres = config.masks.map((m) => ({
      id: String(m.id ?? "cadre"),
      label: String(m.id ?? "cadre"),
      x: bornee(Number(m.x) || 0, 0, 0.97),
      y: bornee(Number(m.y) || 0, 0, 0.97),
      w: bornee(Number(m.w) || 0.1, 0.03, 1),
      h: bornee(Number(m.h) || 0.1, 0.03, 1),
      actif: m.enabled !== false,
    }));
  }
  if (config?.presetId && PRESETS_SOUS_TITRES.includes(config.presetId))
    projet.style.preset = config.presetId;
  if (config?.subtitle) {
    projet.style.surcharges = objetClean(
      Object.fromEntries(
        CLEFS_STYLE.filter((cle) => config.subtitle[cle] !== undefined).map((cle) => [
          cle,
          config.subtitle[cle],
        ]),
      ),
    );
  }
  if (config?.options) {
    projet.options = {
      ...projet.options,
      motParMot: Boolean(config.options.wordByWord),
      retirerSonOriginal: Boolean(config.options.removeOriginalAudio),
      couperSilences: Boolean(config.options.cutSilences),
      miroir: Boolean(config.options.mirror),
      fournisseurVoix: FOURNISSEURS_VOIX.includes(config.options.ttsProvider)
        ? config.options.ttsProvider
        : projet.options.fournisseurVoix,
      filtre: FILTRES.includes(config.options.filterId) ? config.options.filterId : "none",
      upscale: UPSCALE.includes(config.options.upscale) ? config.options.upscale : "none",
      transition: TRANSITIONS.includes(config.options.transition)
        ? config.options.transition
        : "none",
      dureeTransition: bornee(Number(config.options.transitionDuration) || 0.25, 0.1, 3),
      opaciteFond: bornee(Number(config.options.subtitleOpacity ?? 0.92), 0, 1),
      niveauAmbiance: bornee(Number(config.options.ambienceLevel ?? 0.25), 0, 1),
      forceMasque: FORCES_MASQUE.includes(config.options.maskStrength)
        ? config.options.maskStrength
        : "medium",
    };
  }
  if (config?.sourceLanguage) projet.langues.source = String(config.sourceLanguage);
  if (config?.targetLanguage) projet.langues.cible = String(config.targetLanguage);
  return projet;
}
