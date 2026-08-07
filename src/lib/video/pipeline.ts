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
  voice?: { provider: "elevenlabs" | "ai33"; clonedVoiceId?: string },
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
      // The server/API accepts at most 1.2. Keep the client in the same range
      // so a dense segment cannot make the whole narration silently disappear.
      const targetSpeed = Math.min(1.2, Math.max(0.75, (wordCount / slot) / 2.8));
      
      const { audioBase64 } = await synthesizeSpeech({
        data: {
          text: s.textEn.trim(),
          speed: targetSpeed,
          direction: s.direction || "neutral",
          provider: voice?.provider ?? "elevenlabs",
          voiceId:
            voice?.provider === "ai33"
              ? (voice.clonedVoiceId || "").trim() || "alloy"
              : SPEAKER_VOICES[s.speakerId || "0"] || SPEAKER_VOICES["0"],
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
    const voiceWav = await composeNarrationWav(segments, duration, progress, {
      provider: opts?.ttsProvider ?? "elevenlabs",
      clonedVoiceId: opts?.clonedVoiceId,
    });

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

    /* ------------------------- coupure des silences ------------------------ */
    const wantCuts = opts?.cutSilences !== false && duration > 0;
    // On ne coupe que les silences qui ne recouvrent aucune parole (marge 0.1s)
    const speechFree = silences.filter(
      (s) =>
        s.end - s.start >= 0.35 &&
        !visible.some((seg) => seg.start - 0.1 < s.end && seg.end + 0.1 > s.start),
    );
    const cutList = wantCuts
      ? speechFree
          .map((s) => ({ start: s.start + 0.08, end: s.end - 0.08 }))
          .filter((s) => s.end - s.start > 0.2)
          .sort((a, b) => b.end - b.start - (a.end - a.start))
          .slice(0, 40)
          .sort((a, b) => a.start - b.start)
      : [];
    const keeps = cutList.length ? keptIntervals(duration, cutList, 0) : [];

    const remap = (t: number) => {
      if (!keeps.length) return t;
      let acc = 0;
      for (const k of keeps) {
        if (t <= k.start) return acc;
        if (t <= k.end) return acc + (t - k.start);
        acc += k.end - k.start;
      }
      return acc;
    };

    // Cover the original subtitle band with the new cards: the new text is
    // placed right on top of the old zone with an opaque plate behind it.
    const coverMask = masks.find((m) => m.enabled && (m.id === "bottom" || m.id === "top"));
    const subYAnchor = coverMask
      ? Math.min(0.94, Math.max(0.06, coverMask.y + coverMask.h / 2))
      : preset.yAnchor;
    const plateColor = preset.boxColor.replace(/@[\d.]+$/, "@0.92");
    const boxColor = preset.boxColor.replace(/@[\d.]+$/, "@0.95");
    const boxBorderW = Math.max(preset.boxBorderW, 16);
    const useBox = preset.useBox !== false;
    const styleBits = [
      `fontcolor=${preset.fontColor}`,
      `fontsize=${preset.fontsize}`,
      `line_spacing=${preset.lineSpacing}`,
      useBox ? `box=1:boxcolor=${boxColor}:boxborderw=${boxBorderW}` : "box=0",
      preset.borderW ? `borderw=${preset.borderW}:bordercolor=${preset.borderColor ?? "black"}` : "",
      preset.shadowColor
        ? `shadowcolor=${preset.shadowColor}:shadowx=${preset.shadowX ?? 2}:shadowy=${preset.shadowY ?? 2}`
        : "",
    ]
      .filter(Boolean)
      .join(":");

    // Keep translated text out of the filter expression. Apostrophes, colons,
    // commas and line breaks inside an inline `text=` value can split the
    // filter graph and leave output.mp4 missing, which surfaces as ErrnoError.

    /* ---------------------- découpage mot par mot ---------------------- */
    type Cue = { text: string; start: number; end: number };
    const wordByWord = opts?.wordByWord !== false;

    const buildCues = (): Cue[] => {
      const cues: Cue[] = [];
      visible.forEach((s, i) => {
        const next = visible[i + 1];
        const segEnd = next ? Math.min(s.end, next.start - 0.02) : s.end;
        const span = Math.max(0.2, segEnd - s.start);
        const words = s.textEn.trim().split(/\s+/).filter(Boolean);
        if (!words.length) return;
        if (!wordByWord) {
          cues.push({ text: s.textEn.trim(), start: s.start, end: segEnd });
          return;
        }
        // Répartition proportionnelle à la longueur des mots.
        const weights = words.map((w) => Math.max(2, w.length));
        const total = weights.reduce((a, b) => a + b, 0);
        let t = s.start;
        words.forEach((w, wi) => {
          const dur = (weights[wi] / total) * span;
          cues.push({ text: w, start: t, end: Math.min(segEnd, t + dur) });
          t += dur;
        });
      });
      // Sécurité : trop de filtres ferait exploser le graphe FFmpeg.
      if (cues.length > 320) {
        return visible.map((s, i) => {
          const next = visible[i + 1];
          return {
            text: s.textEn.trim(),
            start: s.start,
            end: next ? Math.min(s.end, next.start - 0.02) : s.end,
          };
        });
      }
      return cues;
    };

    const cues = buildCues().filter((c) => c.end - c.start > 0.04);
    const subtitleFiles = cues.map((_, i) => `subtitle_${i}.txt`);

    const buildTextFilters = (withCuts: boolean) =>
      cues
        .flatMap((c, i) => {
          const start = (withCuts ? remap(c.start) : c.start).toFixed(3);
          const end = (withCuts ? remap(c.end) : c.end).toFixed(3);
          const enable = `enable=between(t\\,${start}\\,${end})`;
          const filters: string[] = [];
          if (coverMask && useBox) {
            const py = coverMask.y.toFixed(3);
            const ph = coverMask.h.toFixed(3);
            filters.push(
              `drawbox=x=0:y=h*${py}:w=iw:h=h*${ph}:color=${plateColor}:t=fill:${enable}`,
            );
          }
          filters.push(
            `drawtext=fontfile=font.ttf:textfile=${subtitleFiles[i]}:reload=0:${styleBits}:x=(w-text_w)/2:y=h*${subYAnchor.toFixed(3)}-text_h/2:${enable}`,
          );
          return filters;
        })
        .join(",");

    const drawTextFilters = buildTextFilters(false);
    const drawTextFiltersCut = keeps.length ? buildTextFilters(true) : drawTextFilters;

    for (let i = 0; i < subtitleFiles.length; i++) {
      const raw = preset.uppercase ? cues[i].text.toUpperCase() : cues[i].text;
      const text = wrapLines(raw, preset.maxCharsPerLine, preset.maxLines).join("\n");
      cleanupNames.add(subtitleFiles[i]);
      await ff.writeFile(subtitleFiles[i], new TextEncoder().encode(text));
    }


    progress("compose", "Récupération des polices…");
    const ttfRes = await fetch("https://raw.githubusercontent.com/googlefonts/roboto/main/src/hinted/Roboto-Bold.ttf");
    const ttfBuf = new Uint8Array(await ttfRes.arrayBuffer());
    cleanupNames.add("font.ttf");
    await ff.writeFile("font.ttf", ttfBuf);

    const probe = logs.join("\n");
    const sizeMatch = probe.match(/Video:.*?[\s,](\d{2,5})x(\d{2,5})/);
    const vw = sizeMatch ? +sizeMatch[1] : 0;
    const vh = sizeMatch ? +sizeMatch[2] : 0;
    const sourceHasAudio = /Stream #\d+:\d+.*: Audio:/.test(probe);
    // Suppression totale de l'audio d'origine (défaut) : seule la voix off reste.
    const dropOriginalAudio = opts?.removeOriginalAudio !== false;
    const hasAudio = sourceHasAudio && !dropOriginalAudio;

    // Even-sized, in-bounds crop rectangles. An out-of-bounds crop makes the
    // whole filter graph fail with exit code 1.
    const even = (n: number) => Math.round(n / 2) * 2;
    const activeMasks = vw && vh
      ? masks
          .filter((m) => m.enabled)
          .map((m) => {
            const x = Math.min(Math.max(0, even(m.x * vw)), vw - 16);
            const y = Math.min(Math.max(0, even(m.y * vh)), vh - 16);
            const w = Math.max(16, Math.min(even(m.w * vw), even(vw - x)));
            const h = Math.max(16, Math.min(even(m.h * vh), even(vh - y)));
            return { x, y, w, h };
          })
          .filter((m) => m.w >= 16 && m.h >= 16 && m.x + m.w <= vw && m.y + m.h <= vh)
          .slice(0, 4)
      : [];

    const mirror = opts?.mirror === true;

    const buildGraph = (useMasks: boolean, useText: boolean, useVoice: boolean, useCuts: boolean) => {
      const cuts = useCuts && keeps.length > 1;
      const text = useText ? (cuts ? drawTextFiltersCut : drawTextFilters) || "null" : "null";
      let g = "";
      let vIn = "0:v";
      let aIn = "0:a";
      let voiceIn = "1:a";

      if (mirror) {
        g += `[0:v]hflip[vflip];`;
        vIn = "vflip";
      }

      if (cuts) {
        // Découpe réelle des silences : trim + concat sur vidéo et audio.
        g += `[${vIn}]split=${keeps.length}${keeps.map((_, i) => `[cv${i}]`).join("")};`;
        keeps.forEach((k, i) => {
          g += `[cv${i}]trim=start=${k.start.toFixed(3)}:end=${k.end.toFixed(3)},setpts=PTS-STARTPTS[tv${i}];`;
        });
        g += `${keeps.map((_, i) => `[tv${i}]`).join("")}concat=n=${keeps.length}:v=1:a=0[vcut];`;
        vIn = "vcut";

        if (hasAudio) {
          g += `[0:a]asplit=${keeps.length}${keeps.map((_, i) => `[ca${i}]`).join("")};`;
          keeps.forEach((k, i) => {
            g += `[ca${i}]atrim=start=${k.start.toFixed(3)}:end=${k.end.toFixed(3)},asetpts=PTS-STARTPTS[ta${i}];`;
          });
          g += `${keeps.map((_, i) => `[ta${i}]`).join("")}concat=n=${keeps.length}:v=0:a=1[acut];`;
          aIn = "acut";
        }
        if (useVoice && voiceWav) {
          g += `[1:a]asplit=${keeps.length}${keeps.map((_, i) => `[cw${i}]`).join("")};`;
          keeps.forEach((k, i) => {
            g += `[cw${i}]atrim=start=${k.start.toFixed(3)}:end=${k.end.toFixed(3)},asetpts=PTS-STARTPTS[tw${i}];`;
          });
          g += `${keeps.map((_, i) => `[tw${i}]`).join("")}concat=n=${keeps.length}:v=0:a=1[wcut];`;
          voiceIn = "wcut";
        }
      }

      if (useMasks && activeMasks.length) {
        g += `[${vIn}]split=${activeMasks.length + 1}[base]${activeMasks.map((_, i) => `[z${i}]`).join("")};`;
        activeMasks.forEach((m, i) => { g += `[z${i}]crop=${m.w}:${m.h}:${m.x}:${m.y},boxblur=20:2[b${i}];`; });
        let prev = "base";
        activeMasks.forEach((m, i) => {
          const out = i === activeMasks.length - 1 ? "masked" : `o${i}`;
          g += `[${prev}][b${i}]overlay=${m.x}:${m.y}[${out}];`;
          prev = out;
        });
        g += `[masked]${text}[vout]`;
      } else {
        g += `[${vIn}]${text}[vout]`;
      }


      if (useVoice && voiceWav) {
        g += hasAudio
          ? `;[${aIn}]volume=0.15,aresample=44100[a0];[${voiceIn}]volume=1.8,aresample=44100[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0,alimiter=limit=0.9[aout]`
          : `;[${voiceIn}]volume=1.4,aresample=44100[aout]`;
      } else if (hasAudio) {
        g += `;[${aIn}]volume=1,aresample=44100[aout]`;
      }
      return g;
    };

    if (voiceWav) {
      cleanupNames.add("voice.wav");
      await ff.writeFile("voice.wav", voiceWav);
    }

    progress("compose", "Assemblage final…");
    cleanupNames.add("output.mp4");

    const attempts: { masks: boolean; text: boolean; voice: boolean; cuts: boolean; note: string }[] = [
      { masks: true, text: true, voice: true, cuts: true, note: "complet" },
      { masks: false, text: true, voice: true, cuts: true, note: "sans masques" },
      { masks: false, text: true, voice: false, cuts: true, note: "coupes prioritaires" },
      { masks: false, text: true, voice: true, cuts: false, note: "sans coupe des silences" },
      { masks: false, text: true, voice: false, cuts: false, note: "sans voix off" },
      { masks: false, text: false, voice: false, cuts: false, note: "vidéo seule" },
    ];


    let lastLogs = "";
    let out: Uint8Array | null = null;

    for (const attempt of attempts) {
      if (attempt.masks && !activeMasks.length) continue;
      if (attempt.voice && !voiceWav) continue;
      if (attempt.cuts && keeps.length < 2) continue;
      const fc = buildGraph(attempt.masks, attempt.text, attempt.voice && !!voiceWav, attempt.cuts);
      const runLogs: string[] = [];
      const onLog = ({ message }: { message: string }) => runLogs.push(message);
      ff.on("log", onLog);
      const args = ["-y", "-i", inputName];
      if (attempt.voice && voiceWav) args.push("-i", "voice.wav");
      args.push("-filter_complex", fc, "-map", "[vout]");
      if (fc.includes("[aout]")) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "128k");
      else args.push("-an");
      args.push("-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "output.mp4");

      let code = 1;
      try {
        code = await ff.exec(args);
      } catch {
        code = 1;
      }
      ff.off("log", onLog);
      lastLogs = runLogs.slice(-12).join("\n");

      if (code === 0) {
        try {
          const bytes = (await ff.readFile("output.mp4")) as Uint8Array;
          if (bytes.byteLength > 1024) { out = bytes; break; }
        } catch { /* retry with a simpler graph */ }
      }
      progress("compose", `Nouvel essai (${attempt.note})…`);
    }


    if (!out) {
      const detail = lastLogs.match(/(Error|Invalid|failed|No such)[^\n]*/i)?.[0];
      throw new Error(
        `L’assemblage vidéo a échoué${detail ? ` : ${detail}` : ""}. Essayez une vidéo plus courte ou désactivez les zones de masquage.`,
      );
    }
    return { videoBlob: new Blob([exactArrayBuffer(out)], { type: "video/mp4" }), segments };

  } finally {
    for (const name of cleanupNames) try { await ff.deleteFile(name); } catch {}
  }
}
