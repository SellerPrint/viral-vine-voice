/**
 * Police des sous-titres, partagee entre le rendu et l'apercu.
 *
 * Elle est mise en cache pour la duree de la session : la re-telecharger a
 * chaque apercu ajouterait une latence inutile.
 */
const FONT_URL = "/fonts/Roboto-Bold.ttf";

let fontBytes: Uint8Array | null = null;

export async function loadFont(signal?: AbortSignal): Promise<Uint8Array> {
  if (fontBytes) return fontBytes;
  const response = await fetch(FONT_URL, { signal });
  if (!response.ok) {
    throw new Error("Impossible de charger la police des sous-titres.");
  }
  fontBytes = new Uint8Array(await response.arrayBuffer());
  return fontBytes;
}
