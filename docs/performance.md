# Performance du pipeline

## Optimisations appliquées

| Sujet                  | Avant                                    | Après                                              |
| ---------------------- | ---------------------------------------- | -------------------------------------------------- |
| Appels TTS             | Séquentiels (~1,5 s × N)                 | Concurrence 4 (`mapLimit`)                         |
| Police des sous-titres | Téléchargée depuis GitHub à chaque rendu | Servie localement, mise en cache mémoire           |
| Cœur FFmpeg            | CDN unpkg                                | Résolu depuis les dépendances, épinglé au lockfile |
| Tentatives de rendu    | Ré-encodage complet avant échec          | Graphe validé sur une source 64×64                 |
| Préréglage d'encodage  | `ultrafast` / CRF 23                     | `veryfast` / CRF 26                                |
| Tas WebAssembly        | Jamais libéré                            | `releaseFfmpeg()` après chaque rendu               |

### Validation préalable du graphe

Chaque tentative teste le graphe de filtres sur une source synthétique
minuscule avant de lancer le vrai encodage :

```
ffmpeg -f lavfi -i color=c=black:s=64x64:d=0.1:r=10 -filter_complex "<graphe>" -frames:v 1 -f null -
```

Coût : environ 200 ms. Gain : les erreurs de syntaxe sont écartées sans payer
un ré-encodage complet, là où six tentatives pouvaient prendre plusieurs
minutes sur une vidéo d'une minute.

### Libération du tas WebAssembly

Emscripten ne restitue jamais sa mémoire au système. Sans terminaison
explicite du worker, le tas grossit à chaque rendu — souvent 1 à 2 Go pour une
vidéo de 60 Mo — jusqu'à faire planter l'onglet, en particulier sur mobile.

`releaseFfmpeg()` est appelé dans le `finally` du traitement et au démontage du
composant. Coût : environ 3 secondes de rechargement du cœur au rendu suivant.

## Piste non appliquée : ffmpeg.wasm multithread

Le multithread apporte un gain de 2 à 4× à l'encodage, mais exige
`SharedArrayBuffer`, donc l'isolation cross-origin :

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Ce n'est **pas activé**, pour trois raisons :

1. **Turnstile cesserait de fonctionner.** Son iframe est servie par
   `challenges.cloudflare.com` sans en-tête CORP, donc bloquée sous
   `require-corp`. Il faudrait basculer sur `credentialless`, dont le support
   Safari reste partiel.
2. **Le paquet installé est mono-thread.** Le passage à `@ffmpeg/core-mt` est
   une substitution de dépendance à part entière, à valider séparément.
3. **Aucun gain sur mobile.** Les navigateurs mobiles limitent fortement le
   nombre de threads disponibles, or c'est la cible principale du produit.

### Marche à suivre le jour où c'est souhaité

1. `bun add @ffmpeg/core-mt` et adapter les imports de `ffmpeg-client.ts`.
2. Ajouter COOP/COEP dans `public/_headers`.
3. Remplacer Turnstile par une vérification compatible, ou passer en
   `credentialless` avec une solution de repli.
4. Mesurer sur mobile avant de généraliser.

## Limites structurelles

| Limite                | Origine                                                |
| --------------------- | ------------------------------------------------------ |
| Vidéos ≤ 60 Mo        | Mémoire disponible pour ffmpeg.wasm dans l'onglet      |
| Rendu lent sur mobile | WebAssembly mono-thread                                |
| Plafond de 320 cues   | Au-delà, le graphe de filtres devient ingérable        |
| Maximum 4 masques     | Chaque masque ajoute un `crop` + `boxblur` + `overlay` |
