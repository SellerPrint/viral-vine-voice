# ViralDub 🎬

> Transforme tes TikToks français en vidéos anglaises prêtes à publier — **sans que ta vidéo quitte ton navigateur**.

Upload un MP4 français, récupère la même vidéo avec voix off anglaise, sous-titres incrustés style CapCut, silences coupés et bandeau de sous-titres d'origine masqué.

![Statut](https://img.shields.io/badge/statut-prototype-orange)
![Licence](https://img.shields.io/badge/licence-MIT-blue)

---

## Pourquoi c'est différent

Tout le traitement vidéo tourne **dans ton navigateur** via `ffmpeg.wasm`. Ton fichier n'est jamais uploadé sur un serveur : seuls **l'audio extrait** et **le texte transcrit** sont envoyés aux APIs d'IA pour la transcription, la traduction et la synthèse vocale.

---

## Fonctionnalités

- 🎙️ **Transcription multi-locuteurs** — ElevenLabs Scribe v2 avec diarisation, mots horodatés
- 🌍 **Traduction contextuelle** — Gemini 2.5 Flash, avec direction émotionnelle par segment
- 🗣️ **Voix off naturelle** — ElevenLabs Turbo v2.5, une voix distincte par locuteur détecté
- 🎨 **Sous-titres CapCut** — 4 presets, affichage mot-à-mot synchronisé, incrustés dans la vidéo
- ✂️ **Coupe automatique des silences** — détection RMS, seuil 400 ms
- 🖼️ **Masquage de zones** — détection automatique du bandeau de sous-titres FR et des logos
- 🪞 **Effet miroir** — pour contourner la détection de doublons des plateformes

---

## Stack

| Couche      | Technologie                                                   |
| ----------- | ------------------------------------------------------------- |
| Framework   | [TanStack Start](https://tanstack.com/start) (SSR) + React 19 |
| Build       | Vite 8 · Tailwind CSS 4 · shadcn/ui                           |
| Vidéo       | `ffmpeg.wasm` (navigateur)                                    |
| Déploiement | Cloudflare Workers (Nitro)                                    |
| IA          | ElevenLabs · Google Gemini · ai33.pro                         |

---

## Démarrage

### Prérequis

- [Bun](https://bun.sh) ≥ 1.1
- Une clé API [ElevenLabs](https://elevenlabs.io)
- Une clé pour le gateway IA (traduction)

### Installation

```bash
git clone https://github.com/SellerPrint/viral-vine-voice.git
cd viral-vine-voice
bun install

cp .env.example .dev.vars   # puis renseigne tes clés
bun run dev
```

L'app démarre sur http://localhost:3000

---

## Variables d'environnement

| Variable             | Requis | Rôle                                                      |
| -------------------- | :----: | --------------------------------------------------------- |
| `ELEVENLABS_API_KEY` |   ✅   | Transcription (Scribe v2) et synthèse vocale (Turbo v2.5) |
| `LOVABLE_API_KEY`    |   ✅   | Gateway IA pour la traduction (Gemini 2.5 Flash)          |
| `AI33_API_KEY`       |   ➖   | Optionnel — voix clonée via ai33.pro                      |

> ⚠️ Ces clés sont utilisées **exclusivement côté serveur** dans les server functions TanStack. Elles ne sont jamais exposées au client.

---

## Scripts

```bash
bun run dev         # serveur de développement
bun run build       # build de production
bun run preview     # prévisualiser le build
bun run typecheck   # vérification des types
bun run lint        # ESLint
bun run test        # tests unitaires
bun run check       # typecheck + lint + test
```

---

## Comment ça marche

```
NAVIGATEUR                                    SERVEUR (Workers)
──────────────────────────────                ─────────────────────────
1. Upload MP4 (max 60 Mo)
2. Extraction audio (ffmpeg.wasm)  ────────►  transcribeAudio
                                              └─► ElevenLabs Scribe v2
                                                  mots + timestamps + locuteurs
3. Détection des silences (RMS)
4. Détection des zones à masquer
   (canvas + densité de contours)

5. Segmentation des mots           ────────►  translateSegments
                                              └─► Gemini 2.5 Flash
                                                  traduction + prosodie

6. Pour chaque segment             ────────►  synthesizeSpeech
                                              └─► ElevenLabs Turbo v2.5
                                                  audio base64

7. Mixage (Web Audio API)
8. Rendu final (ffmpeg.wasm)
   masques + sous-titres + coupes
   + miroir + mixage audio

9. Téléchargement MP4
```

---

## Limites connues

| Limite                              | Raison                                                 |
| ----------------------------------- | ------------------------------------------------------ |
| Vidéos ≤ 60 Mo                      | Contrainte mémoire de `ffmpeg.wasm` dans le navigateur |
| Langue source : français uniquement | Codée en dur dans le prompt et l'appel STT             |
| Rendu lent sur mobile               | WASM monothread ; ~1 à 3 min pour 60 s de vidéo        |
| Nécessite un navigateur récent      | WebAssembly, Web Audio API, SharedArrayBuffer          |

---

## Feuille de route

- [ ] Rate limiting et protection anti-abus des endpoints IA
- [ ] Tests unitaires du pipeline
- [ ] ffmpeg.wasm multithread (COOP/COEP) — 2 à 4× plus rapide
- [ ] Langue source configurable
- [ ] Annulation en cours de traitement
- [ ] Export SRT/VTT séparé

---

## Licence

MIT
