import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de bout en bout.
 *
 * Ils couvrent ce qu'aucun test unitaire ne voit : le chargement réel de la
 * page, les en-têtes de sécurité servis par la configuration de déploiement,
 * et l'absence de secret dans le bundle envoyé au navigateur.
 *
 * Le serveur est démarré automatiquement par Playwright.
 *
 * On utilise `vite dev` et non `preview` : le build de ce projet cible
 * Cloudflare Workers (`preset: cloudflare-module`), donc `.output/server`
 * n'est pas exécutable par Node. Conséquence assumée : les en-têtes définis
 * dans `vercel.json` ne sont pas servis en local, et le test correspondant
 * les vérifie donc directement sur le déploiement quand `E2E_BASE_URL` est
 * fourni.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "line" : "list",
  timeout: 60_000,

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          // Deux tests allouent beaucoup de mémoire dans la page : le buffer
          // de 61 Mo et le cœur FFmpeg (~32 Mo de .wasm). Chromium utilise
          // /dev/shm par défaut, souvent limité à 64 Mo dans un conteneur —
          // au-delà l'onglet meurt avec un « Target crashed » qui ressemble à
          // tort à un bug applicatif.
          args: ["--disable-dev-shm-usage"],
        },
      },
    },
  ],

  // Aucun serveur a demarrer si l'on teste une URL deja deployee.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "bun run dev --port 4173 --host 127.0.0.1",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
