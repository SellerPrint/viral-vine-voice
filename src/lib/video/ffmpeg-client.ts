import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";

let instance: FFmpegType | null = null;
let loading: Promise<FFmpegType> | null = null;

const CORE_VERSION = "0.12.6";
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

export async function getFfmpeg(onLog?: (m: string) => void, onProgress?: (p: number) => void) {
  if (typeof window === "undefined") {
    throw new Error("Le moteur vidéo doit être chargé dans le navigateur.");
  }
  if (instance) return instance;
  if (loading) return loading;
  loading = (async () => {
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
      import("@ffmpeg/ffmpeg"),
      import("@ffmpeg/util"),
    ]);
    const ff = new FFmpeg();
    ff.on("log", ({ message }) => {
      if (onLog) onLog(message);
      // eslint-disable-next-line no-console
      console.log("[ffmpeg]", message);
    });
    if (onProgress) ff.on("progress", ({ progress }) => onProgress(Math.max(0, Math.min(1, progress))));
    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    ]);
    await ff.load({ coreURL, wasmURL });
    instance = ff;
    return ff;
  })().catch((error) => {
    loading = null;
    instance = null;
    throw error;
  });
  return loading;
}

export function releaseFfmpeg() {
  if (!instance) {
    loading = null;
    return;
  }
  try {
    instance.terminate();
  } catch {
    // ignore termination errors; the goal is to drop the WASM worker/memory.
  }
  instance = null;
  loading = null;
}
