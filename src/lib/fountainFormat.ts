import { ScriptLine } from './scriptTypes';

export function linesToFountain(lines: ScriptLine[]): string {
  // Very simplified Fountain-ish output
  // - scene: printed as-is (assumed already normalized)
  // - character: as-is
  // - parenthetical: as-is
  // - dialogue: as-is
  // - transition: as-is
  // - lyric: with "~ " prefix
  // - action/general: as-is
  return lines
    .map(l => {
      switch (l.type) {
        case 'lyric':
          return l.text.startsWith('~') ? l.text : `~ ${l.text}`;
        default:
          return l.text;
      }
    })
    .join('\n');
}