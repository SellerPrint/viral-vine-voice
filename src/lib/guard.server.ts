import { getRequest, getRequestHeader, getRequestIP } from "@tanstack/react-start/server";

/**
 * Garde-fous anti-abus des endpoints IA.
 *
 * Sans cela, les server functions constituent un proxy ElevenLabs / Gemini
 * gratuit et anonyme : n'importe qui peut les appeler en boucle depuis la
 * console du navigateur et faire exploser la facture.
 *
 * Deux couches, indépendantes et cumulables :
 *   1. Cloudflare Turnstile — bloque les appels automatisés (actif dès que
 *      `TURNSTILE_SECRET_KEY` est défini).
 *   2. Limitation de débit par IP — plafonne le volume et le coût.
 *
 * ⚠️ Le compteur est en mémoire du worker : il est réinitialisé à chaque
 * redémarrage et n'est pas partagé entre isolats. C'est un garde-fou
 * best-effort suffisant contre le script opportuniste, mais pour un plafond
 * strict il faut un stockage partagé (Cloudflare KV ou Durable Object).
 * Voir `docs/rate-limiting.md`.
 */

export type RateLimitRule = {
  /** Nombre d'appels autorisés dans la fenêtre. */
  limit: number;
  /** Durée de la fenêtre en millisecondes. */
  windowMs: number;
};

export const RATE_LIMITS = {
  transcribe: { limit: 10, windowMs: 60 * 60 * 1000 },
  translate: { limit: 30, windowMs: 60 * 60 * 1000 },
  speech: { limit: 400, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, RateLimitRule>;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Empêche la Map de croître indéfiniment sous un flux d'IP variées. */
const MAX_BUCKETS = 10_000;

function pruneExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size > MAX_BUCKETS) {
    const excess = buckets.size - MAX_BUCKETS;
    let removed = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++removed >= excess) break;
    }
  }
}

function clientKey(): string {
  const cfIp = getRequestHeader("cf-connecting-ip" as never) as string | undefined;
  if (cfIp) return cfIp;
  const ip = getRequestIP({ xForwardedFor: true });
  return ip ?? "unknown";
}

export class RateLimitError extends Error {
  readonly statusCode = 429;
  constructor(retryAfterSeconds: number) {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    super(
      `Limite d'utilisation atteinte. Réessaie dans ${minutes} minute${minutes > 1 ? "s" : ""}.`,
    );
    this.name = "RateLimitError";
  }
}

export function enforceRateLimit(scope: keyof typeof RATE_LIMITS): void {
  const rule = RATE_LIMITS[scope];
  const now = Date.now();
  pruneExpired(now);

  const key = `${scope}:${clientKey()}`;
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return;
  }

  if (bucket.count >= rule.limit) {
    throw new RateLimitError(Math.ceil((bucket.resetAt - now) / 1000));
  }

  bucket.count += 1;
}

/* ─────────────────────────── Turnstile ─────────────────────────── */

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Un jeton validé reste réutilisable le temps d'un traitement complet. */
const TOKEN_TTL_MS = 30 * 60 * 1000;
const verifiedTokens = new Map<string, number>();

export function isTurnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

export async function verifyTurnstile(token: string | undefined): Promise<void> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  // Non configuré : on laisse passer pour ne pas casser le développement local.
  // La limitation de débit reste active dans tous les cas.
  if (!secret) return;

  if (!token) {
    throw new Error("Vérification anti-robot requise. Recharge la page et réessaie.");
  }

  const now = Date.now();
  for (const [cached, expiry] of verifiedTokens) {
    if (expiry <= now) verifiedTokens.delete(cached);
  }

  const cachedExpiry = verifiedTokens.get(token);
  if (cachedExpiry && cachedExpiry > now) return;

  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  const ip = clientKey();
  if (ip !== "unknown") body.append("remoteip", ip);

  const response = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body });
  const result = (await response.json()) as { success?: boolean };

  if (!result.success) {
    throw new Error("Vérification anti-robot échouée. Recharge la page et réessaie.");
  }

  verifiedTokens.set(token, now + TOKEN_TTL_MS);
}

/** Garde commune : Turnstile puis limitation de débit. */
export async function guard(
  scope: keyof typeof RATE_LIMITS,
  turnstileToken: string | undefined,
): Promise<void> {
  await verifyTurnstile(turnstileToken);
  enforceRateLimit(scope);
}

/**
 * `AbortSignal` de la requête entrante.
 *
 * Le contexte du handler ne l'expose pas ; on le lit sur la requête pour
 * propager l'annulation client jusqu'aux appels d'API tierces et cesser de
 * consommer des crédits dès que l'utilisateur abandonne.
 */
export function requestSignal(): AbortSignal | undefined {
  try {
    return getRequest().signal;
  } catch {
    return undefined;
  }
}
