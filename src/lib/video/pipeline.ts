import { getFfmpeg } from "./ffmpeg-client";
import { transcribeAudio, translateSegments, synthesizeSpeech } from "@/lib/ai.functions";
import {
  DEFAULT_MASKS,
  SUBTITLE_PRESETS,
  resolvePreset,
  type PipelineOptions,
} from "./presets";
import { type VoiceDirection } from "@/lib/ai.server";

export type Word = { text: string; start: number; end: number; speakerId?: string };
export type Segment = { 
  start: number; 
  end: number; 
  textFr: string; 
  textEn: string; 
  direction?: VoiceDirection;
  speakerId?: string;
};
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

const SPEAKER_VOICES: Record<string, string> = {
  "0": "EXAVITQu4vr4xnSDxMaL", // Bella
  "1": "pNInz6obpgDQGcFmaJgB", // Adam
  "2": "IKne3meq5aZN9X97s4mc", // Charlie
  "3": "Lcf7u9Pa966p7ftY009V", // Emily
};

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
      const slot = Math.max(0.4, s.end - s.start);
      // Heuristic for speed: base is 2.8 words/sec.
      const wordCount = s.textEn.split(/\s+/).length;
      const targetSpeed = Math.min(1.25, Math.max(0.75, (wordCount / slot) / 2.8));
      
      const { audioBase64 } = await synthesizeSpeech({
        data: {
          text: s.textEn.trim(),
          speed: targetSpeed,
          direction: s.direction || "neutral",
          voiceId: SPEAKER_VOICES[s.speakerId || "0"] || SPEAKER_VOICES["0"],
          previousText: usable[i - 1]?.textEn,
          nextText: usable[i + 1]?.textEn,
        },
      });
      const bytes = base64ToBytes(audioBase64);
      const buffer = await decodeCtx.decodeAudioData(exactArrayBuffer(bytes));
      clips.push({ buffer, start: s.start, slot });
    } catch (e) {
      console.error("TTS Segment failed", e);
    }
  }
  decodeCtx.close();
  if (!clips.length) return null;

  const sampleRate = 24000;
  const tail = Math.max(duration, ...clips.map((c) => c.start + c.buffer.duration));
  const offline = new OfflineAudioContext(1, Math.ceil((tail + 1) * sampleRate), sampleRate);
  
  for (const c of clips) {
    const src = offline.createBufferSource();
    src.buffer = c.buffer;
    
    // Fine-tune playback rate to perfectly fit the slot if it's too long
    const actualDuration = c.buffer.duration;
    if (actualDuration > c.slot + 0.1) {
      src.playbackRate.value = Math.min(1.2, actualDuration / c.slot);
    }
    
    src.connect(offline.destination);
    src.start(c.start);
    // Remove hard stop to avoid clicking and allow slight overflow if needed
    // src.stop(c.start + c.slot); 
  }
  const rendered = await offline.startRendering();
  return encodeWav(rendered.getChannelData(0), sampleRate);
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export function groupWordsToSegments(words: Word[]): { text: string; start: number; end: number; speakerId: string }[] {
  const out: { text: string; start: number; end: number; speakerId: string }[] = [];
  if (!words.length) return out;
  let cur: Word[] = [];
  
  const flush = () => {
    if (!cur.length) return;
    // Determine majority speaker
    const speakers = cur.map(w => w.speakerId || "0");
    const mode = speakers.sort((a,b) =>
          speakers.filter(v => v===a).length
        - speakers.filter(v => v===b).length
    ).pop() || "0";

    out.push({
      text: cur.map((w) => w.text).join(" ").replace(/\s+([,.!?;:])/g, "$1").trim(),
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      speakerId: mode,
    });
    cur = [];
  };

  for (const w of words) {
    cur.push(w);
    const dur = cur[cur.length - 1].end - cur[0].start;
    const endsSentence = /[.!?…]$/.test(w.text.trim());
    if ((endsSentence && dur > 1.5) || dur > 7) flush();
  }
  flush();
  return out;
}

