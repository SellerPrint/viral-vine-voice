import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetMemoryKv,
  incrementBy,
  incrementCounter,
  kvBackend,
  kvGet,
  kvSet,
} from "./kv.server";

describe("kvBackend", () => {
  const saved = { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN };

  afterEach(() => {
    process.env.KV_REST_API_URL = saved.url;
    process.env.KV_REST_API_TOKEN = saved.token;
    vi.unstubAllGlobals();
    __resetMemoryKv();
  });

  it("retombe en mémoire sans configuration", () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    expect(kvBackend()).toBe("memory");
  });

  it("bascule sur Redis dès que les deux variables sont présentes", () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io";
    process.env.KV_REST_API_TOKEN = "jeton";
    expect(kvBackend()).toBe("redis");
  });

  it("exige les DEUX variables : une URL seule ne suffit pas", () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io";
    delete process.env.KV_REST_API_TOKEN;
    expect(kvBackend()).toBe("memory");
  });
});

describe("incrementCounter (mémoire)", () => {
  beforeEach(() => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    __resetMemoryKv();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("compte les appels successifs sur la même clé", async () => {
    expect((await incrementCounter("k", 1000)).count).toBe(1);
    expect((await incrementCounter("k", 1000)).count).toBe(2);
    expect((await incrementCounter("k", 1000)).count).toBe(3);
  });

  it("isole les clés distinctes", async () => {
    await incrementCounter("a", 1000);
    await incrementCounter("a", 1000);
    expect((await incrementCounter("b", 1000)).count).toBe(1);
  });

  it("repart à zéro une fois la fenêtre écoulée", async () => {
    await incrementCounter("k", 1000);
    await incrementCounter("k", 1000);
    vi.advanceTimersByTime(1001);
    expect((await incrementCounter("k", 1000)).count).toBe(1);
  });

  it("signale que le compteur n'est PAS partagé entre instances", async () => {
    // C'est la limite assumée du repli : en production sans KV, chaque
    // instance a son propre compteur, donc N instances = N × la limite.
    const result = await incrementCounter("k", 1000);
    expect(result.shared).toBe(false);
  });
});

describe("incrementBy (mémoire)", () => {
  beforeEach(() => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    __resetMemoryKv();
  });

  it("cumule les quantités", async () => {
    expect((await incrementBy("b", 100, 1000)).total).toBe(100);
    expect((await incrementBy("b", 250, 1000)).total).toBe(350);
  });

  it("accepte une quantité négative, pour rembourser un refus", async () => {
    await incrementBy("b", 500, 1000);
    expect((await incrementBy("b", -200, 1000)).total).toBe(300);
  });
});

describe("kvGet / kvSet (mémoire)", () => {
  beforeEach(() => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    __resetMemoryKv();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("relit une valeur écrite", async () => {
    await kvSet("k", "v", 1000);
    expect(await kvGet("k")).toBe("v");
  });

  it("oublie une valeur expirée", async () => {
    await kvSet("k", "v", 1000);
    vi.advanceTimersByTime(1001);
    expect(await kvGet("k")).toBeNull();
  });

  it("renvoie null pour une clé inconnue", async () => {
    expect(await kvGet("jamais-ecrite")).toBeNull();
  });
});

describe("résilience Redis", () => {
  beforeEach(() => {
    process.env.KV_REST_API_URL = "https://example.upstash.io";
    process.env.KV_REST_API_TOKEN = "jeton";
    __resetMemoryKv();
  });
  afterEach(() => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    vi.unstubAllGlobals();
  });

  it("bascule en mémoire si Redis est injoignable, plutôt que de tout refuser", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
    );
    // Un incident du magasin ne doit pas rendre l'endpoint inutilisable :
    // mieux vaut un compteur local qu'aucune protection.
    const result = await incrementCounter("k", 1000);
    expect(result.count).toBe(1);
    expect(result.shared).toBe(false);
  });

  it("utilise la réponse de Redis quand elle arrive", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ result: 7 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    );
    const result = await incrementCounter("k", 1000);
    expect(result.count).toBe(7);
    expect(result.shared).toBe(true);
  });

  it("bascule en mémoire sur réponse HTTP en erreur", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("nope", { status: 500 }))),
    );
    const result = await incrementCounter("k", 1000);
    expect(result.shared).toBe(false);
  });
});
