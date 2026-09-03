import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * Parcours de base.
 *
 * Ces cas visent ce que les tests unitaires ne peuvent pas voir : le bundle
 * réellement servi au navigateur, les erreurs de console au chargement, et le
 * comportement de l'interface face à un vrai fichier.
 */

const CLIP = fileURLToPath(new URL("./fixtures/clip.mp4", import.meta.url));

test("la page se charge sans erreur de console", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();

  // Plusieurs incidents passés (import `blob:` bloqué par la CSP, module
  // dynamique introuvable) se manifestaient exactement ainsi : une page qui
  // s'affiche, mais une erreur au chargement du moteur vidéo.
  expect(errors, `erreurs console : ${errors.join(" | ")}`).toHaveLength(0);
});

test("le bundle client ne contient aucun secret serveur", async ({ page }) => {
  const scripts: string[] = [];

  // On écoute AVANT la navigation, et on lit le corps une fois la réponse
  // terminée : lire pendant le chargement renvoyait un tableau vide.
  // On filtre sur le type de ressource, pas sur l'extension : en
  // developpement Vite sert les modules sans suffixe `.js`, et le test ne
  // capturait alors aucun script.
  page.on("requestfinished", async (request) => {
    if (request.resourceType() !== "script") return;
    const response = await request.response();
    if (!response || response.status() !== 200) return;
    scripts.push(await response.text().catch(() => ""));
  });

  await page.goto("/", { waitUntil: "networkidle" });

  expect(scripts.length, "aucun script capturé").toBeGreaterThan(0);
  const joined = scripts.join("\n");

  // Une clé serveur qui fuite dans le bundle est exploitable par n'importe
  // quel visiteur : c'est le genre de régression qu'un refactor introduit
  // sans que rien d'autre ne le signale.
  for (const secret of [
    "ELEVENLABS_API_KEY",
    "GEMINI_API_KEY",
    "TURNSTILE_SECRET_KEY",
    "AI33_API_KEY",
    "KV_REST_API_TOKEN",
  ]) {
    expect(joined, `${secret} ne doit pas apparaître côté client`).not.toContain(secret);
  }
});

test("les en-têtes de sécurité sont servis", async ({ page }) => {
  // `vercel.json` n'est appliqué que par la plateforme : le serveur de
  // développement ne sert pas ces en-têtes. Le cas n'a donc de sens que
  // contre un déploiement réel.
  test.skip(!process.env.E2E_BASE_URL, "nécessite E2E_BASE_URL (déploiement réel)");

  const response = await page.goto("/");
  const headers = response?.headers() ?? {};

  // La CSP a déjà cassé Turnstile et le chargement de ffmpeg.wasm : vérifier
  // sa présence évite qu'une refonte du déploiement la fasse disparaître.
  expect(headers["content-security-policy"]).toBeTruthy();
  expect(headers["content-security-policy"]).toContain("challenges.cloudflare.com");
  expect(headers["x-content-type-options"]).toBe("nosniff");
});

