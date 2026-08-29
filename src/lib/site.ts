/**
 * URL canonique du site, sans barre oblique finale.
 *
 * Utilisée pour le sitemap et les métadonnées Open Graph, qui exigent des URL
 * absolues. Configurable via `VITE_SITE_URL` selon l'environnement.
 */
export const SITE_URL = (
  (import.meta.env.VITE_SITE_URL as string | undefined) ?? "https://viraldub.app"
).replace(/\/+$/, "");

export const SITE_NAME = "ViralDub";

export const SITE_DESCRIPTION =
  "Traduis et double tes vidéos avec sous-titres synchronisés, voix distinctes et rendu MP4 prêt à publier.";
