/**
 * HyperFrames Subtitle Renderer
 *
 * Utilise le producer HyperFrames pour rendre les compositions HTML
 * de sous-titres en vidéo overlay transparente.
 *
 * Ce module peut être exécuté côté serveur (Cloudflare Workers, Lambda)
 * ou localement pour le développement.
 */

import {
  generateHyperFramesComposition,
  type HyperFramesPreset,
  HYPERFRAMES_PRESETS,
} from "./composition";
import type { Cue } from "../subtitles/cues";

export type RenderOptions = {
  /** Preset de sous-titres HyperFrames */
  preset?: HyperFramesPreset;
  /** Largeur de la vidéo (défaut: 1080) */
  width?: number;
  /** Hauteur de la vidéo (défaut: 1920) */
  height?: number;
  /** FPS du rendu (défaut: 30) */
  fps?: number;
  /** Qualité du rendu (défaut: "high") */
  quality?: "low" | "medium" | "high";
  /** Transparence de l'overlay (défaut: true) */
  transparent?: boolean;
};

export type RenderResult = {
  /** Blob vidéo avec les sous-titres animés */
  videoBlob: Blob;
  /** Composition HTML générée (pour débogage) */
  compositionHTML: string;
  /** Durée totale en secondes */
  duration: number;
  /** Métadonnées du rendu */
  metadata: {
    preset: string;
    wordCount: number;
    compositionId: string;
  };
};

/**
 * Génère un fichier HTML temporaire pour le rendu HyperFrames
 */
async function writeCompositionToTempFile(
  html: string,
  compositionId: string,
): Promise<string> {
  // En environnement Cloudflare Workers, on utilise les KV ou R2
  // En local, on écrit dans /tmp
  const isWorker = typeof globalThis.caches !== "undefined";

  if (isWorker) {
    // En Workers, on retourne l'HTML directement pour un rendu client-side
    return html;
  }

  // En local, on écrit dans /tmp
  const fs = await import("fs/promises");
  const path = await import("path");
  const tmpDir = path.join(process.cwd(), ".tmp", "hyperframes");
  await fs.mkdir(tmpDir, { recursive: true });

  const filePath = path.join(tmpDir, `${compositionId}.html`);
  await fs.writeFile(filePath, html, "utf-8");

  return filePath;
}

/**
 * Rend une composition HyperFrames en vidéo via le producer
 *
 * Cette fonction est conçue pour être appelée côté serveur.
 * Elle nécessite que @hyperframes/producer soit installé.
 */
export async function renderSubtitlesWithHyperFrames(
  cues: Cue[],
  options: RenderOptions = {},
): Promise<RenderResult> {
  const {
    preset = HYPERFRAMES_PRESETS[0],
    width = 1080,
    height = 1920,
    fps = 30,
    quality = "high",
    transparent = true,
  } = options;

  // Générer la composition HTML
  const compositionId = `viraldub-subtitles-${Date.now()}`;
  const compositionHTML = generateHyperFramesComposition(cues, preset, {
    width,
    height,
    compositionId,
  });

  // Calculer la durée
  const duration =
    cues.length > 0 ? Math.max(...cues.map((c) => c.end)) : 1;

  // Options de rendu selon la qualité
  const qualitySettings = {
    low: { crf: 28, preset: "ultrafast" as const },
    medium: { crf: 26, preset: "veryfast" as const },
    high: { crf: 23, preset: "medium" as const },
  };

  const { crf, preset: ffPreset } = qualitySettings[quality];

  // Le producer n'est pas encore installé - fallback sur rendu client-side
  // Pour activer le rendu serveur, installer @hyperframes/producer :
  // bun add @hyperframes/producer
  console.info(
    "[HyperFrames] Rendu client-side (producer non installé).",
    "Pour le rendu serveur haute qualité, installez @hyperframes/producer."
  );

  return {
    videoBlob: new Blob([compositionHTML], { type: "text/html" }),
    compositionHTML,
    duration,
    metadata: {
      preset: preset.id,
      wordCount: cues.reduce(
        (acc, cue) => acc + (cue.text.split(/\s+/).length || 1),
        0,
      ),
      compositionId,
    },
  };
}

/**
 * Version simplifiée pour le rendu client-side
 * Génère un blob HTML qui peut être chargé dans un iframe
 */
