// src/lib/transliteration.ts

export type LyricsLang =
  | 'en'
  | 'es'
  | 'hi'       // Hindi (Devanagari)
  | 'hi_latn'  // Hindi typed in English
  | 'pa'       // Punjabi (Gurmukhi)
  | 'pa_latn'; // Punjabi typed in English

/**
 * Placeholder: in the future, map romanized → native script before alignment.
 * For now we return the input unchanged so the UI flow works.
 */
export function transliterateIfNeeded(text: string, language: LyricsLang, normalizeScript: boolean): string {
  // Later: if language ends with _latn and normalizeScript, convert to native (Devanagari/Gurmukhi).
  return text;
}