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

  const input = page.locator("#ed-import-plan");
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
    const input = document.querySelector("#ed-import-plan");
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
  await page.locator("#ed-import-plan").setInputFiles(CLIP);

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
  // Le bloc doit être dans la partie visible de la timeline avant qu'une
  // souris ne vienne le saisir : hors du cadre, `mouse.down` n'appuie sur
  // rien et le geste n'échoue pas — il ne fait tout simplement rien.
  await block.scrollIntoViewIfNeeded();
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
  await page.locator("#ed-import-plan").setInputFiles(CLIP);
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

/* --------------------------------------------------------------------------
   Manipulation des zones et lisibilité de l'atelier
   --------------------------------------------------------------------------
   Deux retours venus du déploiement réel, sur un portable à 1568 × 882 et
   Windows à 100 % : « les éléments ne se déplacent pas avec les poignées » et
   « tout est petit, peu visible ». Aucun des deux ne se voyait à 1280 px sur
   un plan bien plus grand que la zone à régler — d'où des cas explicites,
   mesurés dans le navigateur, sur la taille réelle des cibles.
   -------------------------------------------------------------------------- */

/** Charge la démo et attend que les zones floutables soient en place. */
async function openDemoWithMasks(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1568, height: 882 });
  await page.goto("/", { waitUntil: "networkidle" });
  await expectHydrated(page);
  await expect(page.locator(".ed-mask").first()).toBeVisible({ timeout: 30_000 });
}

test("chaque poignée d'une zone est atteignable là où elle s'affiche", async ({ page }) => {
  await openDemoWithMasks(page);

  // Régression vécue : les cibles étaient centrées SUR le bord de la zone, donc
  // à moitié dehors, et le cadre rognait (`overflow: hidden`). Une zone collée
  // en haut ou à droite perdait ses poignées — invisibles, donc ingérables.
  // Pire : égales dans les huit directions, elles recouvraient le centre d'un
  // petit rectangle et le glissement du corps saisissait une voisine.
  const report = await page.evaluate(() => {
    // On mesure la visibilité dans la scène, pas dans le cadre : les poignées
    // sont volontairement à cheval sur les bords de la zone, donc à moitié
    // dehors. Ce qui ne doit pas arriver, c'est qu'elles sortent de la surface
    // affichée — `.ed-stage-canvas` rogne, et une poignée rognée est une
    // poignée que personne ne trouve.
    const frame = document.querySelector(".ed-stage-canvas")?.getBoundingClientRect();
    if (!frame) return null;
    const zones = [...document.querySelectorAll(".ed-mask")];
    return zones.map((zone) => {
      const handles = [...zone.querySelectorAll<HTMLElement>(".ed-mask-handle")];
      return {
        total: handles.length,
        horsCadre: handles.filter((h) => {
          const r = h.getBoundingClientRect();
          return (
            r.left < frame.left - 0.5 ||
            r.right > frame.right + 0.5 ||
            r.top < frame.top - 0.5 ||
            r.bottom > frame.bottom + 0.5
          );
        }).length,
        detournees: handles.filter((h) => {
          const r = h.getBoundingClientRect();
          return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) !== h;
        }).length,
        cote: handles.length ? Math.round(handles[0].getBoundingClientRect().width) : 0,
      };
    });
  });

  expect(report).not.toBeNull();
  for (const zone of report!) {
    expect(zone.total).toBe(8);
    expect(zone.cote).toBeGreaterThanOrEqual(13); // une cible, pas un pixel
    expect(zone.horsCadre, "une poignée hors de la scène est ingérable").toBe(0);
    expect(zone.detournees).toBe(0);
  }
});

