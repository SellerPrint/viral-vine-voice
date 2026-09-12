import { describe, expect, it } from "vitest";

import { CREER_SERVEUR_NODE, CREER_TRANSPORT } from "./http.mjs";
import { OUTILS } from "./serveur.mjs";

/**
 * Le fil HTTP du MCP, testé comme un client le verrait.
 *
 * Ce que l'on vérifie ici n'est pas le protocole — il est partagé avec le fil
 * stdio, et `serveur.test.mjs` l'éprouve déjà. Ce sont les quatre choses que le
 * déploiement change : personne n'entre sans jeton, rien ne touche au disque,
 * une session perdue se dit au lieu de rendre un montage à moitié, et un appel
 * peut se passer de session. Et une dernière, structurelle : les deux fils
 * doivent annoncer le même contrat.
 */

const POST = (corps, { secret = "jeteau-essai", session, headers = {} } = {}) =>
  new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      ...(session ? { "mcp-session-id": session } : {}),
      ...headers,
    },
    body: typeof corps === "string" ? corps : JSON.stringify(corps),
  });

const init = (surcharge = {}) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", ...surcharge },
});

const unTransport = (options = {}) => CREER_TRANSPORT({ secret: "jeteau-essai", ...options });

describe("la porte", () => {
  it("se décrit en GET, sans jeton : c'est un contrôle de déploiement", async () => {
    const transport = unTransport();
    const reponse = await transport.fetch(new Request("http://localhost/api/mcp"));
    expect(reponse.status).toBe(200);
    const corps = await reponse.json();
    expect(corps.serveur).toBe("viraldub-monteur");
    expect(corps.outils).toBe(OUTILS.length);
    // ce que Vercel ne peut pas promettre est dit, pas tu
    expect(corps.dispo.ecriture_fichier).toBe(false);
    expect(corps.attente).toMatch(/initialize/);
  });

  it("refuse d'ouvrir un atelier public sans MCP_TOKEN", async () => {
    const transport = CREER_TRANSPORT({ secret: undefined });
    const reponse = await transport.fetch(POST(init(), { secret: "" }));
    expect(reponse.status).toBe(503);
    expect((await reponse.json()).refus).toMatch(/MCP_TOKEN/);
  });

  it("rejette un jeton absent ou faux, accepte le bon", async () => {
    const transport = unTransport();
    expect((await transport.fetch(POST(init(), { secret: "" }))).status).toBe(401);
    expect((await transport.fetch(POST(init(), { secret: "jeteau-dautre" }))).status).toBe(401);
    const bon = await transport.fetch(POST(init()));
    expect(bon.status).toBe(200);
    expect(bon.headers.get("www-authenticate")).toBeNull();
  });

  it("borne la taille du corps, à l'annonce comme à la lecture", async () => {
    const transport = unTransport({ limiteOctets: 80 });
    const reponse = await transport.fetch(
      POST({ jsonrpc: "2.0", id: 1, method: "ping", params: { long: "x".repeat(400) } }),
    );
    expect(reponse.status).toBe(413);
    expect((await reponse.json()).refus).toMatch(/Ko au plus/);
  });

  it("répond -32700 à un corps qui n'est pas du JSON, en 400", async () => {
    const transport = unTransport();
    const reponse = await transport.fetch(POST("{ ceci n'est pas du json"));
    expect(reponse.status).toBe(400);
    expect((await reponse.json()).error.code).toBe(-32700);
  });

  it("dit qu'il ne sert pas de flux SSE, plutot que de se taire", async () => {
    // Un client Streamable HTTP ouvre un GET pour un flux d'evenements. Un JSON
    // lu comme un flux vide se traduit par un client branche et muet : le refus
    // nomme, lui, se comprend.
    const transport = unTransport();
    const reponse = await transport.fetch(
      new Request("http://localhost/api/mcp", { headers: { accept: "text/event-stream" } }),
    );
    expect(reponse.status).toBe(405);
    expect((await reponse.json()).refus).toMatch(/mcp-remote|sans état/);
    // la sante du fil reste accessible a un client qui ne demande que du JSON
    const sansFlux = await transport.fetch(new Request("http://localhost/api/mcp"));
    expect(sansFlux.status).toBe(200);
  });

  it("n'accepte que GET, POST, OPTIONS", async () => {
    const transport = unTransport();
    const reponse = await transport.fetch(
      new Request("http://localhost/api/mcp", { method: "PUT", body: "{}" }),
    );
    expect(reponse.status).toBe(405);
    expect(reponse.headers.get("allow")).toContain("POST");
    const preflet = await transport.fetch(
      new Request("http://localhost/api/mcp", { method: "OPTIONS" }),
    );
    expect(preflet.status).toBe(204);
    expect(preflet.headers.get("access-control-allow-headers")).toContain("mcp-session-id");
  });
});

