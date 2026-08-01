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
import { detectMaskZones } from "@/lib/video/detect";

type Change = {
  preset: SubtitlePreset;
  overrides: SubtitleOverrides;
  masks: MaskZone[];
  targetLanguage: TargetLanguage;
};

type Props = {
  file: { name: string; size: number; bytes: Uint8Array };
  preset: SubtitlePreset;
  overrides: SubtitleOverrides;
  masks: MaskZone[];
  targetLanguage: TargetLanguage;
  onChange: (v: Change) => void;
};

export function SettingsPanel({ file, preset, overrides, masks, targetLanguage, onChange }: Props) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [detecting, setDetecting] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const blob = new Blob([file.bytes as unknown as BlobPart], { type: "video/mp4" });
    const url = URL.createObjectURL(blob);
    setVideoBlob(blob);
    setVideoUrl(url);
    return () => {
      setVideoBlob(null);
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const update = (patch: Partial<Change>) =>
    onChange({ preset, overrides, masks, targetLanguage, ...patch });

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
      <div>
        <h3 className="font-display text-lg font-bold">Langue finale</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Langue des sous-titres traduits (et de la voix off).
        </p>
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
              <div className="opacity-70">{p.uppercase ? "MAJ" : "aa"} · {p.fontsize}px</div>
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
          Les zones cochées sont floutées via <code>delogo</code> (interpolation des pixels
          voisins), pas de bandeau noir. Les nouveaux sous-titres se superposent par-dessus.
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
