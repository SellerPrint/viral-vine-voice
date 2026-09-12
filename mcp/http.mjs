/**
 * Transport HTTP du fil MCP — la porte que Vercel sait tenir.
 *
 * ## Pourquoi un second fil
 *
 * `mcp/serveur.mjs` parle sur stdin/stdout : c'est ce que veulent Claude
 * Desktop et Cursor, et c'est impossible sur une fonction serverless — pas de
 * processus qui dure, pas de tuyau qui reste ouvert. Le fil HTTP parle le même
 * JSON-RPC, une requête par message, et reprend exactement le même
 * `CREER_SESSION` : aucun des deux ne peut donc dévier de l'autre, ni en
 * méthodes, ni en bornes, ni dans les refus.
 *
 * ## Deux façons de s'en servir
 *
 * 1. **Collant** — `initialize` rend un identifiant dans l'en-tête
 *    `Mcp-Session-Id`, le client le renvoie à chaque appel, le montage vit en
 *    mémoire d'instance. Sur Vercel une instance est éphémère : si l'identifiant
 *    ne répond plus (redéploiement, froid, autre région), le fil répond 410 et
 *    le client n'a qu'à rappeler `initialize`. C'est dit, pas caché.
 * 2. **Sans état** — chaque `tools/call` peut porter `params.document` (le JSON
 *    que `exporter_config` a rendu). La session est montée pour cet appel, le
 *    nouveau document revient dans `result.document`. Rien à retenir de part et
 *    d'autre : c'est le mode qui traverse les redéploiements.
 *
 * ## Ce que ce fil ne fait pas
 *
 * Il n'écrit et ne lit aucun fichier (`exporter_config` sans `chemin`,
 * `importer_config` avec `config` : le document voyage dans la requête), il
 * n'appelle aucun modèle, ne rend rien, et ne connait aucun secret de l'app —
 * `clonedVoiceId`, les clés API et le jeton Turnstile ne passent jamais ici.
 *
 * Un jeton d'accès est **obligatoire** : sans `MCP_TOKEN` configuré, le fil
 * répond 503 au lieu d'ouvrir un atelier de montage public.
 */

import { timingSafeEqual } from "node:crypto";

import { CREER_SESSION, NOM_SERVEUR, OUTILS, VERSION } from "./serveur.mjs";
import { depuisConfig } from "./projet.mjs";

export const TETE_SESSION = "mcp-session-id";
export const TETE_JETON = "authorization";

const LIMITES_DEFAUT = {
  octets: 256 * 1024,
  sessions: 128,
  vieMs: 30 * 60 * 1000,
};

const json = (statut, corps, tetes = {}) =>
  new Response(JSON.stringify(corps, null, 2), {
    status: statut,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Un montage en cours ne se met pas en cache, jamais : deux onglets ne
      // doivent pas rejouer le même `initialize` l'un contre l'autre.
      "cache-control": "no-store",
      ...tetes,
    },
  });

