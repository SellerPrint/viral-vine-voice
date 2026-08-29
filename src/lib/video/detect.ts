import type { MaskZone } from "./presets";

/**
 * Sample a few frames of the video, run an edge-density heuristic per row/column,
 * and suggest mask zones for the burnt-in FR subtitles and top/side logos.
 * Runs entirely in the browser via HTMLVideoElement + canvas.
 */
export async function detectMaskZones(file: File | Blob): Promise<MaskZone[]> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.src = url;
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Impossible de lire la vidéo pour analyse."));
    });

    const duration = video.duration || 5;
    const samples = [0.15, 0.4, 0.65, 0.9].map((r) => r * duration);

    const W = 180;
    const H = Math.round((video.videoHeight / video.videoWidth) * W) || 320;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    // aggregated per-row and per-cell edge activity
    const rowAct = new Float32Array(H);
    // 4x4 grid activity for corner logos
    const grid = new Float32Array(16);

    let sampled = 0;
    for (const t of samples) {
      // Une image qu'on n'a pas pu atteindre est ignorée, pas bloquante.
      if (!(await seek(video, Math.min(t, duration - 0.05)))) continue;
      sampled++;
      ctx.drawImage(video, 0, 0, W, H);
      const img = ctx.getImageData(0, 0, W, H).data;
      // grayscale + simple horizontal edge
      for (let y = 1; y < H; y++) {
        let rowSum = 0;
        for (let x = 1; x < W; x++) {
          const i = (y * W + x) * 4;
          const iL = (y * W + (x - 1)) * 4;
          const iU = ((y - 1) * W + x) * 4;
          const g = 0.3 * img[i] + 0.59 * img[i + 1] + 0.11 * img[i + 2];
          const gL = 0.3 * img[iL] + 0.59 * img[iL + 1] + 0.11 * img[iL + 2];
          const gU = 0.3 * img[iU] + 0.59 * img[iU + 1] + 0.11 * img[iU + 2];
          const e = Math.abs(g - gL) + Math.abs(g - gU);
          rowSum += e;
          const gx = Math.min(3, Math.floor((x / W) * 4));
          const gy = Math.min(3, Math.floor((y / H) * 4));
          grid[gy * 4 + gx] += e;
        }
        rowAct[y] += rowSum;
      }
    }

    // Aucune image exploitable : pas de suggestion plutôt qu'une suggestion fausse.
    if (sampled === 0) return [];

    // normalize
    const rowMax = Math.max(...rowAct);
    for (let i = 0; i < rowAct.length; i++) rowAct[i] /= rowMax || 1;
    const gridMax = Math.max(...grid);
    for (let i = 0; i < grid.length; i++) grid[i] /= gridMax || 1;

    // Find bottom subtitle band: strongest contiguous rows in bottom 45%
    const bottomStart = Math.floor(H * 0.55);
    const band = findPeakBand(rowAct, bottomStart, H, 0.45);

    // Top logo band: strongest contiguous rows in top 20%
    const topBand = findPeakBand(rowAct, 0, Math.floor(H * 0.2), 0.55);

    // Corner logos: check top-left (row 0 cols 0) and top-right (row 0 cols 3)
    const tlActive = grid[0 * 4 + 0] > 0.55 || grid[0 * 4 + 1] > 0.55;
    const trActive = grid[0 * 4 + 3] > 0.55 || grid[0 * 4 + 2] > 0.55;

    const zones: MaskZone[] = [];
    if (band) {
      zones.push({
        id: "bottom",
        label: "Sous-titres FR (bas)",
        x: 0,
        y: Math.max(0, band.start / H - 0.01),
        w: 1,
        h: Math.min(1 - band.start / H, (band.end - band.start) / H + 0.02),
        enabled: true,
      });
    }
    if (topBand) {
      zones.push({
        id: "top",
        label: "Bandeau haut",
        x: 0,
        y: 0,
        w: 1,
        h: Math.min(0.15, topBand.end / H + 0.01),
        enabled: true,
      });
    }
    zones.push({
      id: "tl",
      label: "Logo haut-gauche",
      x: 0,
      y: 0.02,
      w: 0.28,
      h: 0.09,
      enabled: tlActive,
    });
    zones.push({
      id: "tr",
      label: "Logo haut-droite",
      x: 0.72,
      y: 0.02,
      w: 0.28,
      h: 0.09,
      enabled: trActive,
    });

    return zones;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Délai au-delà duquel on abandonne une image plutôt que de figer l'analyse. */
const SEEK_TIMEOUT_MS = 3000;

/**
 * Se positionne sur une image, avec abandon au bout de `SEEK_TIMEOUT_MS`.
 *
 * L'événement `seeked` peut ne jamais arriver (codec exotique, onglet en
 * arrière-plan, fichier partiellement lisible). Sans délai maximal, la
 * promesse ne se résolvait jamais et l'interface restait figée sur l'analyse,
 * sans erreur ni possibilité d'annuler.
 *
 * Résout `false` en cas d'abandon : l'échantillon est ignoré et la détection
 * continue avec les images restantes.
 */
function seek(video: HTMLVideoElement, t: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      resolve(ok);
    };
    const onSeeked = () => finish(true);
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(false), SEEK_TIMEOUT_MS);

    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = t;
  });
}

function findPeakBand(
  rowAct: Float32Array,
  from: number,
  to: number,
  threshold: number,
): { start: number; end: number } | null {
  let best: { start: number; end: number; score: number } | null = null;
  let curStart = -1;
  let curScore = 0;
  for (let y = from; y < to; y++) {
    if (rowAct[y] >= threshold) {
      if (curStart < 0) {
        curStart = y;
        curScore = 0;
      }
      curScore += rowAct[y];
    } else if (curStart >= 0) {
      const band = { start: curStart, end: y, score: curScore };
      if (!best || band.score > best.score) best = band;
      curStart = -1;
    }
  }
  if (curStart >= 0) {
    const band = { start: curStart, end: to, score: curScore };
    if (!best || band.score > best.score) best = band;
  }
  if (!best) return null;
  if (best.end - best.start < 3) return null;
  return { start: best.start, end: best.end };
}
