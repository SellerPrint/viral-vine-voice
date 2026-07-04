import { getFfmpeg } from "./ffmpeg-client";
import { transcribeAudio, translateSegments, synthesizeSpeech } from "@/lib/ai.functions";

export type Word = { text: string; start: number; end: number };
export type Segment = { start: number; end: number; textFr: string; textEn: string };
export type VideoInput = { name: string; bytes: Uint8Array };

export type ProgressCb = (step: string, detail?: string, pct?: number) => void;

/* -------------------------------- helpers -------------------------------- */

function arrayBufferToBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
function base64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export async function readFileBytes(file: File): Promise<Uint8Array> {
  const attempts: Array<() => Promise<ArrayBuffer | Uint8Array>> = [
    () => file.arrayBuffer(),
    async () => {
      if (!file.stream) throw new Error("File streams are unavailable in this browser.");
      const reader = file.stream().getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.byteLength;
      }
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return out;
    },
  ];

  let lastError: unknown;
  for (let round = 0; round < 4; round++) {
    for (const attempt of attempts) {
      try {
        const data = await attempt();
        return data instanceof Uint8Array ? data : new Uint8Array(data);
      } catch (error) {
        lastError = error;
      }
    }
    await wait(250 * (round + 1));
  }

  throw new Error(
    `Impossible de copier cette vidéo depuis le sélecteur de fichiers. Ouvre-la depuis la galerie locale de l’appareil ou télécharge-la d’abord, puis réessaie. ${
      lastError instanceof Error ? lastError.message : ""
    }`.trim(),
  );
}

/** Group words into sentence-ish segments (~4-8s or on strong punctuation). */
export function groupWordsToSegments(words: Word[]): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  if (!words.length) return out;
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({
      text: cur.map((w) => w.text).join(" ").replace(/\s+([,.!?;:])/g, "$1").trim(),
      start: cur[0].start,
      end: cur[cur.length - 1].end,
    });
    cur = [];
  };
  for (const w of words) {
    cur.push(w);
    const dur = cur[cur.length - 1].end - cur[0].start;
    const endsSentence = /[.!?…]$/.test(w.text);
    if ((endsSentence && dur > 2) || dur > 7.5) flush();
  }
  flush();
  return out;
}

/** Detect silence intervals from a mono 16k WAV using an AudioContext. */
export async function detectSilences(wavBytes: Uint8Array): Promise<{ start: number; end: number }[]> {
  const ctx = new AudioContext();
  const buf = await ctx.decodeAudioData(wavBytes.buffer.slice(0) as ArrayBuffer);
  const data = buf.getChannelData(0);
  const sampleRate = buf.sampleRate;
  const winSize = Math.floor(0.02 * sampleRate); // 20ms
  const threshold = 0.008; // ~ -42dB
  const minSilence = 0.4; // seconds
  const silences: { start: number; end: number }[] = [];
  let silStart: number | null = null;
  for (let i = 0; i < data.length; i += winSize) {
    let sum = 0;
    const end = Math.min(i + winSize, data.length);
    for (let j = i; j < end; j++) sum += data[j] * data[j];
    const rms = Math.sqrt(sum / (end - i));
    const t = i / sampleRate;
    if (rms < threshold) {
      if (silStart === null) silStart = t;
    } else if (silStart !== null) {
      const dur = t - silStart;
      if (dur >= minSilence) silences.push({ start: silStart, end: t });
      silStart = null;
    }
  }
  if (silStart !== null) silences.push({ start: silStart, end: data.length / sampleRate });
  ctx.close();
  return silences;
}

/** Build kept intervals (video parts we keep) from total duration and silences. */
export function keptIntervals(
  duration: number,
  silences: { start: number; end: number }[],
  padding = 0.1,
): { start: number; end: number }[] {
  const trimmed = silences
    .map((s) => ({ start: s.start + padding, end: s.end - padding }))
    .filter((s) => s.end - s.start > 0.2);
  const kept: { start: number; end: number }[] = [];
  let cur = 0;
  for (const s of trimmed) {
    if (s.start > cur) kept.push({ start: cur, end: s.start });
    cur = s.end;
  }
  if (cur < duration) kept.push({ start: cur, end: duration });
  return kept.filter((k) => k.end - k.start > 0.15);
}

/* --------------------------------- MAIN --------------------------------- */

