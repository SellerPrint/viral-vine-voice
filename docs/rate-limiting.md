# Protection des endpoints IA

Les trois server functions (`transcribeAudio`, `translateSegments`,
`synthesizeSpeech`) appellent des API facturées à l'usage. Sans garde-fou,
elles constituent un proxy ElevenLabs et Gemini gratuit et anonyme,
appelable en boucle depuis la console du navigateur.

## Ce qui est en place

| Couche                        | Fichier                   | Actif                            |
| ----------------------------- | ------------------------- | -------------------------------- |
| Bornes de taille et de volume | `src/lib/ai.functions.ts` | Toujours                         |
| Allowlist des voix            | `src/lib/voices.ts`       | Toujours                         |
| Limitation de débit par IP    | `src/lib/guard.server.ts` | Toujours                         |
| Cloudflare Turnstile          | `src/lib/guard.server.ts` | Si `TURNSTILE_SECRET_KEY` défini |

### Bornes appliquées

| Entrée                 | Limite         | Raison                                  |
| ---------------------- | -------------- | --------------------------------------- |
| `audioBase64`          | 8 Mo           | ~3 min de mono 16 kHz                   |
| `text` (TTS)           | 800 caractères | Borne le coût d'un appel                |
| `segments`             | 400            | Borne le nombre d'appels par traitement |
| `voiceId` (ElevenLabs) | Allowlist      | Empêche l'usage de voix premium         |

### Quotas par défaut

Définis dans `RATE_LIMITS` (`src/lib/guard.server.ts`), par IP et par heure :

| Endpoint     | Limite |
| ------------ | ------ |
| `transcribe` | 10     |
| `translate`  | 30     |
| `speech`     | 400    |

Un traitement complet consomme environ 1 transcription, 1 traduction et
20 à 60 appels TTS : les valeurs autorisent donc une poignée de vidéos par
heure et par IP.

## Limite connue du compteur en mémoire

Le compteur vit dans la mémoire de l'isolat Workers. Il est réinitialisé à
chaque redémarrage et **n'est pas partagé entre isolats** : sous forte charge,
Cloudflare peut en instancier plusieurs et la limite effective devient un
multiple de la valeur configurée.

C'est un garde-fou best-effort, suffisant contre un script opportuniste, mais
pas un plafond strict.

## Passer à un plafond strict (Cloudflare KV)

1. Créer l'espace de noms :

   ```bash
   npx wrangler kv namespace create RATE_LIMIT
   ```

2. Le déclarer dans `wrangler.toml` :

   ```toml
   [[kv_namespaces]]
   binding = "RATE_LIMIT"
   id = "<id retourné par la commande>"
   ```

3. Remplacer le corps de `enforceRateLimit` :

   ```ts
   export async function enforceRateLimit(scope: keyof typeof RATE_LIMITS, env: Env) {
     const rule = RATE_LIMITS[scope];
     const window = Math.floor(Date.now() / rule.windowMs);
     const key = `rl:${scope}:${clientKey()}:${window}`;

     const current = Number(await env.RATE_LIMIT.get(key)) || 0;
     if (current >= rule.limit) throw new RateLimitError(rule.windowMs / 1000);

     await env.RATE_LIMIT.put(key, String(current + 1), {
       expirationTtl: Math.ceil(rule.windowMs / 1000),
     });
   }
   ```

> KV est cohérent à terme : de courtes rafales peuvent encore dépasser la
> limite. Pour une exactitude stricte, utiliser un Durable Object indexé sur
> l'IP.

## Activer Turnstile

1. Créer un widget sur le [tableau de bord Cloudflare](https://dash.cloudflare.com/?to=/:account/turnstile).
2. Renseigner `VITE_TURNSTILE_SITE_KEY` (client) et `TURNSTILE_SECRET_KEY` (serveur).
3. Le widget apparaît automatiquement sous le panneau de réglages.

Sans clé, le widget n'est pas monté et le développement local reste fluide :
seule la limitation de débit s'applique.

## À faire avant tout trafic public

- [ ] Définir un plafond de dépense sur ElevenLabs et ai33.pro — c'est le
      dernier filet de sécurité, indépendant du code.
- [ ] Activer Turnstile.
- [ ] Surveiller la consommation les premiers jours.
- [ ] Ajouter une authentification si le service doit être monétisé.
