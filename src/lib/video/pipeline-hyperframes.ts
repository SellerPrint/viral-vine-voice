/**
 * ViralDub Pipeline with HyperFrames Animated Subtitles
 *
 * Version modifiée du pipeline qui utilise HyperFrames pour les sous-titres
 * au lieu des presets FFmpeg drawtext statiques.
 *
 * Avantages :
 * - Animations mot par mot (word-by-word)
 * - Effets pop/scale fluides
 * - Transitions riches entre segments
 * - Meilleure expérience utilisateur
 */

import { transcribeAudio, translateSegments } from "@/lib/ai.functions";
import { arrayBufferToBase64, exactArrayBuffer } from "@/lib/base64";
import { DEFAULT_SOURCE_LANGUAGE } from "@/lib/languages";

import { composeNarrationWav } from "./audio/narration";
import { planSilenceCuts } from "./audio/silence-plan";
import { detectSilences, keptIntervals } from "./audio/wav";
import { getFfmpeg, writeFileSafe } from "./ffmpeg-client";
import { loadFont } from "./font";
import { resolveMasks, type GraphInputs } from "./ffmpeg/graph";
import { renderWithFallback } from "./ffmpeg/render";
import {
  DEFAULT_MASKS,
  SUBTITLE_PRESETS,
  resolvePreset,
  type PipelineOptions,
} from "./presets";
import { remapTimeWithTransitions, transitionDurations } from "./transitions";
import {
  buildCues,
  groupWordsToSegments,
  wrapLines,
  type Segment,
} from "./subtitles/cues";

// HyperFrames integration
import {
  renderSubtitlesWithHyperFrames,
  overlaySubtitlesOnVideo,
  type HyperFramesPreset,
  HYPERFRAMES_PRESETS,
} from "./hyperframes";

export type { Segment, Word, Cue } from "./subtitles/cues";
export { groupWordsToSegments, wrapLines, buildCues } from "./subtitles/cues";
export { detectSilences, keptIntervals, remapTime } from "./audio/wav";
export { buildGraph, buildStyleBits, resolveMasks } from "./ffmpeg/graph";

export type VideoInput = { name: string; bytes: Uint8Array };

export type ProgressCb = (
  step: string,
  detail?: string,
  pct?: number
) => void;

export type PipelineResult = {
  videoBlob: Blob;
  segments: Segment[];
  /** Dégradations et échecs partiels à signaler à l'utilisateur. */
  warnings: string[];
};

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/**
 * Options étendues pour le pipeline HyperFrames
 */
export type HyperFramesPipelineOptions = PipelineOptions & {
  /** Utiliser HyperFrames pour les sous-titres (défaut: true) */
  useHyperFrames?: boolean;
  /** Preset HyperFrames pour les sous-titres */
  hyperframesPreset?: HyperFramesPreset;
  /** Rendre les sous-titres côté client (défaut: false) */
  clientSideRender?: boolean;
};

