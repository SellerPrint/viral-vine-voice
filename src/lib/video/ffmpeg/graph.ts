import { buildLookFilters, type UpscaleMode } from "../filters";
import {
  buildAcrossfadeChain,
  buildXfadeChain,
  transitionDurations,
  type TransitionType,
} from "../transitions";
import type { Cue } from "../subtitles/cues";
import type { MaskZone, SubtitlePreset } from "../presets";

export type Rect = { x: number; y: number; w: number; h: number };

export type GraphInputs = {
  cues: Cue[];
  subtitleFiles: string[];
  preset: SubtitlePreset;
  coverMask: MaskZone | undefined;
  subYAnchor: number;
  activeMasks: Rect[];
  keeps: { start: number; end: number }[];
  hasAudio: boolean;
  hasVoice: boolean;
  mirror: boolean;
  remap: (t: number) => number;
  /** Filtre colorimetrique facultatif. */
  filterId?: string;
  /** Mise a l'echelle facultative. */
  upscale?: UpscaleMode;
  videoWidth?: number;
  videoHeight?: number;
  /** Transition entre segments conserves. */
  transition?: TransitionType;
  /** Duree souhaitee de la transition, en secondes. */
  transitionDuration?: number;
};

export type GraphToggles = {
  masks: boolean;
  text: boolean;
  voice: boolean;
  cuts: boolean;
  /** Filtres et upscale, abandonnes en premier si le rendu echoue. */
  look?: boolean;
  /** Transitions, abandonnees avant les coupes elles-memes. */
  transitions?: boolean;
};

/** Arrondit à un entier pair : libx264 refuse les dimensions impaires. */
const even = (n: number) => Math.round(n / 2) * 2;

/**
 * Convertit les masques normalisés en rectangles pixels valides.
 *
 * Un rectangle hors cadre fait échouer tout le graphe avec un code 1.
 */
export function resolveMasks(masks: MaskZone[], videoWidth: number, videoHeight: number): Rect[] {
  if (!videoWidth || !videoHeight) return [];

  return masks
    .filter((m) => m.enabled)
    .map((m) => {
      const x = Math.min(Math.max(0, even(m.x * videoWidth)), videoWidth - 16);
      const y = Math.min(Math.max(0, even(m.y * videoHeight)), videoHeight - 16);
      const w = Math.max(16, Math.min(even(m.w * videoWidth), even(videoWidth - x)));
      const h = Math.max(16, Math.min(even(m.h * videoHeight), even(videoHeight - y)));
      return { x, y, w, h };
    })
    .filter((m) => m.w >= 16 && m.h >= 16 && m.x + m.w <= videoWidth && m.y + m.h <= videoHeight)
    .slice(0, 4);
}

/** Applique une opacite a une couleur FFmpeg (`black`, `#RRGGBB`, `x@0.5`). */
export function withOpacity(color: string, opacity: number): string {
  const clamped = Math.min(1, Math.max(0, opacity));
  const base = color.replace(/@[\d.]+$/, "");
  return `${base}@${clamped.toFixed(2)}`;
}

