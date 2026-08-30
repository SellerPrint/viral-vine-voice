import { describe, expect, it } from "vitest";

import { MAX_RATE, planEnd, planNarrationClips, planOvershoot } from "./narration-plan";

/** Aucun clip ne doit démarrer avant la fin du précédent. */
function hasOverlap(clips: { start: number; playedDuration: number }[]): boolean {
  return clips.some(
    (clip, i) => i > 0 && clip.start < clips[i - 1].start + clips[i - 1].playedDuration - 1e-6,
  );
}

describe("planification de la voix off", () => {
  it("ne touche à rien quand tout tient confortablement", () => {
    const plan = planNarrationClips(
      [
        { start: 0, end: 3, duration: 2 },
        { start: 4, end: 7, duration: 2.5 },
      ],
      10,
    );
    expect(plan[0]).toMatchObject({ start: 0, rate: 1 });
    expect(plan[1]).toMatchObject({ start: 4, rate: 1 });
    expect(planOvershoot(plan, 10)).toBe(0);
  });

  it("ne fait jamais se chevaucher deux clips", () => {
    // Cas réel : la traduction anglaise est plus longue que le français.
    const plan = planNarrationClips(
      [
        { start: 0, end: 2, duration: 3.21 },
        { start: 2.2, end: 4.5, duration: 4.29 },
        { start: 5, end: 6.5, duration: 3.57 },
        { start: 7, end: 9, duration: 5.0 },
        { start: 9.2, end: 10, duration: 2.86 },
      ],
      10,
    );
    expect(hasOverlap(plan)).toBe(false);
  });

  it("décale un clip qui déborde, sans le laisser mordre sur le suivant", () => {
    // Ce cas ne déclenche PAS la compression globale (le total tient dans la
    // vidéo) : seul le décalage séquentiel peut éviter le chevauchement, ce qui
    // teste réellement `Math.max(request.start, cursor)`.
    const plan = planNarrationClips(
      [
        { start: 0, end: 1, duration: 2.5 },
        { start: 1, end: 2, duration: 1.0 },
      ],
      20,
    );
    expect(hasOverlap(plan)).toBe(false);
    // Le second clip doit être repoussé après la fin du premier, pas rester
    // à son ancrage d'origine (1 s), qui provoquerait un chevauchement.
    expect(plan[1].start).toBeGreaterThan(1.5);
  });

  it("n'accélère jamais au-delà de la limite de l'API", () => {
    const plan = planNarrationClips([{ start: 0, end: 1, duration: 30 }], 10);
    for (const clip of plan) {
      expect(clip.rate).toBeLessThanOrEqual(MAX_RATE + 1e-9);
    }
  });

  it("reproduit le symptôme signalé : la voix ne doit plus s'arrêter avant la fin", () => {
    // Sans planification, le placement naïf plaçait le dernier clip à 9,2 s
    // pour 2,86 s de parole : il finissait à 12 s et était tronqué.
    const requests = [
      { start: 0, end: 2, duration: 3.21 },
      { start: 2.2, end: 4.5, duration: 4.29 },
      { start: 9.2, end: 10, duration: 2.86 },
    ];
    const naiveEnd = Math.max(...requests.map((r) => r.start + r.duration));
    expect(naiveEnd).toBeGreaterThan(10);

    const plan = planNarrationClips(requests, 10);
    // Le plan doit rapprocher la fin de la durée réelle de la vidéo.
    expect(planEnd(plan)).toBeLessThan(naiveEnd);
  });

  it("signale un dépassement quand le texte est physiquement trop long", () => {
    // 18 s de parole dans 10 s de vidéo : impossible même à 1,2x.
    const plan = planNarrationClips([{ start: 0, end: 10, duration: 18 }], 10);
    expect(planOvershoot(plan, 10)).toBeGreaterThan(0);
  });

  it("ne signale aucun dépassement quand tout rentre", () => {
    const plan = planNarrationClips([{ start: 0, end: 5, duration: 4 }], 10);
    expect(planOvershoot(plan, 10)).toBe(0);
  });

  it("préserve l'ordre chronologique même si l'entrée est désordonnée", () => {
    const plan = planNarrationClips(
      [
        { start: 5, end: 7, duration: 1.5 },
        { start: 0, end: 2, duration: 1.5 },
      ],
      10,
    );
    expect(plan[0].start).toBeLessThan(plan[1].start);
  });

  it("gère une liste vide sans erreur", () => {
    expect(planNarrationClips([], 10)).toEqual([]);
    expect(planEnd([])).toBe(0);
  });

  it("compresse globalement plutôt que de tronquer la fin", () => {
    // Beaucoup de segments denses : la passe 2 doit s'activer.
    const requests = Array.from({ length: 6 }, (_, i) => ({
      start: i * 1.6,
      end: i * 1.6 + 1.2,
      duration: 2.2,
    }));
    const plan = planNarrationClips(requests, 10);
    expect(hasOverlap(plan)).toBe(false);
    // Tous les clips restent présents : aucun n'est supprimé.
    expect(plan).toHaveLength(6);
    // Et l'accélération est bien répartie, pas concentrée sur le dernier.
    expect(plan.every((c) => c.rate > 1)).toBe(true);
  });
});
