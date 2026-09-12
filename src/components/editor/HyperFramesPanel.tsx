import { useEffect, useMemo, useState } from "react";

import {
  generateCSSOnlyComposition,
  getAvailablePresets,
  getPresetById,
} from "@/lib/video/hyperframes";

import { useEditor } from "./editor-context";
import { Section } from "./ui";

/**
 * Aperçu de la composition HyperFrames.
 *
 * HyperFrames est un moteur de sous-titres **animés** : la composition est du
 * HTML+CSS, pas une chaîne `drawtext`. Le modulelivre deux chemins — une
 * version GSAP (script externe) et une version CSS seule. Ici, la seconde :
 * rien ne sort du navigateur, aucun script dans la carte, donc le cadre
 * `sandbox` peut rester plein de restrictions et la Content-Security-Policy du
 * déploiement n'a pas à être élargie pour un CDN.
 *
 * Ce que l'aperçu ne fait pas, et ne prétend pas faire : produire la vidéo. Le
 * producteur `@hyperframes/producer` (Puppeteer + FFmpeg natif) n'est pas
 * installé dans ce projet — l'export continue de passer par le graphe FFmpeg,
 * seul chemin qui respecte `maskStrength`, les coupes et la voix off.
 */
export function HyperFramesPanel() {
  const { derived, project } = useEditor();
  const presets = useMemo(() => getAvailablePresets(), []);
  const [presetId, setPresetId] = useState(() => presets[0]?.id ?? "");
  const [html, setHtml] = useState<string | null>(null);

  const cues = derived.cues;
  const preset = getPresetById(presetId) ?? presets[0];

  // Une nouvelle ligne, un nouveau style : l'aperçu affiché ne doit pas survivre
  // muet à ce qui l'a produit — c'est la façon la plus sûre de montrer un
  // sous-titre qui n'existe plus.
  useEffect(() => {
    setHtml(null);
  }, [cues, presetId, project.presetId, project.wordByWord]);

  const generer = () => {
    if (!preset || cues.length === 0) return;
    setHtml(generateCSSOnlyComposition(cues, preset, { width: 1080, height: 1920 }));
  };

  return (
    <Section title="HyperFrames — sous-titres animés">
      <p className="ed-note">
        Composition HTML/CSS animée, calculée ici même. Aperçu seulement : l&apos;export garde le
        moteur FFmpeg du projet, seul chemin qui honore coupes, masques et voix off.
      </p>
      <div className="ed-hf-row">
        <label className="ed-hf-preset">
          <span>Preset</span>
          <select
            className="ed-select"
            value={presetId}
            onChange={(event) => setPresetId(event.target.value)}
            disabled={presets.length === 0}
          >
            {presets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} — {item.entrance}
                {item.wordByWord ? " · mot à mot" : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="ed-btn ed-btn--sm"
          onClick={generer}
          disabled={cues.length === 0 || !preset}
          title={
            cues.length === 0
              ? "Aucun repère de sous-titres à animer"
              : "Générer la composition pour les repères actuels"
          }
        >
          Générer l&apos;aperçu
        </button>
        {html ? (
          <a
            className="ed-btn ed-btn--sm"
            href={`data:text/html;charset=utf-8,${encodeURIComponent(html)}`}
            download="sous-titres-hyperframes.html"
            title="Ouvrir la composition seule, ou l'envoyer au producteur"
          >
            Télécharger le HTML
          </a>
        ) : null}
      </div>

      {cues.length === 0 ? (
        <p className="ed-note">
          Aucun repère à animer : importe un plan ou saisis une ligne dans l&apos;onglet Texte.
        </p>
      ) : null}

      {html ? (
        <>
          <iframe
            className="ed-hyperframes"
            title="Aperçu HyperFrames"
            // Rien de ces pages n'a besoin de vivre : ni script, ni formulaire,
            // ni même une origine. Le cadre reste donc complètement sandboxé.
            sandbox=""
            srcDoc={html}
          />
          <p className="ed-note">
            {cues.length} repère{cues.length > 1 ? "s" : ""} · {Math.round(cues.at(-1)?.end ?? 0)} s
            · lecture autonome de l&apos;animation
          </p>
        </>
      ) : null}
    </Section>
  );
}
