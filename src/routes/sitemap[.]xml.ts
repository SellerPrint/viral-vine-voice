import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

import { SITE_URL } from "@/lib/site";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const entries = [
          { path: "/", changefreq: "weekly", priority: "1.0" },
          { path: "/how-it-works", changefreq: "monthly", priority: "0.7" },
        ];

        // Le protocole sitemap impose des URL absolues : une valeur relative
        // rend le fichier invalide pour les moteurs de recherche.
        const urls = entries.map(
          (entry) =>
            `  <url><loc>${SITE_URL}${entry.path}</loc><changefreq>${entry.changefreq}</changefreq><priority>${entry.priority}</priority></url>`,
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
