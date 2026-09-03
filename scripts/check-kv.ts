/**
 * Vérifie que `KV_REST_API_URL` / `KV_REST_API_TOKEN` pointent vers une base
 * Redis REST réellement joignable.
 *
 *   bun run scripts/check-kv.ts
 *
 * Le repli mémoire de `kv.server.ts` est silencieux par conception :
 * l'application fonctionne sans KV, elle perd juste le partage d'état entre
 * instances. Ce script rend cet échec visible, avant de découvrir en
 * production que le plafond de facturation ne s'applique pas.
 */

export {}; // fait de ce fichier un module : requis pour le `await` de haut niveau

// Mêmes noms acceptés que `src/lib/kv.server.ts`.
const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

function fail(message: string, hint?: string): never {
  console.error(`\n❌ ${message}`);
  if (hint) console.error(`\n   ${hint}`);
  process.exit(1);
}

if (!url && !token) {
  fail(
    "Aucune des deux variables n'est définie.",
    "Renseignez KV_REST_API_URL et KV_REST_API_TOKEN dans .env.local,\n" +
      "   ou lancez : KV_REST_API_URL=... KV_REST_API_TOKEN=... bun run scripts/check-kv.ts",
  );
}
if (!url)
  fail(
    "KV_REST_API_TOKEN est défini mais KV_REST_API_URL manque.",
    "Les deux sont requis, sinon repli mémoire.",
  );
if (!token)
  fail(
    "KV_REST_API_URL est défini mais KV_REST_API_TOKEN manque.",
    "Les deux sont requis, sinon repli mémoire.",
  );

if (/^rediss?:\/\//.test(url)) {
  fail(
    "Cette valeur est une chaîne de connexion TCP (redis://…), pas une URL REST.",
    "C'est ce que fournit l'intégration « Redis » du Marketplace Vercel, qui\n" +
      "   n'expose pas d'API REST HTTP. Le code a besoin de l'intégration\n" +
      "   « Upstash » : supprimez la base actuelle, créez-en une chez Upstash,\n" +
      "   et vous obtiendrez une URL en https://….upstash.io",
  );
}

function originOf(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    fail(`KV_REST_API_URL n'est pas une URL valide : ${JSON.stringify(value)}`);
  }
}

const baseOrigin = originOf(url);
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:|$)/.test(url);
if (!url.startsWith("https://") && !isLocal) {
  fail(
    `KV_REST_API_URL doit être en https, reçu : ${baseOrigin}`,
    "Le jeton transite dans l'en-tête Authorization.",
  );
}

async function command(...args: (string | number)[]): Promise<unknown> {
  const response = await fetch(url as string, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });

  if (response.status === 401 || response.status === 403) {
    fail(
      `Jeton refusé (HTTP ${response.status}).`,
      "Le KV_REST_API_TOKEN ne correspond pas à cette base. Recopiez-le\n" +
        "   depuis la console (attention aux espaces en fin de valeur).",
    );
  }
  if (!response.ok) {
    fail(`La base a répondu HTTP ${response.status}.`, (await response.text()).slice(0, 300));
  }

  const payload = (await response.json()) as { result?: unknown; error?: string };
  if (payload.error) fail(`Erreur Redis : ${payload.error}`);
  return payload.result;
}

const key = `healthcheck:${Date.now()}:${Math.random().toString(36).slice(2)}`;

console.log(`\nBase   : ${baseOrigin}`);
console.log(`Jeton  : ${token.slice(0, 6)}… (${token.length} caractères)`);
console.log("\nAller-retour réel sur une clé temporaire…\n");

const started = Date.now();

try {
  await command("SET", key, "ok", "EX", 60);
  console.log("  ✓ écriture");

  const read = await command("GET", key);
  if (read !== "ok") fail(`Relecture incohérente : attendu "ok", reçu ${JSON.stringify(read)}`);
  console.log("  ✓ lecture");

  // C'est l'opération dont dépendent le rate-limit et le plafond TTS.
  const counter = `${key}:n`;
  await command("INCRBY", counter, 5);
  const total = await command("INCRBY", counter, -2);
  if (Number(total) !== 3) fail(`INCRBY incohérent : attendu 3, reçu ${JSON.stringify(total)}`);
  console.log("  ✓ incrément et remboursement");

  await command("DEL", key, counter);
  console.log("  ✓ nettoyage");
} catch (error) {
  if (error instanceof TypeError) {
    fail(
      `Base injoignable : ${error.message}`,
      `Vérifiez l'URL (${baseOrigin}) et votre accès réseau.`,
    );
  }
  throw error;
}

const elapsed = Date.now() - started;
const perCall = Math.round(elapsed / 6);

console.log(`\n✅ La base répond. ~${perCall} ms par commande (6 appels en ${elapsed} ms).`);

if (perCall > 120) {
  console.log(
    `\n⚠️  Latence élevée. Chaque vérification de rate-limit paie cet aller-retour.\n` +
      `   Une base située dans la région de vos fonctions Vercel descend typiquement sous 30 ms.`,
  );
}

console.log(
  '\nEn production, vérifiez que kvBackend() renvoie "redis" : le repli\n' +
    "mémoire ne provoque aucune erreur visible.\n",
);
