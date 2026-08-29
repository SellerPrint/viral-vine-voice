import { describe, expect, it } from "vitest";

import { mapLimit } from "./concurrency";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe("mapLimit", () => {
  it("préserve l'ordre des entrées", async () => {
    const result = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      await tick(Math.random() * 5);
      return n * 2;
    });
    expect(result).toEqual([2, 4, 6, 8, 10]);
  });

  it("gère une liste vide", async () => {
    expect(await mapLimit([], 4, async (n) => n)).toEqual([]);
  });

  it("ne dépasse jamais la concurrence demandée", async () => {
    let active = 0;
    let peak = 0;
    await mapLimit(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async (n) => {
        active++;
        peak = Math.max(peak, active);
        await tick(2);
        active--;
        return n;
      },
    );
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("transmet l'index à la fonction", async () => {
    expect(await mapLimit(["a", "b", "c"], 2, async (item, i) => `${i}:${item}`)).toEqual([
      "0:a",
      "1:b",
      "2:c",
    ]);
  });

  it("propage la première erreur", async () => {
    await expect(
      mapLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });

  it("traite tous les éléments quand la limite dépasse leur nombre", async () => {
    expect(await mapLimit([1, 2], 10, async (n) => n + 1)).toEqual([2, 3]);
  });

  it("est plus rapide qu'un traitement séquentiel", async () => {
    const started = Date.now();
    await mapLimit(
      Array.from({ length: 8 }, (_, i) => i),
      4,
      async () => tick(20),
    );
    // Séquentiel : ~160 ms. Avec 4 en parallèle : ~40 ms.
    expect(Date.now() - started).toBeLessThan(120);
  });
});
