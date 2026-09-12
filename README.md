# ViralDub 🎬

> Transforme tes TikToks en vidéos doublées prêtes à publier — **sans que ta vidéo quitte ton navigateur**.

Un **monteur** complet dans l'onglet : timeline manipulable (glisser, rogner, couper à la tête de lecture, annuler), zones à flouter saisies à la souris, sous-titres éditables bloc par bloc — et le doublage IA (transcription, traduction, voix off) comme une étape de plus dans ce montage, pas comme un formulaire à part.

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
- 🎬 **Monteur type logiciel desktop** — timeline multi-pistes (plan, coupes, sous-titres, voix off), vignettes décodées du plan, règle graduée, aimantation, zoom molette, raccourcis `Espace` `J/K/L` `S` `Suppr` `Ctrl+Z`, la hauteur de la timeline se tire au bord de son cadre (double-clic : retour à l'automatique), et `F` replie les volets quand le plan manque de place
- 🖱️ **Manipulation directe** — un sous-titre se déplace à la souris, un flou se redimensionne dans l'aperçu, un style se glisse depuis la bibliothèque sur la piste
- 🤖 **Agent de montage (MCP)** — 17 outils sur stdio (`npm run mcp`) ou sur HTTP (`POST /api/mcp`, verrouillé par `MCP_TOKEN`) ; dans l'atelier, l'onglet Projet a un volet « Agent de montage » qui lit l'état réel du fil, le teste, et pose sur la table le montage que l'agent a composé — par la même porte que le bouton Importer

- 🔁 **Deux chemins d'export** — rendu local (aucun appel réseau, ré-encode la timeline telle quelle) ou doublage complet ; les pistes générées par l'IA reviennent ensuite dans le monteur, corrigeables

---

## Stack

| Couche      | Technologie                                                   |
| ----------- | ------------------------------------------------------------- |
| Framework   | [TanStack Start](https://tanstack.com/start) (SSR) + React 19 |
| Build       | Vite 8 · Tailwind CSS 4 · shadcn/ui                           |
| Vidéo       | `ffmpeg.wasm` (navigateur)                                    |
| Déploiement | Cloudflare Workers (par défaut) · Vercel (auto)               |
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
| `MCP_TOKEN`          |   ➖   | Optionnel — ouvre le fil MCP HTTP sur `/api/mcp`          |

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
bun run mcp         # le fil MCP pour un client local (stdio)
bun run mcp:http    # le même fil sur HTTP, port 4750
```

---

## Comment ça marche

```
NAVIGATEUR                                    SERVEUR (Workers)
──────────────────────────────                ─────────────────────────
1. Import du plan (max 60 Mo) dans le monteur
   vignettes + forme d'onde + durée mesurées localement
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
8. Rendu final (ffmpeg.wasm)     ◄── même graphe pour un
   masques + sous-titres + coupes     rendu local sans IA
   + miroir + mixage audio
9. Les phrases traduites et les coupes Propositions de la machine
   reviennent sur la timeline           posées sur les pistes,
10. Ajustement à la souris, puis        validées une à une
    téléchargement MP4
```

---

## Déploiement

Le build vise Cloudflare Workers, mais **Vercel marche sans configuration** :
Nitro détecte la plateforme à partir de son environnement. Vérifié ici même —
avec seulement `VERCEL=1` dans le shell, `npm run build` produit
`.vercel/output` avec `preset: vercel`, une fonction unique `__server`
(`nodejs20.x`) et les 44 Mo de statiques (cœurs WebAssembly, polices, démo).

1. **Manager de paquets** : laisser Bun, que Vercel déduit de `bun.lock`. Un
   `npm install` se casse en `ERESOLVE` (conflit de paires entre `eslint@10`
   et `eslint-plugin-react-hooks@5`) ; il lui faut `--legacy-peer-deps`.
2. **Commande de build** : `npm run build`, telle quelle. Elle enchaîne
   `vite build` puis `scripts/apply-vercel-max-duration.mjs` (voir point 4).
3. **Variables d'environnement** : `ELEVENLABS_API_KEY` et une clé de
   traduction (`GEMINI_API_KEY` par défaut) sont requises pour le doublage ;
   `TURNSTILE_SECRET_KEY` + `VITE_TURNSTILE_SITE_KEY` le sont aussi, car
   `guard.server.ts` **refuse les appels IA en production sans Turnstile** —
   sans lui, l'API devient un proxy ElevenLabs gratuit pour n'importe qui.
   Sans ces clés, l'interface reste utilisable : le rendu local, la timeline
   et les masques ne touchent pas le réseau, et un lancement de doublage
   répond une phrase explicite plutôt qu'un échec muet.
4. **Durée de fonction** : le plafond par défaut de Vercel est de 10 s en
   Hobby, et `transcribeAudio` comme `translateSegments` sont **une seule
   requête** chacun (toute la piste audio, puis tous les segments). Le script
   d'après-build écrit donc `maxDuration: 60` dans le `.vc-config.json` généré
   — ni `nitro.config.ts` ni `functions.maxDuration` de `vercel.json` ne sont
   lus ici : le wrapper Vite n'expose que `preset`/`output`/`cloudflare`, et
   la Build Output API ne retient que ce qu'elle trouve dans `.vercel/output`.
   Au-delà (source de quelques minutes, ou Pro/Enterprise jusqu'à 300 s),
   régler `VERCEL_MAX_DURATION=<secondes>`.
5. **Budget et cache partagés** : `KV_REST_API_URL` + `KV_REST_API_TOKEN`
   (Upstash ou Vercel KV) sont optionnels, mais sans eux le plafond
   `TTS_DAILY_CHAR_BUDGET` et le cache de traduction ne vivent que dans la
   mémoire d'une instance — donc pas entre les fonctions cold-démarrées.
   `npm run check:kv` valide la connexion, `/api/health` dit lequel est actif.
6. **Appels serveur** : les server functions sont gardées par
   `createCsrfMiddleware` (`src/start.ts`) — un `POST /_serverFn/…` venant
   d'une autre origine reçoit un 403 avant d'atteindre le handler, ce qui
   empêche une page tierce de faire dépenser la clef ElevenLabs depuis le
   navigateur d'un visiteur. Le test e2e « une server function refuse un appel
   venu d'un autre site » le vérifie. En face, `guard.server.ts` ajoute
   Turnstile, la limitation de débit et le plafond de caractères par 24 h.
7. **Après le premier déploiement**, contrôler les en-têtes réellement servis
   (la CSP a déjà cassé Turnstile et `ffmpeg.wasm` par le passé) :
   `E2E_BASE_URL=https://… npx playwright test -g "en-têtes"`. Le cas est
   sauté en local parce que seul un déploiement réel applique `vercel.json`.

8. **Fil MCP** : Le fil s'appelle à `https://viral-vine-voice.vercel.app/api/mcp` (le volet « Agent de
   montage » de l'atelier affiche l'origine où il tourne, sans configuration).
   `POST /api/mcp` parle le JSON-RPC de `mcp/serveur.mjs` — le même
   dispatcheur, pas une seconde implémentation — sans dépendance ni build. Il est
   **fermé par défaut** : sans `MCP_TOKEN` dans les variables du projet, la route
   répond 503 (un atelier de montage ne s'ouvre pas au monde par accident). Avec
   le jeton, chaque appel porte `Authorization: Bearer …`, le débit est compté
   comme pour les appels IA (120/min et par clé, `guard.server.ts`), le corps est
   plafonné à 256 Ko, et **aucun fichier n'est écrit** : `exporter_config` rend le
   document dans la réponse — que l'humain importe dans l'atelier, onglet Projet.
   La route tourne sur le runtime Node (`nodejs20.x`) et non sur l'Edge :
   `mcp/serveur.mjs` importe `node:fs` pour le fil stdio partagé. `GET /api/mcp`
   rend la santé du fil (nom, version, nombre d'outils, `disque: false`) — le
   contrôle à faire après un déploiement, sans jeton. Les deux modes de session
   (collante via `Mcp-Session-Id`, ou sans état via `params.document`) sont
   décrits dans `mcp/MCP.md`.

---

## Limites connues

| Limite                                          | Raison                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| Vidéos ≤ 60 Mo                                  | Contrainte mémoire de `ffmpeg.wasm` dans le navigateur                  |
| Langue source : 7 langues                       | Liste bornée côté serveur (ISO 639-3 pour Scribe)                       |
| Piste de voix off non ré-encodée au rendu local | Le mixage vient du doublage complet, seul chemin qui synthétise la voix |
| 4 zones de masquage maximum                     | Chaque zone ajoute `crop` + `boxblur` + `overlay` au graphe             |
| Rendu lent sur mobile                           | WASM monothread ; ~1 à 3 min pour 60 s de vidéo                         |
| Nécessite un navigateur récent                  | WebAssembly, Web Audio API, SharedArrayBuffer                           |

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
