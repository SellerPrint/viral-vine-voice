import { getFfmpeg, releaseFfmpeg, writeFileSafe } from "@/lib/video/ffmpeg-client";
import { loadFont } from "@/lib/video/font";
import { resolveMasks, type GraphInputs } from "@/lib/video/ffmpeg/graph";
import { renderWithFallback } from "@/lib/video/ffmpeg/render";
import { wrapLines, type Cue } from "@/lib/video/subtitles/cues";
import { remapTimeWithTransitions, transitionDurations } from "@/lib/video/transitions";
import { ancreLegende, cadreCouvrant } from "@/lib/video/presets";
import { exactArrayBuffer } from "@/lib/base64";

import { projectKeeps, projectPreset } from "./project";
import { type Range } from "./edl";
import { QUALITY_PRESETS, type Project } from "./types";

/**
 * Rendu local : ce que la timeline contient, incrusté tel quel.
 *
 * Le doublage IA (`runPipeline`) est un tout : transcription, traduction, voix,
 * coupes, rendu. Or la moitié des gestes d'un monteur — repositionner un bloc de
 * texte, accepter ou refuser une coupe, changer un flou — ne demandent aucun
 * service distant et ne devraient pas attendre un quota. Ce module applique au
 * fichier source exactement le graphe de filtres décrit par le projet, en
 * réutilisant le *même* constructeur de graphe que le pipeline : l'aperçu du
 * monteur et l'image encodée ne peuvent donc pas diverger.
 *
 * La piste de voix off n'est pas ré-encodée ici : elle est produite par le
 * doublage complet, dont le fichier final contient déjà le mixage.
 */

export type LocalRenderRequest = {
  project: Project;
  /** Cues déjà résolus depuis la piste de sous-titres. */
  cues: Cue[];
  /** Plages conservées ; vide = montage sans coupe. */
  keeps: Range[];
  /** Relâche le moteur WebAssembly en fin de rendu (mémoire de l'onglet). */
  releaseEngine?: boolean;
  onProgress?: (detail: string, pct?: number) => void;
  signal?: AbortSignal;
};

export type LocalRenderResult = {
  blob: Blob;
  /** Nom du graphe retenu par le moteur, pour expliquer une dégradation. */
  attempt: string;
  degradations: string[];
  bytes: Uint8Array;
};

export async function renderProjectLocally(
  request: LocalRenderRequest,
): Promise<LocalRenderResult> {
  const { project, cues, keeps, signal, onProgress, releaseEngine = true } = request;
  const source = project.source;
  if (!source?.bytes) {
    throw new Error(
      "Le fichier source n'est plus en mémoire. Réimporte la vidéo avant de lancer un rendu local.",
    );
  }

  const ff = await getFfmpeg(undefined, (p) =>
    onProgress?.("Chargement du moteur vidéo…", p * 0.08),
  );
  const cleanup = new Set<string>(["input.mp4", "output.mp4"]);

  try {
    signal?.throwIfAborted();
    onProgress?.("Préparation du fichier…", 0.12);
    await writeFileSafe(ff, "input.mp4", source.bytes);

    const preset = projectPreset(project);

    onProgress?.(`Incrustation de ${cues.length} sous-titre(s)…`, 0.25);
    const subtitleFiles = cues.map((_, index) => `subtitle_${index}.txt`);
    for (const [index, cue] of cues.entries()) {
      cleanup.add(subtitleFiles[index]);
      const raw = preset.uppercase ? cue.text.toUpperCase() : cue.text;
      const text = wrapLines(raw, preset.maxCharsPerLine, preset.maxLines).join("\n");
      await ff.writeFile(subtitleFiles[index], new TextEncoder().encode(text));
    }

    cleanup.add("font.ttf");
    await writeFileSafe(ff, "font.ttf", await loadFont(signal, project.targetLanguage.code));

    const width = source.width;
    const height = source.height;
    const activeMasks = resolveMasks(project.masks, width, height);
    const coverMask = cadreCouvrant(project.masks);
    const subYAnchor = ancreLegende(project.masks, preset.yAnchor);

    const transition = project.transition;
    const transitionSeconds = project.transitionDuration;
    const cutDurations =
      transition === "none" ? keeps.map(() => 0) : transitionDurations(keeps, transitionSeconds);

    const inputs: GraphInputs = {
      cues,
      subtitleFiles,
      preset,
      coverMask,
      subYAnchor,
      activeMasks,
      keeps,
      hasAudio: source.hasAudio && !project.removeOriginalAudio,
      hasVoice: false,
      mirror: project.mirror,
      ambienceLevel: project.ambienceLevel,
      maskStrength: project.maskStrength,
      remap: (time) => remapTimeWithTransitions(time, keeps, cutDurations),
      filterId: project.filterId,
      upscale: project.upscale,
      videoWidth: width,
      videoHeight: height,
      fps: source.fps,
      transition,
      transitionDuration: transitionSeconds,
    };

    if (!width || !height) {
      // Sans dimensions, `resolveMasks` renvoie zéro zone : le flou demandé ne
      // serait pas appliqué. Mieux vaut le dire que de rendre autre chose.
      if (activeMasks.length === 0 && project.masks.some((m) => m.enabled)) {
        onProgress?.("Dimensions inconnues : zones de masquage ignorées.", 0.4);
      }
    }

    const quality = QUALITY_PRESETS[project.quality];
    onProgress?.("Encodage…", 0.45);
    const outcome = await renderWithFallback(ff, inputs, {
      inputName: "input.mp4",
      voiceFile: null,
      outputName: "output.mp4",
      preset: quality.preset,
      crf: quality.crf,
      onProgress: (note) => onProgress?.(note, 0.7),
      signal,
    });

    onProgress?.("Lecture du résultat…", 0.95);
    const bytes = (await ff.readFile("output.mp4")) as Uint8Array;
    const blob = new Blob([exactArrayBuffer(bytes)], { type: "video/mp4" });
    onProgress?.("Terminé", 1);

    return {
      blob,
      bytes,
      attempt: outcome.attempt.note,
      degradations: outcome.degradations,
    };
  } finally {
    for (const name of cleanup) {
      await ff.deleteFile(name).catch(() => {});
    }
    if (releaseEngine) releaseFfmpeg();
  }
}

/**
 * Plages conservées, telles que le graphe les attend.
 *
 * Le graphe n'a besoin de `keeps` que s'il y a au moins deux segments à
 * recoller : un seul plan conservé passe par la voie « pas de coupe », aussi
 * bien en lecture qu'en écriture.
 */
export function keepsFromProject(project: Project): Range[] {
  const keeps = projectKeeps(project);
  return keeps.length > 1 ? keeps : [];
}
