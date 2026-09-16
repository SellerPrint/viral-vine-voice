/**
 * Fiches lisibles des catalogues CapCut — copie assumée des constantes app.
 *
 * `serveur.test.mjs` compare les `id` (et les noms) aux listes de
 * `src/lib/**`. Un écart de nommage ici, c'est un agent qui choisit « glow »
 * en croyant que c'est un filtre.
 */
export const FICHES_FILTRES = [
  { id: "none", nom: "Aucun", description: "Image d'origine, sans retouche." },
  { id: "pure", nom: "Pure", description: "Legere montee de contraste et de nettete. Rendu propre et neutre." },
  { id: "vivid", nom: "Vivid", description: "Couleurs saturees et contrastees, style reseaux sociaux." },
  { id: "warm", nom: "Chaud", description: "Temperature plus chaude, teint dore." },
  { id: "cool", nom: "Froid", description: "Dominante bleutee, ambiance nocturne." },
  { id: "film", nom: "Film", description: "Contraste doux et teintes desaturees, look cinema." },
  { id: "bw", nom: "Noir & blanc", description: "Monochrome contraste." },
  { id: "vintage", nom: "Vintage", description: "Look Shotcut / Kdenlive : contraste doux, un peu de sépia." },
  { id: "fade", nom: "Fade", description: "Image délavée, façon Omniclip cinéma." },
  { id: "punch", nom: "Punch", description: "Contraste et saturation poussés, style CapCut Pop." },
];

