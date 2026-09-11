/**
 * HyperFrames Integration for ViralDub
 *
 * Module d'intégration des sous-titres animés HyperFrames
 * qui remplace les presets FFmpeg drawtext statiques.
 */

// Générateur de compositions
export {
  generateHyperFramesComposition,
  generateCSSOnlyComposition,
  cuesToSubtitleElements,
  HYPERFRAMES_PRESETS,
  type HyperFramesPreset,
} from "./composition";

// Renderer
export {
  renderSubtitlesWithHyperFrames,
  renderSubtitlesClientSide,
  overlaySubtitlesOnVideo,
  getAvailablePresets,
  getPresetById,
  type RenderOptions,
  type RenderResult,
} from "./renderer";
