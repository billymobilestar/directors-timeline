import { XMLParser } from 'fast-xml-parser';
import type { ParsedScript, SceneBlock, ScriptLine } from '@/lib/scriptTypes';

function toLineTypeFromFDX(elemType: string): ScriptLine['type'] {
  // Map FDX elements to our types
  switch (elemType) {
    case 'Scene Heading': return 'scene';
    case 'Action': return 'action';
    case 'Character': return 'character';
    case 'Parenthetical': return 'parenthetical';
    case 'Dialogue': return 'dialogue';
    case 'Transition': return 'transition';
    default: return 'action';
  }
}

function coerceText(x: any): string {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  // Some FDX text is { '#text': '...' }
  if (typeof x === 'object' && typeof x['#text'] === 'string') return x['#text'];
  return String(x ?? '');
}

function sceneEstSeconds(lines: ScriptLine[]): number {
  let est = lines.reduce((acc, l) => {
    switch (l.type) {
      case 'action': return acc + 2.0;
      case 'dialogue': return acc + 1.5;
      case 'parenthetical': return acc + 0.8;
      case 'lyric': return acc + 1.2;
      default: return acc;
    }
  }, 0);
  return Math.max(10, Math.min(est, 180));
}

export function importFdxToScenes(xml: string): ParsedScript {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    textNodeName: '#text',
    preserveOrder: false,
    trimValues: true,
  });

  const json: any = parser.parse(xml || '');
  const fd = json.FinalDraft || json['FinalDraft'];
  if (!fd) {
    return { scenes: [], warnings: ['Not a valid .fdx file (no <FinalDraft> root).'] };
  }

  // Document/Content/Paragraphs/Paragraph
  const paragraphs = fd?.Content?.Paragraph || fd?.Content?.Paragraphs?.Paragraph || [];
  const list = Array.isArray(paragraphs) ? paragraphs : [paragraphs];

  const scenes: SceneBlock[] = [];
  const warnings: string[] = [];
  let cur: SceneBlock | null = null;
  let idx = 0;

  const flush = () => {
    if (!cur) return;
    cur.estLengthSec = sceneEstSeconds(cur.lines);
    scenes.push(cur);
    cur = null;
  };

  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const type = p?.Type || p?.type || 'Action';
    const text = coerceText(p?.Text);

    if (type === 'Scene Heading') {
      flush();
      idx += 1;
      const heading = text || `UNTITLED SCENE ${idx}`;
      const slug = heading.toUpperCase().replace(/\s*[-–]\s*/g, ' - ');
      cur = {
        index: idx,
        heading,
        slug,
        startLine: i,
        lines: [],
        description: '',
        estLengthSec: 0,
        positionSec: 0,
      };
    } else {
      if (!cur) {
        warnings.push('FDX content before first Scene Heading — creating a COLD OPEN.');
        idx = 1;
        cur = {
          index: idx,
          heading: 'INT. COLD OPEN - DAY',
          slug: 'INT. COLD OPEN - DAY',
          startLine: i,
          lines: [],
          description: '',
          estLengthSec: 0,
          positionSec: 0,
        };
      }
      const lt = toLineTypeFromFDX(type);
      cur.lines.push({ type: lt, text });
    }
  }
  flush();

  // descriptions + layout
  let cursor = 0;
  const GAP = 1;
  for (const s of scenes) {
    s.description = s.lines
      .filter(l => l.type === 'action' || l.type === 'dialogue' || l.type === 'parenthetical')
      .map(l => l.text)
      .join('\n')
      .trim();
    s.positionSec = cursor;
    cursor += s.estLengthSec + GAP;
  }

  return { scenes, warnings };
}