export const FICHES_VFX = [
  { id: "none", nom: "Aucun", description: "Pas d'effet visuel.", categorie: "camera" },
  { id: "glow", nom: "Lueur", description: "Halo doux, visages plus lumineux.", categorie: "light" },
  { id: "bloom", nom: "Bloom", description: "Hautes lumières qui débordent, look clip.", categorie: "light" },
  { id: "neon", nom: "Néon", description: "Saturation punchy, contours plus nets.", categorie: "light" },
  { id: "flash", nom: "Flash", description: "Éclats blancs type transition CapCut.", categorie: "light" },
  { id: "strobe", nom: "Stroboscope", description: "Clignotements rapides, club / drop.", categorie: "light" },
  { id: "leak", nom: "Fuite de lumière", description: "Voile chaud, lumière qui entre dans l'objectif.", categorie: "light" },
  { id: "golden", nom: "Golden hour", description: "Soleil rasant, tons miel.", categorie: "light" },
  { id: "moonlight", nom: "Clair de lune", description: "Nuit bleutée, bas volume de couleur.", categorie: "light" },
  { id: "rim", nom: "Contre-jour", description: "Sujet détouré, bords plus clairs.", categorie: "light" },
  { id: "flare", nom: "Lens flare", description: "Voile chaud + halo, soleil dans l'axe.", categorie: "light" },
  { id: "shake", nom: "Tremblement", description: "Caméra qui tremble — impact, drop, punch.", categorie: "camera" },
  { id: "handheld", nom: "Caméra à l'épaule", description: "Micro-mouvements, documentaire.", categorie: "camera" },
  { id: "zoom", nom: "Zoom punch", description: "Poussée vers l'avant, rythme des cuts viraux.", categorie: "camera" },
  { id: "crash", nom: "Crash zoom", description: "Zoom violent + contraste, punchline.", categorie: "camera" },
  { id: "dutch", nom: "Dutch angle", description: "Horizon penché, malaise / tension.", categorie: "camera" },
  { id: "pulse", nom: "Pulse", description: "Image qui respire au rythme du beat.", categorie: "camera" },
  { id: "glitch", nom: "Glitch", description: "Décalage RGB et saccades, style digital.", categorie: "glitch" },
  { id: "rgb", nom: "RGB split", description: "Aberration chromatique, canaux écartés.", categorie: "glitch" },
  { id: "pixel", nom: "Pixel", description: "Mosaïque / 8-bit, comme l'effet Pixelate.", categorie: "glitch" },
  { id: "mosaic", nom: "Mosaïque", description: "Gros blocs, censure / low-fi.", categorie: "glitch" },
  { id: "static", nom: "Snow TV", description: "Neige analogique, canal mal réglé.", categorie: "glitch" },
  { id: "hologram", nom: "Hologramme", description: "Cyan / magenta, scan sci-fi.", categorie: "glitch" },
  { id: "cyber", nom: "Cyberpunk", description: "Teal et magenta, néons de rue.", categorie: "glitch" },
  { id: "scanline", nom: "Scanlines", description: "Lignes CRT, moniteur vintage.", categorie: "glitch" },
  { id: "grain", nom: "Grain", description: "Bruit de capteur, matière film.", categorie: "film" },
  { id: "vignette", nom: "Vignette", description: "Bords assombris, sujet au centre.", categorie: "film" },
  { id: "filmold", nom: "Film ancien", description: "Grain, vignette et couleurs fanées.", categorie: "film" },
  { id: "vhs", nom: "VHS", description: "Bande analogique : bruit, teinte et contraste.", categorie: "film" },
  { id: "crt", nom: "CRT", description: "Tube cathodique, légèrement bombé visuellement.", categorie: "film" },
  { id: "super8", nom: "Super 8", description: "Petit format, grain fort, couleurs chaudes.", categorie: "film" },
  { id: "polaroid", nom: "Polaroid", description: "Tirage instantané, pastels et voile.", categorie: "film" },
  { id: "bleach", nom: "Bleach bypass", description: "Argentique skip-bleach, métal et contraste.", categorie: "film" },
  { id: "tealorange", nom: "Teal & orange", description: "Look blockbuster, ombres froides peaux chaudes.", categorie: "film" },
  { id: "noir", nom: "Noir", description: "Monochrome dur, polar des années 40.", categorie: "film" },
  { id: "sepia", nom: "Sépia", description: "Carte postale, photo de famille.", categorie: "film" },
  { id: "lofi", nom: "Lo-fi", description: "Image un peu sale, compact jetable.", categorie: "film" },
  { id: "y2k", nom: "Y2K", description: "Flash compact, couleurs sucrées 2000s.", categorie: "film" },
  { id: "dream", nom: "Rêve", description: "Flou doux, image un peu laiteuse.", categorie: "blur" },
  { id: "blur", nom: "Flou", description: "Gaussian plein cadre — intro / outro.", categorie: "blur" },
  { id: "motion", nom: "Flou de mouvement", description: "Trainée horizontale, whip pan.", categorie: "blur" },
  { id: "radial", nom: "Flou radial", description: "Centre net, bords qui filent.", categorie: "blur" },
  { id: "tilt", nom: "Tilt-shift", description: "Miniature, bas et haut fondus.", categorie: "blur" },
  { id: "soft", nom: "Doux", description: "Peau lissée, pub beauté.", categorie: "blur" },
  { id: "sharpen", nom: "Netteté", description: "Contours croustillants, détail.", categorie: "blur" },
  { id: "fog", nom: "Brouillard", description: "Voile blanc, distance perdue.", categorie: "blur" },
  { id: "invert", nom: "Négatif", description: "Couleurs inversées.", categorie: "color" },
  { id: "poster", nom: "Poster", description: "Aplats, peu de niveaux.", categorie: "color" },
  { id: "comic", nom: "Comics", description: "Encre et couleurs pop.", categorie: "color" },
  { id: "thermal", nom: "Thermique", description: "Palette chaleur, caméra IR.", categorie: "color" },
  { id: "nightvis", nom: "Vision nocturne", description: "Vert militaire, grain.", categorie: "color" },
  { id: "duotone", nom: "Duotone", description: "Deux teintes, affiche.", categorie: "color" },
  { id: "pastel", nom: "Pastel", description: "Couleurs lessivées, aesthetic.", categorie: "color" },
  { id: "ice", nom: "Glace", description: "Froid, cyan, peau pâle.", categorie: "color" },
  { id: "fire", nom: "Braise", description: "Rouges saturés, chaleur.", categorie: "color" },
  { id: "underwater", nom: "Sous-marin", description: "Cyan profond, un peu de flou.", categorie: "color" },
  { id: "infrared", nom: "Infrarouge", description: "Foliage blanc, ciels sombres.", categorie: "color" },
  { id: "acid", nom: "Acid", description: "Teintes chimiques, clip rave.", categorie: "color" },
  { id: "matte", nom: "Matte", description: "Noirs relevés, look log / LUT.", categorie: "color" },
];

