import type { FFmpeg } from "@ffmpeg/ffmpeg";

import { buildGraph, type GraphInputs, type GraphToggles } from "./graph";

export type RenderAttempt = GraphToggles & { note: string };

/** Stratégie de repli : du rendu complet au plus dégradé. */
export const RENDER_ATTEMPTS: RenderAttempt[] = [
  {
    masks: true,
    text: true,
    voice: true,
    cuts: true,
    look: true,
    transitions: true,
    note: "complet",
  },
  // Les transitions sont l'element le plus fragile : on les lache en premier,
  // avant de sacrifier masques, sous-titres ou voix off.
  {
    masks: true,
    text: true,
    voice: true,
    cuts: true,
    look: true,
    transitions: false,
    note: "sans transitions",
  },
  // L'upscale est le plus gros consommateur de memoire : second a partir.
  {
    masks: true,
    text: true,
    voice: true,
    cuts: true,
    look: false,
    transitions: false,
    note: "sans filtre visuel",
  },
  {
    masks: false,
    text: true,
    voice: true,
    cuts: true,
    look: false,
    transitions: false,
    note: "sans masques",
  },
  {
    masks: false,
    text: true,
    voice: false,
    cuts: true,
    look: false,
    transitions: false,
    note: "coupes prioritaires",
  },
  {
    masks: false,
    text: true,
    voice: true,
    cuts: false,
    look: false,
    transitions: false,
    note: "sans coupe des silences",
  },
  {
    masks: false,
    text: true,
    voice: false,
    cuts: false,
    look: false,
    transitions: false,
    note: "sans voix off",
  },
  {
    masks: false,
    text: false,
    voice: false,
    cuts: false,
    look: false,
    transitions: false,
    note: "vidéo seule",
  },
];

/** Décrit ce qui a été abandonné par rapport au rendu complet. */
export function describeDegradation(attempt: RenderAttempt, inputs: GraphInputs): string[] {
  const lost: string[] = [];
  if (!attempt.masks && inputs.activeMasks.length) lost.push("masquage des zones");
  if (!attempt.text && inputs.cues.length) lost.push("sous-titres");
  if (!attempt.voice && inputs.hasVoice) lost.push("voix off");
  if (!attempt.cuts && inputs.keeps.length > 1) lost.push("coupe des silences");
  if (attempt.look === false && (inputs.filterId ?? "none") !== "none") {
    lost.push("filtre visuel");
  }
  if (attempt.look === false && (inputs.upscale ?? "none") !== "none") {
    lost.push("mise à l'échelle");
  }
  if (
    attempt.transitions === false &&
    (inputs.transition ?? "none") !== "none" &&
    inputs.keeps.length > 1
  ) {
    lost.push("transitions");
  }
  return lost;
}

/**
 * Valide la syntaxe d'un graphe sur une source minuscule.
 *
 * Coûte ~200 ms et évite un ré-encodage complet voué à échouer : sans cela,
 * six tentatives sur une vidéo d'une minute peuvent prendre plusieurs minutes
 * avant d'aboutir au rendu le plus dégradé.
 */
export async function validateGraph(
  ff: FFmpeg,
  graph: string,
  withVoice: boolean,
): Promise<boolean> {
  const args = ["-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.1:r=10"];
  if (withVoice) {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=44100:d=0.1");
  }
  args.push("-filter_complex", graph, "-map", "[vout]");
  if (graph.includes("[aout]")) args.push("-map", "[aout]");
  args.push("-frames:v", "1", "-f", "null", "-");

  try {
    return (await ff.exec(args)) === 0;
  } catch {
    return false;
  }
}

export type RenderOutcome = {
  bytes: Uint8Array;
  attempt: RenderAttempt;
  degradations: string[];
};

export type RenderConfig = {
  inputName: string;
  voiceFile: string | null;
  outputName: string;
  /** `veryfast` + CRF 26 : meilleur compromis poids/temps que `ultrafast`/23. */
  preset?: string;
  crf?: number;
  onProgress?: (note: string) => void;
  signal?: AbortSignal;
};

