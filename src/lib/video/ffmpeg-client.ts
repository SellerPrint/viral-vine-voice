import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";

// Le cœur FFmpeg est résolu depuis les dépendances du projet et servi par
// Vite, plutôt que téléchargé depuis un CDN tiers à l'exécution : version
// épinglée au lockfile, fonctionnement hors ligne, et pas de point de panne
// externe dans le chemin critique.
import coreUrl from "@ffmpeg/core?url";
import wasmUrl from "@ffmpeg/core/wasm?url";

let instance: FFmpegType | null = null;
let loading: Promise<FFmpegType> | null = null;

export async function getFfmpeg(onLog?: (m: string) => void, onProgress?: (p: number) => void) {
  if (typeof window === "undefined") {
    throw new Error("Le moteur vidéo doit être chargé dans le navigateur.");
  }
  if (instance) return instance;
  if (loading) return loading;

  loading = (async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");

    const ff = new FFmpeg();
    ff.on("log", ({ message }) => {
      onLog?.(message);
      if (import.meta.env.DEV) console.debug("[ffmpeg]", message);
    });
    if (onProgress) {
      ff.on("progress", ({ progress }) => onProgress(Math.max(0, Math.min(1, progress))));
    }

    // Les URLs sont passées directement, sans `toBlobURL`.
    //
    // `toBlobURL` recopie le cœur dans un `blob:` que le worker charge ensuite
    // par `importScripts()`. Or le cœur est un module ESM : `importScripts`
    // échoue toujours, et @ffmpeg/ffmpeg retombe sur `await import(blob:)`.
    // Cet import dynamique d'un blob est bloqué par notre CSP et refusé par
    // certains navigateurs, d'où « Failed to fetch dynamically imported
    // module: blob:… » au lancement d'un rendu.
    //
    // Les fichiers sont déjà servis par notre propre origine : le détour par
    // un blob n'apportait rien. On économise au passage la recopie en mémoire
    // des 32 Mo du .wasm.
    await ff.load({ coreURL: coreUrl, wasmURL: wasmUrl });

    instance = ff;
    return ff;
  })().catch((error) => {
    loading = null;
    instance = null;
    throw error;
  });

  return loading;
}

/**
 * Libère le worker et le tas WebAssembly.
 *
 * Emscripten ne rend jamais sa mémoire au système : sans terminaison
 * explicite, le tas grossit à chaque rendu (souvent 1 à 2 Go pour une vidéo
 * de 60 Mo) jusqu'à faire planter l'onglet, en particulier sur mobile.
 */
export function releaseFfmpeg() {
  if (!instance) {
    loading = null;
    return;
  }
  try {
    instance.terminate();
  } catch {
    // Peu importe l'échec de terminaison : l'objectif est de lâcher la
    // référence pour que le worker et sa mémoire soient collectés.
  }
  instance = null;
  loading = null;
}