export const FICHES_TEXTE = [
  { id: "none", nom: "Aucun", description: "Texte posé, sans entrée.", categorie: "entree" },
  { id: "fade", nom: "Fondu", description: "Apparaît en fondu, classique CapCut.", categorie: "entree" },
  { id: "pop", nom: "Pop", description: "Scale élastique, sticker.", categorie: "entree" },
  { id: "bounce", nom: "Rebond", description: "Tombe et rebondit.", categorie: "entree" },
  { id: "slide-up", nom: "Glisse haut", description: "Monte depuis le bas.", categorie: "entree" },
  { id: "slide-down", nom: "Glisse bas", description: "Descend depuis le haut.", categorie: "entree" },
  { id: "slide-left", nom: "Glisse gauche", description: "Entre par la droite.", categorie: "entree" },
  { id: "slide-right", nom: "Glisse droite", description: "Entre par la gauche.", categorie: "entree" },
  { id: "typewriter", nom: "Machine à écrire", description: "Lettres qui se dévoilent.", categorie: "entree" },
  { id: "scale", nom: "Zoom", description: "Gros plan sur le mot.", categorie: "entree" },
  { id: "zoom-out", nom: "Dézoom", description: "Recule depuis un gros plan.", categorie: "entree" },
  { id: "blur-in", nom: "Flou d'entrée", description: "Net depuis le flou.", categorie: "entree" },
  { id: "blur-out", nom: "Flou de sortie", description: "Se dissout dans le flou.", categorie: "entree" },
  { id: "drop", nom: "Chute", description: "Tombe du haut, atterrit.", categorie: "entree" },
  { id: "rise", nom: "Montée", description: "Monte lentement, titrage.", categorie: "entree" },
  { id: "elastic", nom: "Élastique", description: "Étire puis relâche.", categorie: "entree" },
  { id: "flip", nom: "Flip", description: "Retournement 3D sur l'axe Y.", categorie: "entree" },
  { id: "glitch", nom: "Glitch", description: "Saccades RGB, digital.", categorie: "impact" },
  { id: "shake", nom: "Tremblement", description: "Impact sur le mot.", categorie: "impact" },
  { id: "spin", nom: "Toupie", description: "Petit tour sur soi.", categorie: "impact" },
  { id: "explode", nom: "Explosion", description: "Scale + flash, punchline.", categorie: "impact" },
  { id: "rotate", nom: "Rotation", description: "Légère bascule d'entrée.", categorie: "impact" },
  { id: "wave", nom: "Vague", description: "Ligne qui ondule.", categorie: "loop" },
  { id: "karaoke", nom: "Karaoké", description: "Balayage de lumière.", categorie: "loop" },
  { id: "glow", nom: "Lueur", description: "Halo qui pulse.", categorie: "loop" },
  { id: "neon", nom: "Néon", description: "Enseigne qui clignote.", categorie: "loop" },
  { id: "heartbeat", nom: "Pouls", description: "Bat au rythme, like.", categorie: "loop" },
  { id: "flicker", nom: "Scintillement", description: "Ampoule fatiguée.", categorie: "loop" },
];

