import { ParsedScript, SceneBlock, ScriptLine, LineType } from './scriptTypes';

// Scene heading: INT., EXT., INT./EXT., EST., I/E  (case-insensitive), optional leading scene numbers
const SCENE_RE = /^\s*(?:\d+[A-Z]?[.:)]?\s+)?((?:INT|EXT|EST|I\/E|INT\.\/EXT\.)\.?\s+.+?)$/i;
// Character cue: ALL CAPS, may include spaces and some punctuation
const CHARACTER_RE = /^[A-Z0-9 .'\-()]+$/;
// Transition: ends with TO:, e.g., CUT TO:
const TRANSITION_RE = /^[A-Z ]+\s+TO:$/;
// Parenthetical: ( ... )
const PAREN_RE = /^\s*\(.+\)\s*$/;
// Lyric: ~ at start
const LYRIC_RE = /^\s*~.+$/;

function classify(line: string, prev?: ScriptLine): LineType {
  const t = line.trimEnd();

  if (SCENE_RE.test(t)) return 'scene';
  if (TRANSITION_RE.test(t)) return 'transition';
  if (PAREN_RE.test(t)) return 'parenthetical';
  if (LYRIC_RE.test(t)) return 'lyric';

  // Dialogue detection: a line following CHARACTER or Parenthetical is dialogue
  if (prev && (prev.type === 'character' || prev.type === 'parenthetical')) return 'dialogue';

  // Character: all-caps block not too long and not empty
  if (t.length > 0 && t.length <= 40 && CHARACTER_RE.test(t)) return 'character';

  // Blank => action (but will be collapsed later)
  if (t.trim().length === 0) return 'action';

  return 'action';
}

/**
 * Estimate time for one line type (very rough but serviceable for layout):
 * - action: 2.0s
 * - dialogue: 1.5s
 * - parenthetical: 0.8s
 * - lyric: 1.2s
 * - character/transition/scene: 0s
 */
function lineSeconds(type: LineType): number {
  switch (type) {
    case 'action': return 2.0;
    case 'dialogue': return 1.5;
    case 'parenthetical': return 0.8;
    case 'lyric': return 1.2;
    default: return 0;
  }
}

function normalizeSceneHeading(h: string): { heading: string; slug: string } {
  // Collapse whitespace
  let clean = h.replace(/\s+/g, ' ').trim();

  // 1) Strip leading scene number tokens like "2", "12A.", "3)"
  clean = clean.replace(/^\s*\d+[A-Z]?[.:)]?\s+/, '');

  // 2) Strip trailing numbers separated by tabs or multiple spaces (e.g., "\t2", "   2A")
  clean = clean.replace(/(?:\s{2,}|\t)+\d+[A-Z]?\s*$/, '');

  // 3) Ensure INT./EXT./EST. tokens are normalized (I/E has no trailing dot)
  clean = clean
    .replace(/^INT(?!\.)/i, 'INT.')
    .replace(/^EXT(?!\.)/i, 'EXT.')
    .replace(/^EST(?!\.)/i, 'EST.')
    .replace(/^INT\.\/EXT(?!\.)/i, 'INT./EXT.')
    .replace(/^I\/E\.?\s/i, 'I/E ');

  const up = clean.toUpperCase();
  const slug = up.replace(/\s*[-–]\s*/g, ' - ');
  return { heading: up, slug };
}

export function parseScript(text: string): ParsedScript {
  const rawLines = text.replace(/\r\n/g, '\n').split('\n');
  const lines: ScriptLine[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const prev = lines[lines.length - 1];
    const t = rawLines[i];
    const type = classify(t, prev);
    lines.push({ type, text: t.trimEnd() });
  }

  // Split into scenes
  const scenes: SceneBlock[] = [];
  let cur: SceneBlock | null = null;
  let sceneIndex = 0;

  const flushScene = () => {
    if (!cur) return;
    // Compose description (action+dialogue+lyric+parenthetical)
    const desc = cur.lines
      .filter(l => l.type === 'action' || l.type === 'dialogue' || l.type === 'lyric' || l.type === 'parenthetical')
      .map(l => l.text)
      .join('\n')
      .trim();

    // Estimate length
    let est = cur.lines.reduce((acc, l) => acc + lineSeconds(l.type), 0);
    est = Math.max(10, Math.min(est, 180)); // clamp 10s..180s

    cur.description = desc;
    cur.estLengthSec = est;
    scenes.push(cur);
    cur = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (L.type === 'scene') {
      // start a new scene
      flushScene();
      sceneIndex += 1;
      const { heading, slug } = normalizeSceneHeading(L.text);
      cur = {
        index: sceneIndex,
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
        // Script without explicit heading at start: create a “COLD OPEN”
        warnings.push(`Content before first scene heading detected near line ${i + 1}. Starting a COLD OPEN scene.`);
        const { heading, slug } = normalizeSceneHeading('INT. COLD OPEN - DAY');
        sceneIndex = 1;
        cur = {
          index: sceneIndex,
          heading,
          slug,
          startLine: 0,
          lines: [],
          description: '',
          estLengthSec: 0,
          positionSec: 0,
        };
      }
      cur.lines.push(L);
    }
  }
  flushScene();

  // Lay scenes out sequentially
  let cursor = 0;
  const GAP = 1; // 1s gap between scenes
  for (const s of scenes) {
    s.positionSec = cursor;
    cursor += s.estLengthSec + GAP;
  }

  return { scenes, warnings };
}