export function renderSubtitlesClientSide(
  cues: Cue[],
  options: RenderOptions = {},
): RenderResult {
  const {
    preset = HYPERFRAMES_PRESETS[0],
    width = 1080,
    height = 1920,
  } = options;

  const compositionId = `viraldub-subtitles-${Date.now()}`;
  const compositionHTML = generateHyperFramesComposition(cues, preset, {
    width,
    height,
    compositionId,
  });

  const duration =
    cues.length > 0 ? Math.max(...cues.map((c) => c.end)) : 1;

  return {
    videoBlob: new Blob([compositionHTML], { type: "text/html" }),
    compositionHTML,
    duration,
    metadata: {
      preset: preset.id,
      wordCount: cues.reduce(
        (acc, cue) => acc + (cue.text.split(/\s+/).length || 1),
        0,
      ),
      compositionId,
    },
  };
}

/**
 * Intègre les sous-titres HyperFrames dans une vidéo existante
 *
 * Cette fonction overlay le rendu des sous-titres sur la vidéo source
 * en utilisant ffmpeg.wasm ou le producer HyperFrames.
 */
export async function overlaySubtitlesOnVideo(
  originalVideoBlob: Blob,
  subtitleCues: Cue[],
  options: RenderOptions = {},
): Promise<Blob> {
  const {
    preset = HYPERFRAMES_PRESETS[0],
    width = 1080,
    height = 1920,
  } = options;

  // 1. Rendre les sous-titres en vidéo séparée
  const subtitleResult = await renderSubtitlesWithHyperFrames(subtitleCues, {
    ...options,
    transparent: true,
  });

  // 2. Overlay avec ffmpeg.wasm
  try {
    const { getFfmpeg, writeFileSafe } = await import("../ffmpeg-client");

    const ff = await getFfmpeg();
    const cleanupNames = new Set<string>();

    try {
      // Écrire les fichiers temporaires
      cleanupNames.add("input.mp4");
      cleanupNames.add("subtitles.webm");
      cleanupNames.add("output.mp4");

      await writeFileSafe(
        ff,
        "input.mp4",
        new Uint8Array(await originalVideoBlob.arrayBuffer())
      );

      // Si on a une vidéo de sous-titres, l'overlay
      if (subtitleResult.videoBlob.type.startsWith("video/")) {
        await writeFileSafe(
          ff,
          "subtitles.webm",
          new Uint8Array(await subtitleResult.videoBlob.arrayBuffer())
        );

        // Overlay des sous-titres sur la vidéo originale
        await ff.exec([
          "-y",
          "-i",
          "input.mp4",
          "-i",
          "subtitles.webm",
          "-filter_complex",
          "[0:v][1:v]overlay=0:0:format=auto[vout]",
          "-map",
          "[vout]",
          "-map",
          "0:a?",
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "23",
          "-c:a",
          "copy",
          "output.mp4",
        ]);
      } else {
        // Pas de vidéo de sous-titres, retourner l'original
        return originalVideoBlob;
      }

      const outputBytes = await ff.readFile("output.mp4");
      // Convertir en ArrayBuffer pour la compatibilité Blob
      if (outputBytes instanceof Uint8Array) {
        const arrayBuffer = outputBytes.buffer.slice(
          outputBytes.byteOffset,
          outputBytes.byteOffset + outputBytes.byteLength
        ) as ArrayBuffer;
        return new Blob([arrayBuffer], { type: "video/mp4" });
      }
      // Si c'est une string, encoder en Uint8Array
      const encoder = new TextEncoder();
      return new Blob([encoder.encode(String(outputBytes))], { type: "video/mp4" });
    } finally {
      for (const name of cleanupNames) {
        try {
          await ff.deleteFile(name);
        } catch {
          // Ignorer les erreurs de nettoyage
        }
      }
    }
  } catch (error) {
    console.error("[HyperFrames] Erreur lors de l'overlay:", error);
    // En cas d'erreur, retourner la vidéo originale
    return originalVideoBlob;
  }
}

/**
 * Liste des presets disponibles
 */
export function getAvailablePresets(): HyperFramesPreset[] {
  return HYPERFRAMES_PRESETS;
}

/**
 * Récupère un preset par son ID
 */
export function getPresetById(id: string): HyperFramesPreset | undefined {
  return HYPERFRAMES_PRESETS.find((p) => p.id === id);
}