test("glisser une zone la déplace d'autant que la souris, poignée par poignée", async ({
  page,
}) => {
  await openDemoWithMasks(page);

  const style = () =>
    page.evaluate(() => {
      const s = document.querySelectorAll<HTMLElement>(".ed-mask")[1].style;
      return {
        left: parseFloat(s.left),
        top: parseFloat(s.top),
        w: parseFloat(s.width),
        h: parseFloat(s.height),
      };
    });

  const drag = async (from: { x: number; y: number }, dx: number, dy: number) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  };

  const box = await page.locator(".ed-mask").nth(1).boundingBox();
  expect(box).toBeTruthy();
  const centre = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };

  // Corps de la zone : translation 1:1. La scène a la largeur du plan, donc
  // 60 px à l'écran valent 60 / largeur × 100 pourcents en base de scène.
  // Un pourcentage de zone se lit sur l'axe correspondant du plan : largeur
  // pour x, hauteur pour y. Les confondre est l'erreur classique, et c'est
  // justement ce que ces deux lignes vérifient dans l'autre sens.
  const plan = await page.evaluate(() => {
    const r = document.querySelector(".ed-frame")?.getBoundingClientRect();
    return { w: r?.width ?? 0, h: r?.height ?? 0 };
  });
  const avant = await style();
  await drag(centre, 60, 40);
  const apres = await style();
  expect(Math.abs(apres.left - avant.left - (60 / plan.w) * 100)).toBeLessThan(1.5);
  expect(Math.abs(apres.top - avant.top - (40 / plan.h) * 100)).toBeLessThan(1.5);
  expect(apres.w).toBeCloseTo(avant.w, 1); // bouger ne redimensionne pas

  // Les huit poignées commandent leur bord, sans exception.
  for (const coin of ["n", "s", "e", "w", "nw", "ne", "sw", "se"]) {
    const cible = await page.evaluate((name) => {
      const zone = document.querySelectorAll<HTMLElement>(".ed-mask")[1];
      zone.style.left = "8%";
      zone.style.top = "24%";
      zone.style.width = "26%";
      zone.style.height = "10%";
      const h = [...zone.querySelectorAll<HTMLElement>(".ed-mask-handle")].find(
        (x) => x.dataset.corner === name,
      )!;
      const r = h.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, coin);
    // Style posé à la main : seul le geste doit le défaire, on repart donc de
    // l'état du plan (le reducer ignore un style écrit dans le DOM).
    await page.locator(".ed-mask").nth(1).click();
    const etat = await style();
    await drag(
      cible,
      coin.includes("w") ? -16 : coin.includes("e") ? 16 : 0,
      coin.includes("n") ? -14 : coin.includes("s") ? 14 : 0,
    );
    const apresPoignee = await style();
    const horizontal = coin.includes("w") || coin.includes("e");
    const aBouge = horizontal
      ? Math.abs(apresPoignee.w - etat.w) > 0.5
      : Math.abs(apresPoignee.h - etat.h) > 0.5;
    expect(aBouge, `la poignée ${coin} doit commander son bord`).toBe(true);
  }
});

test("une zone collée au bord se règle à 0 % sans être repoussée", async ({ page }) => {
  await openDemoWithMasks(page);

  // Le champ de position appliquait un plancher de taille (2 %) : impossible
  // d'aligner un logo sur le bord gauche, la valeur sautait d'elle-même à 2.
  await page.locator(".ed-mask").nth(2).click();
  const champ = page.locator('label:has-text("X %") input').first();
  await expect(champ).toBeVisible();
  await champ.fill("0");
  await champ.press("Enter");
  await page.waitForTimeout(250);

  // Tant que le champ garde le focus il montre ce qui a été tapé ; la valeur
  // reformatée n'arrive qu'à la sortie du champ.
  await champ.blur();
  await expect(champ).toHaveValue("0.00");
  const left = await page.evaluate(() =>
    parseFloat(document.querySelectorAll<HTMLElement>(".ed-mask")[2].style.left),
  );
  expect(left).toBe(0);
});

