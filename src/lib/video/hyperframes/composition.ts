/**
 * HyperFrames Subtitle Composition Generator
 *
 * Génère des compositions HTML HyperFrames avec animations GSAP
 * à partir des cues de sous-titres ViralDub.
 *
 * Remplace les presets FFmpeg drawtext par des animations riches :
 * - Apparition mot par mot (word-by-word)
 * - Effets pop/scale sur les mots-clés
 * - Transitions fluides entre segments
 */

import type { Cue } from "../subtitles/cues";

/**
 * Échappe un fragment de texte pour insertion dans du HTML.
 *
 * Le texte des sous-titres vient d'un LLM et de la vidéo source : sans
 * échappement, un `<script>` dans une transcription s'exécuterait tel quel
 * dans la composition rendue.
 */
function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type HyperFramesPreset = {
  id: string;
  name: string;
  /** Taille de base de la police (px) */
  fontSize: number;
  /** Famille de police */
  fontFamily: string;
  /** Couleur du texte */
  color: string;
  /** Couleur de l'ombre portée */
  shadowColor: string;
  /** Contour du texte */
  textOutline?: { color: string; width: number };
  /** Fond derrière le texte */
  background?: { color: string; borderRadius: number; padding: number };
  /** Animation d'apparition */
  entrance: "pop" | "slide" | "fade" | "typewriter";
  /** Afficher mot par mot */
  wordByWord: boolean;
};

export const HYPERFRAMES_PRESETS: HyperFramesPreset[] = [
  {
    id: "tiktok-pop",
    name: "TikTok Pop",
    fontSize: 72,
    fontFamily: "Inter",
    color: "#FFFFFF",
    shadowColor: "rgba(0,0,0,0.8)",
    textOutline: { color: "#000000", width: 3 },
    entrance: "pop",
    wordByWord: true,
  },
  {
    id: "capcut-yellow",
    name: "CapCut Jaune",
    fontSize: 80,
    fontFamily: "Inter",
    color: "#FFD700",
    shadowColor: "rgba(0,0,0,0.9)",
    textOutline: { color: "#000000", width: 4 },
    entrance: "pop",
    wordByWord: true,
  },
  {
    id: "minimal-white",
    name: "Minimal Blanc",
    fontSize: 64,
    fontFamily: "Inter",
    color: "#FFFFFF",
    shadowColor: "rgba(0,0,0,0.6)",
    background: { color: "rgba(0,0,0,0.7)", borderRadius: 12, padding: 16 },
    entrance: "fade",
    wordByWord: false,
  },
  {
    id: "highlight-box",
    name: "Highlight Box",
    fontSize: 68,
    fontFamily: "Inter",
    color: "#FFFFFF",
    shadowColor: "rgba(0,0,0,0.7)",
    background: { color: "#FF0050", borderRadius: 8, padding: 12 },
    entrance: "slide",
    wordByWord: true,
  },
];

type SubtitleElement = {
  id: string;
  text: string;
  start: number;
  end: number;
  words: { text: string; start: number; end: number }[];
};

/**
 * Convertit les cues ViralDub en éléments de sous-titres HyperFrames
 */
export function cuesToSubtitleElements(cues: Cue[]): SubtitleElement[] {
  return cues.map((cue, index) => ({
    id: `subtitle-${index}`,
    text: cue.text,
    start: cue.start,
    end: cue.end,
    // Split text into words with proportional timing
    words: cue.text
      .split(/\s+/)
      .filter(Boolean)
      .map((word, wordIndex, arr) => {
        const totalWords = arr.length;
        const span = cue.end - cue.start;
        const wordStart = cue.start + (wordIndex / totalWords) * span;
        const wordEnd = cue.start + ((wordIndex + 1) / totalWords) * span;
        return { text: word, start: wordStart, end: wordEnd };
      }),
  }));
}

/**
 * Génère le CSS personnalisé pour un preset HyperFrames
 */