export async function renderWithFallback(
  ff: FFmpeg,
  inputs: GraphInputs,
  config: RenderConfig,
): Promise<RenderOutcome> {
  const {
    inputName,
    voiceFile,
    outputName,
    preset = "veryfast",
    crf = 26,
    onProgress,
    signal,
  } = config;

  let lastLogs = "";

  // Normalise les tentatives selon les options reellement demandees, puis
  // retire les doublons : sans cela, on encoderait plusieurs fois le meme
  // graphe (par exemple « complet » et « sans transitions » quand aucune
  // transition n'est demandee).
  const wantsLook = (inputs.filterId ?? "none") !== "none" || (inputs.upscale ?? "none") !== "none";
  const wantsTransition = (inputs.transition ?? "none") !== "none" && inputs.keeps.length > 1;

  const seen = new Set<string>();
  const attempts = RENDER_ATTEMPTS.map((a) => ({
    ...a,
    look: wantsLook ? a.look !== false : false,
    transitions: wantsTransition ? a.transitions !== false : false,
  })).filter((a) => {
    const key = `${a.masks}|${a.text}|${a.voice}|${a.cuts}|${a.look}|${a.transitions}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (const attempt of attempts) {
    signal?.throwIfAborted();

    if (attempt.masks && !inputs.activeMasks.length) continue;
    if (attempt.voice && !inputs.hasVoice) continue;
    if (attempt.cuts && inputs.keeps.length < 2) continue;

    const useVoice = attempt.voice && inputs.hasVoice;
    const graph = buildGraph(inputs, { ...attempt, voice: useVoice });

    // Écarte les graphes syntaxiquement invalides sans payer l'encodage.
    if (!(await validateGraph(ff, graph, useVoice))) {
      // Sans cette trace, une degradation restait inexplicable : l'utilisateur
      // lisait « filtre visuel non applique » sans jamais savoir pourquoi.
      console.warn(
        `[render] graphe invalide pour « ${attempt.note} » : passage a la tentative suivante.`,
        { graph },
      );
      onProgress?.(`Nouvel essai (${attempt.note})…`);
      continue;
    }

    const runLogs: string[] = [];
    const onLog = ({ message }: { message: string }) => runLogs.push(message);
    ff.on("log", onLog);

    const args = ["-y", "-i", inputName];
    if (useVoice && voiceFile) args.push("-i", voiceFile);
    args.push("-filter_complex", graph, "-map", "[vout]");
    if (graph.includes("[aout]")) {
      args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "128k");
      // La video reste la reference de duree. `amix=duration=longest` evite de
      // tronquer une voix off plus longue que l'audio source, et `-shortest`
      // empeche en retour d'allonger la video au-dela de son dernier cadre.
      args.push("-shortest");
    } else {
      args.push("-an");
    }
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      preset,
      "-crf",
      String(crf),
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outputName,
    );

    let code = 1;
    try {
      code = await ff.exec(args);
    } catch {
      code = 1;
    } finally {
      ff.off("log", onLog);
    }

    lastLogs = runLogs.slice(-12).join("\n");

    if (code !== 0) {
      const why = lastLogs.match(/(Error|Invalid|failed|No such|Cannot)[^\n]*/i)?.[0];
      console.warn(
        `[render] echec de l'encodage pour « ${attempt.note} » (code ${code})${why ? ` : ${why}` : ""}`,
      );
    }

    if (code === 0) {
      try {
        const bytes = (await ff.readFile(outputName)) as Uint8Array;
        if (bytes.byteLength > 1024) {
          return { bytes, attempt, degradations: describeDegradation(attempt, inputs) };
        }
      } catch {
        // Sortie illisible : on tente un graphe plus simple.
      }
    }

    onProgress?.(`Nouvel essai (${attempt.note})…`);
  }

  const detail = lastLogs.match(/(Error|Invalid|failed|No such)[^\n]*/i)?.[0];
  throw new Error(
    `L'assemblage vidéo a échoué${detail ? ` : ${detail}` : ""}. Essaie une vidéo plus courte ou désactive les zones de masquage.`,
  );
}
