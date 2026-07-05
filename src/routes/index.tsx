import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { readFileBytes, runPipeline, type Segment, type VideoInput } from "@/lib/video/pipeline";
import {
  DEFAULT_MASKS,
  SUBTITLE_PRESETS,
  type MaskZone,
  type SubtitleOverrides,
  type SubtitlePreset,
} from "@/lib/video/presets";
import { SettingsPanel } from "@/components/SettingsPanel";

export const Route = createFileRoute("/")({
  component: Home,
});

type StepKey =
  | "idle"
  | "ffmpeg"
  | "extract"
  | "silence"
  | "transcribe"
  | "translate"
  | "tts"
  | "compose"
  | "done"
  | "error";

const STEPS: { key: StepKey; label: string }[] = [
  { key: "ffmpeg", label: "Chargement du moteur vidéo" },
  { key: "extract", label: "Extraction de l'audio" },
  { key: "silence", label: "Détection des silences" },
  { key: "transcribe", label: "Transcription française" },
  { key: "translate", label: "Traduction FR → EN" },
  { key: "tts", label: "Voix off anglaise (ElevenLabs)" },
  { key: "compose", label: "Montage & rendu final" },
];

function Home() {
  const [file, setFile] = useState<(VideoInput & { size: number }) | null>(null);
  const [step, setStep] = useState<StepKey>("idle");
  const [detail, setDetail] = useState("");
  const [pct, setPct] = useState(0);
  const [output, setOutput] = useState<{ url: string; segments: Segment[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (f: File | null) => {
    setError(null);
    setOutput(null);
    if (!f) return setFile(null);
    if (!f.type.startsWith("video/")) {
      setError("Merci d'importer un fichier vidéo (MP4).");
      return;
    }
    if (f.size > 60 * 1024 * 1024) {
      setError("Fichier trop lourd. Maximum 60 Mo (limite du traitement navigateur).");
      return;
    }
    setCopying(true);
    setDetail("Copie locale de la vidéo…");
    try {
      const bytes = await readFileBytes(f);
      setFile({ name: f.name, size: f.size, bytes });
    } catch (e) {
      setFile(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCopying(false);
      setDetail("");
    }
  };

  const start = useCallback(async () => {
    if (!file) return;
    setError(null);
    setOutput(null);
    setPct(0);
    try {
      const res = await runPipeline({ name: file.name, bytes: file.bytes }, (s, d, p) => {
        setStep(s as StepKey);
        if (d !== undefined) setDetail(d);
        if (p !== undefined) setPct(p);
      });
      const url = URL.createObjectURL(res.videoBlob);
      setOutput({ url, segments: res.segments });
      setStep("done");
      setPct(1);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  }, [file]);

  const reset = () => {
    if (output) URL.revokeObjectURL(output.url);
    setFile(null);
    setOutput(null);
    setStep("idle");
    setDetail("");
    setPct(0);
    setError(null);
    setCopying(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const currentStepIdx = STEPS.findIndex((s) => s.key === step);
  const running = copying || (step !== "idle" && step !== "done" && step !== "error");

  return (
    <div className="mesh-bg min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="bg-grad-brand grid h-9 w-9 place-items-center rounded-xl font-display text-lg font-bold text-black">
            V
          </div>
          <span className="font-display text-xl font-bold tracking-tight">ViralDub</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm text-muted-foreground">
          <Link to="/how-it-works" className="hover:text-foreground">
            Comment ça marche
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-24">
        <section className="pt-8 pb-14 md:pt-16 md:pb-20">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-primary" /> 100 % traité dans ton navigateur
            </span>
            <h1 className="mt-6 font-display text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
              Tes TikToks viraux <br />
              <span className="text-grad-brand">en anglais.</span> Automatique.
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
              Uploade un TikTok français. On enlève le bandeau de sous-titres, on traduit, on ajoute
              une voix off anglaise, on coupe les silences et on rend la vidéo prête à publier.
            </p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <div className="rounded-3xl border border-border bg-card/60 p-6 backdrop-blur md:p-8">
            {!output && (
              <>
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (running) return;
                    void handleFile(e.dataTransfer.files?.[0] ?? null);
                  }}
                  className={`relative flex min-h-[220px] flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition ${
                    file ? "border-accent/60 bg-accent/5" : "border-border hover:border-primary/60"
                  }`}
                >
                  <input
                    ref={inputRef}
                    type="file"
                    accept="video/*"
                    disabled={running}
                    onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    aria-label="Importer une vidéo"
                  />
                  {copying ? (
                    <>
                      <div className="bg-grad-brand mx-auto grid h-14 w-14 place-items-center rounded-2xl text-2xl text-black">
                        …
                      </div>
                      <p className="mt-4 font-display text-xl font-semibold">Copie de la vidéo…</p>
                      <p className="mt-1 text-sm text-muted-foreground">Garde cette page ouverte.</p>
                    </>
                  ) : !file ? (
                    <>
                      <div className="bg-grad-brand mx-auto grid h-14 w-14 place-items-center rounded-2xl text-2xl text-black">
                        ↑
                      </div>
                      <p className="mt-4 font-display text-xl font-semibold">
                        Glisse ta vidéo TikTok ici
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        MP4 · max 60 Mo · idéalement &lt; 60 s
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-display text-lg font-semibold">{file.name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {(file.size / 1024 / 1024).toFixed(1)} Mo
                      </p>
                    </>
                  )}
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button
                    onClick={start}
                    disabled={!file || running}
                    className="bg-grad-brand rounded-xl px-6 py-3 font-display font-semibold text-black transition hover:opacity-90 disabled:opacity-40"
                  >
                    {running ? "Traitement en cours…" : "Lancer la traduction"}
                  </button>
                  {file && !running && (
                    <button
                      onClick={reset}
                      className="rounded-xl border border-border px-5 py-3 text-sm text-muted-foreground hover:text-foreground"
                    >
                      Changer la vidéo
                    </button>
                  )}
                </div>
              </>
            )}

            {output && (
              <div>
                <h3 className="font-display text-2xl font-bold">Ta vidéo est prête ✨</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Voix off et sous-titres anglais, silences coupés, bandeau FR masqué.
                </p>
                <video
                  src={output.url}
                  controls
                  className="mt-5 w-full rounded-2xl border border-border"
                />
                <div className="mt-5 flex flex-wrap gap-3">
                  <a
                    href={output.url}
                    download={`viraldub-${Date.now()}.mp4`}
                    className="bg-grad-brand rounded-xl px-6 py-3 font-display font-semibold text-black transition hover:opacity-90"
                  >
                    Télécharger la vidéo
                  </a>
                  <button
                    onClick={reset}
                    className="rounded-xl border border-border px-5 py-3 text-sm text-muted-foreground hover:text-foreground"
                  >
                    Traiter une autre vidéo
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="mt-6 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
                <p className="font-semibold text-destructive">Erreur</p>
                <p className="mt-1 opacity-90">{error}</p>
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-border bg-card/60 p-6 backdrop-blur md:p-8">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-bold">Pipeline</h2>
              {running && (
                <span className="text-xs font-medium text-accent">{Math.round(pct * 100)}%</span>
              )}
            </div>
            <ol className="mt-6 space-y-4">
              {STEPS.map((s, i) => {
                const active = step === s.key;
                const doneStep = i < currentStepIdx || step === "done";
                return (
                  <li key={s.key} className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-semibold transition ${
                        doneStep
                          ? "border-accent bg-accent/20 text-accent"
                          : active
                            ? "border-primary bg-primary/20 text-primary"
                            : "border-border text-muted-foreground"
                      }`}
                    >
                      {doneStep ? "✓" : i + 1}
                    </div>
                    <div className="flex-1">
                      <p
                        className={`font-medium ${
                          active || doneStep ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {s.label}
                      </p>
                      {active && detail && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
                      )}
                      {active && pct > 0 && pct < 1 && (
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-border">
                          <div
                            className="bg-grad-brand h-full transition-all"
                            style={{ width: `${Math.round(pct * 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="mt-8 rounded-xl border border-border bg-background/40 p-4 text-xs leading-relaxed text-muted-foreground">
              La vidéo ne quitte jamais ton navigateur : seuls l'audio et le texte sont envoyés à
              ElevenLabs et Lovable AI pour la voix off et la traduction.
            </div>
          </div>
        </section>

        <section className="mt-20 grid gap-5 md:grid-cols-3">
          {[
            {
              t: "Voix off naturelle",
              d: "Voix anglaise studio générée par ElevenLabs, ajustée en vitesse pour coller au timing.",
            },
            {
              t: "Sous-titres anglais",
              d: "Sous-titres punchy en majuscules, style TikTok, incrustés dans la vidéo finale.",
            },
            {
              t: "Silences coupés",
              d: "Détection RMS des blancs > 400 ms. Cuts nets et rythme boosté, façon montage viral.",
            },
          ].map((f) => (
            <div key={f.t} className="rounded-2xl border border-border bg-card/40 p-6 backdrop-blur">
              <h3 className="font-display text-lg font-bold">{f.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.d}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border/50 py-8 text-center text-xs text-muted-foreground">
        Fait avec Lovable · ElevenLabs · ffmpeg.wasm
      </footer>
    </div>
  );
}
