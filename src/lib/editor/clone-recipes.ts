import type { Project } from "./types";
import type { TransitionType } from "@/lib/video/transitions";

/**
 * Recettes de look inspirées des clones CapCut open source.
 *
 * Ce ne sont pas des copies de code : chaque recette n'écrit que des champs
 * déjà connus du projet (filtre, preset, fondu, mot-à-mot). Le graphe ffmpeg
 * et l'EDL ne changent pas.
 */

export type CloneOrigin = "CapCut" | "OpenCut" | "Omniclip" | "Shotcut" | "Kdenlive";

export type CloneRecipe = {
  id: string;
  name: string;
  origin: CloneOrigin;
  license: string;
  url: string;
  blurb: string;
  patch: Partial<
    Pick<
      Project,
      | "presetId"
      | "filterId"
      | "vfxId"
      | "textFxId"
      | "wordByWord"
      | "boxOpacity"
      | "transition"
      | "transitionDuration"
      | "overrides"
    >
  > & { transition?: TransitionType };
};

export const CLONE_RECIPES: CloneRecipe[] = [
  {
    id: "capcut-pop",
    name: "CapCut Pop",
    origin: "CapCut",
    license: "Look libre",
    url: "https://www.capcut.com",
    blurb: "Légendes jaunes mot à mot, image Vivid — le rythme des Reels.",
    patch: {
      presetId: "capcut-pop",
      filterId: "vivid",
      vfxId: "zoom",
      textFxId: "pop",
      wordByWord: true,
      boxOpacity: 0,
      transition: "wipeleft",
      overrides: { uppercase: true, fontColor: "yellow", borderW: 12 },
    },
  },
  {
    id: "opencut-clean",
    name: "OpenCut Clean",
    origin: "OpenCut",
    license: "MIT",
    url: "https://github.com/OpenCut-app/OpenCut",
    blurb: "Montage local, légendes discrètes, coupe franche — clone CapCut MIT.",
    patch: {
      presetId: "discret",
      filterId: "pure",
      vfxId: "none",
      textFxId: "fade",
      wordByWord: false,
      boxOpacity: 0,
      transition: "none",
      overrides: { uppercase: false, fontColor: "white", borderW: 6 },
    },
  },
  {
    id: "omniclip-cinema",
    name: "Omniclip Cinéma",
    origin: "Omniclip",
    license: "MIT",
    url: "https://github.com/cosark/omni-clip",
    blurb: "Look film, fondu entre coupes, sous-titres classiques — éditeur web MIT.",
    patch: {
      presetId: "capcut-classic",
      filterId: "film",
      vfxId: "filmold",
      textFxId: "fade",
      wordByWord: false,
      boxOpacity: 0.35,
      transition: "fade",
      transitionDuration: 0.25,
      overrides: { uppercase: false, fontColor: "white", borderW: 8 },
    },
  },
  {
    id: "shotcut-mono",
    name: "Shotcut Mono",
    origin: "Shotcut",
    license: "GPL-3.0",
    url: "https://shotcut.org",
    blurb: "Noir et blanc contrasté, légende minimale — NLE open source.",
    patch: {
      presetId: "capcut-minimal",
      filterId: "bw",
      vfxId: "noir",
      textFxId: "none",
      wordByWord: false,
      boxOpacity: 0,
      transition: "none",
      overrides: { uppercase: false, fontColor: "white", borderW: 4 },
    },
  },
  {
    id: "kdenlive-warm",
    name: "Kdenlive Chaud",
    origin: "Kdenlive",
    license: "GPL-3.0",
    url: "https://kdenlive.org",
    blurb: "Température chaude et dissolution — l'atelier KDE.",
    patch: {
      presetId: "tiktok-bold",
      filterId: "warm",
      vfxId: "glow",
      textFxId: "bounce",
      wordByWord: true,
      boxOpacity: 0,
      transition: "dissolve",
      transitionDuration: 0.3,
      overrides: { uppercase: true, fontColor: "white", borderW: 10 },
    },
  },
];

export function cloneRecipe(id: string): CloneRecipe | undefined {
  return CLONE_RECIPES.find((item) => item.id === id);
}

export function applyCloneRecipe(
  project: Project,
  id: string,
): { patch: Partial<Project>; notice: string } | null {
  const recipe = cloneRecipe(id);
  if (!recipe) return null;
  return {
    patch: { ...recipe.patch },
    notice: `${recipe.name} appliqué (${recipe.origin}, ${recipe.license}). Filtre et légendes seulement — le graphe d'encodage ne change pas.`,
  };
}

export function matchingCloneRecipe(project: Project): string | null {
  for (const recipe of CLONE_RECIPES) {
    const { patch } = recipe;
    if (patch.presetId && patch.presetId !== project.presetId) continue;
    if (patch.filterId && patch.filterId !== project.filterId) continue;
    if (patch.transition && patch.transition !== project.transition) continue;
    if (typeof patch.wordByWord === "boolean" && patch.wordByWord !== project.wordByWord) continue;
    return recipe.id;
  }
  return null;
}