test("la densité de l'interface se règle, se retient, et F rend le plan lisible", async ({
  page,
}) => {
  await openDemoWithMasks(page);

  const tailleTexte = () =>
    page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".ed-root")!).fontSize));

  await page
    .locator('.ed-inspector button[title="Afficher l\'inspecteur"], .ed-topbar .ed-seg-btn')
    .first();
  await page.locator(".ed-inspector button", { hasText: "Projet" }).first().click();
  await page.locator(".ed-inspector button", { hasText: "Grande" }).click();
  await page.waitForTimeout(250);
  expect(await page.getAttribute(".ed-root", "data-ui")).toBe("large");
  expect(await tailleTexte()).toBeGreaterThan(15);

  // Choix durable : un monteur qui règle son confort ne le règle pas deux fois.
  await page.reload({ waitUntil: "networkidle" });
  await expectHydrated(page);
  await expect(page.locator(".ed-root")).toHaveAttribute("data-ui", "large");

  // Et surtout : sur un plan vertical, ce qui manque c'est de la hauteur. Le
  // repli des volets et de la timeline doit donc agrandir le plan, pas seulement
  // dégager la place sur les côtés.
  await page.locator(".ed-root").click({ position: { x: 8, y: 8 } });
  const avant = await page.evaluate(
    () => document.querySelector(".ed-frame")?.getBoundingClientRect().height ?? 0,
  );
  await page.keyboard.press("f");
  await page.waitForTimeout(400);
  const apres = await page.evaluate(
    () => document.querySelector(".ed-frame")?.getBoundingClientRect().height ?? 0,
  );
  expect(apres).toBeGreaterThan(avant * 1.3);
  await page.keyboard.press("f");
  await page.waitForTimeout(300);
  await expect(page.locator(".ed-timeline")).toBeVisible();
});

test("la hauteur de la timeline se tire par son bord et rend de la place au plan", async ({
  page,
}) => {
  await openDemoWithMasks(page);

  // Sur un plan vertical, l'aperçu est contraint en hauteur : le seul moyen de
  // l'agrandir vraiment est de disputer de la hauteur à la timeline. C'est ce
  // que fait le bord de reprise, et c'est ce que ce cas mesure — en pixels de
  // plan gagnés, pas en présence d'un élément de plus.
  const mesures = () =>
    page.evaluate(() => ({
      timeline: Math.round(
        document.querySelector(".ed-timeline")?.getBoundingClientRect().height ?? 0,
      ),
      plan: Math.round(document.querySelector(".ed-frame")?.getBoundingClientRect().height ?? 0),
    }));

  const avant = await mesures();
  expect(avant.timeline).toBeGreaterThan(150);

  const poignee = await page.locator(".ed-tl-resize").boundingBox();
  expect(poignee).toBeTruthy();
  // Vers le bas : la timeline se replie et rend sa hauteur au plan.
  await page.mouse.move(poignee!.x + poignee!.width / 2, poignee!.y + 5);
  await page.mouse.down();
  await page.mouse.move(poignee!.x + poignee!.width / 2, poignee!.y + 5 + 90, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const serre = await mesures();
  expect(avant.timeline - serre.timeline).toBeGreaterThan(70);
  expect(serre.plan - avant.plan).toBeGreaterThan(50);

  // Réglage durable, puis retour à l'automatique par double-clic.
  await page.reload({ waitUntil: "networkidle" });
  await expectHydrated(page);
  await expect
    .poll(async () => (await mesures()).timeline, { timeout: 15_000 })
    .toBeLessThan(avant.timeline - 50);

  await page.locator(".ed-tl-resize").dblclick();
  await page.waitForTimeout(300);
  const apresDoubleClic = await mesures();
  expect(apresDoubleClic.timeline).toBeGreaterThan(serre.timeline + 20);
});

/* --------------------------------------------------------------------------
   Déposer un plan, reprendre plusieurs blocs, voir la légende suivre le cadre
   -------------------------------------------------------------------------- */

const fixtureVideo = fileURLToPath(new URL("./fixtures/clip.mp4", import.meta.url));

test("déposer un plan n'importe où dans la fenêtre l'importe vraiment", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.goto("/", { waitUntil: "networkidle" });
  await expectHydrated(page);
  await expect(page.locator(".ed-mask").first()).toBeVisible({ timeout: 30_000 });
  const nomInitial = await page.locator(".ed-project-name").inputValue();

  const data = await import("node:fs").then((fs) =>
    fs.readFileSync(fixtureVideo).toString("base64"),
  );

  // Le filetage du geste d'abord : survoler doit ouvrir le bandeau de dépôt.
  await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bin], "plan-depose.mp4", { type: "video/mp4" }));
    const cible = document.querySelector(".ed-stage")!;
    cible.dispatchEvent(
      new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
    cible.dispatchEvent(
      new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
    (window as unknown as { __transfert: DataTransfer }).__transfert = transfer;
  }, data);
  await expect(page.locator(".ed-drop-overlay")).toBeVisible();

  await page.evaluate(() => {
    const cible = document.querySelector(".ed-stage")!;
    const transfer = (window as unknown as { __transfert: DataTransfer }).__transfert;
    cible.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  });

  // Le plan déposé tient la scène, et le bandeau s'efface avec le geste.
  await expect(page.locator(".ed-project-name")).not.toHaveValue(nomInitial, { timeout: 30_000 });
  await expect(page.locator(".ed-project-name")).toHaveValue("plan-depose");
  await expect(page.locator(".ed-drop-overlay")).toHaveCount(0);
});

