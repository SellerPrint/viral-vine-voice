import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "Comment ça marche — ViralDub" },
      {
        name: "description",
        content:
          "Découvre le pipeline de ViralDub : extraction audio, transcription, traduction IA, voix off ElevenLabs, coupe des silences et rendu ffmpeg dans le navigateur.",
      },
      { property: "og:title", content: "Comment ça marche — ViralDub" },
      {
        property: "og:description",
        content:
          "Le pipeline détaillé qui transforme une vidéo TikTok française en version anglaise doublée.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HowItWorks,
});

const steps = [
  { t: "1. Extraction de l'audio", d: "ffmpeg.wasm tourne dans ton navigateur et sort une piste mono 16 kHz depuis ton MP4." },
  { t: "2. Détection des silences", d: "On analyse le RMS de l'audio par fenêtres de 20 ms. Toute zone < -42 dB pendant plus de 400 ms est marquée à couper." },
  { t: "3. Transcription française", d: "ElevenLabs Scribe v2 retourne les mots français avec des timestamps précis." },
  { t: "4. Traduction FR → EN", d: "Lovable AI (Gemini) regroupe les mots en segments puis produit une traduction anglaise concise, calibrée pour tenir dans la durée." },
  { t: "5. Voix off anglaise", d: "Chaque segment est synthétisé via ElevenLabs Turbo v2.5 avec une voix naturelle et une vitesse ajustée pour coller au timing." },
  { t: "6. Montage final", d: "Un unique filter_complex ffmpeg masque le bandeau FR, incruste les sous-titres EN, coupe les silences et remplace la piste audio." },
];

function HowItWorks() {
  return (
    <div className="mesh-bg min-h-screen">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-6 py-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="bg-grad-brand grid h-9 w-9 place-items-center rounded-xl font-display text-lg font-bold text-black">
            V
          </div>
          <span className="font-display text-xl font-bold tracking-tight">ViralDub</span>
        </Link>
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Retour
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-6 pb-24">
        <h1 className="mt-8 font-display text-5xl font-bold tracking-tight md:text-6xl">
          Comment <span className="text-grad-brand">ça marche</span>
        </h1>
        <p className="mt-5 text-lg text-muted-foreground">
          Six étapes, la plupart s'exécutent directement dans ton navigateur. Seuls l'audio et le
          texte transitent par nos APIs.
        </p>
        <ol className="mt-12 space-y-6">
          {steps.map((s) => (
            <li key={s.t} className="rounded-2xl border border-border bg-card/60 p-6 backdrop-blur">
              <h2 className="font-display text-xl font-bold">{s.t}</h2>
              <p className="mt-2 text-muted-foreground">{s.d}</p>
            </li>
          ))}
        </ol>
        <div className="mt-12 rounded-2xl border border-primary/40 bg-primary/5 p-6">
          <h3 className="font-display text-lg font-bold">Limites à connaître</h3>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Vidéos jusqu'à 60 Mo / ~60 s pour rester rapide (ffmpeg.wasm est mono-thread).</li>
            <li>
              Le retrait des sous-titres FR se fait par masque noir sur le bandeau bas. Si tes
              sous-titres sont ailleurs, ils resteront visibles.
            </li>
            <li>La voix off consomme des crédits ElevenLabs sur ta connexion liée.</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
