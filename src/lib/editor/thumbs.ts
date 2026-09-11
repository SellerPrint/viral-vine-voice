/**
 * Vignettes de la piste vidéo.
 *
 * Un montage sans images n'est pas repérable à l'œil : la seule chose qui dit
 * « ici tu changes de plan », c'est la vignette. Elles sont fabriquées en
 * cherchant l'élément `<video>` hors écran, image par image — pas de moteur de
 * rendu, pas de téléchargement, et un coût borné (`count` images maximum).
 */

export type Thumb = { time: number; url: string };

export type ThumbOptions = {
  count?: number;
  /** Largeur d'une vignette, en pixels CSS. */
  width?: number;
  signal?: AbortSignal;
};

const SEEK_TIMEOUT = 2500;

/** Attend un événement une seule fois, sans bloquer éternellement un média capricieux. */
function once(element: HTMLVideoElement, event: string, timeout = SEEK_TIMEOUT): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, timeout);
    function finish() {
      clearTimeout(timer);
      element.removeEventListener(event, finish);
      resolve();
    }
    element.addEventListener(event, finish, { once: true });
  });
}

export async function buildThumbs(
  url: string,
  duration: number,
  options: ThumbOptions = {},
): Promise<Thumb[]> {
  if (typeof document === "undefined" || !(duration > 0)) return [];
  // Une vignette tous les ~0,7 s, plafonné : chaque image est une recherche +
  // un décodage, et 48 recherches sur une machine à deux cœurs retardent la
  // première interaction de plusieurs secondes pour un gain visuel nul.
  const count = Math.max(2, Math.min(32, options.count ?? Math.round(duration * 1.5)));
  const width = options.width ?? 92;

  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.style.position = "fixed";
  video.style.left = "-10000px";
  video.style.width = "160px";
  document.body.appendChild(video);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const thumbs: Thumb[] = [];

  try {
    if (video.readyState < 1) await once(video, "loadedmetadata", 8000);
    const ratio =
      video.videoHeight && video.videoWidth ? video.videoHeight / video.videoWidth : 16 / 9;
    canvas.width = width;
    canvas.height = Math.max(8, Math.round(width * ratio));

    for (let i = 0; i < count; i++) {
      if (options.signal?.aborted) break;
      const time = (i + 0.5) * (duration / count);
      video.currentTime = Math.min(duration - 0.02, Math.max(0, time));
      await once(video, "seeked");
      if (!video.videoWidth) continue;
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.62),
      );
      if (blob) thumbs.push({ time, url: URL.createObjectURL(blob) });
    }
  } catch (error) {
    // Des vignettes manquantes ne doivent pas empêcher de monter.
    console.warn("[monteur] vignettes indisponibles", error);
  } finally {
    video.remove();
    video.removeAttribute("src");
    video.load();
  }

  return thumbs;
}

export function releaseThumbs(thumbs: Thumb[]) {
  for (const thumb of thumbs) URL.revokeObjectURL(thumb.url);
}
