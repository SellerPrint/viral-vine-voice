import { getFfmpeg, releaseFfmpeg } from "./ffmpeg-client";
import { transcribeAudio, translateSegments, synthesizeSpeech } from "@/lib/ai.functions";
import {
  DEFAULT_MASKS,
  SUBTITLE_PRESETS,
  resolvePreset,
  type PipelineOptions,
} from "./presets";

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

/** Encode a mono Float32 track into a 16-bit PCM WAV file. */
function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return bytes;
}

/**
 * Synthesize each translated segment and mix them into a single mono WAV
 * timeline (one FFmpeg input only → pas d'erreur FS).
 */
async function composeNarrationWav(
  segments: Segment[],
  duration: number,
  progress: ProgressCb,
): Promise<Uint8Array | null> {
  const usable = segments.filter((s) => s.textEn.trim().length > 1);
  if (!usable.length || !duration) return null;

  const decodeCtx = new AudioContext();
  const clips: { buffer: AudioBuffer; start: number; slot: number }[] = [];

  for (let i = 0; i < usable.length; i++) {
    const s = usable[i];
    progress("tts", `Voix off ${i + 1}/${usable.length}…`, (i + 1) / usable.length);
    try {
      const { audioBase64 } = await synthesizeSpeech({
        data: { text: s.textEn.trim(), speed: 1.0 },
      });
      const bytes = base64ToBytes(audioBase64);
      const buffer = await decodeCtx.decodeAudioData(exactArrayBuffer(bytes));
      clips.push({ buffer, start: s.start, slot: Math.max(0.4, s.end - s.start) });
    } catch {
      // on ignore un segment raté pour ne pas casser tout le rendu
    }
  }
  decodeCtx.close();
  if (!clips.length) return null;

  const sampleRate = 24000;
  const tail = Math.max(
    duration,
    ...clips.map((c) => c.start + c.buffer.duration),
  );
  const offline = new OfflineAudioContext(1, Math.ceil((tail + 0.5) * sampleRate), sampleRate);
  for (const c of clips) {
    const src = offline.createBufferSource();
    src.buffer = c.buffer;
    // accélère légèrement si la voix dépasse la durée du segment (max 1.35x)
    const ratio = c.buffer.duration / c.slot;
    src.playbackRate.value = Math.min(1.35, Math.max(1, ratio));
    src.connect(offline.destination);
    src.start(c.start);
  }
  const rendered = await offline.startRendering();
  return encodeWav(rendered.getChannelData(0), sampleRate);
}