function generatePresetCSS(preset: HyperFramesPreset): string {
  const outline = preset.textOutline
    ? `-webkit-text-stroke: ${preset.textOutline.width}px ${preset.textOutline.color}; paint-order: stroke fill;`
    : "";

  const bg = preset.background
    ? `background: ${preset.background.color}; border-radius: ${preset.background.borderRadius}px; padding: ${preset.background.padding}px ${preset.background.padding * 1.5}px;`
    : "";

  return `
    .subtitle-word {
      display: inline-block;
      font-family: '${preset.fontFamily}', sans-serif;
      font-size: ${preset.fontSize}px;
      font-weight: 700;
      color: ${preset.color};
      text-shadow: 3px 3px 6px ${preset.shadowColor};
      ${outline}
      ${bg}
      opacity: 0;
      transform: scale(0.8);
    }

    .subtitle-word.visible {
      opacity: 1;
      transform: scale(1);
    }

    .subtitle-word.highlight {
      color: #FFD700;
      text-decoration: underline;
      text-decoration-thickness: 4px;
    }

    @keyframes popIn {
      0% { opacity: 0; transform: scale(0.5); }
      70% { transform: scale(1.1); }
      100% { opacity: 1; transform: scale(1); }
    }

    @keyframes slideUp {
      0% { opacity: 0; transform: translateY(20px); }
      100% { opacity: 1; transform: translateY(0); }
    }

    @keyframes fadeIn {
      0% { opacity: 0; }
      100% { opacity: 1; }
    }

    .subtitle-word.pop { animation: popIn 0.2s ease-out forwards; }
    .subtitle-word.slide { animation: slideUp 0.25s ease-out forwards; }
    .subtitle-word.fade { animation: fadeIn 0.3s ease-out forwards; }
  `;
}

/**
 * Génère le script GSAP pour les animations de sous-titres
 */
function generateGSAPScript(
  elements: SubtitleElement[],
  preset: HyperFramesPreset,
  // Chaque tween porte sa propre duree ; le total ne sert qu'a la balise
  // `data-composition-duration` de la page, pas a la timeline.
  _duration: number,
): string {
  const animations: string[] = [];

  // Initialisation : cacher tous les mots
  elements.forEach((el) => {
    el.words.forEach((_, wordIndex) => {
      animations.push(
        `tl.set("#${el.id}-word-${wordIndex}", { opacity: 0, scale: 0.8 }, ${el.start.toFixed(3)});`,
      );
    });
  });

  // Animation mot par mot
  elements.forEach((el) => {
    if (preset.wordByWord) {
      el.words.forEach((word, wordIndex) => {
        const delay = wordIndex * 0.08; // 80ms entre chaque mot
        const animClass = preset.entrance;

        animations.push(
          `tl.to("#${el.id}-word-${wordIndex}", { opacity: 1, scale: 1, duration: 0.2, ease: "back.out(1.7)", onStart: function() { document.getElementById("${el.id}-word-${wordIndex}").classList.add("${animClass}"); } }, ${(el.start + delay).toFixed(3)});`,
        );
      });
    } else {
      // Animation du bloc entier
      animations.push(
        `tl.to("#${el.id}", { opacity: 1, scale: 1, duration: 0.3, ease: "power2.out" }, ${el.start.toFixed(3)});`,
      );
    }

    // Fin : masquer le sous-titre
    animations.push(
      `tl.to("#${el.id}", { opacity: 0, duration: 0.15 }, ${(el.end - 0.15).toFixed(3)});`,
    );
  });

  return `
    const tl = gsap.timeline({ paused: true });
    ${animations.join("\n    ")}
  `;
}

/**
 * Génère la composition HTML HyperFrames complète
 */
export function generateHyperFramesComposition(
  cues: Cue[],
  preset: HyperFramesPreset,
  options: {
    width?: number;
    height?: number;
    compositionId?: string;
  } = {},
): string {
  const {
    width = 1080,
    height = 1920,
    compositionId = `viraldub-subtitles-${Date.now()}`,
  } = options;

  const elements = cuesToSubtitleElements(cues);
  const duration = cues.length > 0 ? Math.max(...cues.map((c) => c.end)) : 1;

  // Générer le HTML des sous-titres
  const subtitlesHTML = elements
    .map((el) => {
      if (preset.wordByWord) {
        const wordsHTML = el.words
          .map(
            (word, i) =>
              `<span id="${el.id}-word-${i}" class="subtitle-word">${escapeHtmlText(word.text)}</span>`,
          )
          .join(" ");

        return `<div id="${el.id}" class="subtitle-container" style="position: absolute; bottom: 15%; left: 0; right: 0; text-align: center; pointer-events: none;">
          <div style="display: inline-flex; gap: 12px; flex-wrap: wrap; justify-content: center;">
            ${wordsHTML}
          </div>
        </div>`;
      } else {
        return `<div id="${el.id}" class="subtitle-word" style="position: absolute; bottom: 15%; left: 0; right: 0; text-align: center;">
          ${escapeHtmlText(el.text)}
        </div>`;
      }
    })
    .join("\n      ");

  // Générer le CSS
  const customCSS = generatePresetCSS(preset);

  // Générer le script GSAP
  const gsapScript = generateGSAPScript(elements, preset, duration);

  return `<!DOCTYPE html>
<html data-composition-id="${compositionId}" data-composition-duration="${duration}" data-resolution="portrait">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    #stage {
      position: relative;
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      background: transparent;
    }
    ${customCSS}
  </style>
</head>
<body>
  <div id="stage">
    <div id="stage-zoom-container">
      ${subtitlesHTML}
    </div>
  </div>
  <script>
    ${gsapScript}
    window.__timelines = window.__timelines || {};
    window.__timelines["${compositionId}"] = tl;
  </script>
</body>
</html>`;
}

