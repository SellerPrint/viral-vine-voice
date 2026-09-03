import { getRequest, getRequestHeader, getRequestIP } from "@tanstack/react-start/server";

import { incrementBy, incrementCounter, kvBackend, kvGet, kvSet } from "./kv.server";

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
 * Les compteurs vivent dans un stockage partagé (`kv.server.ts`) dès que
 * `KV_REST_API_URL` / `KV_REST_API_TOKEN` sont configurés. C'est nécessaire en
 * serverless : chaque requête pouvant atterrir sur une instance différente, un
 * compteur en mémoire donnait en pratique N × la limite pour N instances.
 * Sans configuration KV, on retombe sur la mémoire locale — suffisant en
 * développement, explicitement best-effort en production.
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
  speech: { limit: 120, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, RateLimitRule>;

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

export async function enforceRateLimit(scope: keyof typeof RATE_LIMITS): Promise<void> {
  const rule = RATE_LIMITS[scope];
  const key = `rl:${scope}:${clientKey()}`;

  const { count, resetAt } = await incrementCounter(key, rule.windowMs);

  if (count > rule.limit) {
    // Journaliser le rejet : sans trace, un abus ressemble à une panne.
    console.warn(`[guard] débit dépassé sur ${scope} (${count}/${rule.limit})`);
    throw new RateLimitError(Math.ceil((resetAt - Date.now()) / 1000));
  }
}

/* ─────────────────────────── Turnstile ─────────────────────────── */

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Un jeton validé reste réutilisable le temps d'un traitement complet.
 *
 * Stocké dans le KV partagé : en mémoire locale, le cache était toujours vide
 * sur une autre instance, et chaque appel repartait vers siteverify — qui
 * refuse un jeton déjà consommé.
 */
const TOKEN_TTL_MS = 30 * 60 * 1000;

export function isTurnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

/**
 * Vrai en production déployée (Vercel, Cloudflare, Netlify) — pas en local.
 *
 * En production, l'absence de Turnstile laisse les endpoints IA ouverts à
 * n'importe quel script : on refuse de servir plutôt que de facturer.
 */
function isProductionDeployment(): boolean {
  return (
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.CF_PAGES) ||
    Boolean(process.env.NETLIFY)
  );
}

/**
 * Cle d'idempotence stable derivee du jeton.
 *
 * Elle doit etre identique pour toutes les validations d'un meme jeton, et
 * differente d'un jeton a l'autre : un hash du jeton remplit exactement ce
 * contrat, sans etat partage entre instances.
 */
async function idempotencyKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // Format UUID v4 attendu par Cloudflare.
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

export async function verifyTurnstile(token: string | undefined): Promise<void> {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    // En production, laisser passer reviendrait à offrir un proxy ElevenLabs
    // anonyme et gratuit. On échoue explicitement plutôt que silencieusement.
    if (isProductionDeployment()) {
      throw new Error("Configuration incomplète : TURNSTILE_SECRET_KEY est requis en production.");
    }
    // En local, on laisse passer pour ne pas casser le développement.
    // La limitation de débit reste active dans tous les cas.
    return;
  }

  if (!token) {
    throw new Error("Vérification anti-robot requise. Recharge la page et réessaie.");
  }

  const cacheKey = `ts:${await idempotencyKey(token)}`;
  if (await kvGet(cacheKey)) return;

  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  const ip = clientKey();
  if (ip !== "unknown") body.append("remoteip", ip);

  // `idempotency_key` : sans elle, rejouer la validation d'un jeton deja
  // valide renvoie `timeout-or-duplicate`, car un jeton Turnstile est a usage
  // unique. Avec une cle stable derivee du jeton, Cloudflare rejoue le meme
  // resultat au lieu de refuser.
  body.append("idempotency_key", await idempotencyKey(token));

  const response = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body });
  const result = (await response.json()) as {
    success?: boolean;
    "error-codes"?: string[];
  };

  if (!result.success) {
    const codes = result["error-codes"] ?? [];

    // `timeout-or-duplicate` signifie que le jeton a deja servi ou a expire
    // (5 minutes). Sur un rendu long — transcription, traduction, puis un
    // appel de synthese par segment — c'est le cas nominal, pas une attaque.
    // Le cache en memoire ne suffit pas : sur Vercel chaque requete peut
    // atterrir sur une instance differente, avec une Map vide.
    if (codes.includes("timeout-or-duplicate")) {
      throw new Error(
        "La vérification anti-robot a expiré pendant le traitement. " +
          "Recharge la page et relance : le jeton n'est valable que 5 minutes.",
      );
    }

    console.error("[turnstile] siteverify a refusé le jeton", codes);
    throw new Error(
      `Vérification anti-robot échouée${codes.length ? ` (${codes.join(", ")})` : ""}. ` +
        `Recharge la page et réessaie.`,
    );
  }

  await kvSet(cacheKey, "1", TOKEN_TTL_MS);
}

/* ──────────────────── Plafond de dépense global ──────────────────── */

/**
 * Budget de caractères TTS pour l'ensemble du service, par fenêtre glissante.
 *
 * La limitation par IP ne borne pas la facture : elle est contournée par un
 * simple pool de proxys, et le compteur est propre à chaque isolat. Ce plafond
 * global est le seul garde-fou qui borne réellement la dépense.
 *
 * 2 000 000 caractères/jour ≈ 300 $/jour au tarif ElevenLabs Turbo — à ajuster
 * via `TTS_DAILY_CHAR_BUDGET` selon ce que vous acceptez de payer.
 *
 * Le compteur est partagé entre instances via `kv.server.ts` : c'est ce qui
 * en fait un vrai plafond de dépense et non une estimation par isolat.
 * Doublez-le malgré tout d'un plafond de facturation chez le fournisseur :
 * un incident du magasin fait retomber le compteur en mémoire locale.
 */
const DEFAULT_TTS_DAILY_CHARS = 2_000_000;

function ttsDailyBudget(): number {
  const raw = Number(process.env.TTS_DAILY_CHAR_BUDGET);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTS_DAILY_CHARS;
}

const BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Clé du compteur, tournante : une nouvelle fenêtre = une nouvelle clé. */
function budgetKey(now: number): string {
  return `tts:budget:${Math.floor(now / BUDGET_WINDOW_MS)}`;
}

export class BudgetExceededError extends Error {
  readonly statusCode = 503;
  constructor() {
    super("Le service a atteint son quota quotidien. Réessaie demain.");
    this.name = "BudgetExceededError";
  }
}

/** Décompte `chars` du budget global TTS, ou lève si le plafond est atteint. */
export async function consumeTtsBudget(chars: number): Promise<void> {
  const now = Date.now();
  const key = budgetKey(now);
  const { total } = await incrementBy(key, chars, BUDGET_WINDOW_MS);

  if (total > ttsDailyBudget()) {
    // Rendre les caracteres refuses : sinon un appel rejete amputerait quand
    // meme le budget, et une rafale d'appels trop gros condamnerait la
    // journee entiere alors qu'aucune synthese n'a eu lieu.
    await incrementBy(key, -chars, BUDGET_WINDOW_MS);
    console.warn(`[guard] plafond TTS atteint (${total}/${ttsDailyBudget()} caractères)`);
    throw new BudgetExceededError();
  }
}

/** Garde commune : Turnstile puis limitation de débit. */
export async function guard(
  scope: keyof typeof RATE_LIMITS,
  turnstileToken: string | undefined,
): Promise<void> {
  await verifyTurnstile(turnstileToken);
  await enforceRateLimit(scope);
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
