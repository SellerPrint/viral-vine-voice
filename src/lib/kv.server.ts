/**
 * Stockage partagé entre instances, avec repli en mémoire.
 *
 * Pourquoi ce module existe : sur Vercel, chaque requête peut être servie par
 * une instance différente, avec sa propre mémoire. Trois garde-fous en
 * dépendaient et étaient donc largement illusoires en production :
 *
 *   - la limitation de débit par IP  → N instances = N × la limite ;
 *   - le plafond de dépense TTS      → ne bornait pas réellement la facture ;
 *   - le cache de jetons Turnstile   → toujours vide sur une autre instance.
 *
 * L'implémentation Redis est activée dès que `KV_REST_API_URL` et
 * `KV_REST_API_TOKEN` sont présents (Vercel KV, Upstash). Sinon on retombe sur
 * la mémoire locale : le développement reste fonctionnel sans dépendance, et
 * le comportement est identique à l'existant.
 *
 * On parle à l'API REST directement plutôt que via un SDK : deux appels
 * suffisent (`INCR`+`EXPIRE`, `SET NX`), et cela évite d'ajouter une
 * dépendance de production à une base de code qui n'en a presque pas.
 */

export type KvBackend = "redis" | "memory";

type MemoryEntry = { value: string; expiresAt: number };

const memory = new Map<string, MemoryEntry>();

/** Empêche la Map de croître indéfiniment sous un flux de clés variées. */
const MAX_MEMORY_KEYS = 10_000;

function pruneMemory(now: number): void {
  for (const [key, entry] of memory) {
    if (entry.expiresAt <= now) memory.delete(key);
  }
  if (memory.size > MAX_MEMORY_KEYS) {
    const excess = memory.size - MAX_MEMORY_KEYS;
    let removed = 0;
    for (const key of memory.keys()) {
      memory.delete(key);
      if (++removed >= excess) break;
    }
  }
}

function redisConfig(): { url: string; token: string } | null {
  // Deux jeux de noms coexistent selon la façon dont la base a été créée :
  // l'intégration Upstash du Marketplace Vercel injecte `KV_REST_API_*`,
  // tandis qu'une base créée directement sur console.upstash.com expose
  // `UPSTASH_REDIS_REST_*`. On accepte les deux pour éviter un repli mémoire
  // silencieux dû au seul nom de la variable.
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  // `REDIS_URL` (protocole TCP `redis://`) n'est pas utilisable ici : ce
  // module parle l'API REST en HTTP. L'intégration « Redis » du Marketplace
  // Vercel ne fournit que cette forme-là ; il faut l'intégration Upstash.
  if (!/^https?:\/\//.test(url)) {
    console.error(
      "[kv] URL non REST ignorée (attendu https://…, reçu un schéma TCP). " +
        "Utilisez l'intégration Upstash, pas une chaîne redis:// .",
    );
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

/** Backend réellement utilisé, exposé pour le diagnostic et les tests. */
export function kvBackend(): KvBackend {
  return redisConfig() ? "redis" : "memory";
}

/**
 * Exécute une commande Redis via l'API REST.
 *
 * Renvoie `null` en cas d'échec réseau plutôt que de lever : un incident du
 * magasin ne doit pas rendre le service indisponible. Les appelants décident
 * eux-mêmes s'ils préfèrent laisser passer ou refuser.
 */
async function redisCommand(command: (string | number)[]): Promise<unknown | null> {
  const config = redisConfig();
  if (!config) return null;

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      // Un magasin lent ne doit pas bloquer la requête utilisateur.
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) {
      console.error("[kv] réponse inattendue", response.status, command[0]);
      return null;
    }
    const payload = (await response.json()) as { result?: unknown };
    return payload.result ?? null;
  } catch (error) {
    console.error("[kv] commande échouée", command[0], error);
    return null;
  }
}

/**
 * Incrémente un compteur et renvoie sa valeur, en posant un TTL au premier
 * incrément.
 *
 * C'est l'opération atomique dont dépend la limitation de débit : lire puis
 * écrire séparément laisserait passer des requêtes concurrentes.
 */
export async function incrementCounter(
  key: string,
  windowMs: number,
): Promise<{ count: number; resetAt: number; shared: boolean }> {
  const now = Date.now();
  const ttlSeconds = Math.ceil(windowMs / 1000);

  if (redisConfig()) {
    const count = await redisCommand(["INCR", key]);
    if (typeof count === "number") {
      // EXPIRE uniquement au premier passage : sinon la fenêtre glisserait
      // indéfiniment et la limite ne se réinitialiserait jamais.
      if (count === 1) await redisCommand(["EXPIRE", key, ttlSeconds]);

      const ttl = await redisCommand(["TTL", key]);
      const remainingMs = typeof ttl === "number" && ttl > 0 ? ttl * 1000 : windowMs;
      return { count, resetAt: now + remainingMs, shared: true };
    }
    // Redis injoignable : on bascule sur la mémoire plutôt que de laisser
    // l'endpoint sans aucune protection.
  }

  pruneMemory(now);
  const existing = memory.get(key);
  if (!existing || existing.expiresAt <= now) {
    memory.set(key, { value: "1", expiresAt: now + windowMs });
    return { count: 1, resetAt: now + windowMs, shared: false };
  }
  const count = Number(existing.value) + 1;
  existing.value = String(count);
  return { count, resetAt: existing.expiresAt, shared: false };
}

/**
 * Ajoute `amount` à un compteur cumulatif et renvoie le total.
 *
 * Utilisé par le plafond de dépense : contrairement au compteur de requêtes,
 * l'unité n'est pas l'appel mais le caractère synthétisé.
 */
export async function incrementBy(
  key: string,
  amount: number,
  windowMs: number,
): Promise<{ total: number; shared: boolean }> {
  const now = Date.now();
  const ttlSeconds = Math.ceil(windowMs / 1000);

  if (redisConfig()) {
    const total = await redisCommand(["INCRBY", key, amount]);
    if (typeof total === "number") {
      if (total === amount) await redisCommand(["EXPIRE", key, ttlSeconds]);
      return { total, shared: true };
    }
  }

  pruneMemory(now);
  const existing = memory.get(key);
  if (!existing || existing.expiresAt <= now) {
    memory.set(key, { value: String(amount), expiresAt: now + windowMs });
    return { total: amount, shared: false };
  }
  const total = Number(existing.value) + amount;
  existing.value = String(total);
  return { total, shared: false };
}

/** Lit une valeur, ou `null` si absente ou expirée. */
export async function kvGet(key: string): Promise<string | null> {
  if (redisConfig()) {
    const value = await redisCommand(["GET", key]);
    if (typeof value === "string") return value;
    if (value === null) return null;
  }

  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.expiresAt <= now) return null;
  return entry.value;
}

/** Écrit une valeur avec expiration. */
export async function kvSet(key: string, value: string, ttlMs: number): Promise<void> {
  if (redisConfig()) {
    const ok = await redisCommand(["SET", key, value, "PX", Math.ceil(ttlMs)]);
    if (ok !== null) return;
  }

  const now = Date.now();
  pruneMemory(now);
  memory.set(key, { value, expiresAt: now + ttlMs });
}

/** Vide le stockage mémoire. Exposé pour les tests uniquement. */
export function __resetMemoryKv(): void {
  memory.clear();
}
