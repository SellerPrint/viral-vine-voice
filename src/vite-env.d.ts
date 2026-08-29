/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Clé publique du widget Cloudflare Turnstile. Sans elle, le widget est inactif. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  /** URL canonique du site, utilisée par le sitemap et les métadonnées Open Graph. */
  readonly VITE_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*?url" {
  const url: string;
  export default url;
}
