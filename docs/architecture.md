## Vue d'ensemble

Application web où l'utilisateur upload une vidéo TikTok FR et récupère une version anglaise avec voix off, sous-titres, silences coupés et transitions.

Le backend Lovable tourne sur Cloudflare Workers — **impossible d'y exécuter ffmpeg**. Toute la manipulation vidéo se fera donc **côté navigateur avec ffmpeg.wasm**. Le serveur ne s'occupe que de l'IA (transcription, traduction, TTS).

## Architecture

```
Browser (React)                        Server (TanStack Start)
────────────────                       ─────────────────────────
1. Upload MP4
2. Extrait audio (ffmpeg.wasm) ──►     /api/transcribe
                                       └► ElevenLabs Scribe v2 (FR)
                                          renvoie mots + timestamps
3. Détecte silences (analyse
   RMS des samples audio) ─────┐
4. Détecte segments sous-titres│
   FR incrustés (crop bas +    │
   masque noir simple sur zone)│
                               ▼
                              /api/translate
                              └► Lovable AI (Gemini)
                                 traduit segments FR→EN
                                 en gardant timings
                               │
                               ▼
                              /api/tts
                              └► ElevenLabs TTS
                                 (eleven_turbo_v2_5)
                                 par segment
5. Recompose (ffmpeg.wasm):
   - coupe silences
   - masque bandeau sous-titres
   - remplace piste audio par TTS EN
   - burn-in sous-titres EN (ASS)
   - transitions fade entre coupes
6. Télécharge MP4 final
```

## Étapes de build

### 1. Design system (dark, énergique TikTok-like)

- Fond `#0A0A0F`, accent rose `#FF0050` + cyan `#00F2EA` (couleurs TikTok)
- Font: Space Grotesk (display) + Inter (body)
- Layout mono-page en 3 zones : upload → progression étapes → preview + download

### 2. Connecteur ElevenLabs

Lier via `standard_connectors--connect` (l'utilisateur choisit sa connexion). Fournit `ELEVENLABS_API_KEY` côté serveur.

### 3. Server functions (`src/lib/*.functions.ts`)

- `transcribeFrench` — reçoit un Blob audio, appelle ElevenLabs `speech-to-text` (`scribe_v2`, `language_code=fra`, `diarize=false`), retourne `{ words: [{text,start,end}] }`.
- `translateSegments` — reçoit segments FR + timings, appelle Lovable AI `google/gemini-2.5-flash` avec JSON schema pour renvoyer segments EN alignés (durée cible respectée).
- `synthesizeEnglish` — pour chaque segment, appelle ElevenLabs TTS streaming (voix `EXAVITQu4vr4xnSDxMaL` Sarah), retourne MP3 base64. Batch parallèle.

### 4. Client vidéo (`src/lib/video/`)

- `ffmpeg.ts` — charge `@ffmpeg/ffmpeg` + `@ffmpeg/util` (WASM depuis CDN unpkg). Singleton.
- `extractAudio.ts` — `ffmpeg -i in.mp4 -vn -ac 1 -ar 16000 out.wav` puis renvoie Blob.
- `detectSilences.ts` — décode le WAV via `AudioContext.decodeAudioData`, calcule RMS par fenêtre de 20ms, détecte silences > 400ms sous seuil -35dB. Retourne intervalles à couper.
- `buildAss.ts` — génère un fichier ASS (sous-titres stylés bas de l'écran, gros, blanc + contour noir, karaoke word-by-word) depuis les mots EN.
- `compose.ts` — assemble le tout en une commande ffmpeg avec `filter_complex` :
  - segments non silencieux découpés puis concaténés
  - `drawbox` noir sur la zone typique des sous-titres TikTok (bas 15%)
  - crossfade 200ms entre segments
  - piste audio = concat des MP3 EN (générés depuis segments)
  - `ass=subs.ass` pour brûler les sous-titres
  - export MP4 H.264 + AAC

### 5. UI (`src/routes/index.tsx`)

- Zone drag-and-drop
- Stepper vertical avec état par étape (upload → extract → transcribe → translate → tts → compose → done) + barre de progression ffmpeg
- Player HTML5 sur la sortie
- Bouton download + bouton "recommencer"

### 6. Routes secondaires

- `/how-it-works` — explique le pipeline
- SEO : titre + description spécifiques par route dans le `head()`

### 7. Sitemap + robots.txt

## Contraintes / limites à annoncer à l'utilisateur

- **Suppression des sous-titres FR** : approche simple = masque noir sur bandeau bas standard TikTok. Un vrai inpainting vidéo (retirer le texte sans masque visible) n'est pas faisable sans un modèle vidéo lourd. Si la vidéo a des sous-titres ailleurs qu'en bas, ils resteront.
- **Traitement 100% côté navigateur** : les vidéos > 60s / > 50MB seront lentes (ffmpeg.wasm est mono-thread par défaut, ~0.2× realtime). On limite à 90s / 60MB en entrée.
- **ElevenLabs consomme des crédits** de la connexion liée (transcription + TTS).
- **Lovable AI consomme des crédits** pour la traduction.

## Notes techniques

- `ffmpeg.wasm` version `0.12.x` (core-mt indisponible sans COOP/COEP headers — on utilise la version single-thread pour éviter la config Vite complexe).
- Server functions renvoient base64 pour les Blobs (le protocole RPC ne sérialise pas les Blob).
- Chunking : audio découpé en fenêtres de 30s max pour Scribe si vidéo longue.
- Timeout côté serveur : les fonctions retournent en < 30s (transcription courte, TTS par segments courts).

Je commence par le design + connecteur ElevenLabs + squelette UI, puis les server functions, puis la partie ffmpeg.wasm.
