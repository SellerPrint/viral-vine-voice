/**
 * Langues source supportées pour la transcription et la traduction.
 *
 * La langue source était auparavant figée sur le français à trois endroits
 * (code ISO ElevenLabs, prompt de traduction, message système). Elle est
 * désormais un paramètre de bout en bout.
 */
export type SourceLanguage = {
  /** Code ISO 639-3 attendu par ElevenLabs Scribe. */
  code: string;
  /** Libellé affiché dans l'interface. */
  label: string;
  /** Nom anglais utilisé dans les prompts de traduction. */
  name: string;
};

export const SOURCE_LANGUAGES: SourceLanguage[] = [
  { code: "fra", label: "Français", name: "French" },
  { code: "eng", label: "Anglais", name: "English" },
  { code: "spa", label: "Espagnol", name: "Spanish" },
  { code: "deu", label: "Allemand", name: "German" },
  { code: "ita", label: "Italien", name: "Italian" },
  { code: "por", label: "Portugais", name: "Portuguese" },
  { code: "ara", label: "Arabe", name: "Arabic" },
];

export const DEFAULT_SOURCE_LANGUAGE = SOURCE_LANGUAGES[0];

export const SOURCE_LANGUAGE_CODES = SOURCE_LANGUAGES.map((l) => l.code);

/**
 * Indique si la langue source et la langue cible designent la meme langue.
 *
 * Les deux listes n'utilisent pas la meme norme : les langues sources sont en
 * ISO 639-3 (« fra », « eng ») parce que c'est ce qu'attend ElevenLabs Scribe,
 * les langues cibles en ISO 639-1 (« fr », « en »). Une comparaison directe
 * des codes ne detecterait donc jamais l'egalite.
 *
 * On compare le nom anglais, qui est commun aux deux listes.
 *
 * Sans ce controle, choisir Francais -> Francais lance une transcription, une
 * traduction et une synthese vocale completes pour reecrire le meme texte :
 * des credits IA depenses pour rien.
 */
export function isSameLanguage(
  sourceName: string | undefined,
  targetName: string | undefined,
): boolean {
  if (!sourceName || !targetName) return false;
  // « Portuguese » cote source, « Portuguese (Brazil) » cote cible : on
  // compare la partie avant la parenthese.
  const normalise = (value: string) => value.split("(")[0].trim().toLowerCase();
  return normalise(sourceName) === normalise(targetName);
}
