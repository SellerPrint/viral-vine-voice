/**
 * Exemple d'utilisation des sous-titres HyperFrames dans ViralDub
 *
 * Ce fichier montre comment intégrer les sous-titres animés HyperFrames
 * dans le pipeline de traitement vidéo existant.
 */

import { runPipeline } from "../pipeline";
import {
  HYPERFRAMES_PRESETS,
  type HyperFramesPreset,
} from "./composition";

// ─── Exemple 1 : Pipeline avec HyperFrames (défaut) ─────────────────────

/**
 * Utilise HyperFrames pour les sous-titres animés par défaut.
 * Le pipeline détecte automatiquement les cues et génère des animations.
 */
export async function exampleWithHyperFrames() {
  const fileInput = document.querySelector<HTMLInputElement>("#file-input");
  const file = fileInput?.files?.[0];

  if (!file) {
    alert("Sélectionne une vidéo");
    return;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // HyperFrames est activé par défaut
  const result = await runPipeline(
    { name: file.name, bytes },
    (step, detail, pct) => {
      console.log(`[${step}] ${detail ?? ""} ${pct ? `${Math.round(pct * 100)}%` : ""}`);
    }
  );

  // Télécharger la vidéo
  const url = URL.createObjectURL(result.videoBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `viraldub-hyperframes-${Date.now()}.mp4`;
  a.click();
}

// ─── Exemple 2 : Liste des presets disponibles ───────────────────────────

/**
 * Affiche tous les presets HyperFrames disponibles.
 */
export function exampleListPresets() {
  console.log("Presets HyperFrames disponibles :");
  console.log("================================");

  HYPERFRAMES_PRESETS.forEach((preset) => {
    console.log(`\n📌 ${preset.name} (${preset.id})`);
    console.log(`   - Taille: ${preset.fontSize}px`);
    console.log(`   - Police: ${preset.fontFamily}`);
    console.log(`   - Couleur: ${preset.color}`);
    console.log(`   - Animation: ${preset.entrance}`);
    console.log(`   - Mot par mot: ${preset.wordByWord ? "Oui" : "Non"}`);
  });

  return HYPERFRAMES_PRESETS;
}

// ─── Exemple 3 : Générer une composition HTML pour prévisualisation ─────

/**
 * Génère la composition HTML HyperFrames sans la rendre en vidéo.
 * Utile pour prévisualiser les sous-titres dans un iframe.
 */
export function exampleGenerateComposition() {
  // Import dynamique pour éviter les erreurs de type
  const composition = require("./composition");

  // Cues de test
  const testCues = [
    {
      text: "HELLO WORLD",
      start: 0.5,
      end: 2.0,
    },
    {
      text: "BIENVENUE SUR VIRALDUB",
      start: 2.5,
      end: 4.5,
    },
  ];

  // Générer la composition avec le preset TikTok Pop
  const html = composition.generateHyperFramesComposition(
    testCues,
    HYPERFRAMES_PRESETS[0],
    {
      width: 1080,
      height: 1920,
    }
  );

  // Afficher dans un iframe
  const iframe = document.createElement("iframe");
  iframe.srcdoc = html;
  iframe.style.width = "360px";
  iframe.style.height = "640px";
  iframe.style.border = "none";
  document.body.appendChild(iframe);

  return html;
}
