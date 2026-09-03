import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_MASKS,
  SUBTITLE_PRESETS,
  TARGET_LANGUAGES,
  type MaskZone,
  type SubtitleOverrides,
  type SubtitlePreset,
  type TargetLanguage,
} from "@/lib/video/presets";
import {
  applyConfig,
  configFileName,
  exportConfig,
  MAX_CONFIG_BYTES,
  parseConfig,
} from "@/lib/config-io";
import { isSameLanguage, SOURCE_LANGUAGES, type SourceLanguage } from "@/lib/languages";
import { detectMaskZones } from "@/lib/video/detect";
import { VIDEO_FILTERS, UPSCALE_MODES } from "@/lib/video/filters";
import { renderPreviewFrame } from "@/lib/video/preview";
import { TRANSITIONS } from "@/lib/video/transitions";
import type { RenderOptions } from "@/lib/video/render-options";

type Change = {
  preset: SubtitlePreset;
  overrides: SubtitleOverrides;
  masks: MaskZone[];
  sourceLanguage: SourceLanguage;
  targetLanguage: TargetLanguage;
  options: RenderOptions;
};

type Props = {
  file: { name: string; size: number; bytes: Uint8Array };
  preset: SubtitlePreset;
  overrides: SubtitleOverrides;
  masks: MaskZone[];
  sourceLanguage: SourceLanguage;
  targetLanguage: TargetLanguage;
  options: RenderOptions;
  onChange: (v: Change) => void;
};

