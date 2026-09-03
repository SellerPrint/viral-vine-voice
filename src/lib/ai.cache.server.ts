/**
 * Cache des réponses IA, partagé entre instances.
 *
 * Deux dépenses se répètent inutilement :
 *
 *   - la **traduction** : relancer un rendu sur la même vidéo retraduit les
 *     mêmes segments, mot pour mot ;
 *   - la **synthèse vocale** : un segment identique, avec la même voix et la
 *     même vitesse, produit le même audio — et c'est le poste le plus cher.
 *
 * La clé est une empreinte du *contenu de la requête*, jamais un identifiant
 * de session : deux utilisateurs qui doublent la même vidéo profitent du même
 * cache, et un changement de texte, de voix ou de vitesse produit
 * mécaniquement une clé différente.
 *
 * Le stockage est celui de `kv.server.ts` : Redis si configuré, mémoire
 * locale sinon. Sans Redis le cache reste utile au sein d'une instance, sans
 * jamais devenir une source d'incohérence.
 */

import { kvGet, kvSet } from "./kv.server";

/** Les traductions sont stables : on peut les garder longtemps. */
const TRANSLATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * L'audio est volumineux : durée plus courte pour ne pas saturer le magasin.
 */
const SPEECH_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Au-delà de cette taille, on ne met pas l'audio en cache.
 *
 * Un clip de synthèse dépasse rarement quelques centaines de kilo-octets ;
 * au-delà, le coût de stockage et de transfert annule le gain.
 */
const MAX_CACHED_AUDIO_CHARS = 400_000;

async function hash(parts: unknown[]): Promise<string> {
  const payload = JSON.stringify(parts);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/* ─────────────────────────── Traduction ─────────────────────────── */

export type CachedTranslation = {
  segments: unknown[];
  untranslated: number;
};

export async function translationCacheKey(input: {
  segments: { text: string; start: number; end: number }[];
  sourceLanguage: string;
  targetLanguage: string;
}): Promise<string> {
  // Seul le texte compte pour la traduction : inclure les horodatages
  // ferait manquer le cache au moindre décalage de découpe.
  return `tr:${await hash([
    input.segments.map((s) => s.text),
    input.sourceLanguage,
    input.targetLanguage,
  ])}`;
}

export async function readTranslationCache(key: string): Promise<CachedTranslation | null> {
  const raw = await kvGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedTranslation;
  } catch {
    // Entrée corrompue : on l'ignore et on régénère.
    return null;
  }
}

export async function writeTranslationCache(key: string, value: CachedTranslation): Promise<void> {
  await kvSet(key, JSON.stringify(value), TRANSLATION_TTL_MS);
}

/* ──────────────────────── Synthèse vocale ───────────────────────── */

export async function speechCacheKey(input: {
  text: string;
  voiceId: string;
  speed: number;
  provider: string;
  direction: string;
}): Promise<string> {
  // La vitesse est arrondie : deux valeurs séparées de 0,001 donneraient un
  // audio indiscernable, mais deux clés distinctes.
  return `sp:${await hash([
    input.text,
    input.voiceId,
    Math.round(input.speed * 100),
    input.provider,
    input.direction,
  ])}`;
}

export async function readSpeechCache(key: string): Promise<string | null> {
  return kvGet(key);
}

export async function writeSpeechCache(key: string, audioBase64: string): Promise<void> {
  if (audioBase64.length > MAX_CACHED_AUDIO_CHARS) return;
  await kvSet(key, audioBase64, SPEECH_TTL_MS);
}

/** Exposé pour les tests et le diagnostic. */
export const CACHE_LIMITS = {
  TRANSLATION_TTL_MS,
  SPEECH_TTL_MS,
  MAX_CACHED_AUDIO_CHARS,
} as const;
