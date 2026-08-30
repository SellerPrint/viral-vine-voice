/**
 * Transitions entre les segments conserves apres coupe des silences.
 *
 * Point critique : un fondu enchaine (`xfade`) fait **se recouvrir** deux
 * segments. Chaque transition raccourcit donc la duree totale de sa propre
 * duree. Or les sous-titres sont positionnes par `remapTime()`, qui suppose
 * une simple concatenation bout a bout.
 *
 * Sans correction, chaque transition decale tous les sous-titres suivants, et
 * l'erreur s'accumule : 12 coupes a 0,3 s font deriver la fin de 3,6 s.
 * `remapTimeWithTransitions()` ci-dessous integre ce recouvrement.
 */
export type TransitionType = "none" | "fade" | "fadeblack" | "slideleft" | "dissolve";

export const TRANSITIONS: { id: TransitionType; name: string; xfade: string }[] = [
  { id: "none", name: "Coupe franche", xfade: "" },
  { id: "fade", name: "Fondu", xfade: "fade" },
  { id: "fadeblack", name: "Fondu au noir", xfade: "fadeblack" },
  { id: "dissolve", name: "Dissolution", xfade: "dissolve" },
  { id: "slideleft", name: "Glissement", xfade: "slideleft" },
];

export type Keep = { start: number; end: number };

/**
 * Duree de transition reellement applicable entre deux segments.
 *
 * Un `xfade` plus long que le segment le plus court produit un graphe invalide
 * ou une image figee. On borne donc a un tiers du plus court des deux
 * segments, et on renonce en dessous d'un seuil ou l'effet serait invisible.
 */
export function effectiveTransitionDuration(requested: number, previous: Keep, next: Keep): number {
  if (requested <= 0) return 0;
  const shortest = Math.min(previous.end - previous.start, next.end - next.start);
  const capped = Math.min(requested, shortest / 3);
  return capped >= 0.08 ? Number(capped.toFixed(3)) : 0;
}

/** Duree de transition retenue avant chaque segment (index 0 : toujours 0). */
export function transitionDurations(keeps: Keep[], requested: number): number[] {
  return keeps.map((keep, i) =>
    i === 0 ? 0 : effectiveTransitionDuration(requested, keeps[i - 1], keep),
  );
}

/**
 * Convertit un temps de la video source vers la timeline finale, en tenant
 * compte du recouvrement introduit par les transitions.
 *
 * Sans transition, le resultat est identique a `remapTime()`.
 */
export function remapTimeWithTransitions(time: number, keeps: Keep[], durations: number[]): number {
  if (!keeps.length) return time;

  let accumulated = 0;
  for (let i = 0; i < keeps.length; i++) {
    const keep = keeps[i];
    // Chaque transition fait remonter le segment courant sur le precedent.
    const overlap = durations[i] ?? 0;
    accumulated -= overlap;

    if (time <= keep.start) return Math.max(0, accumulated);
    if (time <= keep.end) return Math.max(0, accumulated + (time - keep.start));
    accumulated += keep.end - keep.start;
  }
  return Math.max(0, accumulated);
}

/** Duree finale de la video apres coupes et transitions. */
export function totalDuration(keeps: Keep[], durations: number[]): number {
  const kept = keeps.reduce((sum, k) => sum + (k.end - k.start), 0);
  const overlap = durations.reduce((sum, d) => sum + d, 0);
  return Math.max(0, kept - overlap);
}

/**
 * Construit la chaine `xfade` enchainant les segments deja decoupes.
 *
 * `offset` est exprime dans la timeline **de sortie** et doit pointer sur le
 * debut du fondu, soit la fin du cumul precedent moins la duree du fondu.
 */
export function buildXfadeChain(
  labels: string[],
  keeps: Keep[],
  durations: number[],
  type: TransitionType,
  outLabel: string,
  fps = 30,
): string {
  const spec = TRANSITIONS.find((t) => t.id === type);
  if (!spec || !spec.xfade || labels.length < 2) return "";

  let graph = "";

  // `xfade` exige une cadence CONSTANTE sur ses deux entrees. Or `trim` +
  // `setpts=PTS-STARTPTS` produit un flux a cadence variable, ce qui fait
  // echouer le filtre avec :
  //   « The inputs needs to be a constant frame rate; current rate of 1/0 is
  //     invalid »
  // On normalise donc chaque segment avant de l'enchainer.
  const normalized = labels.map((label, i) => {
    const out = `xn${i}`;
    graph += `[${label}]fps=${fps},format=yuv420p,setsar=1[${out}];`;
    return out;
  });

  let previous = normalized[0];
  let elapsed = keeps[0].end - keeps[0].start;

  for (let i = 1; i < labels.length; i++) {
    const duration = durations[i] ?? 0;
    const out = i === labels.length - 1 ? outLabel : `xf${i}`;

    if (duration <= 0) {
      // Pas de fondu possible ici : concatenation simple.
      graph += `[${previous}][${normalized[i]}]concat=n=2:v=1:a=0[${out}];`;
      elapsed += keeps[i].end - keeps[i].start;
    } else {
      const offset = Math.max(0, elapsed - duration);
      graph += `[${previous}][${normalized[i]}]xfade=transition=${spec.xfade}:duration=${duration}:offset=${offset.toFixed(3)}[${out}];`;
      elapsed += keeps[i].end - keeps[i].start - duration;
    }
    previous = out;
  }

  return graph;
}

/**
 * Equivalent audio de `buildXfadeChain`.
 *
 * `acrossfade` raccourcit le flux audio exactement comme `xfade` raccourcit la
 * video. Les deux doivent utiliser les memes durees, faute de quoi l'image et
 * le son se desynchronisent progressivement.
 */
export function buildAcrossfadeChain(
  labels: string[],
  durations: number[],
  outLabel: string,
): string {
  if (labels.length < 2) return "";

  let graph = "";
  let previous = labels[0];

  for (let i = 1; i < labels.length; i++) {
    const duration = durations[i] ?? 0;
    const out = i === labels.length - 1 ? outLabel : `af${i}`;
    graph +=
      duration > 0
        ? `[${previous}][${labels[i]}]acrossfade=d=${duration}:c1=tri:c2=tri[${out}];`
        : `[${previous}][${labels[i]}]concat=n=2:v=0:a=1[${out}];`;
    previous = out;
  }
  return graph;
}
