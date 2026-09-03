// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Mêmes en-têtes qu'en production (`vercel.json`) : sans eux le navigateur
// n'accorde pas l'isolation cross-origin, `SharedArrayBuffer` reste absent et
// le cœur FFmpeg multi-thread ne peut pas se charger en développement.
//
// Ils sont posés par un middleware et non via `server.headers` : le wrapper
// `@lovable.dev/vite-tanstack-config` *supprime* `server.headers` lorsqu'il
// détecte un environnement sandbox (il l'annonce dans ses logs). Un
// middleware, lui, survit à cette réécriture de configuration.
function crossOriginIsolation() {
  const apply = (
    _req: unknown,
    res: { setHeader(k: string, v: string): void },
    next: () => void,
  ) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    next();
  };
  return {
    name: "cross-origin-isolation",
    configureServer(server: { middlewares: { use(fn: typeof apply): void } }) {
      server.middlewares.use(apply);
    },
    configurePreviewServer(server: { middlewares: { use(fn: typeof apply): void } }) {
      server.middlewares.use(apply);
    },
  };
}

export default defineConfig({
  vite: {
    plugins: [crossOriginIsolation()],
    // Ces deux paquets embarquent un .wasm de 30+ Mo : les pré-bundler à
    // chaque démarrage ne sert à rien, ils sont chargés à la demande.
    optimizeDeps: { exclude: ["@ffmpeg/core", "@ffmpeg/core-mt"] },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
