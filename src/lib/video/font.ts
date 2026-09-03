/**
 * Police des sous-titres, partagee entre le rendu et l'apercu.
 *
 * Roboto ne couvre que le latin, le grec et le cyrillique. Or l'application
 * propose douze langues cibles, dont l'arabe, l'hindi, le japonais et le
 * coreen : avec Roboto, chaque caractere de ces ecritures se rendait en
 * « tofu », le rectangle vide que FreeType dessine faute de glyphe. Les
 * sous-titres etaient alors une rangee de carres.
 *
 * On choisit donc la police d'apres la langue cible, et on la met en cache par
 * langue : la retelecharger a chaque apercu ajouterait une latence inutile.
 */

/** Police par defaut, pour toutes les langues a alphabet latin. */
const DEFAULT_FONT = "/fonts/Roboto-Bold.ttf";

/**
 * Polices par ecriture. Les fichiers CJK pesent plusieurs megaoctets, d'ou le
 * chargement a la demande : un rendu en anglais ne telecharge que Roboto.
 */
const FONT_BY_LANGUAGE: Record<string, string> = {
  ar: "/fonts/NotoSansArabic-Bold.ttf",
  hi: "/fonts/NotoSansDevanagari-Bold.ttf",
  ja: "/fonts/NotoSansJP-Bold.otf",
  ko: "/fonts/NotoSansKR-Bold.otf",
};

/** Police adaptee a une langue cible, `DEFAULT_FONT` si l'alphabet est latin. */
export function fontUrlForLanguage(languageCode?: string): string {
  if (!languageCode) return DEFAULT_FONT;
  // Tolere « ja-JP », « ar_SA », etc.
  const base = languageCode.toLowerCase().split(/[-_]/)[0];
  return FONT_BY_LANGUAGE[base] ?? DEFAULT_FONT;
}

const cache = new Map<string, Uint8Array>();

export async function loadFont(signal?: AbortSignal, languageCode?: string): Promise<Uint8Array> {
  const url = fontUrlForLanguage(languageCode);

  const cached = cache.get(url);
  if (cached) return cached;

  const response = await fetch(url, { signal });
  if (!response.ok) {
    // Sans repli, une police manquante ferait echouer tout le rendu. Mieux
    // vaut des sous-titres dans une police approximative que pas de video.
    if (url !== DEFAULT_FONT) {
      console.error(`[font] ${url} introuvable, repli sur Roboto`);
      return loadFont(signal);
    }
    throw new Error("Impossible de charger la police des sous-titres.");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  cache.set(url, bytes);
  return bytes;
}

/** Vide le cache. Reserve aux tests. */
export function __resetFontCache(): void {
  cache.clear();
}
