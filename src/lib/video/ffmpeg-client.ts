import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";

// Le cœur FFmpeg est résolu depuis les dépendances du projet et servi par
// Vite, plutôt que téléchargé depuis un CDN tiers à l'exécution : version
// épinglée au lockfile, fonctionnement hors ligne, et pas de point de panne
// externe dans le chemin critique.
import coreUrl from "@ffmpeg/core?url";
import wasmUrl from "@ffmpeg/core/wasm?url";

let instance: FFmpegType | null = null;
let loading: Promise<FFmpegType> | null = null;
let multiThread = false;

/**
 * Indique si le navigateur nous accorde l'isolation cross-origin, condition
 * *nécessaire* au multi-thread — mais pas suffisante ici.
 *
 * ⚠️ Le cœur `@ffmpeg/core-mt` n'est PAS utilisé, malgré l'isolation servie en
 * production. Emscripten y démarre ses threads en chargeant un second script,
 * `ffmpeg-core.worker.js`, dont il calcule l'adresse **relativement au cœur**.
 * Notre bundler renomme les fichiers avec une empreinte
 * (`ffmpeg-core-CcyiuWOr.js`), l'adresse déduite ne correspond à rien, et la
 * requête n'aboutit jamais. Symptôme observé en production : le rendu reste
 * figé sur « Chargement du moteur vidéo » à 0 %, **sans aucune erreur** —
 * `ff.load()` ne rejette pas, il attend un worker qui ne viendra pas.
 *
 * Le rétablir demande de servir les trois fichiers du cœur côte à côte sous
 * des noms stables (par exemple depuis `public/`), pas un simple import `?url`.
 *
 * Cette fonction reste exportée : elle documente la condition et sert au
 * diagnostic. Les en-têtes COOP/COEP sont conservés — ils sont inoffensifs et
 * évitent d'avoir à refaire ce travail le jour où le cœur MT sera câblé.
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
    // Cœur MONO-THREAD, y compris en contexte isolé. Voir la note sur
    // `canUseMultiThread()` : le cœur multi-thread ne fonctionne pas avec
    // notre bundler et faisait geler le rendu à « Chargement du moteur ».
    multiThread = false;
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
