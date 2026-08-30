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
import { getFfmpeg } from "./ffmpeg-client";
import { loadFont } from "./font";
import { buildStyleBits, withOpacity } from "./ffmpeg/graph";
import type { SubtitlePreset } from "./presets";
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
  signal?: AbortSignal;
};

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
    signal,
  } = options;

  const ff = await getFfmpeg();
  signal?.throwIfAborted();

  const input = "preview-in.mp4";
  const output = "preview-out.jpg";
  const textFile = "preview-text.txt";

  await ff.writeFile(input, videoBytes);

  try {
    const chain: string[] = [];

    const look = buildLookFilters(filterId, upscale, videoWidth, videoHeight);
    if (look) chain.push(look);

    // L'apercu du texte reprend `buildStyleBits`, donc toute evolution du
    // style se reflete ici sans duplication de logique.
    if (sampleText && preset) {
      // `drawtext` echoue sans fichier de police dans le systeme de fichiers
      // virtuel : le rendu l'ecrit de son cote, l'apercu doit faire de meme.
      await ff.writeFile("font.ttf", await loadFont(signal));
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
        `drawtext=fontfile=font.ttf:textfile=${textFile}:reload=0:${buildStyleBits(preset)}:x=(w-text_w)/2:y=h*${anchor.toFixed(3)}-text_h/2`,
      );
    }

    const args = ["-y", "-ss", String(atSecond), "-i", input];
    if (chain.length) args.push("-vf", chain.join(","));
    args.push("-frames:v", "1", "-q:v", "3", output);

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
