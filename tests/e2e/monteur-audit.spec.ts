import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

/**
 * Audit fonctionnel du monteur, en conditions réelles.
 *
 * Huit parcours qui correspondent chacun à une promesse de l'interface : la
 * légende manipulée sur son propre cadran, l'aperçu HyperFrames, les zones de
 * masquage de bout en bout, la boîte d'export et son résumé, le fichier de
 * configuration dans les deux sens, un fichier hostile, les raccourcis clavier,
 * et ce que l'atelier retient d'une session à l'autre.
 *
 * Les mesures sont prises dans le DOM — pas dans un mock. Si la scène ment par
 * rapport au plan, ou si un contrôle ne fait rien, le cas rougit.
 */

async function openDemo(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1568, height: 882 });
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator('.ed-root[data-hydrated="true"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".ed-mask").first()).toBeVisible({ timeout: 30_000 });
}

/** Amène la tête de lecture sur le premier repère, là où une légende s'affiche. */
async function showFirstCue(page: import("@playwright/test").Page) {
  const lane = await page.locator('[data-lane="cuts"]').boundingBox();
  await page.mouse.click(lane!.x + 40, lane!.y + lane!.height / 2);
  await expect(page.locator(".ed-subtitle")).toBeVisible({ timeout: 10_000 });
}

/** Ce que la scène dit du bandeau de masquage : sa géométrie en pourcentages. */
const mesureBande = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const zone = document.querySelector<HTMLElement>(".ed-mask")!;
    return {
      top: parseFloat(zone.style.top),
      hauteur: parseFloat(zone.style.height),
    };
  });

const mesureLegende = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const titre = document.querySelector<HTMLElement>(".ed-subtitle")!;
    const rect = titre.getBoundingClientRect();
    return {
      haut: rect.top,
      gauche: rect.left,
      corps: parseFloat(window.getComputedStyle(titre).fontSize),
    };
  });