export function SettingsPanel({
  file,
  preset,
  overrides,
  masks,
  sourceLanguage,
  targetLanguage,
  options,
  onChange,
}: Props) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [detecting, setDetecting] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // L'URL d'objet precedente doit etre liberee, sinon chaque apercu fuit
  // quelques centaines de kilo-octets.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const buildPreview = async () => {
    setPreviewing(true);
    setPreviewError(null);
    try {
      const url = await renderPreviewFrame(file.bytes, {
        filterId: options.filterId,
        upscale: options.upscale,
        videoWidth: dims?.w ?? 0,
        videoHeight: dims?.h ?? 0,
        sampleText: "Aperçu des sous-titres",
        preset: { ...preset, ...overrides, boxOpacity: options.subtitleOpacity },
        atSecond: 1,
        // Sans cela l'aperçu utiliserait Roboto quelle que soit la langue et
        // afficherait des carrés là où le rendu final sera correct.
        languageCode: targetLanguage.code,
      });
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return url;
      });
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "Aperçu impossible.");
    } finally {
      setPreviewing(false);
    }
  };

  useEffect(() => {
    // `slice()` protege contre un buffer detache : si un apercu ou un rendu a
    // transfere `file.bytes` au worker FFmpeg, `new Blob` sur la vue detachee
    // produirait une video vide.
    const blob = new Blob([file.bytes.slice() as unknown as BlobPart], { type: "video/mp4" });
    const url = URL.createObjectURL(blob);
    setVideoBlob(blob);
    setVideoUrl(url);
    return () => {
      setVideoBlob(null);
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const update = (patch: Partial<Change>) =>
    onChange({ preset, overrides, masks, sourceLanguage, targetLanguage, options, ...patch });
  const setOption = <K extends keyof RenderOptions>(key: K, value: RenderOptions[K]) =>
    update({ options: { ...options, [key]: value } });

  /* ------------------------- import / export config ------------------------ */

  const configInputRef = useRef<HTMLInputElement>(null);
  const [configMessage, setConfigMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  const handleExport = () => {
    const json = exportConfig({
      presetId: preset.id,
      sourceLanguage: sourceLanguage.code,
      targetLanguage: targetLanguage.code,
      options,
      masks,
    });

    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = configFileName();
    link.click();
    URL.revokeObjectURL(url);

    setConfigMessage({ kind: "ok", text: "Configuration exportée." });
  };

  const handleImport = async (fileList: FileList | null) => {
    const chosen = fileList?.[0];
    if (!chosen) return;

    // On refuse avant de lire : inutile de charger 500 Mo en memoire pour
    // decouvrir ensuite que ce n'est pas une configuration.
    if (chosen.size > MAX_CONFIG_BYTES) {
      setConfigMessage({ kind: "error", text: "Fichier trop volumineux." });
      return;
    }

    const result = parseConfig(await chosen.text());
    if (!result.ok) {
      setConfigMessage({ kind: "error", text: result.error });
      return;
    }

    const merged = applyConfig(result.config, {
      presetId: preset.id,
      sourceLanguage: sourceLanguage.code,
      targetLanguage: targetLanguage.code,
      options,
      masks,
    });

    // Les identifiants valides ont ete verifies contre les listes blanches :
    // un `find` qui echoue signifie seulement que le champ etait absent.
    update({
      preset: SUBTITLE_PRESETS.find((p) => p.id === merged.presetId) ?? preset,
      sourceLanguage:
        SOURCE_LANGUAGES.find((l) => l.code === merged.sourceLanguage) ?? sourceLanguage,
      targetLanguage:
        TARGET_LANGUAGES.find((l) => l.code === merged.targetLanguage) ?? targetLanguage,
      options: merged.options,
      masks: masks.map((m) => {
        const imported = merged.masks.find((i) => i.id === m.id);
        return imported ? { ...m, ...imported } : m;
      }),
    });

    setConfigMessage({ kind: "ok", text: "Configuration importée." });
  };

  const effective = { ...preset, ...overrides };

  const autoDetect = async () => {
    if (!videoBlob) return;
    setDetecting(true);
    try {
      const zones = await detectMaskZones(videoBlob);
      // merge with existing (keep ids order of DEFAULT_MASKS)
      const merged: MaskZone[] = DEFAULT_MASKS.map((d) => {
        const found = zones.find((z) => z.id === d.id);
        return found ?? d;
      });
      update({ masks: merged });
    } catch (e) {
      console.error(e);
    } finally {
      setDetecting(false);
    }
  };

  return (
    <div className="mt-6 space-y-6 rounded-2xl border border-border bg-background/40 p-5">
      {/* --------------------------- import / export --------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleExport}
          className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
        >
          Exporter la configuration
        </button>
        <button
          type="button"
          onClick={() => configInputRef.current?.click()}
          className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
        >
          Importer une configuration
        </button>
        <input
          ref={configInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            void handleImport(e.target.files);
            // Reinitialise pour que reimporter le meme fichier declenche
            // bien un nouvel evenement `change`.
            e.target.value = "";
          }}
        />
        {configMessage && (
          <span
            className={`text-xs ${
              configMessage.kind === "ok" ? "text-emerald-400" : "text-amber-300"
            }`}
          >
            {configMessage.text}
          </span>
        )}
      </div>
      <p className="-mt-4 text-xs text-muted-foreground">
        Le fichier ne contient que des réglages : ni clé d'API, ni identifiant de voix clonée, ni
        vidéo.
      </p>

      <div>
        <h3 className="font-display text-lg font-bold">Montage & audio</h3>
        <div className="mt-3 space-y-2">
          {(
            [
              ["wordByWord", "Sous-titres mot par mot"],
              ["removeOriginalAudio", "Supprimer l'ambiance d'origine"],
              ["cutSilences", "Couper les scènes silencieuses"],
              ["mirror", "Effet miroir (flip horizontal)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={options[key]}
                onChange={(e) => setOption(key, e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        {/* ------------------------------ apparence ------------------------------ */}
        <p className="mt-5 text-xs font-medium text-muted-foreground">Filtre visuel</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {VIDEO_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setOption("filterId", f.id)}
              title={f.description}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${
                options.filterId === f.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.name}
            </button>
          ))}
        </div>

        <p className="mt-4 text-xs font-medium text-muted-foreground">Définition</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {UPSCALE_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setOption("upscale", m.id)}
              title={m.note}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${
                options.upscale === m.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.name}
            </button>
          ))}
        </div>
        {options.upscale === "2160" && (
          <p className="mt-2 text-xs text-amber-500">
            La 4K multiplie par environ 4 le temps d'encodage et peut échouer sur mobile. Si le
            rendu échoue, l'application repasse automatiquement en définition d'origine.
          </p>
        )}

        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">
            Opacité du fond des sous-titres
          </p>
          <span className="text-xs tabular-nums text-muted-foreground">
            {Math.round(options.subtitleOpacity * 100)} %
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={options.subtitleOpacity}
          onChange={(e) => setOption("subtitleOpacity", Number(e.target.value))}
          className="mt-2 w-full accent-primary"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          0 % : aucun bandeau, seuls le contour et l'ombre assurent la lisibilité.
        </p>

        {/* ------------------------------ ambiance ------------------------------- */}
        {!options.removeOriginalAudio && (
          <>
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                Volume de l'ambiance d'origine
              </p>
              <span className="text-xs tabular-nums text-muted-foreground">
                {Math.round(options.ambienceLevel * 100)} %
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={options.ambienceLevel}
              onChange={(e) => setOption("ambienceLevel", Number(e.target.value))}
              className="mt-2 w-full accent-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Musique et bruits de la vidéo conservés sous la voix off. Le fond baisse
              automatiquement quand la voix parle, puis remonte dans les silences.
            </p>
          </>
        )}

        {/* ----------------------------- transitions ----------------------------- */}
        <p className="mt-5 text-xs font-medium text-muted-foreground">
          Transition entre les coupes
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {TRANSITIONS.map((t) => (
            <button
              key={t.id}
              onClick={() => setOption("transition", t.id)}
              disabled={!options.cutSilences && t.id !== "none"}
              className={`rounded-full border px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
                options.transition === t.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
        {!options.cutSilences && (
          <p className="mt-2 text-xs text-muted-foreground">
            Les transitions nécessitent la coupe des silences : sans coupe, il n'y a rien à
            raccorder.
          </p>
        )}
        {options.transition !== "none" && (
          <>
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Durée de la transition</p>
              <span className="text-xs tabular-nums text-muted-foreground">
                {options.transitionDuration.toFixed(2)} s
              </span>
            </div>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={options.transitionDuration}
              onChange={(e) => setOption("transitionDuration", Number(e.target.value))}
              className="mt-2 w-full accent-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Les sous-titres sont recalés automatiquement : un fondu raccourcit la vidéo.
            </p>
          </>
        )}

        {/* ------------------------------- aperçu -------------------------------- */}
        <div className="mt-5 rounded-xl border border-border bg-background/40 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-muted-foreground">Aperçu avant rendu</p>
            <button
              onClick={buildPreview}
              disabled={previewing}
              className="rounded-full border border-primary bg-primary/10 px-3 py-1.5 text-xs transition disabled:opacity-50"
            >
              {previewing ? "Génération…" : "Générer l'aperçu"}
            </button>
          </div>
          {previewError && <p className="mt-2 text-xs text-destructive">{previewError}</p>}
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Aperçu du rendu avec les filtres et le style de sous-titres"
              className="mt-3 w-full rounded-lg"
            />
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              L'aperçu est calculé par FFmpeg sur une image de la vidéo : il reflète exactement le
              rendu final, filtre et sous-titres compris.
            </p>
          )}
        </div>

        <p className="mt-4 text-xs font-medium text-muted-foreground">Moteur de voix off</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(
            [
              ["elevenlabs", "Voix IA (ElevenLabs)"],
              ["ai33", "Voix clonée (ai33.pro)"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setOption("ttsProvider", value)}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${
                options.ttsProvider === value
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {options.ttsProvider === "ai33" && (
          <input
            value={options.clonedVoiceId}
            onChange={(e) => setOption("clonedVoiceId", e.target.value)}
            placeholder="ID de ta voix clonée ai33.pro"
            className="mt-3 w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary"
          />
        )}
      </div>

      <div>
        <h3 className="font-display text-lg font-bold">Langue source</h3>
        <p className="mt-1 text-xs text-muted-foreground">Langue parlée dans la vidéo importée.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {SOURCE_LANGUAGES.map((l) => (
            <button
              key={l.code}
              onClick={() => update({ sourceLanguage: l })}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${
                sourceLanguage.code === l.code
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-display text-lg font-bold">Langue finale</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Langue des sous-titres traduits (et de la voix off).
        </p>
        {isSameLanguage(sourceLanguage.name, targetLanguage.name) && (
          // Traduire une langue vers elle-meme consomme transcription,
          // traduction et synthese vocale pour reecrire le meme texte.
          <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Langue source et langue finale identiques : la vidéo sera retranscrite et redoublée sans
            être traduite. Choisis une autre langue finale pour un vrai doublage.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {TARGET_LANGUAGES.map((l) => (
            <button
              key={l.code}
              onClick={() => update({ targetLanguage: l })}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${
                targetLanguage.code === l.code
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-bold">Réglages sous-titres</h3>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SUBTITLE_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => update({ preset: p, overrides: {} })}
              className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
                preset.id === p.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <div className="font-semibold">{p.name}</div>
              <div className="opacity-70">
                {p.uppercase ? "MAJ" : "aa"} · {p.fontsize}px
              </div>
            </button>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <NumberSlider
            label="Taille police"
            value={effective.fontsize}
            min={14}
            max={48}
            onChange={(v) => update({ overrides: { ...overrides, fontsize: v } })}
          />
          <NumberSlider
            label="Position verticale"
            value={effective.yAnchor}
            min={0.1}
            max={0.95}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => update({ overrides: { ...overrides, yAnchor: v } })}
          />
          <NumberSlider
            label="Caractères / ligne"
            value={effective.maxCharsPerLine}
            min={10}
            max={40}
            onChange={(v) => update({ overrides: { ...overrides, maxCharsPerLine: v } })}
          />
          <NumberSlider
            label="Nombre de lignes"
            value={effective.maxLines}
            min={1}
            max={4}
            onChange={(v) => update({ overrides: { ...overrides, maxLines: v } })}
          />
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={effective.uppercase}
            onChange={(e) => update({ overrides: { ...overrides, uppercase: e.target.checked } })}
          />
          Majuscules
        </label>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-bold">Zones à masquer</h3>
          <button
            onClick={autoDetect}
            disabled={detecting}
            className="rounded-lg border border-primary/60 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-50"
          >
            {detecting ? "Analyse…" : "Détection auto"}
          </button>
        </div>

        {videoUrl && (
          <div
            className="relative mt-3 overflow-hidden rounded-xl border border-border bg-black"
            onLoad={() => {
              if (videoRef.current)
                setDims({ w: videoRef.current.videoWidth, h: videoRef.current.videoHeight });
            }}
          >
            <video
              ref={videoRef}
              src={videoUrl}
              muted
              playsInline
              controls
              className="mx-auto max-h-[380px] w-auto"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                setDims({ w: v.videoWidth, h: v.videoHeight });
              }}
            />
            {dims && (
              <div
                className="pointer-events-none absolute inset-0 mx-auto"
                style={{ aspectRatio: `${dims.w}/${dims.h}` }}
              >
                {masks
                  .filter((m) => m.enabled)
                  .map((m) => (
                    <div
                      key={m.id}
                      className="absolute border-2 border-accent bg-accent/25"
                      style={{
                        left: `${m.x * 100}%`,
                        top: `${m.y * 100}%`,
                        width: `${m.w * 100}%`,
                        height: `${m.h * 100}%`,
                      }}
                    >
                      <span className="absolute -top-5 left-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-black">
                        {m.label}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 space-y-4">
          {masks.map((m, i) => (
            <div key={m.id} className="rounded-lg border border-border p-3">
              <label className="flex items-center justify-between text-sm font-medium">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={m.enabled}
                    onChange={(e) => {
                      const next = [...masks];
                      next[i] = { ...m, enabled: e.target.checked };
                      update({ masks: next });
                    }}
                  />
                  {m.label}
                </span>
              </label>
              {m.enabled && (
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <NumberSlider
                    label="X"
                    value={m.x}
                    min={0}
                    max={0.95}
                    step={0.01}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => {
                      const next = [...masks];
                      next[i] = { ...m, x: v };
                      update({ masks: next });
                    }}
                  />
                  <NumberSlider
                    label="Y"
                    value={m.y}
                    min={0}
                    max={0.98}
                    step={0.01}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => {
                      const next = [...masks];
                      next[i] = { ...m, y: v };
                      update({ masks: next });
                    }}
                  />
                  <NumberSlider
                    label="Largeur"
                    value={m.w}
                    min={0.05}
                    max={1}
                    step={0.01}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => {
                      const next = [...masks];
                      next[i] = { ...m, w: v };
                      update({ masks: next });
                    }}
                  />
                  <NumberSlider
                    label="Hauteur"
                    value={m.h}
                    min={0.02}
                    max={1}
                    step={0.01}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => {
                      const next = [...masks];
                      next[i] = { ...m, h: v };
                      update({ masks: next });
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Les zones cochées sont floutées puis assombries, ce qui rend illisible un sous-titre ou un
          logo incrusté. Ne coche que les zones réellement occupées : une zone cochée à tort laisse
          une bande visible sur l&apos;image. Les nouveaux sous-titres se superposent par-dessus.
        </p>
      </div>
    </div>
  );
}

function NumberSlider({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono text-foreground">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mt-1 w-full accent-primary"
      />
    </label>
  );
}
