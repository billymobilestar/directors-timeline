// src/lib/format/fountain.ts
// Minimal Fountain exporter for our ScriptLine[] structure.

export type LineType =
  | 'scene'
  | 'action'
  | 'character'
  | 'parenthetical'
  | 'dialogue'
  | 'transition'
  | 'lyric';

export type ScriptLine = { type: LineType; text: string };

/**
 * Convert ScriptLine[] to Fountain text.
 * We keep things simple and readable:
 * - scene -> as-is (e.g., "INT. OFFICE - DAY")
 * - action -> paragraph
 * - character -> uppercase name line
 * - parenthetical -> "(...)" on its own line
 * - dialogue -> one or more lines under the character/parenthetical
 * - transition -> line ending with "TO:"
 * - lyric -> we prefix with "~" (common Fountain lyric convention)
 */
export function linesToFountain(lines: ScriptLine[]): string {
  const out: string[] = [];
  let i = 0;

  const pushBlankOnce = () => {
    if (out.length && out[out.length - 1] !== '') out.push('');
  };

  while (i < lines.length) {
    const L = lines[i];
    if (!L) break;

    switch (L.type) {
      case 'scene': {
        // Ensure uppercase for safety.
        const slug = (L.text || '').trim().toUpperCase();
        pushBlankOnce();
        out.push(slug);
        pushBlankOnce();
        i++;
        break;
      }
      case 'action': {
        const txt = (L.text || '').trim();
        if (txt) {
          out.push(txt);
          pushBlankOnce();
        }
        i++;
        break;
      }
      case 'character': {
        // CHARACTER cue, then optional parenthetical + dialogue block
        const who = (L.text || '').trim().toUpperCase();
        pushBlankOnce();
        out.push(who);
        i++;

        if (i < lines.length && lines[i].type === 'parenthetical') {
          out.push((lines[i].text || '').trim());
          i++;
        }

        let hadDialogue = false;
        while (i < lines.length && lines[i].type === 'dialogue') {
          out.push((lines[i].text || '').trim());
          hadDialogue = true;
          i++;
        }
        if (hadDialogue) pushBlankOnce();
        break;
      }
      case 'parenthetical': {
        out.push((L.text || '').trim());
        pushBlankOnce();
        i++;
        break;
      }
      case 'dialogue': {
        // Dialogue without an explicit CHARACTER above — allow it anyway.
        const txt = (L.text || '').trim();
        if (txt) out.push(txt);
        i++;
        break;
      }
      case 'transition': {
        const t = (L.text || '').trim().toUpperCase();
        pushBlankOnce();
        out.push(t.endsWith('TO:') ? t : `${t} TO:`);
        pushBlankOnce();
        i++;
        break;
      }
      case 'lyric': {
        const lyr = (L.text || '').trim();
        out.push(lyr.startsWith('~') ? lyr : `~${lyr}`);
        i++;
        break;
      }
      default: {
        i++;
        break;
      }
    }
  }

  // Trim trailing blanks
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}