test("la légende se règle sur son cadran : corps par la poignée, place par le corps", async ({
  page,
}) => {
  await openDemo(page);
  await showFirstCue(page);

  const avant = await mesureLegende(page);
  expect(avant.corps).toBeGreaterThan(10);

  // 1) La poignée de coin agrandit le texte sous la souris. C'est le reproche
  //    reçu : la zone bleue ne commandait que la boîte de masquage, jamais la
  //    légende elle-même, si bien que « changer la taille » ne changeait rien.
  const poignee = await page.locator(".ed-subtitle-grip").boundingBox();
  await page.mouse.move(poignee!.x + poignee!.width / 2, poignee!.y + poignee!.height / 2);
  await page.mouse.down();
  await page.mouse.move(poignee!.x + poignee!.width / 2, poignee!.y - 30, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => mesureLegende(page).then((m) => m.corps), { timeout: 5_000 })
    .toBeGreaterThan(avant.corps + 1);

  // 2) Sa ligne, elle, la déplace : l'ancre écrite ici est celle que le moteur
  //    lit, donc l'aperçu et l'export disent la même chose. Le suivi est mesuré
  //    au pixel : 60 px à la souris, 60 px à l'écran — sans à-coup au départ,
  //    puisque le geste part d'où la ligne se voit et non du réglage du style.
  const avantLigne = await mesureLegende(page);
  const bandeAvant = await mesureBande(page);
  // On saisit le texte là où il est, pas sur la ligne du bandeau : la poignée
  // du cadre passe au-dessus (c'est elle que l'on voit), et vise ce carré blanc
  // se lit comme un appui sur le cadre.
  const ligne = await page.locator(".ed-subtitle-text").boundingBox();
  const xp = ligne!.x + 14;
  const yp = ligne!.y + 14;
  await page.mouse.move(xp, yp);
  await page.mouse.down();
  await page.mouse.move(xp, yp - 60, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(() => mesureLegende(page).then((m) => m.haut), { timeout: 5_000 })
    .toBeLessThan(avantLigne.haut - 40);
  const apresLigne = await mesureLegende(page);
  expect(Math.abs(apresLigne.haut - (avantLigne.haut - 60))).toBeLessThan(12);
  // Et le bandeau suit la ligne sans se faire écraser : c'est ce que le geste
  // provoquait avant, sa hauteur tombant au plancher toléré (3 %).
  const bandeApres = await mesureBande(page);
  expect(bandeApres.hauteur).toBeCloseTo(bandeAvant.hauteur, 1);
  expect(bandeApres.top).toBeLessThan(bandeAvant.top - 5);

  // 3) Un geste seulement horizontal ne peut rien donner — `drawtext` centre
  //    chaque ligne. Ça s'explique, cela ne se tait pas.
  const avantGlissement = await mesureLegende(page);
  const legende = await page.locator(".ed-subtitle-text").boundingBox();
  await page.mouse.move(legende!.x + 14, legende!.y + 14);
  await page.mouse.down();
  await page.mouse.move(legende!.x + 134, legende!.y + 14, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("notice")).toContainText(/règle à la verticale/, {
    timeout: 5_000,
  });
  expect(Math.abs((await mesureLegende(page)).gauche - avantGlissement.gauche)).toBeLessThan(2);

  // 4) Le cadran de la légende ne doit pas pour autant voler les poignées du
  //    bandeau : tirer le bord sud reste la façon de régler la plaque.
  const avantBord = await mesureBande(page);
  const poigneeSud = await page.locator('.ed-mask-handle[data-corner="se"]').first().boundingBox();
  await page.mouse.move(
    poigneeSud!.x + poigneeSud!.width / 2,
    poigneeSud!.y + poigneeSud!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(poigneeSud!.x + poigneeSud!.width / 2, poigneeSud!.y + 40, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(() => mesureBande(page).then((m) => m.hauteur), { timeout: 5_000 })
    .toBeGreaterThan(avantBord.hauteur + 3);
});

test("HyperFrames : l'aperçu se génère dans l'atelier, sans réseau", async ({ page }) => {
  await openDemo(page);
  await showFirstCue(page);

  await page.locator('.ed-insp-tabs [role="tab"]:has-text("Style")').click();
  const encart = page.locator("section", { hasText: "HyperFrames" }).first();
  await expect(encart).toBeVisible();

  const externes: string[] = [];
  page.on("request", (requete) => {
    if (/fonts\.googleapis|cdn\.|unpkg|jsdelivr/.test(requete.url())) externes.push(requete.url());
  });

  await encart.getByRole("button", { name: /Générer l'aperçu/ }).click();
  const cadre = page.locator("iframe.ed-hyperframes");
  await expect(cadre).toBeVisible({ timeout: 15_000 });

  // La composition est injectée en `srcDoc` : le texte du repère y vit, chaque
  // ligne a sa fenêtre de lecture, et rien ne sort de la page.
  const source = (await cadre.getAttribute("srcdoc")) ?? "";
  expect(source.length).toBeGreaterThan(500);
  expect(source).toContain("@keyframes cue-");
  expect(source).toContain("--cycle");
  expect(source).not.toContain("https://");
  expect(source.toLowerCase()).not.toContain("<script");
  expect(externes, `ressources externes : ${externes.join(", ")}`).toHaveLength(0);

  // Le cadre est sandboxé sans origine : aucune de ses pages ne peut appeler
  // une API au nom de l'atelier.
  expect(await cadre.getAttribute("sandbox")).toBe("");
});

test("les zones de masquage se créent, se règlent, se retirent, et la force suit", async ({
  page,
}) => {
  await openDemo(page);
  await page.locator('.ed-rail-btn:has-text("Masques")').click();

  const zones = page.locator(".ed-mask");
  const avant = await zones.count();
  expect(avant).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Zone", exact: true }).click();
  await expect(zones).toHaveCount(avant + 1);

  // La force du flou : le chip actif doit suivre le clic, c'est lui qui part
  // dans le graphe ffmpeg.
  await page.getByRole("button", { name: "Fort", exact: true }).click();
  await expect(page.locator(".ed-chip.is-active", { hasText: "Fort" })).toBeVisible();

  // La zone créée se règle aussi au champ près, et le cadran de la scène obéit.
  const nouvelle = zones.last();
  await page.getByLabel("X %").last().fill("30");
  await page.keyboard.press("Tab");
  await expect
    .poll(() => nouvelle.evaluate((el) => parseFloat((el as HTMLElement).style.left)))
    .toBeCloseTo(30, 0);

  await page.getByLabel("Retirer la zone").last().click();
  await expect(zones).toHaveCount(avant);
});

test("la boîte d'export annonce la même chose que le plan", async ({ page }) => {
  await openDemo(page);
  await showFirstCue(page);

  await page.keyboard.press("Control+e");
  const boite = page.locator('[aria-label="Exporter le montage"]');
  await expect(boite).toBeVisible({ timeout: 5_000 });
  await expect(boite.getByText("Zones floutées")).toBeVisible();
  await expect(boite.getByText("Durée de sortie")).toBeVisible();

  // Le résumé n'est pas décoratif : il compte les blocs réellement sur la piste.
  const blocs = await page.locator('[data-lane="subs"] .ed-clip').count();
  await expect(boite.getByText(new RegExp(`${blocs} bloc\\(s\\)`))).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(boite).toHaveCount(0);
});

test("le fichier de réglages fait l'aller-retour, montage compris et sans secret", async ({
  page,
}) => {
  await openDemo(page);
  await page.locator('.ed-rail-btn:has-text("Projet")').click();

  const encart = page.locator("section", { hasText: "Fichier de réglages" }).first();
  await expect(encart).toBeVisible();
  await expect(encart.getByText("ni clé d'API, ni identifiant de voix clonée")).toBeVisible();

  // 1) On exporte, et on lit ce qui est vraiment parti sur le disque.
  const telechargement = page.waitForEvent("download");
  await encart.getByRole("button", { name: "Exporter" }).click();
  const fichier = await telechargement;
  const config = JSON.parse(readFileSync((await fichier.path())!, "utf8"));
  expect(config.app).toBe("viraldub");
  expect(config.version).toBe(2);
  expect(config.timeline.clips.length).toBeGreaterThan(0);
  expect(config.masks.length).toBeGreaterThan(0);
  expect(JSON.stringify(config)).not.toMatch(/clonedVoiceId|apiKey|turnstile|token/i);
  const blocsDuFichier = config.timeline.clips.filter(
    (c: { track: string }) => c.track === "subs",
  ).length;

  // 2) On salit le montage : un bloc de plus, que le fichier ne connaît pas.
  await showFirstCue(page);
  await page.keyboard.press("c");
  await expect(page.locator('[data-lane="subs"] .ed-clip')).toHaveCount(blocsDuFichier + 1);

  // 3) On réimporte le fichier par le champ caché, celui qu'un humain
  //    atteindrait dans la boîte de sélection : le plan revient tel quel.
  await page.locator('input[aria-label="Importer un fichier de configuration"]').setInputFiles({
    name: "viraldub-config-retour.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(config), "utf8"),
  });

  await expect(page.getByTestId("notice")).toContainText(/Montage importé/, { timeout: 10_000 });
  await expect(page.locator('[data-lane="subs"] .ed-clip')).toHaveCount(blocsDuFichier);
});

test("une configuration fabriquée ailleurs est refusée avec son motif", async ({ page }) => {
  await openDemo(page);
  await page.locator('.ed-rail-btn:has-text("Projet")').click();

  const blocsAvant = await page.locator('[data-lane="subs"] .ed-clip').count();

  await page.locator('input[aria-label="Importer un fichier de configuration"]').setInputFiles({
    name: "hostile.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        app: "viraldub",
        version: 2,
        // une cle inconnue, et un corps hors de ce que le moteur sait peindre
        genre: "x=1,atob=all",
        subtitle: { fontsize: 900 },
      }),
      "utf8",
    ),
  });

  await expect(page.getByTestId("notice")).toContainText(/invalide/, { timeout: 10_000 });
  // le montage en place n'est pas démonté par le fichier rejeté
  await expect(page.locator('[data-lane="subs"] .ed-clip')).toHaveCount(blocsAvant);
});

test("les raccourcis commandent le plan, et Ctrl+Z les efface", async ({ page }) => {
  await openDemo(page);
  await showFirstCue(page);

  const aimant = page.locator('[aria-label*="Aimantation"]');
  const avantAimant = await aimant.getAttribute("aria-label");
  await page.keyboard.press("m");
  await expect(aimant).not.toHaveAttribute("aria-label", avantAimant!);

  const zoom = page.locator('input[aria-label="Zoom de la timeline"]');
  const zoomAvant = await zoom.inputValue();
  await page.keyboard.press("=");
  await expect(zoom).not.toHaveValue(zoomAvant);

  const coupes = page.locator('[data-lane="cuts"] .ed-clip');
  const avantCoupes = await coupes.count();
  await page.keyboard.press("x");
  await expect(coupes).toHaveCount(avantCoupes + 1);
  await page.keyboard.press("Control+z");
  await expect(coupes).toHaveCount(avantCoupes);

  const textes = page.locator('[data-lane="subs"] .ed-clip');
  const avantTextes = await textes.count();
  await page.keyboard.press("c");
  await expect(textes).toHaveCount(avantTextes + 1);
  await page.keyboard.press("Control+z");
  await expect(textes).toHaveCount(avantTextes);

  // V éteint la légende à l'écran sans toucher aux blocs : le plan reste intact,
  // seule l'affiche disparaît.
  await page.keyboard.press("v");
  await expect(page.locator(".ed-subtitle")).toHaveCount(0);
  await page.keyboard.press("v");
  await expect(page.locator(".ed-subtitle")).toBeVisible();
  await expect(textes).toHaveCount(avantTextes);
});

test("l'atelier retient l'interface ; le montage, lui, voyage par le fichier", async ({ page }) => {
  await openDemo(page);

  // L'onglet « Projet » de l'inspecteur porte la densite de l'interface.
  await page.locator('.ed-insp-tabs [role="tab"]:has-text("Projet")').click();
  const encart = page.locator("section", { hasText: "Interface" }).first();
  await encart.getByRole("button", { name: "Compact" }).click();

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator('.ed-root[data-hydrated="true"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('.ed-insp-tabs [role="tab"]:has-text("Projet")').click();
  await expect(
    page.locator("section", { hasText: "Interface" }).first().locator(".ed-chip.is-active"),
  ).toContainText("Compact");

  // Le montage n'est écrit sur aucun stockage : c'est un choix assumé (le plan
  // de l'utilisateur ne quitte pas son poste, et rien ne traîne sur un partage).
  // La sortie de secours est le fichier de configuration, vérifié plus haut.
  const cles = await page.evaluate(() =>
    Object.keys(window.localStorage).filter((cle) => /projet|monteur|clips|media/i.test(cle)),
  );
  expect(cles).toHaveLength(0);
});