export async function runPipeline(
  input: VideoInput,
  progress: ProgressCb,
  opts?: HyperFramesPipelineOptions,
): Promise<PipelineResult> {
  const signal = opts?.signal;
  const useHyperFrames = opts?.useHyperFrames !== false; // Défaut: true
  const hyperframesPreset = opts?.hyperframesPreset ?? HYPERFRAMES_PRESETS[0];
  const clientSideRender = opts?.clientSideRender === true;

  const preset = resolvePreset(
    opts?.preset ?? SUBTITLE_PRESETS[0],
    opts?.overrides ?? {}
  );
  const masks = opts?.masks ?? DEFAULT_MASKS;
  const sourceLanguage =
    opts?.sourceLanguage ?? DEFAULT_SOURCE_LANGUAGE;
  const targetLanguage = opts?.targetLanguage ?? {
    code: "en",
    label: "Anglais",
    name: "English",
  };
  const warnings: string[] = [];

  signal?.throwIfAborted();

  progress("ffmpeg", "Chargement du moteur vidéo…");
  const ff = await getFfmpeg(undefined, (p) =>
    progress("ffmpeg-progress", undefined, p)
  );
  const cleanupNames = new Set<string>();

  try {
    const inputName = "input.mp4";
    cleanupNames.add(inputName);
    cleanupNames.add("audio.wav");

    progress("upload", "Import du fichier…");
    // Copie : `input.bytes` sert aussi a l'apercu et au lecteur video.
    await writeFileSafe(ff, inputName, input.bytes);
    signal?.throwIfAborted();

    progress("extract", "Extraction audio…");
    await ff.exec([
      "-y",
      "-i",
      inputName,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "audio.wav",
    ]);
    const wav = (await ff.readFile("audio.wav")) as Uint8Array;
    signal?.throwIfAborted();

    progress("silence", "Détection des silences…");
    const silences = await detectSilences(wav);

    /* ---------------------------- durée & sondage --------------------------- */
    const logs: string[] = [];
    const handler = ({ message }: { message: string }) => logs.push(message);
    ff.on("log", handler);
    await ff.exec(["-i", inputName, "-hide_banner"]).catch(() => {});
    ff.off("log", handler);

    const probe = logs.join("\n");
    const durMatch = probe.match(
      /Duration:\s*(\d+):(\d+):(\d+\.\d+)/
    );
    const duration = durMatch
      ? +durMatch[1] * 3600 + +durMatch[2] * 60 + parseFloat(durMatch[3])
      : 0;

    signal?.throwIfAborted();

    /* ----------------------------- transcription ---------------------------- */
    progress(
      "transcribe",
      `Transcription multi-locuteurs (${sourceLanguage.label})…`
    );
    const audioB64 = arrayBufferToBase64(exactArrayBuffer(wav));
    const { words } = await transcribeAudio({
      signal,
      data: {
        audioBase64: audioB64,
        mime: "audio/wav",
        sourceLanguage: sourceLanguage.code,
        turnstileToken: opts?.turnstileToken,
      },
    });

    const rawSegments = groupWordsToSegments(words);
    if (rawSegments.length === 0) throw new Error("Aucune parole détectée.");

    /* ------------------------------ traduction ------------------------------ */
    progress(
      "translate",
      `Traduction + prosodie (${targetLanguage.name})…`
    );
    const { segments, untranslated } = await translateSegments({
      signal,
      data: {
        segments: rawSegments.map((s) => ({
          text: s.text,
          start: s.start,
          end: s.end,
        })),
        sourceLanguage: sourceLanguage.name,
        targetLanguage: targetLanguage.name,
        turnstileToken: opts?.turnstileToken,
      },
    });

    if (untranslated > 0) {
      warnings.push(
        `${untranslated} segment${untranslated > 1 ? "s" : ""} n'${untranslated > 1 ? "ont" : "a"} pas pu être traduit${untranslated > 1 ? "s" : ""} : le texte d'origine est conservé.`
      );
    }

    const segs = segments as Array<
      (typeof segments)[number] & { speakerId?: string }
    >;
    segs.forEach((segment, index) => {
      segment.speakerId = rawSegments[index]?.speakerId;
    });

    /* ------------------------------- voix off ------------------------------- */
    progress("tts", "Génération voix off…", 0);
    const narration = await composeNarrationWav(
      segments,
      duration,
      (done, total) =>
        progress("tts", `Voix off ${done}/${total}…`, done / total),
      {
        provider: opts?.ttsProvider ?? "elevenlabs",
        clonedVoiceId: opts?.clonedVoiceId,
        turnstileToken: opts?.turnstileToken,
      },
      signal
    );

    // Un échec partiel produisait auparavant une vidéo quasi muette annoncée
    // comme un succès complet.
    if (narration.total > 0 && narration.failed === narration.total) {
      warnings.push(
        "La voix off n'a pu être générée sur aucun segment (quota ou clé API). La vidéo est rendue sans doublage."
      );
    } else if (narration.failed > 0) {
      // Le motif change tout : « limite de débit atteinte » invite à relancer,
      // « clé API refusée » demande une action de configuration.
      const why = narration.failureReasons.length
        ? ` (${narration.failureReasons.join(", ")})`
        : "";
      warnings.push(
        `${narration.failed} segment${narration.failed > 1 ? "s" : ""} sur ${narration.total} sans voix off${why}. ` +
          `Chaque segment a été retenté 3 fois avant abandon.`
      );
    }

    // La traduction peut etre physiquement trop longue pour la duree de la
    // video : a 1,2x maximum, on ne fait pas entrer 15 s de parole dans 10 s.
    // Le dire franchement vaut mieux qu'une fin muette inexpliquee.
    if (narration.overshoot > 0.3) {
      warnings.push(
        `La voix off dépasse d'environ ${narration.overshoot.toFixed(1)} s : la traduction est plus longue que la vidéo. ` +
          `La narration a été accélérée au maximum. Pour un meilleur résultat, raccourcis la vidéo ou choisis une langue plus concise.`
      );
    }

    const voiceWav = narration.wav;
    signal?.throwIfAborted();

    /* ------------------------ coupure des silences -------------------------- */
    const visible = segments
      .filter((s) => s.textEn.trim())
      .sort((a, b) => a.start - b.start);
    const wantCuts = opts?.cutSilences !== false && duration > 0;

    // Le silence est rogné contre la parole plutôt qu'écarté dès qu'il la
    // touche : un silence commence toujours à l'instant où la parole s'arrête,
    // donc un simple test de chevauchement les éliminait tous.
    const cutList = wantCuts ? planSilenceCuts(silences, visible) : [];
    const keeps = cutList.length ? keptIntervals(duration, cutList, 0) : [];

    if (wantCuts && !cutList.length && silences.length > 0) {
      warnings.push(
        "Aucun silence exploitable détecté : la vidéo garde son rythme d'origine."
      );
    }

    /* -------------------------------- cues ---------------------------------- */
    const cues = buildCues(segments, opts?.wordByWord !== false);

    /* ------------------------------- masques -------------------------------- */
    const sizeMatch = probe.match(
      /Video:.*?[\s,](\d{2,5})x(\d{2,5})/
    );
    const videoWidth = sizeMatch ? +sizeMatch[1] : 0;
    const videoHeight = sizeMatch ? +sizeMatch[2] : 0;

    // `xfade` normalise chaque segment a une cadence donnee : utiliser celle
    // de la source evite de degrader une video 50 ou 60 fps.
    const fpsMatch = probe.match(/,\s*([\d.]+)\s*fps\b/);
    const sourceFps = fpsMatch ? parseFloat(fpsMatch[1]) : 0;

    const sourceHasAudio = /Stream #\d+:\d+.*: Audio:/.test(probe);
    const dropOriginalAudio = opts?.removeOriginalAudio !== false;
    const hasAudio = sourceHasAudio && !dropOriginalAudio;

    const activeMasks = resolveMasks(masks, videoWidth, videoHeight);

    const coverMask = masks.find(
      (m) => m.enabled && (m.id === "bottom" || m.id === "top")
    );
    const subYAnchor = coverMask
      ? Math.min(0.94, Math.max(0.06, coverMask.y + coverMask.h / 2))
      : preset.yAnchor;

    if (voiceWav) {
      cleanupNames.add("voice.wav");
      await writeFileSafe(ff, "voice.wav", voiceWav);
    }

    // Les fondus font se recouvrir les segments : le remappage des sous-titres
    // doit integrer ce raccourcissement, sinon ils derivent un peu plus a
    // chaque coupe.
    const transition = opts?.transition ?? "none";
    const transitionSeconds = opts?.transitionDuration ?? 0.3;
    const cutDurations =
      transition === "none"
        ? keeps.map(() => 0)
        : transitionDurations(keeps, transitionSeconds);

    /* -------------------------------- rendu --------------------------------- */
    progress("compose", "Assemblage final…");
    cleanupNames.add("output.mp4");

    let outcome;

    if (useHyperFrames && cues.length > 0) {
      // ─── Chemin HyperFrames : sous-titres animés ────────────────────────
      progress("compose", "Rendu des sous-titres animés HyperFrames…");

      try {
        // 1. Rendre les sous-titres HyperFrames
        const subtitleResult = await renderSubtitlesWithHyperFrames(cues, {
          preset: hyperframesPreset,
          width: videoWidth || 1080,
          height: videoHeight || 1920,
          fps: sourceFps || 30,
          quality: "high",
          transparent: true,
        });

        // 2. Si on a une vidéo de sous-titres, l'overlay
        if (subtitleResult.videoBlob.type.startsWith("video/")) {
          const inputFileData = await ff.readFile(inputName);
          // Convertir en ArrayBuffer compatible Blob
          let inputArrayBuffer: ArrayBuffer;
          if (inputFileData instanceof Uint8Array) {
            inputArrayBuffer = inputFileData.buffer.slice(
              inputFileData.byteOffset,
              inputFileData.byteOffset + inputFileData.byteLength
            ) as ArrayBuffer;
          } else {
            inputArrayBuffer = new TextEncoder().encode(String(inputFileData)).buffer as ArrayBuffer;
          }
          const originalBlob = new Blob([inputArrayBuffer], { type: "video/mp4" });

          const finalBlob = await overlaySubtitlesOnVideo(
            originalBlob,
            cues,
            {
              preset: hyperframesPreset,
              width: videoWidth || 1080,
              height: videoHeight || 1920,
            }
          );

          const finalArrayBuffer = await finalBlob.arrayBuffer();
          // Copie ArrayBuffer pour éviter les problèmes de SharedArrayBuffer
          const copiedBuffer = new ArrayBuffer(finalArrayBuffer.byteLength);
          new Uint8Array(copiedBuffer).set(new Uint8Array(finalArrayBuffer));
          const finalBytes = new Uint8Array(copiedBuffer);

          // Appliquer les masques et la voix off si nécessaire
          const graphInputs: GraphInputs = {
            cues: [], // Pas de sous-titres FFmpeg
            subtitleFiles: [],
            preset,
            coverMask,
            subYAnchor,
            activeMasks,
            keeps,
            hasAudio,
            hasVoice: Boolean(voiceWav),
            mirror: opts?.mirror === true,
            ambienceLevel: opts?.ambienceLevel,
            maskStrength: opts?.maskStrength,
            remap: (t) => remapTimeWithTransitions(t, keeps, cutDurations),
            filterId: opts?.filterId,
            upscale: opts?.upscale ?? "none",
            videoWidth,
            videoHeight,
            fps: sourceFps,
            transition,
            transitionDuration: transitionSeconds,
          };

          // Écrire la vidéo avec sous-titres pour le traitement final
          cleanupNames.add("hf-output.mp4");
          await writeFileSafe(ff, "hf-output.mp4", finalBytes);

          outcome = await renderWithFallback(
            ff,
            graphInputs,
            {
              inputName: "hf-output.mp4",
              voiceFile: voiceWav ? "voice.wav" : null,
              outputName: "output.mp4",
              onProgress: (note) => progress("compose", note),
              signal,
            }
          );
        } else {
          // Fallback : utiliser le rendu FFmpeg classique
          progress("compose", "Fallback sur rendu FFmpeg classique…");
          outcome = await renderWithFallback(
            ff,
            buildGraphInputs(
              cues,
              preset,
              coverMask,
              subYAnchor,
              activeMasks,
              keeps,
              hasAudio,
              voiceWav,
              opts,
              transition,
              transitionSeconds,
              cutDurations,
              videoWidth,
              videoHeight,
              sourceFps
            ),
            {
              inputName,
              voiceFile: voiceWav ? "voice.wav" : null,
              outputName: "output.mp4",
              onProgress: (note) => progress("compose", note),
              signal,
            }
          );
        }
      } catch (error) {
        console.warn(
          "[HyperFrames] Erreur, fallback sur FFmpeg classique:",
          error
        );
        warnings.push(
          "Rendu HyperFrames échoué, utilisation du rendu FFmpeg classique."
        );

        // Fallback : chemiin FFmpeg classique
        const subtitleFiles = cues.map((_, i) => `subtitle_${i}.txt`);
        for (let i = 0; i < subtitleFiles.length; i++) {
          const raw = preset.uppercase
            ? cues[i].text.toUpperCase()
            : cues[i].text;
          const text = wrapLines(
            raw,
            preset.maxCharsPerLine,
            preset.maxLines
          ).join("\n");
          cleanupNames.add(subtitleFiles[i]);
          await ff.writeFile(
            subtitleFiles[i],
            new TextEncoder().encode(text)
          );
        }

        progress("compose", "Chargement de la police…");
        cleanupNames.add("font.ttf");
        await writeFileSafe(
          ff,
          "font.ttf",
          await loadFont(signal, targetLanguage.code)
        );

        outcome = await renderWithFallback(
          ff,
          buildGraphInputs(
            cues,
            preset,
            coverMask,
            subYAnchor,
            activeMasks,
            keeps,
            hasAudio,
            voiceWav,
            opts,
            transition,
            transitionSeconds,
            cutDurations,
            videoWidth,
            videoHeight,
            sourceFps
          ),
          {
            inputName,
            voiceFile: voiceWav ? "voice.wav" : null,
            outputName: "output.mp4",
            onProgress: (note) => progress("compose", note),
            signal,
          }
        );
      }
    } else {
      // ─── Chemin FFmpeg classique : sous-titres drawtext ──────────────────
      const subtitleFiles = cues.map((_, i) => `subtitle_${i}.txt`);

      for (let i = 0; i < subtitleFiles.length; i++) {
        const raw = preset.uppercase
          ? cues[i].text.toUpperCase()
          : cues[i].text;
        const text = wrapLines(
          raw,
          preset.maxCharsPerLine,
          preset.maxLines
        ).join("\n");
        cleanupNames.add(subtitleFiles[i]);
        await ff.writeFile(
          subtitleFiles[i],
          new TextEncoder().encode(text)
        );
      }

      progress("compose", "Chargement de la police…");
      cleanupNames.add("font.ttf");
      await writeFileSafe(
        ff,
        "font.ttf",
        await loadFont(signal, targetLanguage.code)
      );

      outcome = await renderWithFallback(
        ff,
        buildGraphInputs(
          cues,
          preset,
          coverMask,
          subYAnchor,
          activeMasks,
          keeps,
          hasAudio,
          voiceWav,
          opts,
          transition,
          transitionSeconds,
          cutDurations,
          videoWidth,
          videoHeight,
          sourceFps
        ),
        {
          inputName,
          voiceFile: voiceWav ? "voice.wav" : null,
          outputName: "output.mp4",
          onProgress: (note) => progress("compose", note),
          signal,
        }
      );
    }

    if (outcome.degradations.length) {
      warnings.push(
        `Rendu simplifié : ${outcome.degradations.join(", ")} non appliqué${outcome.degradations.length > 1 ? "s" : ""}.`
      );
    }

    return {
      videoBlob: new Blob(
        [exactArrayBuffer(outcome.bytes)],
        { type: "video/mp4" }
      ),
      segments,
      warnings,
    };
  } finally {
    for (const name of cleanupNames) {
      try {
        await ff.deleteFile(name);
      } catch {
        // Le fichier peut ne jamais avoir été écrit : sans importance.
      }
    }
  }
}

/**
 * Helper pour construire les GraphInputs
 */
function buildGraphInputs(
  cues: any[],
  preset: any,
  coverMask: any,
  subYAnchor: number,
  activeMasks: any[],
  keeps: any[],
  hasAudio: boolean,
  voiceWav: any,
  opts: any,
  transition: string,
  transitionSeconds: number,
  cutDurations: number[],
  videoWidth: number,
  videoHeight: number,
  sourceFps: number
): GraphInputs {
  const subtitleFiles = cues.map((_: any, i: number) => `subtitle_${i}.txt`);

  return {
    cues,
    subtitleFiles,
    preset,
    coverMask,
    subYAnchor,
    activeMasks,
    keeps,
    hasAudio,
    hasVoice: Boolean(voiceWav),
    mirror: opts?.mirror === true,
    ambienceLevel: opts?.ambienceLevel,
    maskStrength: opts?.maskStrength,
    remap: (t: number) => remapTimeWithTransitions(t, keeps, cutDurations),
    filterId: opts?.filterId,
    upscale: opts?.upscale ?? "none",
    videoWidth,
    videoHeight,
    fps: sourceFps,
    transition: transition as any,
    transitionDuration: transitionSeconds,
  };
}
