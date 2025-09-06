import type { ParsedScript } from '@/lib/scriptTypes';
import { parseScript } from '@/lib/scriptParser';

/**
 * Fountain importer (dependency-free)
 * Reuses the project's heuristic script parser to split into scenes and lines.
 * Supports .fountain and .txt (Fountain-ish) without relying on external libs.
 * Kept async to match existing call sites/tests that await this function.
 */
export async function importFountainToScenes(text: string): Promise<ParsedScript> {
  return Promise.resolve(parseScript(text || ''));
}