function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

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
  const buf = await ctx.decodeAudioData(exactArrayBuffer(wavBytes));
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
  opts?: PipelineOptions,
): Promise<{ videoBlob: Blob; segments: Segment[] }> {
  const preset = resolvePreset(opts?.preset ?? SUBTITLE_PRESETS[0], opts?.overrides ?? {});
  const masks = opts?.masks ?? DEFAULT_MASKS;
  progress("ffmpeg", "Chargement du moteur vidéo (~30 Mo)…");
  const ff = await getFfmpeg(undefined, (p) => progress("ffmpeg-progress", undefined, p));
  const cleanupNames = new Set<string>();

  try {
  const inputName = "input.mp4";
  cleanupNames.add(inputName);
  cleanupNames.add("audio.wav");
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
    const buf = await ctx.decodeAudioData(exactArrayBuffer(wav));
    duration = buf.duration;
    ctx.close();
  }

  const kept = keptIntervals(duration, silences);

  // 3. Transcribe (FR)
  progress("transcribe", "Transcription française via ElevenLabs…");
  const audioB64 = arrayBufferToBase64(exactArrayBuffer(wav));
  const { words } = await transcribeAudio({ data: { audioBase64: audioB64, mime: "audio/wav" } });
  const rawSegments = groupWordsToSegments(words);

  if (rawSegments.length === 0) {
    throw new Error("Aucune parole détectée dans la vidéo.");
  }

  // 4. Translate FR -> langue cible
  const targetLanguage = opts?.targetLanguage ?? { code: "en", label: "Anglais", name: "English" };
  progress("translate", `Traduction française → ${targetLanguage.name}…`);
  const { segments } = await translateSegments({
    data: {
      segments: rawSegments.map((s) => ({ text: s.text, start: s.start, end: s.end })),
      targetLanguage: targetLanguage.name,
    },
  });

  // 5. Voix off : synthèse de chaque segment + mixage en un seul WAV (1 input).
  progress("tts", "Génération de la voix off…", 0);
  let voiceWav: Uint8Array | null = null;
  try {
    voiceWav = await composeNarrationWav(segments, duration, progress);
  } catch {
    voiceWav = null;
  }


  // Escape text for drawtext (per line, newlines added after escaping)
  const esc = (s: string) =>
    s
      .replace(/\\/g, "\\\\")
      .replace(/:/g, "\\:")
      .replace(/,/g, "\\,")
      .replace(/'/g, "\u2019")
      .replace(/%/g, "\\%");

  // Wrap long lines so subtitles stay fully on screen (portrait 9:16).
  const wrapLines = (raw: string, maxChars: number, maxLines: number) => {
    const words = raw.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      if (!cur.length) {
        cur = w;
      } else if ((cur + " " + w).length <= maxChars) {
        cur += " " + w;
      } else if (lines.length === maxLines - 1) {
        cur += " " + w;
      } else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur.length) lines.push(cur);
    return lines;
  };

  // Avoid overlapping subtitle cards: clamp each segment's end to the next start.
  const visible = segments
    .filter((s) => s.textEn.trim())
    .sort((a, b) => a.start - b.start);

  const drawTextFilters = visible
    .map((s, i) => {
      const raw = preset.uppercase ? s.textEn.toUpperCase() : s.textEn;
      const text = wrapLines(raw, preset.maxCharsPerLine, preset.maxLines)
        .map(esc)
        .join("\\n");
      const next = visible[i + 1];
      const start = s.start.toFixed(3);
      const rawEnd = next ? Math.min(s.end, next.start - 0.02) : s.end;
      const end = Math.max(rawEnd, s.start + 0.4).toFixed(3);
      // yAnchor is the vertical center of the text block in the frame (0..1)
      return `drawtext=fontfile=font.ttf:text='${text}':fontcolor=${preset.fontColor}:fontsize=${preset.fontsize}:line_spacing=${preset.lineSpacing}:box=1:boxcolor=${preset.boxColor}:boxborderw=${preset.boxBorderW}:x=(w-text_w)/2:y=h*${preset.yAnchor.toFixed(3)}-text_h/2:enable='between(t,${start},${end})'`;
    })
    .join(",");

  // Load a font for drawtext
  progress("compose", "Chargement de la police pour sous-titres…");
  const fontRes = await fetch(
    "https://unpkg.com/@fontsource/space-grotesk@5.2.10/files/space-grotesk-latin-700-normal.woff2",
  );
  const ttfRes = await fetch(
    "https://raw.githubusercontent.com/googlefonts/roboto/main/src/hinted/Roboto-Bold.ttf",
  );
  const ttfBuf = ttfRes.ok
    ? new Uint8Array(await ttfRes.arrayBuffer())
    : new Uint8Array(await fontRes.arrayBuffer());
  cleanupNames.add("font.ttf");
  await ff.writeFile("font.ttf", ttfBuf);

  // Mask (blur) the zones where the original FR subtitles / logos are burnt in.
  const sizeMatch = logs.join("\n").match(/Video:.*?[\s,](\d{2,5})x(\d{2,5})/);
  const vw = sizeMatch ? +sizeMatch[1] : 0;
  const vh = sizeMatch ? +sizeMatch[2] : 0;
  const even = (n: number) => Math.max(16, Math.round(n / 2) * 2);
  const activeMasks =
    vw && vh
      ? masks
          .filter((m) => m.enabled && m.w > 0.02 && m.h > 0.01)
          .map((m) => {
            const w = even(Math.min(m.w, 1) * vw);
            const h = even(Math.min(m.h, 1) * vh);
            const x = Math.max(0, Math.min(vw - w, Math.round(m.x * vw / 2) * 2));
            const y = Math.max(0, Math.min(vh - h, Math.round(m.y * vh / 2) * 2));
            return { w, h, x, y };
          })
          .slice(0, 4)
      : [];

  let filterComplex = "";
  if (activeMasks.length) {
    const parts: string[] = [`[0:v]split=${activeMasks.length + 1}[base]${activeMasks
      .map((_, i) => `[z${i}]`)
      .join("")}`];
    activeMasks.forEach((m, i) => {
      parts.push(`[z${i}]crop=${m.w}:${m.h}:${m.x}:${m.y},boxblur=18:2[b${i}]`);
    });
    let prev = "base";
    activeMasks.forEach((m, i) => {
      const out = i === activeMasks.length - 1 ? "masked" : `o${i}`;
      parts.push(`[${prev}][b${i}]overlay=${m.x}:${m.y}[${out}]`);
      prev = out;
    });
    filterComplex = parts.join(";");
    filterComplex += `;[masked]${drawTextFilters || "null"}[vout]`;
  } else {
    filterComplex = `[0:v]${drawTextFilters || "null"}[vout]`;
  }


  progress("compose", "Assemblage final (ffmpeg)…");
  if (voiceWav) {
    cleanupNames.add("voice.wav");
    await ff.writeFile("voice.wav", voiceWav);
  }

  // aac-mix : voix off + audio original atténué. aac : audio original seul.
  type Mode = "mix" | "voice" | "aac" | "none";
  const baseArgs = (mode: Mode) => {
    const a = ["-y", "-i", inputName];
    if (mode === "mix" || mode === "voice") a.push("-i", "voice.wav");
    let fc = filterComplex;
    if (mode === "mix") {
      fc += `;[0:a]volume=0.14,aresample=44100[a0];[1:a]volume=1.6,aresample=44100[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0,alimiter=limit=0.95[aout]`;
    } else if (mode === "voice") {
      fc += `;[1:a]volume=1.6,aresample=44100[aout]`;
    }
    a.push("-filter_complex", fc, "-map", "[vout]");
    if (mode === "mix" || mode === "voice") {
      a.push("-map", "[aout]", "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2");
    } else if (mode === "aac") {
      a.push("-map", "0:a?", "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2");
    } else {
      a.push("-an");
    }
    a.push(
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "24",
      "-pix_fmt",
      "yuv420p",
      "-shortest",
      "-max_muxing_queue_size",
      "1024",
      "-movflags",
      "+faststart",
      "output.mp4",
    );
    return a;
  };

  cleanupNames.add("output.mp4");
  let outBytes: Uint8Array | null = null;
  let lastError: unknown = null;
  const modes: Mode[] = voiceWav ? ["mix", "voice", "aac", "none"] : ["aac", "none"];
  for (const mode of modes) {
    try {
      await ff.exec(baseArgs(mode));
      const data = (await ff.readFile("output.mp4")) as Uint8Array;
      // Un fichier trop petit = rendu invalide (ffmpeg a échoué silencieusement).
      if (data && data.byteLength > 1024) {
        outBytes = data;
        break;
      }
      lastError = new Error("Fichier de sortie vide ou invalide.");
    } catch (error) {
      lastError = error;
    }
  }


  if (!outBytes) {
    throw new Error(
      `La vidéo n'a pas pu être encodée (format source probablement non supporté). Convertis-la en MP4 H.264 ou essaie une vidéo plus courte. ${
        lastError instanceof Error ? lastError.message : String(lastError ?? "")
      }`.trim(),
    );
  }

  const blob = new Blob([outBytes.buffer.slice(0) as ArrayBuffer], { type: "video/mp4" });

  // Free memory: unlink intermediate files from the in-memory FS.
  progress("done", "Terminé");
  return { videoBlob: blob, segments };
  } finally {
    for (const name of cleanupNames) {
      try { await ff.deleteFile(name); } catch { /* ignore */ }
    }
    releaseFfmpeg();
  }
}
