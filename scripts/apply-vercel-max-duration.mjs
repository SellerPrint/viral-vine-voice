/**
 * Relève la durée maximale des Vercel Functions produites par le build.
 *
 * Pourquoi ce script existe : `transcribeAudio` et `translateSegments` sont
 * chacun **une seule requête** — la première envoie toute la piste audio, la
 * seconde tous les segments à traduire. Vercel borne par défaut une fonction à
 * 10 s sur le plan Hobby (60 s au maximum), 15 s sur Pro : au-delà, la
 * requête est tuée en 504 et l'utilisateur voit un doublage abandonné sans
 * explication côté client.
 *
 * Nitro ne peut pas être configuré ici : le wrapper `@lovable.dev/vite-tanstack-config`
 * n'expose que `preset`/`output`/`cloudflare` (vérifié dans sa définition de
 * types), et un `nitro.config.ts` posé à la racine est ignoré par ce build.
 * `functions.maxDuration` de `vercel.json` n'est pas non plus appliqué : avec
 * la Build Output API, c'est `.vercel/output/config.json` et les
 * `.vc-config.json` qui font foi. D'où ce patch d'après-build, qui écrit la
 * valeur là où Vercel la lit.
 *
 * Sans `.vercel/output` (build Cloudflare, développement), c'est un non-événement.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Valeur par défaut : le plafond du plan Hobby, donc jamais refusé. */
const DEFAULT_SECONDS = 60;

function maxSeconds() {
  const raw = Number(process.env.VERCEL_MAX_DURATION);
  return Number.isFinite(raw) && raw >= 1 ? Math.round(raw) : DEFAULT_SECONDS;
}

/** Toutes les `.vc-config.json` du build Vercel, récursivement. */
function functionConfigs(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (!statSync(path).isDirectory()) continue;
    if (entry.endsWith(".func")) {
      const config = join(path, ".vc-config.json");
      if (existsSync(config)) found.push(config);
    } else {
      functionConfigs(path, found);
    }
  }
  return found;
}

const root = process.cwd();
const output = join(root, ".vercel", "output", "functions");
if (!existsSync(output)) {
  console.log(
    "[vercel-max-duration] pas de .vercel/output : build pour une autre plateforme, rien à faire.",
  );
  process.exit(0);
}

const seconds = maxSeconds();
const configs = functionConfigs(output);
if (configs.length === 0) {
  console.log("[vercel-max-duration] aucune fonction trouvée dans .vercel/output.");
  process.exit(0);
}

for (const path of configs) {
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (typeof config.maxDuration === "number") {
    console.log(
      `[vercel-max-duration] ${path} : déjà à ${config.maxDuration} s, on n'y touche pas.`,
    );
    continue;
  }
  // Clé documentée par la Build Output API (`ServerlessFunctionConfig`).
  config.maxDuration = seconds;
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`[vercel-max-duration] ${path} : maxDuration = ${seconds} s.`);
}