export const FICHES_SFX = [
  { id: "whoosh", nom: "Whoosh", description: "Souffle court de transition.", categorie: "whoosh", duree: 0.42 },
  { id: "whoosh-long", nom: "Whoosh long", description: "Balayage plus ample, coupe whip.", categorie: "whoosh", duree: 0.78 },
  { id: "whoosh-in", nom: "Whoosh in", description: "Arrive dans le plan.", categorie: "whoosh", duree: 0.5 },
  { id: "whoosh-out", nom: "Whoosh out", description: "Sort du plan.", categorie: "whoosh", duree: 0.48 },
  { id: "swipe", nom: "Swipe", description: "Glissement d'écran, UI mobile.", categorie: "whoosh", duree: 0.32 },
  { id: "whip", nom: "Whip", description: "Coup de fouet, whip pan.", categorie: "whoosh", duree: 0.28 },
  { id: "swoosh", nom: "Swoosh", description: "Souffle plus grave, logo.", categorie: "whoosh", duree: 0.55 },
  { id: "reverse", nom: "Reverse", description: "Whoosh à l'envers, anticipation.", categorie: "whoosh", duree: 0.62 },
  { id: "impact", nom: "Impact", description: "Frappe sèche, punch visuel.", categorie: "hit", duree: 0.38 },
  { id: "boom", nom: "Boom", description: "Sub grave, drop.", categorie: "hit", duree: 0.72 },
  { id: "bass", nom: "Bass drop", description: "Descente de basse, beat.", categorie: "hit", duree: 0.55 },
  { id: "slam", nom: "Slam", description: "Porte / objet qui claque.", categorie: "hit", duree: 0.34 },
  { id: "punch", nom: "Punch", description: "Coup de poing, combat.", categorie: "hit", duree: 0.26 },
  { id: "thud", nom: "Thud", description: "Chute sourde.", categorie: "hit", duree: 0.44 },
  { id: "crash", nom: "Crash", description: "Casse, débris.", categorie: "hit", duree: 0.7 },
  { id: "kick", nom: "Kick", description: "Grosse caisse, 808 court.", categorie: "hit", duree: 0.32 },
  { id: "click", nom: "Clic", description: "Clic UI, marqueur de cut.", categorie: "ui", duree: 0.1 },
  { id: "snap", nom: "Snap", description: "Claquement de doigts.", categorie: "ui", duree: 0.16 },
  { id: "pop", nom: "Pop", description: "Bulle / sticker qui apparaît.", categorie: "ui", duree: 0.18 },
  { id: "tap", nom: "Tap", description: "Doigt sur l'écran.", categorie: "ui", duree: 0.09 },
  { id: "shutter", nom: "Shutter", description: "Déclencheur photo, deux lames.", categorie: "ui", duree: 0.26 },
  { id: "type", nom: "Clavier", description: "Trois frappes, texte qui tombe.", categorie: "ui", duree: 0.38 },
  { id: "notify", nom: "Notif", description: "Deux tons, alerte douce.", categorie: "ui", duree: 0.48 },
  { id: "send", nom: "Send", description: "Message envoyé.", categorie: "ui", duree: 0.28 },
  { id: "like", nom: "Like", description: "Cœur / like TikTok.", categorie: "ui", duree: 0.36 },
  { id: "toggle", nom: "Toggle", description: "Interrupteur, switch.", categorie: "ui", duree: 0.14 },
  { id: "riser", nom: "Riser", description: "Montée de tension avant le cut.", categorie: "riser", duree: 1.15 },
  { id: "riser-short", nom: "Riser court", description: "Montée d'une seconde pile.", categorie: "riser", duree: 0.7 },
  { id: "downer", nom: "Downer", description: "Descente, fin de séquence.", categorie: "riser", duree: 0.9 },
  { id: "tension", nom: "Tension", description: "Drone qui monte, thriller.", categorie: "riser", duree: 1.4 },
  { id: "reverse-cym", nom: "Cymbale reverse", description: "Anticipation classique.", categorie: "riser", duree: 1.05 },
  { id: "glitch", nom: "Glitch", description: "Rafales numériques.", categorie: "texture", duree: 0.34 },
  { id: "sparkle", nom: "Étincelle", description: "Tintements aigus, magic / like.", categorie: "texture", duree: 0.58 },
  { id: "static", nom: "Static", description: "Souffle TV, neige.", categorie: "texture", duree: 0.5 },
  { id: "zap", nom: "Zap", description: "Décharge électrique.", categorie: "texture", duree: 0.22 },
  { id: "digital", nom: "Digital", description: "Artefact data, buffer.", categorie: "texture", duree: 0.4 },
  { id: "record", nom: "Vinyl crackle", description: "Poussière de disque.", categorie: "texture", duree: 0.8 },
  { id: "braam", nom: "Braam", description: "Cuivre Inception, trailer.", categorie: "cinematic", duree: 1.2 },
  { id: "subdrop", nom: "Sub drop", description: "Infra, salle obscure.", categorie: "cinematic", duree: 1.0 },
  { id: "stinger", nom: "Stinger", description: "Horreur, jump scare.", categorie: "cinematic", duree: 0.55 },
  { id: "trailer", nom: "Trailer hit", description: "Hit de bande-annonce.", categorie: "cinematic", duree: 0.85 },
  { id: "heartbeat", nom: "Heartbeat", description: "Deux battements, suspense.", categorie: "cinematic", duree: 1.15 },
  { id: "air", nom: "Souffle", description: "Inspiration, cut dramatique.", categorie: "cinematic", duree: 0.45 },
  { id: "boing", nom: "Boing", description: "Ressort, rebond.", categorie: "cartoon", duree: 0.45 },
  { id: "plop", nom: "Plop", description: "Goutte / bulle.", categorie: "cartoon", duree: 0.2 },
  { id: "zip", nom: "Zip", description: "Course cartoon.", categorie: "cartoon", duree: 0.3 },
  { id: "slide", nom: "Sifflet", description: "Glissando descendant.", categorie: "cartoon", duree: 0.55 },
  { id: "honk", nom: "Klaxon", description: "Poire, gag.", categorie: "cartoon", duree: 0.28 },
  { id: "clap", nom: "Clap", description: "Claquement de mains.", categorie: "cartoon", duree: 0.22 },
  { id: "hat", nom: "Hi-hat", description: "Cymbale fermée, rythme.", categorie: "cartoon", duree: 0.14 },
  { id: "laser", nom: "Laser", description: "Tir sci-fi.", categorie: "tech", duree: 0.32 },
  { id: "beep", nom: "Beep", description: "Bip machine, UI rétro.", categorie: "tech", duree: 0.18 },
  { id: "beep-double", nom: "Beep ×2", description: "Deux bips, confirmation.", categorie: "tech", duree: 0.32 },
  { id: "scan", nom: "Scan", description: "Balayage sonar / HUD.", categorie: "tech", duree: 0.7 },
  { id: "warp", nom: "Warp", description: "Saut hyperspace.", categorie: "tech", duree: 0.85 },
  { id: "powerup", nom: "Power-up", description: "Bonus jeu vidéo.", categorie: "tech", duree: 0.5 },
  { id: "powerdown", nom: "Power-down", description: "Machine qui s'éteint.", categorie: "tech", duree: 0.6 },
  { id: "modem", nom: "Modem", description: "Handshake 56k, nostalgie.", categorie: "tech", duree: 0.65 },
];

