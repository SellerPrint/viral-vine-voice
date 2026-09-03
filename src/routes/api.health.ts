import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

import { incrementBy, kvBackend } from "@/lib/kv.server";

/**
 * Point de contrôle de l'infrastructure partagée.
 *
 * Le repli mémoire de `kv.server.ts` est silencieux par conception : sans KV
 * l'application fonctionne, elle perd seulement l'effet des limites entre
 * instances — ce qui ne se constate autrement que sur la facture. Cette route
 * rend l'état observable depuis l'extérieur, après déploiement.
 *
 * Elle n'expose ni l'URL ni le jeton, seulement le backend effectif et le
 * résultat d'un aller-retour réel.
 */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const backend = kvBackend();

        // Aller-retour réel : `kvBackend()` ne lit que les variables
        // d'environnement et resterait « redis » avec un jeton invalide.
        // On incrémente puis on rembourse pour ne rien laisser derrière.
        let reachable: boolean | null = null;
        let latencyMs: number | null = null;

        if (backend === "redis") {
          const key = "health:probe";
          const started = Date.now();
          const up = await incrementBy(key, 1, 60_000);
          await incrementBy(key, -1, 60_000);
          latencyMs = Date.now() - started;
          reachable = up.shared;
        }

        const healthy = backend === "redis" && reachable === true;

        return new Response(
          JSON.stringify(
            {
              status: healthy ? "ok" : "degraded",
              kv: {
                backend,
                reachable,
                latencyMs,
                // Le message dit quoi faire, pas seulement ce qui ne va pas.
                hint: healthy
                  ? undefined
                  : backend === "memory"
                    ? "KV_REST_API_URL et KV_REST_API_TOKEN absents ou non REST : limites de débit et plafond TTS appliqués par instance, cache IA inactif."
                    : "Variables présentes mais la base ne répond pas : vérifiez le jeton et la région.",
              },
            },
            null,
            2,
          ),
          {
            status: healthy ? 200 : 503,
            headers: {
              "Content-Type": "application/json",
              // Un diagnostic mis en cache ne diagnostique plus rien.
              "Cache-Control": "no-store",
            },
          },
        );
      },
    },
  },
});
