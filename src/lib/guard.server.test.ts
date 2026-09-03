import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `getRequestIP` / `getRequestHeader` lisent le contexte de requête TanStack,
// absent en test : on le simule pour piloter l'IP vue par le limiteur.
let currentIp = "1.1.1.1";

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => ({ signal: undefined }),
  getRequestHeader: () => undefined,
  getRequestIP: () => currentIp,
}));

const loadGuard = async () => {
  vi.resetModules();
  return import("./guard.server");
};

describe("enforceRateLimit", () => {
  beforeEach(() => {
    currentIp = "1.1.1.1";
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("laisse passer les appels sous la limite", async () => {
    const { enforceRateLimit, RATE_LIMITS } = await loadGuard();
    for (let i = 0; i < RATE_LIMITS.transcribe.limit; i++) {
      await expect(enforceRateLimit("transcribe")).resolves.not.toThrow();
    }
  });

  it("bloque au-delà de la limite", async () => {
    const { enforceRateLimit, RATE_LIMITS, RateLimitError } = await loadGuard();
    for (let i = 0; i < RATE_LIMITS.transcribe.limit; i++) await enforceRateLimit("transcribe");
    await expect(enforceRateLimit("transcribe")).rejects.toThrow(RateLimitError);
  });

  it("réautorise après la fenêtre", async () => {
    const { enforceRateLimit, RATE_LIMITS } = await loadGuard();
    for (let i = 0; i < RATE_LIMITS.transcribe.limit; i++) await enforceRateLimit("transcribe");
    vi.advanceTimersByTime(RATE_LIMITS.transcribe.windowMs + 1);
    await expect(enforceRateLimit("transcribe")).resolves.not.toThrow();
  });

  it("compte séparément chaque IP", async () => {
    const { enforceRateLimit, RATE_LIMITS } = await loadGuard();
    for (let i = 0; i < RATE_LIMITS.transcribe.limit; i++) await enforceRateLimit("transcribe");
    currentIp = "2.2.2.2";
    await expect(enforceRateLimit("transcribe")).resolves.not.toThrow();
  });

  it("compte séparément chaque endpoint", async () => {
    const { enforceRateLimit, RATE_LIMITS } = await loadGuard();
    for (let i = 0; i < RATE_LIMITS.transcribe.limit; i++) await enforceRateLimit("transcribe");
    await expect(enforceRateLimit("translate")).resolves.not.toThrow();
  });

  it("annonce un délai de réessai exploitable", async () => {
    const { enforceRateLimit, RATE_LIMITS } = await loadGuard();
    for (let i = 0; i < RATE_LIMITS.transcribe.limit; i++) await enforceRateLimit("transcribe");
    try {
      await enforceRateLimit("transcribe");
      expect.unreachable("aurait dû lever");
    } catch (error) {
      expect((error as { statusCode: number }).statusCode).toBe(429);
      expect((error as Error).message).toMatch(/minute/);
    }
  });
});

describe("consumeTtsBudget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.TTS_DAILY_CHAR_BUDGET;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.TTS_DAILY_CHAR_BUDGET;
  });

  it("laisse passer sous le budget", async () => {
    process.env.TTS_DAILY_CHAR_BUDGET = "1000";
    const { consumeTtsBudget } = await loadGuard();
    await expect(consumeTtsBudget(500)).resolves.not.toThrow();
    await expect(consumeTtsBudget(400)).resolves.not.toThrow();
  });

  it("bloque le dépassement, y compris depuis une autre IP", async () => {
    process.env.TTS_DAILY_CHAR_BUDGET = "1000";
    const { consumeTtsBudget, BudgetExceededError } = await loadGuard();
    await consumeTtsBudget(900);
    currentIp = "9.9.9.9";
    await expect(consumeTtsBudget(200)).rejects.toThrow(BudgetExceededError);
  });

  it("ne décompte rien quand l'appel est refusé", async () => {
    process.env.TTS_DAILY_CHAR_BUDGET = "1000";
    const { consumeTtsBudget } = await loadGuard();
    await consumeTtsBudget(900);
    await expect(consumeTtsBudget(200)).rejects.toThrow();
    // Le refus n'a pas consommé : il reste 100 caractères.
    await expect(consumeTtsBudget(100)).resolves.not.toThrow();
  });

  it("repart à zéro après 24 h", async () => {
    process.env.TTS_DAILY_CHAR_BUDGET = "1000";
    const { consumeTtsBudget } = await loadGuard();
    await consumeTtsBudget(1000);
    await expect(consumeTtsBudget(1)).rejects.toThrow();
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    await expect(consumeTtsBudget(1000)).resolves.not.toThrow();
  });

  it("retombe sur la valeur par défaut si la variable est invalide", async () => {
    process.env.TTS_DAILY_CHAR_BUDGET = "pas-un-nombre";
    const { consumeTtsBudget } = await loadGuard();
    await expect(consumeTtsBudget(1_000_000)).resolves.not.toThrow();
  });
});

describe("verifyTurnstile", () => {
  const ENV_KEYS = ["TURNSTILE_SECRET_KEY", "VERCEL_ENV", "NODE_ENV", "CF_PAGES", "NETLIFY"];
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("laisse passer en local quand la clé est absente", async () => {
    const { verifyTurnstile } = await loadGuard();
    await expect(verifyTurnstile(undefined)).resolves.toBeUndefined();
  });

  it("refuse de servir en production sans clé", async () => {
    process.env.VERCEL_ENV = "production";
    const { verifyTurnstile } = await loadGuard();
    await expect(verifyTurnstile("un-token")).rejects.toThrow(/TURNSTILE_SECRET_KEY/);
  });

  it("exige un jeton quand la clé est configurée", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    const { verifyTurnstile } = await loadGuard();
    await expect(verifyTurnstile(undefined)).rejects.toThrow(/anti-robot/);
  });

  it("rejette un jeton invalide", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ success: false }) } as Response),
    );
    const { verifyTurnstile } = await loadGuard();
    await expect(verifyTurnstile("mauvais")).rejects.toThrow(/échouée/);
    vi.unstubAllGlobals();
  });

  it("ne revérifie pas un jeton déjà validé", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const { verifyTurnstile } = await loadGuard();
    await verifyTurnstile("bon-token");
    await verifyTurnstile("bon-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
