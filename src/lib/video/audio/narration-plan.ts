/**
 * Placement des clips de voix off sur la timeline.
 *
 * Le placement naif — chaque clip demarre a `segment.start` et joue a sa
 * vitesse naturelle — pose trois problemes des que la traduction est plus
 * longue que le segment d'origine (frequent du francais vers l'anglais) :
 *
 * 1. Les clips **se chevauchent** : deux voix parlent en meme temps.
 * 2. Le dernier clip **depasse la duree de la video**. Le mixage
 *    `amix=duration=first` (ou la duree de la piste video) tronque alors la
 *    fin : les sous-titres continuent, la voix s'arrete.
 * 3. Le decalage **s'accumule** : chaque debordement repousse la suite.
 *
 * Ce module calcule un plan explicite. Le principe est de repartir le
 * depassement sur l'ensemble des clips plutot que de le laisser s'accumuler
 * sur les derniers, qui seraient purement et simplement perdus.
 */
export type ClipRequest = {
  /** Debut souhaite, en secondes (celui du segment d'origine). */
  start: number;
  /** Fin du segment d'origine. */
  end: number;
  /** Duree naturelle du clip synthetise, en secondes. */
  duration: number;
};

export type PlannedClip = {
  /** Instant de demarrage retenu. */
  start: number;
  /** Facteur de lecture applique (1 = vitesse naturelle). */
  rate: number;
  /** Duree effective apres application de `rate`. */
  playedDuration: number;
};

/**
 * Acceleration maximale acceptable.
 *
 * Au-dela, la voix devient desagreable et l'API la refuse de toute facon
 * (`speed` est borne a 1.2 cote schema).
 */
export const MAX_RATE = 1.2;

/** Marge de fin : on evite de coller la derniere syllabe au dernier cadre. */
const TAIL_MARGIN = 0.05;

/**
 * Ordonnance les clips sans chevauchement et en tenant dans `totalDuration`.
 *
 * Strategie, dans l'ordre :
 * 1. chaque clip demarre au plus tot a son instant d'origine, jamais avant la
 *    fin du precedent (pas de voix superposees) ;
 * 2. si un clip deborde sur le suivant, on l'accelere jusqu'a `MAX_RATE` ;
 * 3. si l'ensemble depasse encore la duree de la video, on applique une
 *    compression globale — repartie sur tous les clips — pour que le dernier
 *    se termine avant la fin. Mieux vaut une voix legerement plus rapide
 *    partout qu'une fin de video muette.
 */
export function planNarrationClips(requests: ClipRequest[], totalDuration: number): PlannedClip[] {
  if (!requests.length) return [];

  const ordered = [...requests].sort((a, b) => a.start - b.start);

  // Passe 1 : placement sequentiel, acceleration locale si le clip mord sur
  // le debut du segment suivant.
  const firstPass: PlannedClip[] = [];
  let cursor = 0;

  ordered.forEach((request, index) => {
    const start = Math.max(request.start, cursor);
    const next = ordered[index + 1];

    // Espace disponible avant le prochain segment, ou avant la fin de la video
    // pour le dernier clip.
    const available = Math.max(0.2, (next ? next.start : totalDuration) - start);

    const rate =
      request.duration > available ? Math.min(MAX_RATE, request.duration / available) : 1;

    const playedDuration = request.duration / rate;
    firstPass.push({ start, rate, playedDuration });
    cursor = start + playedDuration;
  });

  const overshoot = cursor - (totalDuration - TAIL_MARGIN);
  if (overshoot <= 0) return firstPass;

  // Passe 2 : le total deborde malgre l'acceleration locale. On compresse
  // globalement plutot que de laisser la fin etre tronquee.
  const spoken = firstPass.reduce((sum, clip) => sum + clip.playedDuration, 0);
  const usable = Math.max(0.1, totalDuration - TAIL_MARGIN);

  // Facteur necessaire pour que la somme des clips tienne dans la video, en
  // supprimant tous les silences intercalaires si besoin.
  const globalRate = Math.min(MAX_RATE, Math.max(1, spoken / usable));

  const secondPass: PlannedClip[] = [];
  cursor = 0;

  ordered.forEach((request, index) => {
    const rate = Math.min(MAX_RATE, Math.max(firstPass[index].rate, globalRate));
    const playedDuration = request.duration / rate;

    // On conserve l'ancrage d'origine tant qu'il ne cree pas de chevauchement.
    const start = Math.max(Math.min(request.start, usable - playedDuration), cursor);
    secondPass.push({ start: Math.max(0, start), rate, playedDuration });
    cursor = Math.max(0, start) + playedDuration;
  });

  return secondPass;
}

/** Instant de fin du dernier clip, pour verifier qu'il tient dans la video. */
export function planEnd(clips: PlannedClip[]): number {
  return clips.reduce((max, clip) => Math.max(max, clip.start + clip.playedDuration), 0);
}

/**
 * Depassement residuel apres planification, en secondes.
 *
 * Il reste positif quand le texte traduit est physiquement trop long pour la
 * duree de la video : a `MAX_RATE` = 1,2x, on ne peut pas faire entrer 15 s de
 * parole dans 10 s. C'est une limite reelle, pas un defaut de placement, et
 * elle doit etre signalee a l'utilisateur plutot que masquee par une troncature
 * silencieuse.
 */
export function planOvershoot(clips: PlannedClip[], totalDuration: number): number {
  return Math.max(0, planEnd(clips) - totalDuration);
}
