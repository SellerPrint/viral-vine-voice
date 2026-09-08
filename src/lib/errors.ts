/**
 * Extraction d'un message lisible depuis une erreur de forme inconnue.
 *
 * ## Le probleme
 *
 * `String(error)` sur un objet qui n'est pas une `Error` renvoie la chaine
 * `"[object Object]"`. C'est la valeur qui s'affichait dans l'interface a la
 * place du vrai message : l'utilisateur voyait un texte vide de sens, et le
 * diagnostic reel etait perdu.
 *
 * Le cas se produit des qu'une erreur **traverse une frontiere**. TanStack
 * Start serialise les erreurs des fonctions serveur : cote client on ne
 * recoit plus une instance d'`Error` mais un objet nu. Meme chose pour une
 * erreur de validation Zod (un tableau), une reponse `fetch` rejetee, ou une
 * valeur relancee depuis un worker.
 *
 * `describe()` inspecte donc la valeur au lieu de la convertir aveuglement.
 */

/** Longueur au-dela de laquelle un message devient illisible dans l'UI. */
const MAX_LENGTH = 300;

function truncate(text: string): string {
  const clean = text.trim();
  return clean.length > MAX_LENGTH ? `${clean.slice(0, MAX_LENGTH)}…` : clean;
}

/**
 * Vrai si la chaine n'apporte aucune information a l'utilisateur.
 *
 * `String(objet)` produit ces valeurs : les afficher revient a ne rien dire.
 */
function isUseless(text: string): boolean {
  const clean = text.trim();
  return (
    clean === "" ||
    clean === "[object Object]" ||
    clean === "{}" ||
    clean === "undefined" ||
    clean === "null" ||
    /^\[object \w+\]$/.test(clean)
  );
}

/**
 * Cherche un message exploitable dans un objet de forme inconnue.
 *
 * Les differentes couches nomment ce champ differemment : `message` pour une
 * `Error` serialisee, `error` pour beaucoup d'API JSON, `detail` pour FastAPI
 * et consorts, `statusText` pour une `Response`.
 */
function fromObject(value: Record<string, unknown>): string | null {
  for (const key of ["message", "error", "detail", "description", "statusText"]) {
    const candidate = value[key];

    if (typeof candidate === "string" && !isUseless(candidate)) {
      return candidate;
    }
    // `{ error: { message: "..." } }` est une forme courante (OpenAI, Google).
    if (candidate && typeof candidate === "object") {
      const nested = fromObject(candidate as Record<string, unknown>);
      if (nested) return nested;
    }
  }

  // Une `Response` non lue : au moins indiquer le code HTTP.
  const status = value.status ?? value.statusCode;
  if (typeof status === "number") {
    return `Erreur ${status}`;
  }

  return null;
}

/**
 * Renvoie un message lisible pour n'importe quelle valeur levee.
 *
 * Ne leve jamais et ne renvoie jamais de chaine vide : l'appelant peut
 * l'afficher directement.
 */
export function describe(error: unknown, fallback = "Une erreur inattendue est survenue."): string {
  if (error instanceof Error) {
    // `AggregateError` porte le detail dans ses erreurs internes.
    if (isUseless(error.message) && "errors" in error) {
      const inner = (error as AggregateError).errors;
      if (Array.isArray(inner) && inner.length) return describe(inner[0], fallback);
    }
    return isUseless(error.message) ? fallback : truncate(error.message);
  }

  if (typeof error === "string") {
    return isUseless(error) ? fallback : truncate(error);
  }

  // Zod renvoie un tableau d'anomalies ; la premiere suffit a orienter.
  if (Array.isArray(error) && error.length) {
    const first = describe(error[0], "");
    if (first) return first;
  }

  if (error && typeof error === "object") {
    const found = fromObject(error as Record<string, unknown>);
    if (found) return truncate(found);
  }

  return fallback;
}

/**
 * Variante prefixee par le contexte, pour situer l'echec.
 *
 * « Traduction : quota depasse » est bien plus actionnable que « quota
 * depasse » seul, quand le rendu enchaine transcription, traduction et
 * synthese vocale.
 */
export function describeWithContext(context: string, error: unknown, fallback?: string): string {
  return `${context} : ${describe(error, fallback)}`;
}