describe("la session collante", () => {
  it("naît sur initialize, vit tant qu'on la nomme, et meurt en le disant", async () => {
    const transport = unTransport();
    const ouverture = await transport.fetch(POST(init()));
    const id = ouverture.headers.get("mcp-session-id");
    expect(id).toMatch(/^[0-9a-f]{32}$/);

    const liste = await transport.fetch(
      POST({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { session: id }),
    );
    expect(liste.status).toBe(200);
    expect((await liste.json()).result.tools).toHaveLength(OUTILS.length);

    // l'instance d'a cote est froide : 410 et une conduite a tenir, pas un
    // montage a moitie qui ferait croire que les gestes sont passes
    const perdu = await transport.fetch(
      POST({ jsonrpc: "2.0", id: 3, method: "ping" }, { session: "0".repeat(32) }),
    );
    expect(perdu.status).toBe(410);
    expect((await perdu.json()).refus).toMatch(/rappelle initialize/);
  });

  it("ne sert rien avant initialize", async () => {
    const transport = unTransport();
    const reponse = await transport.fetch(POST({ jsonrpc: "2.0", id: 7, method: "tools/list" }));
    expect(reponse.status).toBe(400);
    expect((await reponse.json()).refus).toMatch(/initialize/);
  });

  it("recycle la plus ancienne quand le quota est depasse", async () => {
    let maintenant = 0;
    const transport = unTransport({ maxSessions: 2, horloge: () => maintenant });
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const reponse = await transport.fetch(POST(init()));
      ids.push(reponse.headers.get("mcp-session-id"));
      maintenant += 1; // sinon toutes portent le meme « vu »
    }
    expect(transport.sessions.size).toBe(2);
    const premiere = await transport.fetch(
      POST({ jsonrpc: "2.0", id: 9, method: "ping" }, { session: ids[0] }),
    );
    expect(premiere.status).toBe(410);
    const derniere = await transport.fetch(
      POST({ jsonrpc: "2.0", id: 10, method: "ping" }, { session: ids[2] }),
    );
    expect(derniere.status).toBe(200);
  });

  it("expire d'elle-meme au bout de sa duree de vie", async () => {
    let maintenant = 0;
    const transport = unTransport({ dureeVieMs: 1000, horloge: () => maintenant });
    const id = (await transport.fetch(POST(init()))).headers.get("mcp-session-id");
    maintenant += 1500;
    const apres = await transport.fetch(
      POST({ jsonrpc: "2.0", id: 4, method: "ping" }, { session: id }),
    );
    expect(apres.status).toBe(410);
  });
});

