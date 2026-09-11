# HyperFrames Integration for ViralDub

## 🎯 Objectif

Remplacer les presets FFmpeg drawtext statiques par des sous-titres animés HyperFrames avec :

- Animations mot par mot (word-by-word)
- Effets pop/scale fluides
- Transitions riches entre segments
- Meilleure expérience utilisateur

## 📦 Installation

```bash
# Ajouter HyperFrames au projet
bun add @hyperframes/core @hyperframes/producer
```

## 🚀 Utilisation

### 1. Pipeline avec HyperFrames (défaut)

```typescript
import { runPipeline } from "./pipeline";

const result = await runPipeline(
  { name: "video.mp4", bytes: videoBytes },
  (step, detail, pct) => console.log(`[${step}] ${detail}`),
  {
    // HyperFrames est activé par défaut
    useHyperFrames: true,
    hyperframesPreset: HYPERFRAMES_PRESETS[0], // TikTok Pop
  },
);
```

### 2. Choisir un preset

```typescript
import { getPresetById, HYPERFRAMES_PRESETS } from "./hyperframes";

// Liste des presets disponibles
console.log(HYPERFRAMES_PRESETS);
// [
//   { id: "tiktok-pop", name: "TikTok Pop", ... },
//   { id: "capcut-yellow", name: "CapCut Jaune", ... },
//   { id: "minimal-white", name: "Minimal Blanc", ... },
//   { id: "highlight-box", name: "Highlight Box", ... },
// ]

// Utiliser un preset spécifique
const preset = getPresetById("capcut-yellow");

const result = await runPipeline(input, progress, {
  useHyperFrames: true,
  hyperframesPreset: preset,
});
```

### 3. Fallback FFmpeg classique

```typescript
const result = await runPipeline(input, progress, {
  useHyperFrames: false, // Désactive HyperFrames
});
```

### 4. Prévisualisation HTML

```typescript
import { generateHyperFramesComposition } from "./hyperframes";

const html = generateHyperFramesComposition(cues, preset, {
  width: 1080,
  height: 1920,
});

// Afficher dans un iframe
const iframe = document.createElement("iframe");
iframe.srcdoc = html;
document.body.appendChild(iframe);
```

## 🎨 Presets disponibles

| ID              | Nom           | Description                            |
| --------------- | ------------- | -------------------------------------- |
| `tiktok-pop`    | TikTok Pop    | blanc avec contour noir, animation pop |
| `capcut-yellow` | CapCut Jaune  | jaune doré, effet highlight            |
| `minimal-white` | Minimal Blanc | fond sombre, discret                   |
| `highlight-box` | Highlight Box | fond rouge, mise en valeur             |

## ⚙️ Configuration

### Options du pipeline

```typescript
type HyperFramesPipelineOptions = {
  useHyperFrames?: boolean; // Défaut: true
  hyperframesPreset?: HyperFramesPreset;
  clientSideRender?: boolean; // Défaut: false
  // ... autres options PipelineOptions
};
```

### Rendu côté client vs serveur

- **Côté serveur** (défaut) : Utilise `@hyperframes/producer` pour un rendu haute qualité
- **Côté client** : Génère un blob HTML pour un rendu dans un iframe (plus lent, qualité réduite)

## 🔧 Architecture

```
src/lib/video/hyperframes/
├── index.ts           # Exportations
├── composition.ts     # Générateur de compositions HTML
├── renderer.ts        # Renderer HyperFrames
├── example.ts         # Exemples d'utilisation
└── README.md          # Cette documentation
```

## 🎬 Comment ça marche

1. **Extraction des cues** : Le pipeline existant génère les sous-titres avec timing mot par mot
2. **Génération HTML** : `composition.ts` crée une composition HyperFrames avec GSAP animations
3. **Rendu** : `renderer.ts` utilise le producer HyperFrames pour capturer les frames
4. **Overlay** : La vidéo de sous-titres est superposée à la vidéo originale

## 🐛 Débogage

### Vérifier les cues générées

```typescript
import { buildCues } from "./subtitles/cues";

const cues = buildCues(segments, true);
console.log("Cues:", cues);
```

### Prévisualiser une composition

```typescript
import { generateHyperFramesComposition } from "./hyperframes";

const html = generateHyperFramesComposition(cues, preset);
console.log(html); // HTML complet à inspecter
```

### Logs détaillés

Le pipeline log les étapes importantes :

```
[compose] Rendu des sous-titres animés HyperFrames…
[HyperFrames] Producer disponible: true
[compose] Assemblage final…
```

## 📝 Notes

- HyperFrames nécessite Node.js 22+ et FFmpeg
- Le rendu serveur est plus rapide et de meilleure qualité
- En cas d'échec, le pipeline fallback automatiquement sur FFmpeg classique
- Les sous-titres HyperFrames sont compatibles avec les masques existants

## 🎯 Prochaines étapes

- [ ] Ajouter plus de presets (animations différentes)
- [ ] Support des transitions entre segments
- [ ] Intégration avec le catalog HyperFrames
- [ ] Agent chat pour décrire les effets souhaités
