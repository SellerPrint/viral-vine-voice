# Brancher un modèle sur l'atelier — serveur MCP

`mcp/serveur.mjs` parle le protocole **MCP sur stdio** (une ligne JSON-RPC 2.0 par
message, ni dépendance, ni build). Un modèle — Claude Desktop, Cursor, n'importe
quel client MCP — pose alors un montage complet : découpage au rythme, cadres de
masquage, typographie de légende, options de sortie, et écrit le fichier que
l'atelier importe.

Ce que le modèle **ne fait pas** par ce canal : rendre une vidéo, toucher le plan
lui-même, lire une clé API. Il produit un plan de montage en nombres et en texte.
L'export se déclenche dans l'atelier, sur le fichier de l'utilisateur.

## Brancher le client

Le serveur se lance avec Node, depuis la racine du dépôt (les chemins d'écriture
qu'il accepte sont relatifs à ce dossier).

```json
{
  "mcpServers": {
    "viraldub-monteur": {
      "command": "node",
      "args": ["/chemin/vers/viral-vine-voice/mcp/serveur.mjs"],
      "cwd": "/chemin/vers/viral-vine-voice"
    }
  }
}
```

Deux drapeaux, facultatifs :

| drapeau              | effet                                                              |
| -------------------- | ------------------------------------------------------------------ |
| `--config <fichier>` | démarre sur une configuration exportée par l'atelier               |
| `--projet <fichier>` | dossier de travail : relu au démarrage, réécrit après chaque geste |

Vérification rapide sans client :

```bash
npm run mcp -- --outils   # liste le contrat des 17 outils
```

## Le fil HTTP — le même serveur sur Vercel

Une fonction serverless ne tient pas un tuyau ouvert : le fil stdio n'y a donc
pas sa place. Le **même** dispatcheur JSON-RPC est posé derrière une route HTTP,
`POST /api/mcp` sur le déploiement (`src/routes/api.mcp.ts` →
`src/lib/mcp.server.ts` → `mcp/http.mjs`) — mêmes outils, mêmes bornes, mêmes
refus, parce qu'il n'y a qu'un seul `traiter`.

| ce que le fil HTTP impose                                                                                      | pourquoi                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_TOKEN` configuré, sinon **503**                                                                           | un atelier de montage public, servi par la facture de quelqu'un, n'a pas de sens. Le jeton se compare à temps constant.                           |
| `Authorization: Bearer <jeton>` sur chaque POST, sinon **401**                                                 |                                                                                                                                                   |
| 120 requêtes/minute et par clé (compteur partagé, le même que les appels IA), sinon **429** avec `Retry-After` | ce point d'entrée ne doit pas devenir une boucle gratuite                                                                                         |
| corps ≤ 256 Ko, sinon **413**                                                                                  | un document de montage pèse quelques kilooctets                                                                                                   |
| **aucun disque** : `exporter_config` sans `chemin`, `importer_config` avec `config`                            | sur Vercel, le système de fichiers est la temporaire d'un froid — promettre un fichier ferait croire à quelque chose que personne ne retrouverait |

Deux façons de travailler :

```bash
# 1) collant : initialize rend un Mcp-Session-Id, on le renvoie à chaque appel
curl -sX POST https://<domaine>/api/mcp \
  -H "authorization: Bearer $MCP_TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' -D -

# 2) sans état : chaque appel porte le document, le nouveau lui revient
curl -sX POST https://<domaine>/api/mcp \
  -H "authorization: Bearer $MCP_TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
         "name":"montage_energetique",
         "arguments":{"intensite":"nerveux"},
         "document":{"app":"viraldub","version":2,"timeline":{"clips":[],"cuts":[]}}}}'
