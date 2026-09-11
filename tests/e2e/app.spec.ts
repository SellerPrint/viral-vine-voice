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

/**
 * Le monteur doit être hydraté avant toute interaction avec un champ : un
 * `change` envoyé sur un input pas encore branché ne déclenche rien, et le test
 * échoue pour une raison extérieure à l'application.
 */
async function expectHydrated(page: import("@playwright/test").Page) {
  await expect(page.locator('.ed-root[data-hydrated="true"]')).toBeVisible({ timeout: 30_000 });
}

/**
 * Attend que ce soit bien le fichier importé qui tienne la scène, et non le
 * plan de démonstration chargé au premier lancement.
 *
 * « un clip visible sur la piste vidéo » ne prouve rien : la démo y pose le
 * sien, donc le test continuait sur la démo et le plan importé arrivait
 * écraser les blocs ajoutés entre-temps (six cues de la démo + un, puis
 * zéro). L'identité du plan est le seul signal sans ambiguïté.
 */
async function expectImportedClip(page: import("@playwright/test").Page) {
  await expect(page.locator(".ed-project-name")).toHaveValue("clip", { timeout: 30_000 });
  await expect(page.locator('[data-lane="video"] .ed-clip')).toHaveCount(1);
  await expect(page.locator(".ed-topbar")).toContainText("clip.mp4");
}

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

  // Le monteur s'hydrate puis charge la démo ; `networkidle` est inutilisable
  // ici (l'atelier décode des vignettes en continu). On attend donc le marqueur
  // d'hydratation posé par l'application elle-même.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expectHydrated(page);

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

  await expect(page.getByTestId("notice")).toContainText(/trop lourd/i, { timeout: 30_000 });
});

test("un plan importé entre dans le monteur", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expectHydrated(page);

  // Vraie vidéo H.264 : un buffer vide était rejeté au décodage, et la piste
  // restait vide sans qu'aucun message ne l'explique.
  await page.locator('input[type="file"]').setInputFiles(CLIP);

  // Le plan atterrit sur la piste vidéo, mesuré et non plus seulement « accepté » :
  // la durée et les dimensions viennent du décodage navigateur.
  await expectImportedClip(page);
});

test("« Doublage IA » ouvre la boîte sur l'onglet du doublage", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expectHydrated(page);

  // Les deux CTA de la barre supérieure ouvrent la même boîte, mais pas le
  // même onglet : cliquer « Doublage IA » pour voir « Lancer le rendu local »
  // faisait lancer un encodage sans voix en croyant lancer le doublage.
  await page.getByRole("button", { name: "Doublage IA" }).click();
  const dialog = page.locator(".ed-modal");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Lancer le doublage" })).toBeVisible();
  await expect(dialog).toContainText("Doublage en");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "Exporter" }).click();
  await expect(dialog.getByRole("button", { name: "Lancer le rendu local" })).toBeVisible();
});

test("une server function refuse un appel venu d'un autre site", async ({ page }) => {
  test.skip(Boolean(process.env.E2E_BASE_URL), "chemin source réservé au serveur de développement");

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expectHydrated(page);

  // On capture l'appel réellement émis par l'application, puis on le rejoue tel
  // quel en ne changeant que son origine. C'est exactement la distinction que
  // fait `createCsrfMiddleware` : avant son câblage, les trois variantes
  // atteignaient le handler — et un appel de transcription qui aboutit se
  // facture, même si l'attaquant ne peut pas lire la réponse.
  type Captured = { url: string; body: string | null; headers: Record<string, string> };
  const capture = new Promise<Captured>((resolve) => {
    page.on("request", (request) => {
      if (request.url().includes("_serverFn")) {
        resolve({ url: request.url(), body: request.postData(), headers: request.headers() });
      }
    });
  });

  await page.evaluate(async () => {
    // Le serveur de développement sert les modules à leur chemin source : cet
    // import n'existe que là, d'où le `test.skip` plus haut. L'identifiant passe
    // par une variable pour que TypeScript ne cherche pas à le résoudre.
    const specifier = "/src/lib/ai.functions.ts";
    const mod = (await import(specifier)) as unknown as {
      translateSegments: (input: { data: unknown }) => Promise<unknown>;
    };
    try {
      await mod.translateSegments({
        data: {
          segments: [{ text: "bonjour", start: 0, end: 1 }],
          sourceLanguage: "Français",
          targetLanguage: "Anglais",
        },
      });
    } catch {
      // Sans clé de traduction, le handler répond son message métier : c'est
      // justement la preuve que la requête est allée jusqu'à lui.
    }
  });

  const captured = await Promise.race([
    capture,
    page.waitForTimeout(15_000).then(() => {
      throw new Error("aucun appel de server function n'a été capté dans ce délai");
    }),
  ]);

  // En-têtes interdits par le client HTTP de Playwright.
  const forbidden = new Set(["host", "connection", "content-length"]);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(captured.headers)) {
    if (!forbidden.has(key.toLowerCase())) headers[key] = value;
  }
  const replay = (extra: Record<string, string>) =>
    page.request.fetch(captured.url, {
      method: "POST",
      data: captured.body,
      headers: { ...headers, ...extra },
    });

  const legit = await replay({});
  expect(legit.status()).toBe(200);
  expect(await legit.text()).toContain("Clé API de traduction manquante");

  const attaques: Array<Record<string, string>> = [
    { origin: "https://attaquant.example" },
    { "sec-fetch-site": "cross-site" },
    { referer: "https://attaquant.example/" },
  ];
  for (const extra of attaques) {
    const refused = await replay(extra);
    expect(refused.status(), `en-têtes ${JSON.stringify(extra)}`).toBe(403);
  }
});

