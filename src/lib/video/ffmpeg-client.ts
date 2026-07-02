import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL, fetchFile } from "@ffmpeg/util";

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

const CORE_VERSION = "0.12.6";
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

export async function getFfmpeg(onLog?: (m: string) => void, onProgress?: (p: number) => void) {
  if (instance) return instance;
  if (loading) return loading;
  loading = (async () => {
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
  })();
  return loading;
}

export { fetchFile };
