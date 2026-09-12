import { CREER_TRANSPORT } from "../../mcp/http.mjs";

import { RateLimitError, enforceRateLimit } from "./guard.server";

/**
 * La porte HTTP du fil MCP, posée sur le déploiement.
 *
 * `mcp/serveur.mjs` parle sur stdin/stdout — ce que Claude Desktop et Cursor
 * savent faire, et ce qu'une fonction serverless ne peut pas être : pas de
 * processus qui dure, pas de tuyau ouvert. Ce module reprend le **même**
 * dispatcheur JSON-RPC (le `CREER_SESSION` du serveur) derrière une fonction
 * `fetch` : une seule implémentation du protocole, donc aucun écart possible
 * entre le poste et Vercel — ni dans les outils, ni dans les bornes, ni dans
 * les refus.
 *
 * Trois choses sont verrouillées ici, et pas dans le transport :
 *
 * - **un jeton** : sans `MCP_TOKEN`, le fil répond 503. Un atelier de montage
 *   ouvert au monde entier, servi par la facture de quelqu'un, n'a pas de sens.
 * - **un débit** : le même compteur partagé (`kv.server.ts`) que les appels IA,
 *   pour qu'un script ne transforme pas ce point d'entrée en boucle gratuite.
 * - **aucun disque** : le transport est créé avec `disque: false`, donc
 *   `exporter_config` refuse les chemins et rend le document dans la réponse.
 *   Sur Vercel, le système de fichiers est la temporaire d'un froid : promettre
 *   un fichier ferait croire à quelque chose que personne ne retrouverait.
 */

const LIMITES = {
  /** Un document de montage pèse quelques kilooctets ; 256 Ko est déjà large. */
  corps: 256 * 1024,
  /** Sessions collantes par instance : au-delà, on recycle la plus ancienne. */
  sessions: 64,
  vieMs: 30 * 60 * 1000,
} as const;

type Transport = ReturnType<typeof CREER_TRANSPORT>;

let transport: Transport | undefined;
let transportPour = "";

/**
 * Un transport par instance, recréé si le jeton change de valeur — une rotation
 * de `MCP_TOKEN` ne doit pas obliger à redéploier pour être entendue.
 */
function transportCourant(): Transport {
  const secret = process.env.MCP_TOKEN ?? "";
  if (!transport || transportPour !== secret) {
    transport = CREER_TRANSPORT({
      secret,
      limiteOctets: LIMITES.corps,
      maxSessions: LIMITES.sessions,
      dureeVieMs: LIMITES.vieMs,
      disque: false,
    });
    transportPour = secret;
  }
  return transport;
}

export function monteurMcpActif(): boolean {
  return Boolean(process.env.MCP_TOKEN);
}

/** Ce que l'instance tient comme sessions, pour le regard des tests et de la santé. */
export function sessionsMcp(): number {
  return transportCourant().sessions.size;
}

const reponseJson = (statut: number, corps: unknown, tetes: HeadersInit = {}) =>
  new Response(JSON.stringify(corps, null, 2), {
    status: statut,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...tetes,
    },
  });

/**
 * Le point d'entrée appelé par la route `/api/mcp`.
 *
 * Le jeton est vérifié par le transport (comparaison à temps constant) : ici on
 * ne fait que refuser trop tôt, compter le débit, et traduire une panne de
 * limite en 429 avec `Retry-After` — un 500 sur ce fil ressemblerait à une
 * panne de l'application, alors que c'est un client qui force.
 */
export async function repondreMcp(
  requete: Request,
  { garde = enforceRateLimit }: { garde?: (scope: "mcp") => Promise<void> } = {},
): Promise<Response> {
  // Ce que la route sait faire, d'abord : refuser une methode n'a rien a voir
  // avec une autorisation, et un 503 sur un PUT ferait chercher un jeton la ou
  // il n'y a juste rien a envoyer.
  if (!["GET", "HEAD", "POST", "OPTIONS"].includes(requete.method.toUpperCase())) {
    return new Response(
      JSON.stringify(
        {
          refus: `méthode ${requete.method.toUpperCase()} sans usage ici : GET pour l'état, POST pour le fil`,
        },
        null,
        2,
      ),
      {
        status: 405,
        headers: {
          "content-type": "application/json; charset=utf-8",
          allow: "GET, POST, OPTIONS",
          "cache-control": "no-store",
        },
      },
    );
  }

  // GET et HEAD sont le controle d'apres deploiement : ils ne disent que le nom,
  // la version, le nombre d'outils et `disque: false` — exactement ce que rend
  // deja `/api/health` sans jeton. Le fil de travail, lui, ne s'ouvre qu'avec un
  // jeton configure.
  const lecture = ["GET", "HEAD", "OPTIONS"].includes(requete.method.toUpperCase());

  if (!monteurMcpActif() && !lecture) {
    return reponseJson(503, {
      refus:
        "fil MCP fermé : la variable d'environnement MCP_TOKEN est absente de ce déploiement. " +
        "Le fil stdio reste complet sur un poste — `node mcp/serveur.mjs`, ou Claude Desktop et Cursor.",
    });
  }

  try {
    await garde("mcp");
  } catch (erreur) {
    if (erreur instanceof RateLimitError) {
      return reponseJson(429, { refus: erreur.message }, { "retry-after": "60" });
    }
    throw erreur;
  }

  const longueur = Number(requete.headers.get("content-length") ?? 0);
  if (longueur > LIMITES.corps) {
    return reponseJson(413, {
      refus: `corps trop lourd : ${(LIMITES.corps / 1024) | 0} Ko au plus`,
    });
  }

  return transportCourant().fetch(requete);
}
