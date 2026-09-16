/**
 * Animations de légende façon CapCut Pro (onglet Texte / Effets).
 *
 * L'aperçu est CSS sur `.ed-subtitle-text`. `drawtext` de FFmpeg n'anime pas :
 * l'export pose le texte tel quel, l'atelier montre le geste.
 */

export type TextFxCategory = "entree" | "loop" | "impact";

export type TextFx = {
  id: string;
  name: string;
  description: string;
  category: TextFxCategory;
  /** Classe posée sur la ligne de légende. Vide = pas d'animation. */
  cssClass: string;
};

export const TEXT_FX_CATEGORIES: { id: TextFxCategory; label: string }[] = [
  { id: "entree", label: "Entrée" },
  { id: "loop", label: "Boucle" },
  { id: "impact", label: "Impact" },
];

export const TEXT_FX: TextFx[] = [
  { id: "none", name: "Aucun", description: "Texte posé, sans entrée.", category: "entree", cssClass: "" },
  { id: "fade", name: "Fondu", description: "Apparaît en fondu, classique CapCut.", category: "entree", cssClass: "ed-textfx-fade" },
  { id: "pop", name: "Pop", description: "Scale élastique, sticker.", category: "entree", cssClass: "ed-textfx-pop" },
  { id: "bounce", name: "Rebond", description: "Tombe et rebondit.", category: "entree", cssClass: "ed-textfx-bounce" },
  { id: "slide-up", name: "Glisse haut", description: "Monte depuis le bas.", category: "entree", cssClass: "ed-textfx-slide-up" },
  { id: "slide-down", name: "Glisse bas", description: "Descend depuis le haut.", category: "entree", cssClass: "ed-textfx-slide-down" },
  { id: "slide-left", name: "Glisse gauche", description: "Entre par la droite.", category: "entree", cssClass: "ed-textfx-slide-left" },
  { id: "slide-right", name: "Glisse droite", description: "Entre par la gauche.", category: "entree", cssClass: "ed-textfx-slide-right" },
  { id: "typewriter", name: "Machine à écrire", description: "Lettres qui se dévoilent.", category: "entree", cssClass: "ed-textfx-type" },
  { id: "scale", name: "Zoom", description: "Gros plan sur le mot.", category: "entree", cssClass: "ed-textfx-scale" },
  { id: "zoom-out", name: "Dézoom", description: "Recule depuis un gros plan.", category: "entree", cssClass: "ed-textfx-zoom-out" },
  { id: "blur-in", name: "Flou d'entrée", description: "Net depuis le flou.", category: "entree", cssClass: "ed-textfx-blur" },
  { id: "blur-out", name: "Flou de sortie", description: "Se dissout dans le flou.", category: "entree", cssClass: "ed-textfx-blur-out" },
  { id: "drop", name: "Chute", description: "Tombe du haut, atterrit.", category: "entree", cssClass: "ed-textfx-drop" },
  { id: "rise", name: "Montée", description: "Monte lentement, titrage.", category: "entree", cssClass: "ed-textfx-rise" },
  { id: "elastic", name: "Élastique", description: "Étire puis relâche.", category: "entree", cssClass: "ed-textfx-elastic" },
  { id: "flip", name: "Flip", description: "Retournement 3D sur l'axe Y.", category: "entree", cssClass: "ed-textfx-flip" },
  { id: "glitch", name: "Glitch", description: "Saccades RGB, digital.", category: "impact", cssClass: "ed-textfx-glitch" },
  { id: "shake", name: "Tremblement", description: "Impact sur le mot.", category: "impact", cssClass: "ed-textfx-shake" },
  { id: "spin", name: "Toupie", description: "Petit tour sur soi.", category: "impact", cssClass: "ed-textfx-spin" },
  { id: "explode", name: "Explosion", description: "Scale + flash, punchline.", category: "impact", cssClass: "ed-textfx-explode" },
  { id: "rotate", name: "Rotation", description: "Légère bascule d'entrée.", category: "impact", cssClass: "ed-textfx-rotate" },
  { id: "wave", name: "Vague", description: "Ligne qui ondule.", category: "loop", cssClass: "ed-textfx-wave" },
  { id: "karaoke", name: "Karaoké", description: "Balayage de lumière.", category: "loop", cssClass: "ed-textfx-karaoke" },
  { id: "glow", name: "Lueur", description: "Halo qui pulse.", category: "loop", cssClass: "ed-textfx-glow" },
  { id: "neon", name: "Néon", description: "Enseigne qui clignote.", category: "loop", cssClass: "ed-textfx-neon" },
  { id: "heartbeat", name: "Pouls", description: "Bat au rythme, like.", category: "loop", cssClass: "ed-textfx-heartbeat" },
  { id: "flicker", name: "Scintillement", description: "Ampoule fatiguée.", category: "loop", cssClass: "ed-textfx-flicker" },
];

const BY_ID = new Map(TEXT_FX.map((item) => [item.id, item]));

export function getTextFx(id: string | undefined | null): TextFx {
  return BY_ID.get(id ?? "none") ?? TEXT_FX[0];
}