test("la timeline se manipule : sélection, déplacement, annulation", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expectHydrated(page);
  // La démo est déjà chargée au premier lancement : on repart d'un projet vide
  // pour que le compte des blocs vienne bien du clic sur le bouton.
  await page.locator('button[title^="Nouveau projet"]').click();
  await page.getByRole("button", { name: "Ouvrir la démo", exact: false }).click();

  // Le plan de démonstration pose six blocs de sous-titres : ils servent de
  // support aux gestes, sans dépendre d'un import ni d'une clé API.
  const blocks = page.locator('[data-lane="subs"] .ed-clip');
  await expect(blocks).toHaveCount(6, { timeout: 20_000 });

  const block = blocks.first();
  const before = await block.boundingBox();
  await expect(before).not.toBeNull();

  await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
  await page.mouse.down();
  await page.mouse.move(before!.x + before!.width / 2 + 120, before!.y + before!.height / 2, {
    steps: 8,
  });
  await page.mouse.up();

  const moved = await block.boundingBox();
  // Un geste de 120 px doit déplacer le bloc d'environ 120 px : ni trois fois
  // la distance (delta cumulé à chaque image), ni rien du tout.
  expect(Math.abs(moved!.x - before!.x - 120)).toBeLessThan(12);

  await page.keyboard.press("Control+z");
  const restored = await block.boundingBox();
  expect(Math.abs(restored!.x - before!.x)).toBeLessThan(2);
});

test("le rendu local incruste la timeline et rend un fichier", async ({ page }) => {
  test.slow();

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expectHydrated(page);
  await page.locator('input[type="file"]').setInputFiles(CLIP);
  await expectImportedClip(page);
  // Le compte des cues part de zéro : posé sur la démo, le « c » suivant aurait
  // ajouté un septième bloc à un plan qui allait être remplacé.
  await expect(page.locator('[data-lane="subs"] .ed-clip')).toHaveCount(0);

  // Un sous-titre posé depuis le clavier, pour vérifier que le montage est bien
  // celui affiché et pas la seule source recopiée.
  await page.keyboard.press("c");
  await expect(page.locator('[data-lane="subs"] .ed-clip')).toHaveCount(1);

  await page.keyboard.press("Control+e");
  await page.getByRole("button", { name: "Lancer le rendu local" }).click();

  await expect(page.locator(".ed-modal video")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole("link", { name: /Télécharger le MP4/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Afficher dans la scène/ })).toBeVisible();

  // Le fichier annoncé est bien une vidéo décodable de la même durée que le
  // montage : le moteur a pu dégrader le graphe, jamais inventer un conteneur.
  const meta = await page.locator(".ed-modal video").evaluate((video) => {
    const element = video as HTMLVideoElement;
    return {
      width: element.videoWidth,
      height: element.videoHeight,
      duration: element.duration,
    };
  });
  expect(meta.width).toBeGreaterThan(0);
  expect(meta.duration).toBeGreaterThan(0.5);
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
