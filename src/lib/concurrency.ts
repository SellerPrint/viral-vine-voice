/**
 * Exécute `fn` sur chaque élément avec une concurrence bornée.
 *
 * L'ordre des résultats suit l'ordre des entrées, indépendamment de l'ordre
 * d'achèvement. Utilisé pour paralléliser les appels TTS sans se faire
 * limiter par le fournisseur.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index], index);
      }
    }),
  );

  return results;
}
