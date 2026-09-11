import { createFileRoute } from "@tanstack/react-router";

import { Editor } from "@/components/editor/Editor";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ViralDub — Monteur de doublage vidéo" },
      {
        name: "description",
        content:
          "Un monteur dans le navigateur : timeline manipulable, coupes de silences, zones à flouter, sous-titres et voix off traduite, export MP4 sans envoyer la vidéo.",
      },
      { property: "og:title", content: "ViralDub — Monteur de doublage vidéo" },
      {
        property: "og:description",
        content:
          "Timeline, masques, sous-titres et doublage IA : le traitement viral de tes plans courts, directement dans l'onglet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:locale", content: "fr_FR" },
      // L'atelier est une application plein écran : pas de défilement de page,
      // chaque panneau gère le sien.
      { name: "theme-color", content: "#0e0e10" },
    ],
  }),
  component: Editor,
});