export async function runPipeline(
  input: VideoInput,
  progress: ProgressCb,
): Promise<{ videoBlob: Blob; segments: Segment[] }> {
  progress("ffmpeg", "Chargement du moteur vidéo (~30 Mo)…");
  const ff = await getFfmpeg(undefined, (p) => progress("ffmpeg-progress", undefined, p));

  const inputName = "input.mp4";
  progress("upload", "Import du fichier…");
  await ff.writeFile(inputName, input.bytes);

  // 1. Extract mono 16k WAV audio for transcription + silence detection
  progress("extract", "Extraction de la piste audio…");
  await ff.exec(["-y", "-i", inputName, "-vn", "-ac", "1", "-ar", "16000", "audio.wav"]);
  const wav = (await ff.readFile("audio.wav")) as Uint8Array;

  // 2. Silence detection (client-side)
  progress("silence", "Détection des silences…");
  const silences = await detectSilences(wav);

  // 2b. Get duration by probing (via ffmpeg)
  let duration = 0;
  const logs: string[] = [];
  const handler = ({ message }: { message: string }) => logs.push(message);
  ff.on("log", handler);
  await ff.exec(["-i", inputName, "-hide_banner"]).catch(() => {});
  ff.off("log", handler);
  const durMatch = logs.join("\n").match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  if (durMatch) {
    duration = +durMatch[1] * 3600 + +durMatch[2] * 60 + parseFloat(durMatch[3]);
  }
  if (!duration) {
    // fallback via wav length
    const ctx = new AudioContext();
    const buf = await ctx.decodeAudioData(wav.buffer.slice(0) as ArrayBuffer);
    duration = buf.duration;
    ctx.close();
  }

  const kept = keptIntervals(duration, silences);

  // 3. Transcribe (FR)
  progress("transcribe", "Transcription française via ElevenLabs…");
  const audioB64 = arrayBufferToBase64(wav.buffer.slice(0) as ArrayBuffer);
  const { words } = await transcribeAudio({ data: { audioBase64: audioB64, mime: "audio/wav" } });
  const rawSegments = groupWordsToSegments(words);

  if (rawSegments.length === 0) {
    throw new Error("Aucune parole détectée dans la vidéo.");
  }

  // 4. Translate FR -> EN
  progress("translate", "Traduction française → anglaise…");
  const { segments } = await translateSegments({
    data: { segments: rawSegments.map((s) => ({ text: s.text, start: s.start, end: s.end })) },
  });

  // 5. TTS EN for each segment (parallel, batched)
  progress("tts", `Synthèse vocale anglaise (${segments.length} segments)…`);
  const audioParts: { start: number; bytes: Uint8Array }[] = new Array(segments.length);
  const concurrency = 3;
  let done = 0;
  const queue = segments.map((s, i) => ({ s, i }));
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;
      if (!item.s.textEn.trim()) {
        audioParts[item.i] = { start: item.s.start, bytes: new Uint8Array() };
        done++;
        progress("tts", `Segment ${done}/${segments.length}`, done / segments.length);
        continue;
      }
      const targetDur = item.s.end - item.s.start;
      // rough speed adjustment so English fits approximate duration
      const words = item.s.textEn.split(/\s+/).length;
      const estDur = words / 2.7; // ~2.7 words/sec at speed 1
      let speed = 1.0;
      if (estDur > targetDur * 1.15) speed = Math.min(1.2, estDur / targetDur);
      const { audioBase64 } = await synthesizeSpeech({
        data: { text: item.s.textEn, speed },
      });
      audioParts[item.i] = { start: item.s.start, bytes: base64ToBytes(audioBase64) };
      done++;
      progress("tts", `Segment ${done}/${segments.length}`, done / segments.length);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  // 6. Write each TTS mp3 as a wav for easier mixing timing
  progress("compose", "Préparation de la piste audio anglaise…");
  // Build a silent base audio of full (trimmed) duration; overlay each TTS at its start.
  // Simpler: produce a filter_complex that takes original video + each mp3 input,
  // trims/positions each with adelay, mixes them, and pastes onto muted video.

  // Write mp3 files
  const inputs: string[] = ["-i", inputName];
  const audioInputs: { idx: number; delayMs: number }[] = [];
  let idx = 1;
  for (let i = 0; i < audioParts.length; i++) {
    const part = audioParts[i];
    if (!part.bytes.length) continue;
    const name = `tts_${i}.mp3`;
    await ff.writeFile(name, part.bytes);
    inputs.push("-i", name);
    // shift to nearest kept interval mapping
    audioInputs.push({ idx, delayMs: Math.max(0, Math.round(part.start * 1000)) });
    idx++;
  }

  // 7. Build filter graph:
  //    - drawbox black covering bottom 18% (typical TikTok caption strip)
  //    - drawtext for burned-in EN subtitles (per segment via enable='between(t,s,e)')
  //    - concat kept intervals via select filter to cut silences
  //    - audio: mix all TTS inputs with adelay

  // Build a select-timestamps expression to keep only "kept" intervals
  const keepExpr =
    kept.length > 0
      ? kept.map((k) => `between(t,${k.start.toFixed(3)},${k.end.toFixed(3)})`).join("+")
      : "1";

  // Escape text for drawtext
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019").replace(/%/g, "\\%");

  // Wrap long lines so subtitles stay fully on screen (portrait 9:16).
  const wrapText = (raw: string, maxChars = 22, maxLines = 3) => {
    const words = raw.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      if (!cur.length) {
        cur = w;
      } else if ((cur + " " + w).length <= maxChars) {
        cur += " " + w;
      } else {
        if (lines.length === maxLines - 1) {
          cur += " " + w;
        } else {
          lines.push(cur);
          cur = w;
        }
      }
    }
    if (cur.length) lines.push(cur);
    return lines.join("\n");
  };

  const drawTextFilters = segments
    .filter((s) => s.textEn.trim())
    .map((s) => {
      const wrapped = wrapText(s.textEn.toUpperCase());
      const text = esc(wrapped);
      const start = s.start.toFixed(3);
      const end = s.end.toFixed(3);
      return `drawtext=fontfile=/tmp/font.ttf:text='${text}':fontcolor=white:fontsize=26:line_spacing=6:box=1:boxcolor=black@0.6:boxborderw=10:x=(w-text_w)/2:y=h-text_h-h*0.22:enable='between(t,${start},${end})'`;
    })
    .join(",");

  // Load a font for drawtext
  progress("compose", "Chargement de la police pour sous-titres…");
  const fontRes = await fetch(
    "https://unpkg.com/@fontsource/space-grotesk@5.2.10/files/space-grotesk-latin-700-normal.woff2",
  );
  // ffmpeg drawtext needs TTF, not woff2. Grab a TTF from another CDN:
  const ttfRes = await fetch(
    "https://raw.githubusercontent.com/googlefonts/roboto/main/src/hinted/Roboto-Bold.ttf",
  );
  const ttfBuf = ttfRes.ok
    ? new Uint8Array(await ttfRes.arrayBuffer())
    : new Uint8Array(await fontRes.arrayBuffer());
  await ff.writeFile("/tmp/font.ttf", ttfBuf);

  // Masks to hide burned-in FR subtitles and platform logos/watermarks.
  // Filled black rectangles are reliable across ffmpeg.wasm; blurring regions
  // would need a split/overlay graph that ffmpeg.wasm handles poorly.
  const maskFilters = [
    // Bottom caption strip (TikTok/CapCut subtitles + username + music info)
    `drawbox=x=0:y=ih*0.66:w=iw:h=ih*0.28:color=black@0.85:t=fill`,
    // Mid-lower zone where "hook" captions sometimes sit
    `drawbox=x=0:y=ih*0.54:w=iw:h=ih*0.10:color=black@0.75:t=fill`,
    // Top strip (title, "POV", header captions, TikTok/IG top bar)
    `drawbox=x=0:y=0:w=iw:h=ih*0.09:color=black@0.85:t=fill`,
    // Top-right watermark / logo box
    `drawbox=x=iw*0.70:y=ih*0.02:w=iw*0.28:h=ih*0.09:color=black@0.85:t=fill`,
    // Top-left watermark / logo box
    `drawbox=x=0:y=ih*0.02:w=iw*0.28:h=ih*0.09:color=black@0.85:t=fill`,
  ].join(",");

  const videoFilter = [
    maskFilters,
    drawTextFilters,
    // silence-cut via setpts (needs select)
    `select='${keepExpr}',setpts=N/FRAME_RATE/TB`,
  ]
    .filter(Boolean)
    .join(",");

  // Audio graph: build mixed narration then re-time it too
  let audioFilter: string;
  if (audioInputs.length === 0) {
    audioFilter = `anullsrc=r=44100:cl=stereo,atrim=0:${duration.toFixed(3)}[aout]`;
  } else {
    const parts = audioInputs
      .map((a, i) => `[${a.idx}:a]adelay=${a.delayMs}|${a.delayMs},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a${i}]`)
      .join(";");
    const mixInputs = audioInputs.map((_, i) => `[a${i}]`).join("");
    audioFilter = `${parts};${mixInputs}amix=inputs=${audioInputs.length}:normalize=0:dropout_transition=0[amix];[amix]aselect='${keepExpr}',asetpts=N/SR/TB[aout]`;
  }

  const filterComplex = `[0:v]${videoFilter}[vout];${audioFilter}`;

  progress("compose", "Assemblage final (ffmpeg)…");
  const args = [
    "-y",
    ...inputs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "24",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    "output.mp4",
  ];

  await ff.exec(args);

  const outBytes = (await ff.readFile("output.mp4")) as Uint8Array;
  const blob = new Blob([outBytes.buffer.slice(0) as ArrayBuffer], { type: "video/mp4" });

  progress("done", "Terminé");
  return { videoBlob: blob, segments };
}