/**
 * Version simplifiée pour le rendu côté client (sans GSAP)
 * Utilise CSS animations pures pour les cas où GSAP n'est pas disponible
 */
export function generateCSSOnlyComposition(
  cues: Cue[],
  preset: HyperFramesPreset,
  options: {
    width?: number;
    height?: number;
    compositionId?: string;
  } = {},
): string {
  const {
    width = 1080,
    height = 1920,
    compositionId = `viraldub-subtitles-${Date.now()}`,
  } = options;

  const elements = cuesToSubtitleElements(cues);

  // Le cycle dure ce que dure le dernier repère, et chaque fenêtre s'exprime en
  // pourcentage de ce cycle : la lecture tombe aux horaires RÉELS des
  // sous-titres, et se rejoue en boucle sans une ligne de script.
  const total = elements.length ? Math.max(...elements.map((el) => el.end)) : 1;
  const cle = (seconde: number) => `${((seconde / total) * 100).toFixed(2)}%`;
  const entree =
    preset.entrance === "slide"
      ? "translateY(14px)"
      : preset.entrance === "pop"
        ? "scale(0.86)"
        : "none";

  const partitions: string[] = [];
  const subtitlesHTML = elements
    .map((el, index) => {
      const wordsHTML = el.words
        .map(
          (word) =>
            `<span class="subtitle-word" style="animation-delay: ${word.start.toFixed(2)}s;">${escapeHtmlText(word.text)}</span>`,
        )
        .join(" ");

      // Un fondu court aux deux bords, jamais plus tendu que la fenêtre elle-même :
      // un repère de 0,3 s ne doit pas cligner sur un seul photogramme.
      const marge = Math.min(0.12, (el.end - el.start) * 0.2);
      const nom = `cue-${index}`;
      partitions.push(`@keyframes ${nom} {
      0%, ${cle(el.start - marge)} { opacity: 0; transform: ${entree}; }
      ${cle(el.start)}, ${cle(el.end - marge)} { opacity: 1; transform: none; }
      ${cle(el.end)}, 100% { opacity: 0; transform: ${entree}; }
    }`);

      return `<div class="subtitle-container" data-cue="${el.id}" style="animation-name: ${nom};">
        <div class="subtitle-line">
          ${wordsHTML}
        </div>
      </div>`;
    })
    .join("\n      ");

  const outline = preset.textOutline
    ? `-webkit-text-stroke: ${preset.textOutline.width}px ${preset.textOutline.color}; paint-order: stroke fill;`
    : "";

  const bg = preset.background
    ? `background: ${preset.background.color}; border-radius: ${preset.background.borderRadius}px; padding: ${preset.background.padding}px ${preset.background.padding * 1.5}px;`
    : "";

  return `<!DOCTYPE html>
<html data-composition-id="${compositionId}" data-resolution="portrait">
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    #stage {
      position: relative;
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      background: transparent;
    }
    #stage { --cycle: ${total.toFixed(2)}s; }
    .subtitle-container {
      position: absolute;
      bottom: 15%;
      left: 0;
      right: 0;
      text-align: center;
      pointer-events: none;
      /* Peint invisible, puis montré par SA seule fenêtre : sans elle, tous les
         repères s'empilaient au même endroit dès la deuxième seconde. */
      opacity: 0;
      animation-duration: var(--cycle);
      animation-timing-function: linear;
      animation-iteration-count: infinite;
      animation-fill-mode: both;
    }
    .subtitle-line {
      display: inline-flex;
      gap: 12px;
      flex-wrap: wrap;
      justify-content: center;
    }
    .subtitle-word {
      display: inline-block;
      font-family: '${preset.fontFamily}', system-ui, sans-serif;
      font-size: ${preset.fontSize}px;
      font-weight: 700;
      color: ${preset.color};
      text-shadow: 3px 3px 6px ${preset.shadowColor};
      ${outline}
      ${bg}
      opacity: 0;
      transform: scale(0.8);
      animation: popIn 0.2s ease-out forwards;
    }
    @keyframes popIn {
      0% { opacity: 0; transform: scale(0.5); }
      70% { transform: scale(1.1); }
      100% { opacity: 1; transform: scale(1); }
    }
    ${partitions.join("\n    ")}
  </style>
</head>
<body>
  <div id="stage">
    ${subtitlesHTML}
  </div>
</body>
</html>`;
}
