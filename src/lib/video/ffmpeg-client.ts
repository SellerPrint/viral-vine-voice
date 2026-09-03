import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";

// Le cœur FFmpeg est résolu depuis les dépendances du projet et servi par
// Vite, plutôt que téléchargé depuis un CDN tiers à l'exécution : version
// épinglée au lockfile, fonctionnement hors ligne, et pas de point de panne
// externe dans le chemin critique.
import coreUrl from "@ffmpeg/core?url";
import wasmUrl from "@ffmpeg/core/wasm?url";
import coreMtUrl from "@ffmpeg/core-mt?url";
import wasmMtUrl from "@ffmpeg/core-mt/wasm?url";
import workerMtUrl from "@ffmpeg/core-mt/worker?url";

let instance: FFmpegType | null = null;
let loading: Promise<FFmpegType> | null = null;
let multiThread = false;

/**
 * Le cœur multi-thread n'est chargeable que si le navigateur nous place en
 * contexte isolé (`crossOriginIsolated`), ce qui suppose les en-têtes
 * `Cross-Origin-Opener-Policy: same-origin` et
 * `Cross-Origin-Embedder-Policy: credentialless` servis par l'hébergeur.
 *
 * On ne se fie pas aux en-têtes : on interroge le navigateur. Deux raisons.
 * D'abord Safari n'implémente pas `credentialless`, l'isolation n'y est donc
 * pas accordée même en présence des en-têtes. Ensuite un contexte non isolé
 * n'expose pas `SharedArrayBuffer`, dont dépend le cœur multi-thread : le
 * charger quand même échouerait au lancement du rendu.
 *
 * Le repli mono-thread est plus lent mais fonctionnellement identique.
 */
export function canUseMultiThread(): boolean {
  return (
    typeof globalThis.crossOriginIsolated === "boolean" &&
    globalThis.crossOriginIsolated &&
    typeof SharedArrayBuffer !== "undefined"
  );
}

/** Indique si l'instance chargée utilise le cœur multi-thread. */
export function isMultiThread(): boolean {
  return instance !== null && multiThread;
}

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
    // Cœur multi-thread quand le navigateur nous accorde l'isolation
    // cross-origin, mono-thread sinon. Voir `canUseMultiThread()`.
    if (canUseMultiThread()) {
      multiThread = true;
      await ff.load({ coreURL: coreMtUrl, wasmURL: wasmMtUrl, workerURL: workerMtUrl });
    } else {
      multiThread = false;
      await ff.load({ coreURL: coreUrl, wasmURL: wasmUrl });
    }

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
 * Écrit un fichier dans le FS virtuel **sans détacher** le buffer de l'appelant.
 *
 * `FFmpeg.writeFile()` place `data.buffer` dans la liste des objets
 * transférables de `postMessage`. Le buffer est donc *déplacé* vers le worker :
 * côté appelant il devient détaché (`byteLength === 0`) et tout réemploi
 * échoue avec
 *
 *   « Failed to execute 'postMessage' on 'Worker': An ArrayBuffer is detached
 *     and could not be cloned. »
 *
 * C'est invisible tant qu'un octet n'est écrit qu'une fois. Ça ne l'est plus
 * dès qu'on réutilise la même source : générer un aperçu puis lancer le rendu,
 * enchaîner deux rendus, ou réécrire la police mise en cache.
 *
 * On transmet donc systématiquement une copie : c'est le worker qui la
 * consomme, l'original reste intact.
 */
export async function writeFileSafe(ff: FFmpegType, path: string, data: Uint8Array): Promise<void> {
  // Un buffer déjà détaché ne peut plus être copié : `slice()` lèverait un
  // `TypeError` peu parlant. On préfère un message qui dit quoi faire.
  if (data.byteLength === 0 && data.length === 0) {
    throw new Error(
      `Les données de « ${path} » ne sont plus disponibles en mémoire. ` +
        `Réimporte la vidéo et relance le rendu.`,
    );
  }
  // `slice()` alloue un nouveau buffer : seul celui-ci est transféré au worker,
  // l'original reste utilisable par l'appelant.
  await ff.writeFile(path, data.slice());
}

/** Vrai si le buffer sous-jacent a été transféré à un worker. */
export function isDetached(data: Uint8Array): boolean {
  return data.byteLength === 0 && data.buffer.byteLength === 0;
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