export function buildStyleBits(preset: SubtitlePreset): string {
  // L'opacite du preset (ou de la surcharge utilisateur) est respectee.
  // Auparavant elle etait ecrasee par `@0.95`, rendant tout style discret
  // impossible : le fond restait un bandeau quasi opaque.
  const opacity = preset.boxOpacity ?? 0.95;
  const boxColor = withOpacity(preset.boxColor, opacity);
  const boxBorderW = Math.max(preset.boxBorderW, 16);
  // Un fond totalement transparent n'a pas de sens : on desactive la boite.
  const useBox = preset.useBox !== false && opacity > 0.01;

  return [
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
}

/**
 * Filtres d'incrustation des sous-titres.
 *
 * Le texte est lu depuis un fichier (`textfile=`) et jamais interpolé dans
 * l'expression : apostrophes, deux-points et virgules casseraient le graphe.
 */
function buildTextFilters(inputs: GraphInputs, withCuts: boolean): string {
  const { cues, subtitleFiles, preset, coverMask, subYAnchor, remap } = inputs;
  // La plaque masque le sous-titre d'origine : son opacite est independante
  // de celle du fond du nouveau texte, sinon un style discret laisserait
  // reapparaitre l'ancien sous-titre.
  const plateColor = withOpacity(preset.boxColor, preset.plateOpacity ?? 0.92);
  const styleBits = buildStyleBits(preset);

  return cues
    .flatMap((cue, index) => {
      const start = (withCuts ? remap(cue.start) : cue.start).toFixed(3);
      const end = (withCuts ? remap(cue.end) : cue.end).toFixed(3);
      const enable = `enable=between(t\\,${start}\\,${end})`;
      const filters: string[] = [];

      // La plaque de recouvrement masque le sous-titre d'origine : elle ne doit
      // pas dépendre de `useBox`, qui n'est qu'un choix de style du texte ajouté.
      if (coverMask) {
        filters.push(
          // `h` dans drawbox = hauteur de la boîte (auto-référence) : il faut `ih`.
          `drawbox=x=0:y=ih*${coverMask.y.toFixed(3)}:w=iw:h=ih*${coverMask.h.toFixed(3)}:color=${plateColor}:t=fill:${enable}`,
        );
      }

      filters.push(
        `drawtext=fontfile=font.ttf:textfile=${subtitleFiles[index]}:reload=0:${styleBits}:x=(w-text_w)/2:y=h*${subYAnchor.toFixed(3)}-text_h/2:${enable}`,
      );
      return filters;
    })
    .join(",");
}

/** Assemble le graphe de filtres complet pour une combinaison d'options. */
export function buildGraph(inputs: GraphInputs, toggles: GraphToggles): string {
  const { activeMasks, keeps, hasAudio, hasVoice, mirror } = inputs;
  const cuts = toggles.cuts && keeps.length > 1;

  // Transitions : uniquement s'il y a bien plusieurs segments a raccorder.
  const transition = inputs.transition ?? "none";
  const wantsTransition = toggles.transitions !== false && transition !== "none" && cuts;
  const durations = wantsTransition
    ? transitionDurations(keeps, inputs.transitionDuration ?? 0.3)
    : keeps.map(() => 0);
  const usesTransition = wantsTransition && durations.some((d) => d > 0);

  const text = toggles.text ? buildTextFilters(inputs, cuts) || "null" : "null";

  let graph = "";
  let videoIn = "0:v";
  let audioIn = "0:a";
  let voiceIn = "1:a";

  if (mirror) {
    graph += `[0:v]hflip[vflip];`;
    videoIn = "vflip";
  }

  // Le look s'applique avant les coupes : une seule passe sur le flux entier
  // plutot qu'une par segment.
  if (toggles.look !== false) {
    const look = buildLookFilters(
      inputs.filterId,
      inputs.upscale ?? "none",
      inputs.videoWidth ?? 0,
      inputs.videoHeight ?? 0,
    );
    if (look) {
      graph += `[${videoIn}]${look}[vlook];`;
      videoIn = "vlook";
    }
  }

  if (cuts) {
    graph += `[${videoIn}]split=${keeps.length}${keeps.map((_, i) => `[cv${i}]`).join("")};`;
    keeps.forEach((keep, i) => {
      graph += `[cv${i}]trim=start=${keep.start.toFixed(3)}:end=${keep.end.toFixed(3)},setpts=PTS-STARTPTS[tv${i}];`;
    });

    if (usesTransition) {
      const chain = buildXfadeChain(
        keeps.map((_, i) => `tv${i}`),
        keeps,
        durations,
        transition,
        "vcut",
      );
      graph += chain;
    } else {
      graph += `${keeps.map((_, i) => `[tv${i}]`).join("")}concat=n=${keeps.length}:v=1:a=0[vcut];`;
    }
    videoIn = "vcut";

    if (hasAudio) {
      graph += `[0:a]asplit=${keeps.length}${keeps.map((_, i) => `[ca${i}]`).join("")};`;
      keeps.forEach((keep, i) => {
        graph += `[ca${i}]atrim=start=${keep.start.toFixed(3)}:end=${keep.end.toFixed(3)},asetpts=PTS-STARTPTS[ta${i}];`;
      });
      // L'audio doit subir exactement le meme raccourcissement que la video,
      // sinon l'image et le son derivent l'un par rapport a l'autre.
      graph += usesTransition
        ? buildAcrossfadeChain(
            keeps.map((_, i) => `ta${i}`),
            durations,
            "acut",
          )
        : `${keeps.map((_, i) => `[ta${i}]`).join("")}concat=n=${keeps.length}:v=0:a=1[acut];`;
      audioIn = "acut";
    }

    if (toggles.voice && hasVoice) {
      graph += `[1:a]asplit=${keeps.length}${keeps.map((_, i) => `[cw${i}]`).join("")};`;
      keeps.forEach((keep, i) => {
        graph += `[cw${i}]atrim=start=${keep.start.toFixed(3)}:end=${keep.end.toFixed(3)},asetpts=PTS-STARTPTS[tw${i}];`;
      });
      graph += usesTransition
        ? buildAcrossfadeChain(
            keeps.map((_, i) => `tw${i}`),
            durations,
            "wcut",
          )
        : `${keeps.map((_, i) => `[tw${i}]`).join("")}concat=n=${keeps.length}:v=0:a=1[wcut];`;
      voiceIn = "wcut";
    }
  }

  if (toggles.masks && activeMasks.length) {
    graph += `[${videoIn}]split=${activeMasks.length + 1}[base]${activeMasks.map((_, i) => `[z${i}]`).join("")};`;
    activeMasks.forEach((mask, i) => {
      // Le flou seul ne suffit pas : un sous-titre incrusté reste lisible même
      // à fort rayon. On floute puis on aplatit la zone avec une plaque quasi
      // opaque, ce qui garantit l'illisibilité tout en gardant la teinte locale.
      graph += `[z${i}]crop=${mask.w}:${mask.h}:${mask.x}:${mask.y},boxblur=40:3,drawbox=x=0:y=0:w=iw:h=ih:color=black@0.55:t=fill[b${i}];`;
    });
    let previous = "base";
    activeMasks.forEach((mask, i) => {
      const out = i === activeMasks.length - 1 ? "masked" : `o${i}`;
      graph += `[${previous}][b${i}]overlay=${mask.x}:${mask.y}[${out}];`;
      previous = out;
    });
    graph += `[masked]${text}[vout]`;
  } else {
    graph += `[${videoIn}]${text}[vout]`;
  }

  if (toggles.voice && hasVoice) {
    graph += hasAudio
      ? `;[${audioIn}]volume=0.15,aresample=44100[a0];[${voiceIn}]volume=1.8,aresample=44100[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0,alimiter=limit=0.9[aout]`
      : `;[${voiceIn}]volume=1.4,aresample=44100[aout]`;
  } else if (hasAudio) {
    graph += `;[${audioIn}]volume=1,aresample=44100[aout]`;
  }

  return graph;
}