export const FICHES_TRANSITIONS = [
  { id: "none", nom: "Coupe franche", description: "Raccord sec, sans recouvrement.", categorie: "coupe" },
  { id: "fade", nom: "Fondu", description: "Fondu enchaîné classique.", categorie: "fondu" },
  { id: "fadeblack", nom: "Fondu au noir", description: "Passe par le noir.", categorie: "fondu" },
  { id: "fadewhite", nom: "Fondu au blanc", description: "Flash blanc entre deux plans.", categorie: "fondu" },
  { id: "dissolve", nom: "Dissolution", description: "Les deux images se mélangent.", categorie: "fondu" },
  { id: "fadegrays", nom: "Fondu gris", description: "Passe par le gris, plus doux que le noir.", categorie: "fondu" },
  { id: "fadefast", nom: "Fondu vif", description: "Courbe rapide, cut presque.", categorie: "fondu" },
  { id: "fadeslow", nom: "Fondu lent", description: "Courbe douce, cinéma.", categorie: "fondu" },
  { id: "slideleft", nom: "Glisse gauche", description: "Le plan suivant pousse vers la gauche.", categorie: "glisse" },
  { id: "slideright", nom: "Glisse droite", description: "Pousse vers la droite.", categorie: "glisse" },
  { id: "slideup", nom: "Glisse haut", description: "Pousse vers le haut.", categorie: "glisse" },
  { id: "slidedown", nom: "Glisse bas", description: "Pousse vers le bas.", categorie: "glisse" },
  { id: "coverleft", nom: "Couvre gauche", description: "Le nouveau plan recouvre en glissant.", categorie: "glisse" },
  { id: "coverright", nom: "Couvre droite", description: "Recouvre depuis la droite.", categorie: "glisse" },
  { id: "coverup", nom: "Couvre haut", description: "Recouvre depuis le haut.", categorie: "glisse" },
  { id: "coverdown", nom: "Couvre bas", description: "Recouvre depuis le bas.", categorie: "glisse" },
  { id: "revealleft", nom: "Révèle gauche", description: "L'ancien plan s'écarte, le nouveau apparaît.", categorie: "glisse" },
  { id: "revealright", nom: "Révèle droite", description: "Révèle vers la droite.", categorie: "glisse" },
  { id: "wipeleft", nom: "Balayage gauche", description: "Ligne qui balaie vers la gauche.", categorie: "balayage" },
  { id: "wiperight", nom: "Balayage droite", description: "Ligne vers la droite.", categorie: "balayage" },
  { id: "wipeup", nom: "Balayage haut", description: "Ligne vers le haut.", categorie: "balayage" },
  { id: "wipedown", nom: "Balayage bas", description: "Ligne vers le bas.", categorie: "balayage" },
  { id: "diagtl", nom: "Diagonale HG", description: "Balayage du haut-gauche.", categorie: "balayage" },
  { id: "diagbr", nom: "Diagonale BD", description: "Balayage du bas-droit.", categorie: "balayage" },
  { id: "pixelize", nom: "Pixels", description: "Mosaïque qui se reforme, clip digital.", categorie: "punch" },
  { id: "zoomin", nom: "Zoom", description: "Poussée vers l'avant au raccord.", categorie: "punch" },
  { id: "hblur", nom: "Flou whip", description: "Whip pan flou, rythme viral.", categorie: "punch" },
  { id: "smoothleft", nom: "Smooth gauche", description: "Glisse adoucie, moins brutale.", categorie: "punch" },
  { id: "circleopen", nom: "Iris ouvre", description: "Cercle qui s'ouvre sur le plan suivant.", categorie: "iris" },
  { id: "circleclose", nom: "Iris ferme", description: "Cercle qui se referme.", categorie: "iris" },
  { id: "radial", nom: "Radial", description: "Balayage en étoile depuis le centre.", categorie: "iris" },
  { id: "squeezeh", nom: "Squeeze H", description: "L'image se comprime à l'horizontale.", categorie: "iris" },
  { id: "squeezev", nom: "Squeeze V", description: "Compresse à la verticale.", categorie: "iris" },
  { id: "horzopen", nom: "Ouvre H", description: "Fente horizontale qui s'ouvre.", categorie: "iris" },
  { id: "vertopen", nom: "Ouvre V", description: "Fente verticale qui s'ouvre.", categorie: "iris" },
];

