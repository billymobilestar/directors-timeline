'use client';

import React, { useMemo, useState } from 'react';
import { linesToFountain, type ScriptLine, type LineType } from '@/lib/format/fountain';

// --- lightweight classifier so the preview looks like a screenplay ---
function isSceneHeading(t: string) { return /^(INT|EXT|EST|INT\.\/EXT\.)\./i.test(t.trim()); }
function isParenthetical(t: string) { return /^\(.+\)$/.test(t.trim()); }
function isTransition(t: string) { return /^[A-Z0-9 .']+TO:\s*$/i.test(t.trim()); }
function isLyric(t: string) { return /^~/.test(t.trim()); }
function isCharacter(t: string) {
  const s = t.trim();
  if (!s || s.length > 40) return false;
  if (/TO:\s*$/.test(s)) return false;
  return /^[A-Z0-9() '\-.]+$/.test(s) && s === s.toUpperCase();
}

function textToScriptLines(text: string): ScriptLine[] {
  const out: ScriptLine[] = [];
  const rows = (text || '').replace(/\r\n/g, '\n').split('\n');
  let prev: LineType = 'action';
  for (const raw of rows) {
    let type: LineType = 'action';
    if (isSceneHeading(raw)) type = 'scene';
    else if (isParenthetical(raw)) type = 'parenthetical';
    else if (isTransition(raw)) type = 'transition';
    else if (isLyric(raw)) type = 'lyric';
    else if (isCharacter(raw)) type = 'character';
    else if (prev === 'character' || prev === 'parenthetical') type = 'dialogue';
    out.push({ type, text: raw });
    prev = type;
  }
  return out;
}

// --- pretty screenplay-like preview ---
function ScriptFormattedView({ lines }: { lines: ScriptLine[] }) {
  // Indents in monospace "character" units
  const INDENT_CH: Record<LineType, number> = {
    scene: 0,
    action: 0,
    character: 22,
    parenthetical: 16,
    dialogue: 12,
    transition: 40,
    lyric: 10,
  };

  return (
    <div className="font-mono text-sm leading-5 text-neutral-100 bg-neutral-950 border border-neutral-800 rounded-lg p-3 h-[calc(100vh-10rem)] overflow-auto">
      <div className="max-w-[70ch]">
        {lines.map((l, i) => {
          const pl = INDENT_CH[l.type] ?? 0;
          const style: React.CSSProperties =
            l.type === 'transition'
              ? { paddingLeft: 0, textAlign: 'right', width: '60ch' }
              : { paddingLeft: `${pl}ch` };

          const cls =
            l.type === 'scene'
              ? 'font-semibold uppercase text-amber-300'
              : l.type === 'character'
              ? 'font-semibold'
              : l.type === 'parenthetical'
              ? 'italic'
              : l.type === 'lyric'
              ? 'italic'
              : '';

          return (
            <div key={i} className={cls} style={style}>
              {l.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ScriptWriterPage() {
  const [raw, setRaw] = useState<string>(
`INT. LIVING ROOM - EVENING

A small apartment. The TV hums softly.

ALEX
(whispering)
We should keep the first scene simple.

CUT TO:
`
  );

  const lines = useMemo(() => textToScriptLines(raw), [raw]);

  function exportFountain() {
    const txt = linesToFountain(lines);
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'script.fountain';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="h-full min-h-screen bg-neutral-950 text-neutral-100">
      <div className="border-b border-neutral-800 px-4 py-3 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Script Writer</h1>
        <button
          className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500"
          onClick={exportFountain}
          title="Export current script as .fountain"
        >
          Export .fountain
        </button>
        <a
          href="/"
          className="ml-auto px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
          title="Back to timeline"
        >
          Back
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
        {/* Editor */}
        <div className="flex flex-col">
          <label className="mb-2 text-sm text-neutral-300">Write your script</label>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            spellCheck={false}
            className="w-full h-[calc(100vh-10rem)] p-3 rounded-lg bg-neutral-950 text-neutral-100 outline-none border border-neutral-800"
            placeholder={`Type screenplay text here...\nUse SCENE HEADINGS like "INT. PLACE - DAY", ALL CAPS CHARACTER lines, (parenthetical), and dialogue below the character.`}
          />
        </div>

        {/* Formatted preview */}
        <div className="flex flex-col">
          <label className="mb-2 text-sm text-neutral-300">Formatted preview</label>
          <ScriptFormattedView lines={lines} />
        </div>
      </div>
    </div>
  );
}