/** Comparaison à temps constant, pour qu'un jeton ne se lise pas octet à octet. */
function jeteauxEgaux(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

function teteAuthorization(requete) {
  const entete = (requete.headers.get(TETE_JETON) ?? "").trim();
  const porteur = /^Bearer\s+(.+)$/i.exec(entete);
  if (porteur?.[1]) return porteur[1].trim();
  if (entete) return entete;
  return (requete.headers.get("x-mcp-token") ?? "").trim();
}

/**
 * Le coeur du transport : une fonction `fetch(request) => Response`, sans
 * dépendance et sans `node:*`, donc identique sous Nitro (Vercel), sous
 * `node:http` en local, ou dans un test.
 */
export function CREER_TRANSPORT({
  secret,
  limiteOctets = LIMITES_DEFAUT.octets,
  dureeVieMs = LIMITES_DEFAUT.vieMs,
  maxSessions = LIMITES_DEFAUT.sessions,
  sessions,
  disque = false,
  horloge = () => Date.now(),
} = {}) {
  const ouvertes = sessions ?? new Map();
  const demarre = horloge();

  const purger = () => {
    const maintenant = horloge();
    for (const [id, entree] of ouvertes) {
      if (maintenant - entree.vu > dureeVieMs) ouvertes.delete(id);
    }
    while (ouvertes.size > maxSessions) {
      const [plusAncien] = ouvertes.keys();
      ouvertes.delete(plusAncien);
    }
  };

  const tetesCors = {
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-mcp-token, mcp-session-id",
    "access-control-expose-headers": TETE_SESSION,
    "access-control-max-age": "600",
  };

  async function corps(request) {
    const texte = await request.text();
    if (new TextEncoder().encode(texte).length > limiteOctets) return null;
    try {
      return { message: JSON.parse(texte), brut: texte };
    } catch {
      return { erreur: { code: -32700, message: "corps illisible : attendu un objet JSON-RPC" } };
    }
  }

  /** Un appel sans session collante : on monte le document fourni, le temps de répondre. */
  const sessionSansEtat = (document) => {
    if (document === undefined) return CREER_SESSION({ disque });
    return CREER_SESSION({
      disque,
      // Un document faux doit répondre d'une erreur nommée, pas monter un
      // montage à moitié : `depuisConfig` est celui que l'outil
      // `importer_config` utilise déjà, même validation, mêmes bornes.
      projet: depuisConfig(document),
    });
  };

  return {
    sessions: ouvertes,
    async fetch(request) {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();

      if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: tetesCors });
      }

      // Un client Streamable HTTP ouvre un `GET` pour recevoir un flux d'evenements.
      // Ce fil n'en sert pas : mieux vaut le dire en 405 qu'un JSON avale comme un
      // flux vide, ce qui se traduit cote client par un silence inexpliquable.
      //
      // Attention au zele : la specification impose au client d'envoyer
      // `Accept: application/json, text/event-stream` sur chaque POST, parce que
      // le serveur choisit l'un ou l'autre. Refuser des que l'en-tete mentionne
      // le flux écartait donc tous les clients conformes — Cursor, `mcp-remote`,
      // les SDK officiels. On ne refuse un POST que si le client est incapable
      // de lire du JSON ; un `GET` qui reclame un flux reste refuse.
      const accepte = request.headers.get("accept") ?? "";
      const veutLeFlux = /text\/event-stream/.test(accepte);
      const litDuJson =
        /application\/json/.test(accepte) ||
        /application\/\*/.test(accepte) ||
        /\*\/\*/.test(accepte) ||
        accepte.trim() === "";
      if (veutLeFlux && (method !== "POST" || !litDuJson)) {
        return json(
          405,
          {
            refus:
              "flux SSE non servi par ce fil : il repond en JSON a chaque appel (mode POST-a-POST). " +
              "Cote client, un pont stdio fait l'affaire — `npx mcp-remote <url> --transport http-only` — " +
              "et le mode sans etat (`params.document`) evite d'avoir a maintenir un flux.",
          },
          { allow: "POST", ...tetesCors },
        );
      }

      if (method === "GET" || method === "HEAD") {
        purger();
        return json(
          200,
          {
            serveur: NOM_SERVEUR,
            version: VERSION,
            transport: "http",
            outils: OUTILS.length,
            montage: "aucun : ce fil ne garde l'état que le temps d'une session",
            sessions: { ouvertes: ouvertes.size, vieMs: dureeVieMs },
            ageMs: horloge() - demarre,
            attente:
              "POSTe un message JSON-RPC (initialize, tools/list, tools/call). Sans `Mcp-Session-Id`, passe `params.document` pour un appel sans état.",
            dispo: { disque: Boolean(disque), ecriture_fichier: Boolean(disque) },
          },
          tetesCors,
        );
      }

      if (method !== "POST") {
        return json(
          405,
          { refus: `méthode ${method} sans usage ici : GET pour l'état, POST pour le fil` },
          {
            allow: "GET, POST, OPTIONS",
            ...tetesCors,
          },
        );
      }

      // 1) un atelier de montage ouvert au monde entier n'a pas de sens.
      if (!secret) {
        return json(
          503,
          {
            refus:
              "fil MCP fermé : MCP_TOKEN n'est pas configuré sur ce déploiement. " +
              "Le fil stdio (node mcp/serveur.mjs) reste disponible et complet sur un poste.",
          },
          tetesCors,
        );
      }
      if (!jeteauxEgaux(teteAuthorization(request), secret)) {
        return json(
          401,
          { refus: "jeton manquant ou faux : en-tête `Authorization: Bearer <MCP_TOKEN>`" },
          { "www-authenticate": "Bearer", ...tetesCors },
        );
      }

      // 2) la charge, bornée : un document de montage est petit, un corps de
      //    plusieurs mégaoctets n'est pas ce à quoi ce fil sert.
      const annonce = Number(request.headers.get("content-length") ?? 0);
      if (annonce > limiteOctets) {
        return json(
          413,
          { refus: `corps trop lourd : ${(limiteOctets / 1024) | 0} Ko au plus` },
          tetesCors,
        );
      }
      const lu = await corps(request);
      if (lu === null) {
        return json(
          413,
          { refus: `corps trop lourd : ${(limiteOctets / 1024) | 0} Ko au plus` },
          tetesCors,
        );
      }
      if (lu.erreur) {
        return json(400, { jsonrpc: "2.0", id: null, error: lu.erreur }, tetesCors);
      }

      // 3) session collante, ou appel sans état. L'épuration passe avant la
      //    recherche : sinon une session morte reprendrait une lease à chaque
      //    appel, et la durée de vie ne voudrait plus rien dire.
      const id = request.headers.get(TETE_SESSION);
      purger();
      let entree = null;
      if (id) {
        entree = ouvertes.get(id);
        if (!entree) {
          return json(
            410,
            {
              refus:
                "session perdue (instance froide, redéploiement ou expiration) : rappelle initialize, " +
                "ou passe `params.document` à chaque appel pour travailler sans état",
            },
            { ...tetesCors, [TETE_SESSION]: "" },
          );
        }
      }

      const messages = Array.isArray(lu.message) ? lu.message : [lu.message];
      const estInit = messages.some((m) => m?.method === "initialize");
      // Deux facons d'appeler sans identifiant : ouvrir une session, ou porter
      // son document. La seconde est celle qui traverse un red deploiement : il
      // n'y a rien a perdre, puisqu'il n'y a rien a retenir.
      const sansEtat = messages.some((m) => m?.params?.document !== undefined);
      if (!id && !estInit && !sansEtat) {
        return json(
          400,
          { refus: "aucune session : envoie `initialize` d'abord, ou passe `params.document`" },
          tetesCors,
        );
      }

      if (!entree) {
        // Un client sans identifiant (le mode sans état) traite chaque message
        // sur la session du document fourni, s'il y en a un.
        const avecDocument = messages.find((m) => m?.params?.document !== undefined);
        const session = avecDocument
          ? sessionSansEtat(avecDocument.params.document)
          : CREER_SESSION({ disque });
        entree = { session, vu: horloge(), collante: Boolean(id) };
        if (id) ouvertes.set(id, entree);
        else if (estInit) {
          const nouvelId = nouvelIdentifiant();
          ouvertes.set(nouvelId, entree);
          entree.id = nouvelId;
        }
      }
      entree.vu = horloge();

      // Le quota, serre ici et pas seulement a l'epuration : une session
      // fraichement creee ne doit jamais etre la victime du recyclage.
      if (ouvertes.size > maxSessions) {
        for (const [cle, valeur] of ouvertes) {
          if (valeur !== entree) {
            ouvertes.delete(cle);
            break;
          }
        }
      }

      const reponses = [];
      let document_retour = null;
      let rendu = false;
      for (const message of messages) {
        const reponse = entree.session.traiter(message);
        if (message?.params?.document !== undefined && reponse?.result) {
          document_retour = entree.session.document();
          rendu = true;
        }
        if (reponse) reponses.push({ jsonrpc: "2.0", ...reponse });
      }
      if (reponses.length === 0) {
        return new Response(null, {
          status: 202,
          headers: { ...tetesCors, [TETE_SESSION]: entree.id ?? "" },
        });
      }
      if (rendu && document_retour) {
        const dernier = reponses[reponses.length - 1];
        if (dernier?.result) dernier.result = { ...dernier.result, document: document_retour };
      }
      const corps_reponse = Array.isArray(lu.message) ? reponses : reponses[0];
      return json(200, corps_reponse, {
        ...tetesCors,
        ...(entree.id ? { [TETE_SESSION]: entree.id } : {}),
      });
    },
  };
}

