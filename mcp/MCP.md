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

## Trois règles que le moteur applique et qu'aucun outil ne contourne

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
