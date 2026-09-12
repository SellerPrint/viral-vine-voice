import type { SourceMedia } from "./types";

/**
 * Import et sonde des médias.
 *
 * Les garde-fous d'import (type, taille, fichier vide) viennent du parcours
 * d'origine et restent ici : ils protègent la mémoire de l'onglet, pas le
 * serveur. Ils sont isolés en fonction pure pour être testés sans navigateur.
 */

export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i;

/** Message d'erreur, ou `null` si le fichier est acceptable. */
export function validateVideoFile(file: {
  name: string;
  size: number;
  type: string;
}): string | null {
  const looksVideo = file.type.startsWith("video/") || VIDEO_EXT.test(file.name);
  if (!looksVideo) return "Merci d'importer un fichier vidéo (MP4, MOV, WEBM…).";
  if (file.size === 0) {
    return "Ce fichier est vide ou illisible. Réenregistre-le dans la galerie puis réessaie.";
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return "Fichier trop lourd. Maximum 60 Mo (limite du traitement navigateur).";
  }
  return null;
}

export type MediaProbe = {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
};

function waitFor(element: HTMLVideoElement, event: string, timeout = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("La vidéo n'a pas pu être lue. Codec non supporté par le navigateur ?"));
    };
    const timer = setTimeout(fail, timeout);
    const cleanup = () => {
      clearTimeout(timer);
      element.removeEventListener(event, done);
      element.removeEventListener("error", fail);
    };
    element.addEventListener(event, done, { once: true });
    element.addEventListener("error", fail, { once: true });
  });
}

/**
 * Mesure la cadence réelle, en images par seconde.
 *
 * Un `<video>` n'expose pas sa cadence : on la déduit de l'horloge de rendu
 * (`requestVideoFrameCallback`) sur quelques images. Sans cette API (Safari
 * ancien, Firefox), on retombe sur 30 fps — la valeur que le moteur de rendu
 * utilise déjà par défaut.
 */
async function measureFps(element: HTMLVideoElement): Promise<number> {
  const withFrames = element as HTMLVideoElement & {
    requestVideoFrameCallback?: (
      cb: (now: number, meta: { mediaTime: number; presentedFrames: number }) => void,
    ) => number;
    cancelVideoFrameCallback?: (handle: number) => void;
  };
  if (!withFrames.requestVideoFrameCallback) return 30;

  return new Promise((resolve) => {
    const times: number[] = [];
    let handle = 0;
    const step = (_now: number, meta: { mediaTime: number; presentedFrames: number }) => {
      times.push(meta.mediaTime);
      if (times.length < 12) {
        handle = withFrames.requestVideoFrameCallback!(step);
        return;
      }
      withFrames.cancelVideoFrameCallback?.(handle);
      const deltas = times
        .slice(1)
        .map((t, i) => t - times[i])
        .filter((d) => d > 0.0005);
      const average = deltas.reduce((sum, d) => sum + d, 0) / (deltas.length || 1);
      resolve(average > 0 ? Math.min(120, Math.round(1 / average)) : 30);
    };
    handle = withFrames.requestVideoFrameCallback(step);
    element.play().catch(() => {});
    setTimeout(() => {
      element.pause();
      resolve(30);
    }, 1200);
  });
}

/** Sonde un `<video>` hors écran : dimensions, durée, piste audio, cadence. */
export async function probeVideoUrl(url: string, withFps = true): Promise<MediaProbe> {
  const element = document.createElement("video");
  element.preload = "metadata";
  element.muted = true;
  element.playsInline = true;
  element.src = url;

  try {
    await waitFor(element, "loadedmetadata");
    const duration =
      Number.isFinite(element.duration) && element.duration > 0 ? element.duration : 0;
    const fps = withFps ? await measureFps(element) : 30;
    return {
      duration,
      width: element.videoWidth,
      height: element.videoHeight,
      fps: fps || 30,
      // `audioTracks` n'existe pas partout : `mozHasAudio` non plus. On teste
      // d'abord les deux, puis on considère qu'il y a de l'audio (le moteur de
      // rendu, lui, sonde le conteneur pour de vrai).
      hasAudio:
        (element as HTMLVideoElement & { mozHasAudio?: boolean; audioTracks?: { length: number } })
          .mozHasAudio ??
        ((element as HTMLVideoElement & { audioTracks?: { length: number } }).audioTracks?.length ??
          1) > 0,
    };
  } finally {
    element.removeAttribute("src");
    element.load();
  }
}

/**
 * Le navigateur a lu les métadonnées mais ne décode pas l'image : `0×0`.
 *
 * Un HEVC de TikTok sur Chromium, par exemple : la durée est là, les pistes
 * aussi, et pourtant l'aperçu comme l'exportation restent noirs. Le taire,
 * c'est laisser un plan importé « réussi » qui ne rendra rien.
 */
export function avertissementDecodage(source: { width: number; height: number }): string | null {
  if (source.width > 0 && source.height > 0) return null;
  return "image non décodée par ce navigateur (0×0) : convertissez la source en H.264 (MP4) — l'aperçu et l'exportation resteraient noirs.";
}

/** File d'attente de décodage partagée : deux sondes simultanées saturent Safari. */
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function probeSerialized(url: string): Promise<MediaProbe> {
  return serialize(() => probeVideoUrl(url));
}

export async function loadSourceFromFile(file: File): Promise<SourceMedia> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const url = URL.createObjectURL(
    new Blob([bytes as unknown as BlobPart], { type: file.type || "video/mp4" }),
  );
  const probe = await probeSerialized(url);
  return {
    name: file.name,
    url,
    bytes,
    size: file.size,
    duration: probe.duration,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    hasAudio: probe.hasAudio,
  };
}

/** Charge le clip livré avec l'application (onglet « Démo » du panneau Média). */
export async function loadDemoSource(url = "/demo/tiktok-demo.mp4"): Promise<SourceMedia> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Le clip de démonstration est indisponible sur ce serveur.");
  const buffer = await response.arrayBuffer();
  const blob = new Blob([buffer], { type: "video/mp4" });
  const probe = await probeSerialized(url);
  return {
    name: "tiktok-demo.mp4",
    // L'URL d'origine reste préférable : le navigateur la met en cache, quand
    // le blob devrait être re-téléchargé à chaque recherche sur la timeline.
    url,
    bytes: new Uint8Array(buffer),
    size: blob.size,
    duration: probe.duration,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    hasAudio: probe.hasAudio,
    demo: true,
  };
}

export function releaseSource(source: SourceMedia | null) {
  if (source && source.url.startsWith("blob:")) URL.revokeObjectURL(source.url);
}