test("un fichier trop lourd est refusé avec un message explicite", async ({ page }) => {
  // Allouer 61 Mo dans la page pendant que Vite compile encore ses modules a
  // deja fait depasser le delai par defaut sur une machine chargee.
  test.slow();

  // `networkidle` : sans hydratation terminee, le gestionnaire React n'est pas
  // encore attache au champ et l'evenement `change` part dans le vide.
  await page.goto("/", { waitUntil: "networkidle" });

  const input = page.locator('input[type="file"]');
  await expect(input).toBeAttached();

  // Playwright refuse un buffer de plus de 50 Mo : le fichier est donc
  // fabriqué côté navigateur, ce qui emprunte exactement le même chemin.
  //
  // On déclare une taille de 61 Mo au lieu d'allouer 61 Mo réels : le
  // garde-fou de l'application lit `file.size`, c'est donc bien lui qu'on
  // exerce. Allouer pour de vrai faisait mourir l'onglet dans les
  // environnements à mémoire contrainte — un « Target crashed » trompeur,
  // qui ressemble à un bug applicatif alors que le test seul est en cause.
  await page.evaluate(() => {
    const input = document.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("champ fichier introuvable");
    const file = new File([new Uint8Array(1024)], "trop-lourd.mp4", { type: "video/mp4" });
    Object.defineProperty(file, "size", { value: 61 * 1024 * 1024 });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await expect(page.getByText(/trop lourd/i)).toBeVisible({ timeout: 30_000 });
});

test("une vidéo valide est acceptée et ouvre les réglages", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  // Vraie vidéo H.264 : un buffer vide était rejeté au décodage, et le
  // panneau ne s'ouvrait jamais.
  await page.locator('input[type="file"]').setInputFiles(CLIP);

  // Le panneau de réglages n'apparaît qu'une fois la vidéo importée : c'est
  // ce montage tardif qui avait empêché le widget Turnstile de se rendre.
  await expect(page.getByText(/Sous-titres FR/i)).toBeVisible({ timeout: 30_000 });
});

test("la page est isolée cross-origin (SharedArrayBuffer disponible)", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  // Sans isolation, le navigateur retire `SharedArrayBuffer` et le cœur
  // FFmpeg multi-thread ne peut pas se charger : le rendu retomberait
  // silencieusement sur le cœur mono-thread, bien plus lent. Ce test échoue
  // donc si les en-têtes COOP/COEP disparaissent d'un côté ou de l'autre.
  const isolated = await page.evaluate(() => ({
    crossOriginIsolated: globalThis.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
  }));

  expect(isolated).toEqual({ crossOriginIsolated: true, sharedArrayBuffer: true });
});

test("/api/health rapporte l'état du stockage partagé", async ({ request }) => {
  const response = await request.get("/api/health");
  const body = (await response.json()) as {
    status: string;
    kv: { backend: string; reachable: boolean | null };
  };

  // En local sans KV configuré, l'état attendu est « degraded / memory » :
  // c'est justement ce que la route doit rendre visible plutôt que de le
  // taire. Contre un déploiement réel (E2E_BASE_URL), on exige « ok ».
  if (process.env.E2E_BASE_URL) {
    expect(body.kv.backend).toBe("redis");
    expect(body.kv.reachable).toBe(true);
    expect(response.status()).toBe(200);
  } else {
    expect(["redis", "memory"]).toContain(body.kv.backend);
    expect([200, 503]).toContain(response.status());
  }

  // Le diagnostic ne doit jamais divulguer les identifiants.
  const raw = JSON.stringify(body);
  expect(raw).not.toContain("upstash.io");
  expect(raw).not.toMatch(/Bearer|KV_REST_API_TOKEN=/);
});

test("le moteur vidéo se charge effectivement", async ({ page }) => {
  // Régression vécue en production : avec `@ffmpeg/core-mt`, `ff.load()`
  // n'échouait pas — il attendait indéfiniment un `ffmpeg-core.worker.js`
  // introuvable (le bundler renomme les fichiers avec une empreinte). Le
  // rendu restait figé sur « Chargement du moteur vidéo » à 0 %, sans la
  // moindre erreur en console. Aucun test unitaire n'aurait vu ça : seul le
  // chargement réel dans un navigateur le révèle.
  // Le module est importé par son chemin source, que seul le serveur de dev
  // expose : contre un déploiement (E2E_BASE_URL) les sources sont bundlées
  // et ce chemin n'existe pas. Le test d'import vidéo, lui, couvre la prod.
  test.skip(Boolean(process.env.E2E_BASE_URL), "chemin source absent d'un build");
  test.slow();
  await page.goto("/", { waitUntil: "networkidle" });

  const result = await page.evaluate(async () => {
    // Le chemin est résolu par le serveur de dev, pas par TypeScript : il
    // passe par une variable pour que `tsc` ne tente pas de le résoudre.
    const specifier = "/src/lib/video/ffmpeg-client.ts";
    const mod = (await import(specifier)) as {
      getFfmpeg: () => Promise<unknown>;
      isMultiThread: () => boolean;
    };
    const ffmpeg = await Promise.race([
      mod.getFfmpeg(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout 60s")), 60_000)),
    ]);
    return { loaded: Boolean(ffmpeg), multiThread: mod.isMultiThread() };
  });

  expect(result.loaded).toBe(true);
  // Le cœur multi-thread est volontairement désactivé : voir la note sur
  // `canUseMultiThread()`. Ce test échouera si quelqu'un le réactive sans
  // avoir d'abord réglé la résolution du worker.
  expect(result.multiThread).toBe(false);
});