```

En collant, une session vit **dans une instance** : après un redéploiement, ou
simplement sur une autre région, l'identifiant ne répond plus et le fil rend
**410** avec la conduite à tenir (« rappelle initialize, ou passe
`params.document` ») — jamais un montage à moitié reconstitué en silence. Le
mode sans état traverse les redéploiements : c'est celui qu'on adopte quand on
branche un agent sur une URL.

Comment brancher un client sur cette URL — les trois chemins qui marchent
aujourd'hui, selon le client (les capacités HTTP de Claude Desktop changent de
version, vérifiez la vôtre avant d'accuser le serveur) :

```jsonc
// Cursor — .cursor/mcp.json : url et en-tetes sont admis directement
{
  "mcpServers": {
    "viraldub-monteur": {
      "url": "https://<domaine>/api/mcp",
      "headers": { "Authorization": "Bearer <MCP_TOKEN>" },
    },
  },
}
```

- **Claude Desktop, en remote** : `Settings → Connectors → Add custom
connector`, avec l'URL de l'atelier (`https://<domaine>/api/mcp`). Le jeton se
  met dans le connector (en-tête `Authorization`), pas dans
  `claude_desktop_config.json` — ce fichier ne valide que les entrées `command`,
  et un `url` qu'on y glisse est silencieusement ignoré ou fait partir l'app en
  erreur.
- **N'importe quel client qui ne parle que stdio** (dont Claude Desktop en
  local, et tout ce qui refuse le HTTP nu) : un pont fait l'affaire, et
  `--transport http-only` evite le negocie SSE que ce fil ne sert pas :

  ```bash
  npx -y mcp-remote http://127.0.0.1:4750/ --transport http-only \
    --header "Authorization: Bearer <MCP_TOKEN>"
  ```

**Ce que le fil HTTP ne fait pas** : il ne tient pas de flux `text/event-stream`
— un `GET` avec `Accept: text/event-stream` reçoit un 405 qui le dit, plutôt
qu'un JSON que le client lirait comme un flux vide. Une requête = une réponse,
et c'est ce qui le rend fiable sur une fonction serverless, où un flux ouvert
n'a aucune garantie de durer plus que l'appel. Pour la même raison, quand une
conversation doit survivre à un redéploiement, travaillez en mode sans état
(`params.document` / `result.document`) : c'est le document qui porte l'état,
pas l'instance.

`GET /api/mcp` répond la santé du fil (nom, version, nombre d'outils, sessions
ouvertes, `disque: false`) — c'est ce qu'on regarde après un déploiement, sans
jeton. En local, `npm run mcp:http` ouvre le même fil sur le port 4750.

## Les outils

| outil                 | à quoi il sert                                                                   |
| --------------------- | -------------------------------------------------------------------------------- |
| `etat`                | résumé lisible : plan, durée de sortie après coupes, blocs par piste, cadres     |
| `valider`             | la liste des problèmes — chevauchements, blocs hors plan, sortie muette          |
| `nouveau_projet`      | feuille vierge, durée du plan comprise                                           |
| `ajouter_bloc`        | texte incrusté (`subs`), réplique doublée (`dub`), segment visuel (`video`)      |
| `modifier_bloc`       | décaler, allonger, raccourcir, réécrire un bloc                                  |
| `supprimer_bloc`      | retirer un bloc                                                                  |
| `vider_pistes`        | tout enlever d'une ou plusieurs pistes avant de recomposer                       |
| `ajouter_coupe`       | retirer une plage à la source, comme la touche `X` de l'atelier                  |
| `supprimer_coupe`     | annuler une coupe                                                                |
| `couper_au_rythme`    | garder une fenêtre autour de chaque temps, couper le reste                       |
| `regler_cadres`       | zones de masquage en fractions d'image, ou en créer                              |
| `regler_style`        | préréglage, corps, ancrage, capitales, longueur de ligne, couleurs               |
| `regler_options`      | mot à mot, silences, ambiance, transition, filtre, agrandissement, force du flou |
| `montage_energetique` | la recette : rythme + typographie + bandeau + mot à mot d'un seul coup           |
| `options_rendu`       | la demande de rendu en trois blocs, pour relecture avant export                  |
| `exporter_config`     | le fichier `.json` que l'atelier importe                                         |
| `importer_config`     | reprendre un montage déjà exporté pour le poursuivre                             |

## Les clés que les outils acceptent