export async function detectSilences(wavBytes: Uint8Array): Promise<{ start: number; end: number }[]> {
  const ctx = new AudioContext();
  const buf = await ctx.decodeAudioData(exactArrayBuffer(wavBytes));
  const data = buf.getChannelData(0);
  const sampleRate = buf.sampleRate;
  const winSize = Math.floor(0.02 * sampleRate);
  const threshold = 0.008;
  const minSilence = 0.4;
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

export async function runPipeline(
  input: VideoInput,
  progress: ProgressCb,
  opts?: PipelineOptions,
): Promise<{ videoBlob: Blob; segments: Segment[] }> {
  const preset = resolvePreset(opts?.preset ?? SUBTITLE_PRESETS[0], opts?.overrides ?? {});
  const masks = opts?.masks ?? DEFAULT_MASKS;
  progress("ffmpeg", "Chargement du moteur vidéo…");
  const ff = await getFfmpeg(undefined, (p) => progress("ffmpeg-progress", undefined, p));
  const cleanupNames = new Set<string>();

  try {
    const inputName = "input.mp4";
    cleanupNames.add(inputName);
    cleanupNames.add("audio.wav");
    progress("upload", "Import du fichier…");
    await ff.writeFile(inputName, input.bytes);

    progress("extract", "Extraction audio…");
    await ff.exec(["-y", "-i", inputName, "-vn", "-ac", "1", "-ar", "16000", "audio.wav"]);
    const wav = (await ff.readFile("audio.wav")) as Uint8Array;

    progress("silence", "Détection des silences…");
    const silences = await detectSilences(wav);

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

    progress("transcribe", "Transcription multi-locuteurs (ElevenLabs)…");
    const audioB64 = arrayBufferToBase64(exactArrayBuffer(wav));
    const { words } = await transcribeAudio({ data: { audioBase64: audioB64, mime: "audio/wav" } });
    const rawSegments = groupWordsToSegments(words);

    if (rawSegments.length === 0) throw new Error("Aucune parole détectée.");

    const targetLanguage = opts?.targetLanguage ?? { code: "en", label: "Anglais", name: "English" };
    progress("translate", `Traduction + Prosodie (${targetLanguage.name})…`);
    const { segments } = await translateSegments({
      data: {
        segments: rawSegments.map((s) => ({ text: s.text, start: s.start, end: s.end })),
        targetLanguage: targetLanguage.name,
      },
    });
    
    // Inject speakerId back into segments
    const segs = segments as Array<(typeof segments)[number] & { speakerId?: string }>;
    segs.forEach((s, i) => { s.speakerId = rawSegments[i]?.speakerId; });

    progress("tts", "Génération voix off (AI)…", 0);
    const voiceWav = await composeNarrationWav(segments, duration, progress);

    // Escape for drawtext. 
    // FFmpeg drawtext uses \ to escape special chars. \n is a special case.
    const esc = (s: string) =>
      s.replace(/[\\':%,;[]/g, (m) => "\\" + m);

    const wrapLines = (raw: string, maxChars: number, maxLines: number) => {
      const words = raw.split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let cur = "";
      for (const w of words) {
        if (!cur.length) cur = w;
        else if ((cur + " " + w).length <= maxChars) cur += " " + w;
        else if (lines.length === maxLines - 1) cur += " " + w;
        else { lines.push(cur); cur = w; }
      }
      if (cur.length) lines.push(cur);
      return lines;
    };

    const visible = segments.filter((s) => s.textEn.trim()).sort((a, b) => a.start - b.start);
    const drawTextFilters = visible.map((s, i) => {
      const raw = preset.uppercase ? s.textEn.toUpperCase() : s.textEn;
      const wrapped = wrapLines(raw, preset.maxCharsPerLine, preset.maxLines);
      const text = wrapped.map(esc).join("\\n");
      const next = visible[i + 1];
      const start = s.start.toFixed(3);
      const end = (next ? Math.min(s.end, next.start - 0.02) : s.end).toFixed(3);
      return `drawtext=fontfile=font.ttf:text='${text}':fontcolor=${preset.fontColor}:fontsize=${preset.fontsize}:line_spacing=${preset.lineSpacing}:box=1:boxcolor=${preset.boxColor}:boxborderw=${preset.boxBorderW}:x=(w-text_w)/2:y=h*${preset.yAnchor.toFixed(3)}-text_h/2:enable='between(t,${start},${end})'`;
    }).join(",");

    progress("compose", "Récupération des polices…");
    const ttfRes = await fetch("https://raw.githubusercontent.com/googlefonts/roboto/main/src/hinted/Roboto-Bold.ttf");
    const ttfBuf = new Uint8Array(await ttfRes.arrayBuffer());
    cleanupNames.add("font.ttf");
    await ff.writeFile("font.ttf", ttfBuf);

    const sizeMatch = logs.join("\n").match(/Video:.*?[\s,](\d{2,5})x(\d{2,5})/);
    const vw = sizeMatch ? +sizeMatch[1] : 0;
    const vh = sizeMatch ? +sizeMatch[2] : 0;
    const even = (n: number) => Math.max(16, Math.round(n / 2) * 2);
    const activeMasks = vw && vh ? masks.filter((m) => m.enabled).map((m) => ({
      w: even(m.w * vw), h: even(m.h * vh), x: even(m.x * vw), y: even(m.y * vh)
    })).slice(0, 4) : [];

    let fc = "";
    if (activeMasks.length) {
      fc = `[0:v]split=${activeMasks.length + 1}[base]${activeMasks.map((_, i) => `[z${i}]`).join("")};`;
      activeMasks.forEach((m, i) => { fc += `[z${i}]crop=${m.w}:${m.h}:${m.x}:${m.y},boxblur=20:2[b${i}];`; });
      let prev = "base";
      activeMasks.forEach((m, i) => {
        const out = i === activeMasks.length - 1 ? "masked" : `o${i}`;
        fc += `[${prev}][b${i}]overlay=${m.x}:${m.y}[${out}];`;
        prev = out;
      });
      fc += `[masked]${drawTextFilters || "null"}[vout]`;
    } else {
      fc = `[0:v]${drawTextFilters || "null"}[vout]`;
    }

    if (voiceWav) {
      cleanupNames.add("voice.wav");
      await ff.writeFile("voice.wav", voiceWav);
      fc += `;[0:a]volume=0.15,aresample=44100[a0];[1:a]volume=1.8,aresample=44100[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0,alimiter=limit=0.9[aout]`;
    } else {
      fc += `;[0:a]volume=1,aresample=44100[aout]`;
    }

    progress("compose", "Assemblage final…");
    const args = ["-y", "-i", inputName];
    if (voiceWav) args.push("-i", "voice.wav");
    args.push("-filter_complex", fc, "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "output.mp4");
    
    await ff.exec(args);
    const out = (await ff.readFile("output.mp4")) as Uint8Array;
    return { videoBlob: new Blob([out], { type: "video/mp4" }), segments };

  } finally {
    for (const name of cleanupNames) try { await ff.deleteFile(name); } catch {}
  }
}
