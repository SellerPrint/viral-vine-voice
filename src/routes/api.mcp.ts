import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

import { repondreMcp } from "@/lib/mcp.server";

/**
 * Le fil MCP du monteur, en HTTP.
 *
 * Une seule route pour les deux sens du protocole : `GET` dit ce que l'instance
 * sait faire (nom, version, nombre d'outils, sessions ouvertes) et sert de
 * contrôle après déploiement ; `POST` porte les messages JSON-RPC — un objet,
 * ou un tableau pour un appel groupé.
 *
 * Ce n'est pas l'interface de l'atelier : aucun appel réseau du navigateur ne
 * passe par ici, et le document de montage n'y contient ni média ni secret.
 * Le fil stdio (`mcp/serveur.mjs`) et ce fil partent du même dispatcheur, donc
 * ce que voit un client branché sur Vercel est exactement ce que voit un client
 * branché sur un poste.
 */
export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      GET: async ({ request }) => repondreMcp(request),
      POST: async ({ request }) => repondreMcp(request),
      // PUT/PATCH/DELETE sont declares pour etre refuses explicitement : sans
      // handler, le routeur rend le document de l'application — un 200 HTML a un
      // client qui croyait parler au fil MCP.
      PUT: async ({ request }) => repondreMcp(request),
      PATCH: async ({ request }) => repondreMcp(request),
      DELETE: async ({ request }) => repondreMcp(request),
      // Le pre-vol n'est pas une requete autorisee ou refusee : il demande
      // seulement ce qui sera permis ensuite, donc il repond avant meme le jeton,
      // et sans `async` — rien a attendre ici.
      OPTIONS: () =>
        new Response(null, {
          status: 204,
          headers: {
            allow: "GET, POST, OPTIONS",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers":
              "content-type, authorization, x-mcp-token, mcp-session-id",
            "access-control-max-age": "600",
          },
        }),
    },
  },
});
