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
