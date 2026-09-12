import { expect, test } from "@playwright/test";

/**
 * La porte HTTP du fil MCP, vérifiée depuis l'extérieur du processus.
 *
 * Les cas unitaires (`mcp/http.test.mjs`, `src/lib/mcp.server.test.ts`) appellent
 * la fonction directement. Ceux-ci passent par la vraie route de l'application —
 * `src/routes/api.mcp.ts` — et ne contrôlent donc que ce qui ne peut être testé
 * qu'en déployant : que la route est montée, qu'elle répond en JSON, et qu'elle
 * reste **fermée** tant que `MCP_TOKEN` n'est pas réglé. C'est le comportement
 * attendu en prévisualisation et en CI, où aucun jeton n'existe : un atelier de
 * montage ne s'ouvre pas au monde par défaut.
 */

test("GET /api/mcp décrit le fil, sans jeton : c'est le contrôle après déploiement", async ({
  request,
}) => {
  const reponse = await request.get("/api/mcp");
  expect(reponse.ok()).toBe(true);
  expect(reponse.headers()["content-type"]).toContain("application/json");
  const corps = await reponse.json();
  expect(corps.serveur).toBe("viraldub-monteur");
  expect(corps.outils).toBe(17);
  // ce que le déploiement ne peut pas promettre est dit, pas tu
  expect(corps.dispo.ecriture_fichier).toBe(false);
  expect(corps.attente).toMatch(/initialize/);
});

test("POST /api/mcp ne s'ouvre pas tout seul", async ({ request }) => {
  // Selon que le déploiement connaît ou non un jeton, la porte répond 503
  // (« MCP_TOKEN absent ») ou 401 (« jeton attendu »). Dans les deux cas elle est
  // fermée : ce qui serait anormal, ce serait un 200 sans credentials, ou un 500.
  const reponse = await request.post("/api/mcp", {
    data: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
  });
  expect([401, 503]).toContain(reponse.status());
  expect((await reponse.json()).refus).toMatch(/MCP_TOKEN|Bearer/);
});

test("un client conforme n'est pas éconduit parce qu'il annonce le flux", async ({ request }) => {
  // La specification Streamable HTTP impose `Accept: application/json,
  // text/event-stream` sur chaque POST, le serveur choisissant le format.
  // Refuser des que le flux etait mentionne ecartait Cursor, `mcp-remote` et
  // les SDK officiels : la requete doit descendre jusqu'a la garde d'acces,
  // pas mourir sur l'en-tete.
  const reponse = await request.post("/api/mcp", {
    headers: { accept: "application/json, text/event-stream" },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        clientInfo: { name: "e2e", version: "1" },
        capabilities: {},
      },
    },
  });
  expect(reponse.status()).not.toBe(405);
  expect([401, 503]).toContain(reponse.status());
  expect((await reponse.json()).refus).toMatch(/MCP_TOKEN|Bearer/);
});

test("les méthodes qui ne servent à rien sont refusées avec l'allow", async ({ request }) => {
  const reponse = await request.fetch("/api/mcp", { method: "PUT", data: "{}" });
  expect(reponse.status()).toBe(405);
  expect(reponse.headers()["content-type"]).toContain("application/json");
  expect(reponse.headers()["allow"]).toContain("POST");

  // Le pre-vol OPTIONS repond 204 — et c'est tout ce que l'on peut tenir ici :
  // en dev, le middleware CORS du serveur de developpement repond a la place de
  // la route (il negocie `Access-Control-Allow-*` avec les methodes par defaut),
  // et sur Vercel c'est le handler de la route qui le fait. Le status, lui, est
  // le meme des deux cotes.
  const preflet = await request.fetch("/api/mcp", { method: "OPTIONS" });
  expect(preflet.status()).toBe(204);
});
