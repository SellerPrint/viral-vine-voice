/**
 * Apercu fidele du rendu, produit par FFmpeg lui-meme.
 *
 * L'apercu extrait **une seule image** et lui applique exactement la meme
 * chaine de filtres que le rendu final. Un apercu CSS serait instantane mais
 * mentirait : `unsharp` et `colortemperature` n'ont pas d'equivalent CSS
 * exact, et l'upscale ne se voit pas du tout.
 *
 * Cout : environ une a deux secondes par apercu, sur une image et non sur la
 * video entiere.
 */
import { buildLookFilters, type UpscaleMode } from "./filters";
import { getFfmpeg, writeFileSafe } from "./ffmpeg-client";
import { loadFont } from "./font";
import {
  buildBlurChain,
  buildStyleBits,
  type MaskStrength,
  type Rect,
  resolveMasks,
  withOpacity,
} from "./ffmpeg/graph";
import type { MaskZone, SubtitlePreset } from "./presets";
import { wrapLines } from "./subtitles/cues";

export type PreviewOptions = {
  filterId?: string;
  upscale?: UpscaleMode;
  videoWidth?: number;
  videoHeight?: number;
  /** Texte d'exemple incruste pour juger du style des sous-titres. */
  sampleText?: string;
  preset?: SubtitlePreset;
  subYAnchor?: number;
  /** Instant de la video a echantillonner, en secondes. */
  atSecond?: number;
  /** Code de langue cible : choisit la police (arabe, hindi, CJK...). */
  languageCode?: string;
  /**
   * Zones a flouter.
   *
   * L'apercu les ignorait : on ne pouvait juger de leur effet qu'apres un
   * rendu complet, alors que c'est precisement le reglage qui abime le plus
   * l'image quand il est mal place.
   */
  masks?: MaskZone[];
  /** Intensite du floutage, alignee sur le rendu final. */
  maskStrength?: MaskStrength;
  signal?: AbortSignal;
};

/**
 * Construit les arguments de filtrage de l'apercu.
 *
 * Extrait de `renderPreviewFrame` pour etre **testable sans WebAssembly** :
 * la logique de graphe est la partie qui casse silencieusement, alors que
 * l'execution ffmpeg elle-meme est deja couverte par les tests e2e.
 *
 * Sans masque, un simple `-vf` suffit. Des qu'une zone est floutee il faut un
 * `-filter_complex` : `crop` + `overlay` exigent un graphe ramifie, impossible
 * a exprimer dans une chaine lineaire.
 */
export function buildPreviewArgs(
  rects: Rect[],
  chain: string[],
  lookChain: string,
  maskStrength: MaskStrength,
): string[] {
  if (!rects.length) {
    return chain.length ? ["-vf", chain.join(",")] : [];
  }

  // `chain` commence par la chaine « look » quand elle existe ; le reste
  // concerne le texte, qui doit passer APRES les masques.
  const textChain = lookChain ? chain.slice(1) : chain;

  let complex = `[0:v]${lookChain ? `${lookChain},` : ""}split=${rects.length + 1}[base]${rects
    .map((_, i) => `[z${i}]`)
    .join("")};`;

  rects.forEach((rect, i) => {
    complex += `[z${i}]crop=${rect.w}:${rect.h}:${rect.x}:${rect.y},${buildBlurChain(
      maskStrength,
      rect,
    )}[b${i}];`;
  });

  let previous = "base";
  rects.forEach((rect, i) => {
    const out = i === rects.length - 1 ? "masked" : `o${i}`;
    complex += `[${previous}][b${i}]overlay=${rect.x}:${rect.y}[${out}];`;
    previous = out;
  });

  // `null` : un graphe doit relier [masked] a [vout] meme sans filtre de texte.
  complex += `[masked]${textChain.length ? textChain.join(",") : "null"}[vout]`;

  return ["-filter_complex", complex, "-map", "[vout]"];
}

/**
 * Genere une image d'apercu et renvoie une URL d'objet.
 *
 * L'appelant est responsable de `URL.revokeObjectURL()`.
 */
export async function renderPreviewFrame(
  videoBytes: Uint8Array,
  options: PreviewOptions = {},
): Promise<string> {
  const {
    filterId,
    upscale = "none",
    videoWidth = 0,
    videoHeight = 0,
    sampleText,
    preset,
    subYAnchor,
    atSecond = 1,
    languageCode,
    masks,
    maskStrength = "medium",
    signal,
  } = options;

  const ff = await getFfmpeg();
  signal?.throwIfAborted();

  const input = "preview-in.mp4";
  const output = "preview-out.jpg";
  const textFile = "preview-text.txt";

  // Copie imperative : le meme `videoBytes` sera reutilise au prochain
  // apercu et surtout par le rendu final.
  await writeFileSafe(ff, input, videoBytes);

  try {
    const chain: string[] = [];

    const look = buildLookFilters(filterId, upscale, videoWidth, videoHeight);
    const lookChain = look || "";
    if (look) chain.push(look);

    // Les masques s'appliquent avant le texte, exactement comme dans
    // `buildGraph` : un sous-titre incruste par l'application ne doit jamais
    // etre floute par une zone.
    //
    // `crop`+`overlay` est impossible dans un `-vf` simple (une seule chaine
    // lineaire). On utilise donc l'astuce des filtres `enable` de `boxblur`
    // via un filtergraph complet lorsqu'il y a des masques.
    const rects = masks ? resolveMasks(masks, videoWidth, videoHeight) : [];

    // L'apercu du texte reprend `buildStyleBits`, donc toute evolution du
    // style se reflete ici sans duplication de logique.
    if (sampleText && preset) {
      // `drawtext` echoue sans fichier de police dans le systeme de fichiers
      // virtuel : le rendu l'ecrit de son cote, l'apercu doit faire de meme.
      await writeFileSafe(ff, "font.ttf", await loadFont(signal, languageCode));
      const wrapped = wrapLines(
        preset.uppercase ? sampleText.toUpperCase() : sampleText,
        preset.maxCharsPerLine,
        preset.maxLines,
      ).join("\n");
      await ff.writeFile(textFile, new TextEncoder().encode(wrapped));

      const anchor = subYAnchor ?? preset.yAnchor;
      const plate = withOpacity(preset.boxColor, preset.plateOpacity ?? 0.92);
      if ((preset.plateOpacity ?? 0) > 0.01) {
        chain.push(`drawbox=x=0:y=ih*0.82:w=iw:h=ih*0.14:color=${plate}:t=fill`);
      }
      chain.push(
        `drawtext=fontfile=font.ttf:textfile=${textFile}:reload=0:expansion=none:${buildStyleBits(preset)}:x=(w-text_w)/2:y=h*${anchor.toFixed(3)}-text_h/2`,
      );
    }

    const args = [
      "-y",
      "-ss",
      String(atSecond),
      "-i",
      input,
      ...buildPreviewArgs(rects, chain, lookChain, maskStrength),
      "-frames:v",
      "1",
      "-q:v",
      "3",
      output,
    ];

    const code = await ff.exec(args);
    if (code !== 0) throw new Error("L'aperçu n'a pas pu être généré.");

    const bytes = (await ff.readFile(output)) as Uint8Array;
    // `slice()` detache la vue du tas WASM, qui sera reutilise.
    return URL.createObjectURL(new Blob([bytes.slice()], { type: "image/jpeg" }));
  } finally {
    for (const name of [input, output, textFile]) {
      try {
        await ff.deleteFile(name);
      } catch {
        // Fichier absent : sans consequence.
      }
    }
  }
}