/** `crypto.randomUUID` n'est pas garanti partout ; un id suffit, il n'est pas un secret. */
function nouvelIdentifiant() {
  const octets = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(octets);
  else for (let i = 0; i < octets.length; i++) octets[i] = Math.floor(Math.random() * 256);
  return [...octets].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Le meme transport, pose sur `node:http` : `node mcp/serveur.mjs --http
 * --port 4750 --secret …` pour essayer le fil HTTP sur un poste, ou lancer un
 * client MCP a distance sans deploiement.
 */
export async function CREER_SERVEUR_NODE({ port = 4750, host = "0.0.0.0", ...options } = {}) {
  const { createServer } = await import("node:http");
  const transport = CREER_TRANSPORT(options);

  const serveur = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    const morceaux = [];
    let poids = 0;
    for await (const morceau of req) {
      poids += morceau.length;
      if (poids > (options.limiteOctets ?? LIMITES_DEFAUT.octets)) break;
      morceaux.push(morceau);
    }
    const requete = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(morceaux),
    });
    const reponse = await transport.fetch(requete);
    const tetes = {};
    reponse.headers.forEach((valeur, cle) => {
      tetes[cle] = valeur;
    });
    res.writeHead(reponse.status, tetes);
    res.end(reponse.body ? Buffer.from(await reponse.arrayBuffer()) : "");
  });

  await new Promise((finir) => serveur.listen(port, host, finir));
  const { port: port_reel } = serveur.address();
  process.stdout.write(
    `viraldub-monteur : fil HTTP sur http://${host}:${port_reel}/ (POST (JSON-RPC))\n`,
  );
  return { serveur, transport, port: port_reel };
}
