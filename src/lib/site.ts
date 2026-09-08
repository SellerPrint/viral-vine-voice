/**
 * URL canonique du site, sans barre oblique finale.
 *
 * Utilisée pour le sitemap et les métadonnées Open Graph, qui exigent des URL
 * absolues. Configurable via `VITE_SITE_URL` selon l'environnement.
 *
 * Le repli pointait sur `https://viraldub.app`, un domaine qui n'existe pas :
 * toutes les metadonnees Open Graph annoncaient une image injoignable, et le
 * moindre partage sur un reseau social affichait une vignette vide.
 *
 * Sur Vercel, `VITE_VERCEL_URL` (ou `VERCEL_URL` au build) porte le domaine
 * reel du deploiement, previews comprises. On l'utilise avant de retomber sur
 * le domaine de production, qui lui repond.
 */
const vercelUrl = import.meta.env.VITE_VERCEL_URL as string | undefined;

export const SITE_URL = (
  (import.meta.env.VITE_SITE_URL as string | undefined) ??
  (vercelUrl ? `https://${vercelUrl.replace(/^https?:\/\//, "")}` : undefined) ??
  "https://viral-vine-voice.vercel.app"
).replace(/\/+$/, "");

export const SITE_NAME = "ViralDub";

export const SITE_DESCRIPTION =
  "Traduis et double tes vidéos avec sous-titres synchronisés, voix distinctes et rendu MP4 prêt à publier.";