const PAR_FAMILLE = {
  filtres: FICHES_FILTRES,
  vfx: FICHES_VFX,
  texte: FICHES_TEXTE,
  sfx: FICHES_SFX,
  transitions: FICHES_TRANSITIONS,
};

function normaliser(q) {
  return String(q ?? "").trim().toLowerCase();
}

function correspond(item, q, categorie) {
  if (categorie && item.categorie && item.categorie !== categorie) return false;
  if (!q) return true;
  const hay = `${item.id} ${item.nom ?? ""} ${item.description ?? ""} ${item.categorie ?? ""}`.toLowerCase();
  return hay.includes(q);
}

/**
 * Catalogue filtré : ids + fiches, pour qu'un agent choisisse sans deviner.
 */
export function listerCatalogues(entrees = {}) {
  const famille = entrees.famille ?? "tout";
  const q = normaliser(entrees.q ?? entrees.recherche);
  const categorie = entrees.categorie && entrees.categorie !== "all" ? entrees.categorie : undefined;
  const cles = famille === "tout" ? Object.keys(PAR_FAMILLE) : [famille];
  if (famille !== "tout" && !PAR_FAMILLE[famille]) {
    throw new RangeError(`famille « ${famille} » inconnue — choix : ${Object.keys(PAR_FAMILLE).join(", ")}, tout`);
  }
  const catalogues = {};
  for (const cle of cles) {
    const items = PAR_FAMILLE[cle].filter((item) => correspond(item, q, categorie));
    catalogues[cle] = {
      total: PAR_FAMILLE[cle].length,
      retenus: items.length,
      items,
    };
  }
  return catalogues;
}
