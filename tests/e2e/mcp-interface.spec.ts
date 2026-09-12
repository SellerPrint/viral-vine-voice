import { expect, test } from "@playwright/test";

/**
 * Le volet « Agent de montage (MCP) » dans l'onglet Projet.
 *
 * Le fil MCP ne vit pas dans la page : c'est une route du serveur. Ce que ces
 * cas vérient, c'est que l'atelier le dit — l'état réel du fil (lu sur
 * `/api/mcp`, pas écrit à la main dans le composant), le bloc à coller chez le
 * client, et surtout que le jeton reste dans la page : il ne doit se retrouver
 * ni dans le localStorage, ni dans l'URL.
 */

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1568, height: 882 });
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator('.ed-root[data-hydrated="true"]')).toBeVisible({ timeout: 30_000 });
  // la démo se charge seule au démarrage : c'est elle qui pose un cadre actif,
  // donc un fil qui compose a quelque chose sous la main
  await expect(page.locator(".ed-mask").first()).toBeVisible({ timeout: 30_000 });
  await page.locator('.ed-rail-btn:has-text("Projet")').click();
});

test("le volet affiche l'état réel du fil", async ({ page }) => {
  const volet = page.locator("section", { hasText: "Agent de montage (MCP)" }).first();
  await expect(volet).toBeVisible();
  // le nombre d'outils vient du GET /api/mcp, pas d'une chaîne codée dans le JSX
  await expect(volet).toContainText(/17 outils/);
  await expect(volet).toContainText(/fermé|jeton|ouvert/);
});

test("le bloc de branchement porte l'URL de ce déploiement", async ({ page }) => {
  const volet = page.locator("section", { hasText: "Agent de montage (MCP)" }).first();
  await expect(volet.locator("pre")).toContainText("/api/mcp");
  await expect(volet.locator("pre")).toContainText("Authorization");
});

test("le jeton reste dans la page : ni stocké, ni envoyé dans une URL", async ({ page }) => {
  const champ = page.getByLabel("Jeton du fil MCP");
  await expect(champ).toHaveAttribute("type", "password");
  await champ.fill("jeteau-de-test-e2e");

  const volet = page.locator("section", { hasText: "Agent de montage (MCP)" }).first();
  await volet.getByRole("button", { name: "Tester le fil" }).click();
  await page.waitForTimeout(1200);

  const stockage = await page.evaluate(() => JSON.stringify(window.localStorage));
  expect(stockage).not.toContain("jeteau-de-test-e2e");
  expect(page.url()).not.toContain("jeteau-de-test-e2e");
});

test("composer un exemple dit ce qui empêche, ou applique le montage", async ({ page }) => {
  const volet = page.locator("section", { hasText: "Agent de montage (MCP)" }).first();
  await volet.getByRole("button", { name: /Composer un exemple/ }).click();

  // Deux issues honnêtes selon la configuration du serveur : soit le refus est
  // explicité dans le volet (aucun MCP_TOKEN réglé, ou un jeton exigé et laissé
  // vide), soit l'agent a composé et le montage est entré par la porte du bouton
  // Importer. Ce qui est refusé ici, c'est le silence — un clic qui ne rend rien
  // et laisse croire que la machine a travaillé.
  const indice = page
    .locator(".ed-alert, [data-testid=notice]")
    .filter({ hasText: /MCP_TOKEN|jeton|refusé|Montage venu de l'agent/i });
  await expect(indice.first()).toBeVisible({ timeout: 15_000 });
});
