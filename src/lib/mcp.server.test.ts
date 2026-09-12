import { afterEach, describe, expect, it } from "vitest";

import { RateLimitError } from "./guard.server";
import { monteurMcpActif, repondreMcp, sessionsMcp } from "./mcp.server";

/**
 * La porte Vercel du fil MCP, testée sans serveur.
 *
 * Ce fichier ne rejoue pas le protocole — `mcp/http.test.mjs` l'a fait. Il
 * vérifie les trois décisions qui n'existent que parce que le fil est posé sur
 * un déploiement partagé : personne n'entre sans jeton, le débit est compté
 * avant de toucher au montage, et une limite dépassée répond 429 au lieu de
 * ressembler à une panne de l'application.
 */

const JETON = "jeteau-des-tests";
let avant: string | undefined;

function jeton(valeur: string | undefined) {
  if (avant === undefined) avant = process.env.MCP_TOKEN;
  if (valeur === undefined) delete process.env.MCP_TOKEN;
  else process.env.MCP_TOKEN = valeur;
}

afterEach(() => jeton(avant));

const POST = (corps: unknown, tetes: Record<string, string> = {}) =>
  new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...tetes },
    body: JSON.stringify(corps),
  });

const initialiser = () => ({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });

describe("la porte du déploiement", () => {
  it("reste fermée tant que MCP_TOKEN manque, et le dit", async () => {
    jeton(undefined);
    expect(monteurMcpActif()).toBe(false);
    const reponse = await repondreMcp(POST(initialiser()));
    expect(reponse.status).toBe(503);
    expect(await reponse.text()).toContain("MCP_TOKEN");
  });

  it("laisse le controle GET passer sans jeton", async () => {
    // c'est ce qu'on regarde juste apres un deploiement, quand on n'a pas encore
    // regle la variable : le fil est la, il annonce 17 outils et aucun disque
    jeton(undefined);
    // le compteur de debit a besoin du contexte de requete de TanStack : on
    // l'injecte, comme pour les autres cas — ce qu'on verifie ici, c'est que GET
    // ne depende pas du jeton
    const reponse = await repondreMcp(new Request("http://localhost/api/mcp", { method: "GET" }), {
      garde: () => Promise.resolve(),
    });
    expect(reponse.status).toBe(200);
    const corps = await reponse.json();
    expect(corps.outils).toBe(17);
    expect(corps.dispo.ecriture_fichier).toBe(false);
  });

  it("pousse le 401 jusqu'au transport, et jamais avant", async () => {
    jeton(JETON);
    const reponse = await repondreMcp(POST(initialiser()), { garde: async () => {} });
    expect(reponse.status).toBe(401);
    expect((await reponse.json()).refus).toMatch(/Bearer/);
  });

  it("ouvre le fil quand le jeton est le bon", async () => {
    jeton(JETON);
    const reponse = await repondreMcp(POST(initialiser(), { authorization: `Bearer ${JETON}` }), {
      garde: async () => {},
    });
    expect(reponse.status).toBe(200);
    const corps = await reponse.json();
    expect(corps.result.serverInfo.name).toBe("viraldub-monteur");
    expect(reponse.headers.get("mcp-session-id")).toMatch(/^[0-9a-f]{32}$/);
    // la session est comptée, et la route ne l'a pas inventée pour l'occasion
    expect(sessionsMcp()).toBeGreaterThan(0);
  });

  it("rend un 429 lisible quand le débit est dépassé", async () => {
    jeton(JETON);
    const reponse = await repondreMcp(POST(initialiser(), { authorization: `Bearer ${JETON}` }), {
      garde: () => Promise.reject(new RateLimitError(90)),
    });
    expect(reponse.status).toBe(429);
    expect(reponse.headers.get("retry-after")).toBe("60");
    expect((await reponse.json()).refus).toMatch(/Limite d'utilisation/);
  });

  it("refuse un corps trop lourd avant de le lire", async () => {
    jeton(JETON);
    const reponse = await repondreMcp(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { authorization: `Bearer ${JETON}`, "content-length": "900000000" },
        body: "{}",
      }),
      { garde: async () => {} },
    );
    expect(reponse.status).toBe(413);
  });

  it("laisse passer une panne du compteur, sans la maquiller", async () => {
    jeton(JETON);
    await expect(
      repondreMcp(POST(initialiser(), { authorization: `Bearer ${JETON}` }), {
        garde: () => Promise.reject(new Error("redis indisponible")),
      }),
    ).rejects.toThrow(/redis indisponible/);
  });
});