Chaque outil ne lit que les noms qu'il annonce dans son `inputSchema` — et, en
plus, **les noms du fichier de configuration de l'atelier** : `fontsize`,
`yAnchor`, `uppercase`, `boxOpacity`, `wordByWord`, `maskStrength`,
`transitionDuration`, `boxColor`, `fontColor`, `enabled`, `largeur`, `hauteur`.
C'est ce qu'un modèle retrouve en relisant `viraldub-config.json`, donc il peut
le renvoyer tel quel.

Une clé qui ne correspond à rien **n'est jamais ignorée** : l'outil répond en
`isError` avec `{"refus": "reglerStyle : clé « bitrate » inconnue — acceptées :
…"}` et la session continue. Un réglage que le modèle croit passé et que
l'export ne montre pas est le pire des bugs, c'est pour ça que le silence est
interdit ici.

## Ordre qui marche

1. `etat` — savoir où on met les pieds (durée du plan, ce qui est déjà posé).
2. `vider_pistes` si le plan porte un travail précédent.
3. Les blocs de texte et de voix, **en temps source**.
4. `couper_au_rythme` ou `ajouter_coupe` — le rythme d'abord, la ponctuation ensuite.
5. `regler_cadres` — les zones à masquer, puis la légence : un cadre actif qui
   touche le bas ou le haut du plan **aspire la légende à son centre**.
6. `regler_style`, `regler_options`.
7. `valider` — corriger ce qui est signalé.
8. `exporter_config`, puis dans l'atelier : Réglages → _Importer un fichier de
   configuration_.

## Quatre règles que le moteur applique et qu'aucun outil ne contourne

- La légende se **centre horizontalement** : `drawtext` fait `x=(w-text_w)/2`. Il
  n'existe aucune ancre horizontale dans le contrat d'options, donc aucun outil ne
  la propose — la promettre produirait un export qui ne ressemble pas à l'aperçu.
- **Un cadre actif touchant le bord bas ou haut impose l'ancrage vertical** de la
  légende à son propre centre (`ancreLegende`, partagé par l'aperçu et les trois
  pipelines). Écrire `ancrage` dans ce cas est accepté mais écarté : `regler_style`
  le dit dans `avertissement`.
- Une **largeur ou une hauteur plaquée sur un bord ne peut pas s'en écarter** :
  comme à la souris, les valeurs hors image sont ramenées dans le cadre et
  signalées dans `bornes`.
- Le **fond de la légende obéit à l'opacité, pas au seul préréglage** : le graphe
  pose `box=1:boxcolor=<couleur du préréglage>@<opacité>:boxborderw=max(preset, 16)`
  et l'aperçu CSS lit la même fonction (`boiteDeTexte`). Un préréglage qui déclare
  `useBox: false` (dont `capcut-pop`, le style par défaut) ne peint rien tant que
  `opaciteFond` n'est pas demandé — d'où l'intérêt de le passer explicitement.
  La **plaque** qui masque l'ancien sous-titre, elle, vient du cadre couvrant
  (`couleurFond` du préréglage, alpha `0,92` par défaut) : agrandir le bandeau
  agrandit la plaque, à l'écran comme à l'export.

## Les bornes, et pourquoi elles sont doublées

`mcp/regles.mjs` recopie les constantes de l'application : préréglages
(`SUBTITLE_PRESETS`), transitions, filtres, agrandissements, codes de langue,
plafond de lignes (`MAX_CUES`), plage du corps (20…170 px, comme le curseur de
l'inspecteur), version du format. La copie est le prix d'un serveur sans bundler ;
`mcp/serveur.test.mjs` la surveille liste par liste et **passe chaque fichier
produit dans `parseConfig`/`applyConfig`**, les fonctions que l'atelier appelle
sur le vrai fichier. C'est ce test qui a rattrapé, à l'écriture, un `presetId`
inventé et un code de langue source faux — deux écarts qui font rejeter toute la
configuration à l'import, sans un mot d'explication côté atelier.

## Secret

`clonedVoiceId`, les clés API et le jeton Turnstile ne figurent dans aucune
réponse, aucun fichier écrit : `versConfig` ne les connaît pas, et le format ne
les autorise pas (`config-io.ts` les écarte à l'export comme à l'import). Une
requête `exporter_config` peut être relue, partagée, collée dans un ticket : elle
ne contient que des nombres et du texte de légende.
