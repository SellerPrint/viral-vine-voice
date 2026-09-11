import { getFfmpeg, writeFileSafe } from "@/lib/video/ffmpeg-client";
import { detectSilences, keptIntervals, type Silence } from "@/lib/video/audio/wav";
import { exactArrayBuffer } from "@/lib/base64";
import type { Range } from "./edl";

/**
 * Détection des silences depuis le monteur.
 *
 * Le pipeline complet la fait déjà, mais uniquement au moment du doublage IA.
 * Ici elle est déclenchable indépendamment : l'utilisateur veut voir les pauses
 * sur la piste de coupes, les accepter une à une, puis lancer un rendu local.
 * Le seul chemin pour y arriver est de décoder l'audio — donc de passer par
 * FFmpeg, le navigateur ne sachant pas extraire une piste de tous les conteneurs.
 */

export type SilenceScan = {
  silences: Silence[];
  keeps: Range[];
  probe: { duration: number; width: number; height: number; fps: number; hasAudio: boolean };
};

export type ScanOptions = {
  /** Padding retiré de chaque silence avant coupe : évite de trancher une syllabe. */
  padding?: number;
  /**
   * Durée du plan, mesurée par le lecteur.
   *
   * Transmise explicitement : s'il fallait la déduire de la sortie texte de
   * FFmpeg, une durée lue à 0 ferait remonter « aucune pause détectée » sur un
   * fichier qui en est plein — un faux négatif impossible à deviner pour
   * l'utilisateur. C'est exactement ce qui s'est produit au premier essai.
   */
  duration?: number;
  signal?: AbortSignal;
  onProgress?: (detail: string) => void;
};

export async function scanSilences(
  bytes: Uint8Array,
  options: ScanOptions = {},
): Promise<SilenceScan> {
  const { signal, onProgress, padding = 0.08 } = options;
  const ff = await getFfmpeg(undefined, (p) => {
    onProgress?.(`Chargement du moteur vidéo… ${Math.round(p * 100)} %`);
  });
  const names = new Set(["scan-input.mp4", "scan-audio.wav"]);

  try {
    signal?.throwIfAborted();
    onProgress?.("Extraction de la piste audio…");
    await writeFileSafe(ff, "scan-input.mp4", bytes);
    await ff.exec([
      "-y",
      "-i",
      "scan-input.mp4",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "scan-audio.wav",
    ]);
    const wav = (await ff.readFile("scan-audio.wav")) as Uint8Array;

    onProgress?.("Analyse du niveau sonore…");
    // Sonde par les logs, comme le pipeline : `ffmpeg -i fichier` écrit sur
    // stderr la bannière contenant durée, dimensions et cadence. On évite
    // `-f null -` ici : rien n'est encodé, et l'appel suivant ne dépend pas du
    // résultat de celui-ci.
    const logs: string[] = [];
    const handler = ({ message }: { message: string }) => logs.push(message);
    ff.on("log", handler);
    await ff.exec(["-i", "scan-input.mp4"]).catch(() => {});
    ff.off("log", handler);
    const probe = parseProbe(logs.join("\n"));
    const total = options.duration && options.duration > 0 ? options.duration : probe.duration;
    if (!(total > 0)) {
      throw new Error("Durée du plan inconnue : relance l'import avant d'analyser les silences.");
    }

    const silences = await detectSilences(new Uint8Array(exactArrayBuffer(wav)));
    const keeps = keptIntervals(total, silences, padding);

    // `keptIntervals` borne déjà les coupes candidates ; on les recalcule ici
    // dans l'espace du monteur pour que la piste reflète ce qui sera rendu.
    const removed: Silence[] = [];
    let cursor = 0;
    for (const keep of keeps) {
      if (keep.start > cursor + 0.02) removed.push({ start: cursor, end: keep.start });
      cursor = keep.end;
    }
    if (total > cursor + 0.02) removed.push({ start: cursor, end: total });

    onProgress?.(`${removed.length} pause(s) repérée(s)`);
    return { silences: removed, keeps, probe: { ...probe, duration: total } };
  } finally {
    for (const name of names) {
      await ff.deleteFile(name).catch(() => {});
    }
  }
}

/** Même lecture des logs que le pipeline : durée, image, cadence, audio. */
export function parseProbe(log: string): {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
} {
  const durMatch = log.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  const duration = durMatch ? +durMatch[1] * 3600 + +durMatch[2] * 60 + parseFloat(durMatch[3]) : 0;
  const sizeMatch = log.match(/Video:.*?[\s,](\d{2,5})x(\d{2,5})/);
  const fpsMatch = log.match(/,\s*([\d.]+)\s*fps\b/);
  return {
    duration,
    width: sizeMatch ? +sizeMatch[1] : 0,
    height: sizeMatch ? +sizeMatch[2] : 0,
    fps: fpsMatch ? parseFloat(fpsMatch[1]) : 30,
    hasAudio: /Stream #\d+:\d+.*: Audio:/.test(log),
  };
}