describe("l'appel sans etat", () => {
  const document = {
    app: "viraldub",
    version: 2,
    presetId: "capcut-pop",
    timeline: {
      clips: [
        { track: "subs", start: 0, duration: 1.6, text: "premier cartouche" },
        { track: "subs", start: 1.6, duration: 1.6, text: "second cartouche" },
      ],
      cuts: [],
    },
  };

  it("monte le document passe, rend le nouveau, et ne retient rien", async () => {
    const transport = unTransport();
    const reponse = await transport.fetch(
      POST({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "couper_au_rythme",
          arguments: { bpm: 120, gardee: 0.29 },
          document,
        },
      }),
    );
    expect(reponse.status).toBe(200);
    const corps = await reponse.json();
    expect(reponse.headers.get("mcp-session-id")).toBeNull();
    // le document neuf revient a cote du resultat de l'outil : c'est ce que le
    // client renverra a l'appel suivant, sans rien avoir a retenir
    expect(corps.result.document.timeline.cuts.length).toBeGreaterThan(0);
    expect(corps.result.document.app).toBe("viraldub");
    expect(corps.result.document.timeline.clips).toHaveLength(2);
    expect(JSON.parse(corps.result.content[0].text).avis).toBeDefined();
    expect(transport.sessions.size).toBe(0);
  });

  it("refuse un document qui n'est pas une configuration de l'atelier", async () => {
    const transport = unTransport();
    const reponse = await transport.fetch(
      POST({
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: { name: "etat", arguments: {}, document: { app: "queque-chose-dautre" } },
      }),
    );
    const corps = await reponse.json();
    // l'erreur vient de la lecture du document : elle est dite, pas drapeeue en 500
    expect(corps.result === undefined || corps.result.content !== undefined).toBe(true);
    const texte = JSON.stringify(corps);
    expect(texte).toMatch(/viraldub|configuration/);
  });

  it("rend la config dans la reponse, faute de disque", async () => {
    const transport = unTransport();
    const sansChemin = await transport.fetch(
      POST({
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: { name: "exporter_config", arguments: {}, document },
      }),
    );
    const donnees = JSON.parse((await sansChemin.json()).result.content[0].text);
    expect(donnees.config.timeline.clips).toHaveLength(2);
    expect(donnees.octets).toBeGreaterThan(100);

    const avecChemin = await transport.fetch(
      POST({
        jsonrpc: "2.0",
        id: 14,
        method: "tools/call",
        params: { name: "exporter_config", arguments: { chemin: "sortie.json" }, document },
      }),
    );
    const refus = JSON.parse((await avecChemin.json()).result.content[0].text);
    expect(refus.refus).toMatch(/n'écrit pas sur le disque/);
  });

  it("accepte un lot de messages, et un acquittement sans reponse", async () => {
    const transport = unTransport();
    const lot = await transport.fetch(
      POST([
        {
          jsonrpc: "2.0",
          id: 20,
          method: "tools/call",
          params: { name: "valider", arguments: {}, document },
        },
        { jsonrpc: "2.0", id: 21, method: "ping" },
      ]),
    );
    const corps = await lot.json();
    expect(Array.isArray(corps)).toBe(true);
    expect(corps).toHaveLength(2);
    expect(corps[0].result.content[0].text).toBeDefined();

    const acquittement = await transport.fetch(
      POST(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { session: lot.headers.get("mcp-session-id") ?? undefined },
      ),
    );
    // sans identifiant valide, une notification ne merite ni corps ni erreur :
    // 400 sur ce fil, parce qu'elle ne peut rien signifier sans session
    expect([202, 400, 410]).toContain(acquittement.status);
  });
});

describe("un seul protocole, deux fils", () => {
  it("le contrat annonce en HTTP est mot pour mot celui du fil stdio", async () => {
    const transport = unTransport();
    const id = (await transport.fetch(POST(init()))).headers.get("mcp-session-id");
    const liste = await transport.fetch(
      POST({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { session: id }),
    );
    const attendus = OUTILS.map(({ run, ...description }) => description);
    expect((await liste.json()).result.tools).toEqual(attendus);
  });

  it("node mcp/serveur.mjs --http repond vraiment sur un port", async () => {
    const { serveur, port } = await CREER_SERVEUR_NODE({ port: 0, secret: "jeteau-essai" });
    try {
      const reponse = await fetch(`http://127.0.0.1:${port}/`, { method: "GET" });
      const corps = await reponse.json();
      expect(corps.transport).toBe("http");
      expect(corps.outils).toBe(OUTILS.length);

      const appel = await fetch(`http://127.0.0.1:${port}/`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer jeteau-essai" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });
      expect(appel.status).toBe(400); // pas de session : c'est le meme carrefour
    } finally {
      serveur.close();
    }
  });
});