test("la marée et Maj-clic reprennent plusieurs blocs, qui se déplacent ensemble", async ({
  page,
}) => {
  await openDemoWithMasks(page);

  const blocs = page.locator('[data-lane="subs"] .ed-clip');
  await expect(blocs).toHaveCount(6);
  const selectionnes = () => page.locator('[data-lane="subs"] .ed-clip.is-selected').count();

  // Maj-clic ajoute à la sélection, sans la remplacer.
  await blocs.nth(1).click();
  expect(await selectionnes()).toBe(1);
  await blocs.nth(2).click({ modifiers: ["Shift"] });
  expect(await selectionnes()).toBe(2);

  const avant = await Promise.all([1, 2].map(async (i) => (await blocs.nth(i).boundingBox())!.x));

  // Glisser l'un des deux déplace les deux du même écart.
  const tenu = await blocs.nth(1).boundingBox();
  await page.mouse.move(tenu!.x + tenu!.width / 2, tenu!.y + tenu!.height / 2);
  await page.mouse.down();
  await page.mouse.move(tenu!.x + tenu!.width / 2 + 60, tenu!.y + tenu!.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const apres = await Promise.all([1, 2].map(async (i) => (await blocs.nth(i).boundingBox())!.x));
  expect(Math.abs(apres[0] - avant[0] - 60)).toBeLessThan(12);
  expect(Math.abs(apres[1] - avant[1] - 60)).toBeLessThan(12);

  // Suppr efface le groupe entier — et un seul pas d'annulation le rend.
  await page.keyboard.press("Delete");
  await expect(blocs).toHaveCount(4);
  await page.keyboard.press("Control+z");
  await expect(blocs).toHaveCount(6);

  // La marée sur le fond d'une piste prend tout ce qu'elle encadre.
  const coupes = await page.locator('[data-lane="cuts"]').boundingBox();
  await page.mouse.move(coupes!.x + 40, coupes!.y + coupes!.height / 2);
  await page.mouse.down();
  await page.mouse.move(coupes!.x + coupes!.width - 40, coupes!.y + coupes!.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await page.waitForTimeout(250);
  expect(
    await page.locator('[data-lane="subs"] .ed-clip.is-selected').count(),
  ).toBeGreaterThanOrEqual(4);
});

test("les zones sélectionnées se déplacent en groupe dans la scène", async ({ page }) => {
  await openDemoWithMasks(page);

  const zones = page.locator(".ed-mask");
  const position = (i: number) =>
    page.evaluate((k) => {
      const style = document.querySelectorAll<HTMLElement>(".ed-mask")[k].style;
      return { left: parseFloat(style.left), top: parseFloat(style.top) };
    }, i);

  await zones.nth(1).click();
  await zones.nth(2).click({ modifiers: ["Shift"] });
  await expect(zones.nth(1)).toHaveClass(/is-selected/);
  await expect(zones.nth(2)).toHaveClass(/is-selected/);

  const avant1 = await position(1);
  const avant2 = await position(2);
  const tenu = await zones.nth(1).boundingBox();
  await page.mouse.move(tenu!.x + tenu!.width / 2, tenu!.y + tenu!.height / 2);
  await page.mouse.down();
  // Vers le bas seulement : les deux zones touchent un bord horizontal, et
  // `clampZone` les y retient — un écart mesuré sur un axe libre est net.
  await page.mouse.move(tenu!.x + tenu!.width / 2, tenu!.y + tenu!.height / 2 + 30, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const apres1 = await position(1);
  const apres2 = await position(2);
  expect(apres1.top).toBeGreaterThan(avant1.top + 1);
  expect(apres2.top).toBeGreaterThan(avant2.top + 1);
  // Le même écart pour les deux, au point près : c'est ce que le geste promet.
  expect(Math.abs(apres2.top - avant2.top - (apres1.top - avant1.top))).toBeLessThan(0.6);
});

test("la légende suit le cadre : tirer la bande déplace le texte incrusté", async ({ page }) => {
  await openDemoWithMasks(page);

  // Une légende à l'écran d'abord : un clic sur le fond de la piste des coupes
  // amène la tête de lecture dans le premier bloc, où le texte est affiché.
  const coupes = await page.locator('[data-lane="cuts"]').boundingBox();
  await page.mouse.click(coupes!.x + 40, coupes!.y + coupes!.height / 2);
  await page.waitForTimeout(500);
  const titre = page.locator(".ed-subtitle");
  await expect(titre).toBeVisible();

  const bord = (selecteur: string) =>
    page.evaluate((s) => document.querySelector(s)!.getBoundingClientRect().top, selecteur);
  const cadreAvant = await bord(".ed-mask");
  const hautAvant = await bord(".ed-subtitle");

  const bande = await page.locator(".ed-mask").first().boundingBox();
  await page.mouse.move(bande!.x + bande!.width / 2, bande!.y + bande!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bande!.x + bande!.width / 2, bande!.y + bande!.height / 2 - 80, {
    steps: 10,
  });
  await page.mouse.up();
  await page.waitForTimeout(500);

  // C'est le reproche reçu : le cadre montait, la légende restait clouée en
  // bas — la scène mentait sur ce que l'export allait incruster.
  expect(cadreAvant - (await bord(".ed-mask"))).toBeGreaterThan(50);
  expect(hautAvant - (await bord(".ed-subtitle"))).toBeGreaterThan(50);
});

test("l'import ne dépend pas d'un volet replié", async ({ page }) => {
  // Le reproche reçu : « impossible de déposer quoi que ce soit ». La seule
  // entrée visible était la zone du panneau gauche — et ce panneau se replie,
  // et sur un petit écran il l'est d'office. Le chemin d'import doit donc tenir
  // dans la barre du haut, volet ouvert ou fermé.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expectHydrated(page);

  const bouton = page.locator('button:has-text("Importer un plan")');
  await expect(bouton).toBeVisible();
  await expect(page.locator("#ed-import-plan")).toBeAttached();
  await expect(page.locator("#ed-import-media")).toBeAttached();

  // La médiathèque repliée, son champ disparaît de l'écran : celui du haut doit
  // rester là, sinon le bouton ne fait plus rien d'apparent.
  const colonne = page.locator(".ed-main");
  await expect(colonne).toHaveAttribute("data-left", "open");
  await page.locator('.ed-seg-btn:has-text("Médiathèque")').click();
  await expect(colonne).toHaveAttribute("data-left", "closed");
  await expect(bouton).toBeVisible();
  await expect(page.locator("#ed-import-plan")).toBeAttached();

  // Et le bouton ouvre bien la boîte de sélection du fichier.
  const choix = page.waitForEvent("filechooser");
  await bouton.click();
  const chooser = await choix;
  await chooser.setFiles(CLIP);
  await expect(page.locator(".ed-project-name")).not.toHaveValue("Démo — doublage vertical", {
    timeout: 30_000,
  });
});

test("un bord plaqué contre le cadre se voit, et le geste muet s'explique", async ({ page }) => {
  await openDemoWithMasks(page);

  // Le reproche : « impossible de les déplacer ». Le logo du haut à droite est
  // collé au bord droit du cadre — le tirer vers la droite ne peut rien donner.
  // Ce n'est pas une interface morte, c'est une bordure : elle doit se lire.
  const logoDroit = page.locator(".ed-mask").nth(2);
  await expect(logoDroit.locator('.ed-mask-handle[data-corner="e"]')).toHaveAttribute(
    "data-pinned",
    "true",
  );
  await expect(logoDroit.locator('.ed-mask-handle[data-corner="w"]')).not.toHaveAttribute(
    "data-pinned",
    "true",
  );

  const gauche = () => logoDroit.evaluate((el) => parseFloat(el.style.left));

  // Vers l'extérieur : rien ne bouge, et le monteur le dit.
  const avant = await gauche();
  const corps = await logoDroit.boundingBox();
  await page.mouse.move(corps!.x + corps!.width / 2, corps!.y + corps!.height / 2);
  await page.mouse.down();
  await page.mouse.move(corps!.x + corps!.width / 2 + 60, corps!.y + corps!.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  expect(await gauche()).toBeCloseTo(avant, 3);
  await expect(page.getByTestId("notice")).toContainText(/bord du cadre/i);

  // Vers l'intérieur : ça part.
  await page.waitForTimeout(3200);
  const tenu = await logoDroit.boundingBox();
  await page.mouse.move(tenu!.x + tenu!.width / 2, tenu!.y + tenu!.height / 2);
  await page.mouse.down();
  await page.mouse.move(tenu!.x + tenu!.width / 2 - 70, tenu!.y + tenu!.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  expect(await gauche()).toBeLessThan(avant - 10);
});

test("les tailles varient : largeur du bandeau, hauteur, et la légende suit", async ({ page }) => {
  await openDemoWithMasks(page);

  // Une légende affichée, pour mesurer ce que le cadre lui fait.
  const coupes = await page.locator('[data-lane="cuts"]').boundingBox();
  await page.mouse.click(coupes!.x + 40, coupes!.y + coupes!.height / 2);
  await page.waitForTimeout(500);
  const titre = page.locator(".ed-subtitle");
  await expect(titre).toBeVisible();

  const bande = page.locator(".ed-mask").first();
  const mesure = () =>
    page.evaluate(() => {
      const z = document.querySelector<HTMLElement>(".ed-mask")!;
      const t = document.querySelector<HTMLElement>(".ed-subtitle")!;
      return {
        largeur: parseFloat(z.style.width),
        hauteur: parseFloat(z.style.height),
        haut: t.getBoundingClientRect().top,
      };
    });

  const avant = await mesure();

  // 1) Poignée est ramenée vers l'intérieur : le bandeau se rétrécit.
  const bord = await bande.boundingBox();
  await page.mouse.move(bord!.x + bord!.width, bord!.y + bord!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bord!.x + bord!.width - 80, bord!.y + bord!.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const apresLargeur = await mesure();
  expect(apresLargeur.largeur).toBeLessThan(avant.largeur - 8);

  // 2) Poignée sud étirée vers le bas : la hauteur varie, et la légende descend
  //    avec — le moteur cale le texte sur le centre du cadre, la scène aussi.
  const bord2 = await bande.boundingBox();
  const bas = await mesure();
  await page.mouse.move(bord2!.x + bord2!.width / 2, bord2!.y + bord2!.height);
  await page.mouse.down();
  await page.mouse.move(bord2!.x + bord2!.width / 2, bord2!.y + bord2!.height + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const apresHauteur = await mesure();
  expect(apresHauteur.hauteur).toBeGreaterThan(bas.hauteur + 1);
  expect(apresHauteur.haut).toBeGreaterThan(bas.haut + 8);
});
