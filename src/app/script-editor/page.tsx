'use client';

import React, { useMemo, useState } from 'react';
import { ScriptLine, LineType } from '@/lib/scriptTypes';
import { linesToFountain } from '@/lib/fountainFormat';
import { parseScript } from '@/lib/scriptParser';

const BLANK: ScriptLine = { type: 'action', text: '' };

const typeClasses: Record<LineType, string> = {
  scene: 'text-emerald-300 font-semibold',
  action: 'text-neutral-100',
  character: 'text-sky-300 uppercase tracking-wide',
  parenthetical: 'text-amber-300',
  dialogue: 'text-neutral-200',
  transition: 'text-fuchsia-300',
  lyric: 'text-pink-300 italic',
  general: 'text-neutral-100',
};

function isSceneHeading(t: string): boolean {
  return /^(INT|EXT|EST|INT\.\/EXT\.)\./i.test(t.trim());
}
function isParenthetical(t: string): boolean {
  return /^\(.+\)$/.test(t.trim());
}
function isTransition(t: string): boolean {
  return /^[A-Z0-9 .']+TO:\s*$/i.test(t.trim());
}
function isLyric(t: string): boolean {
  return /^~/.test(t.trim());
}
function isCharacter(t: string): boolean {
  const s = t.trim();
  if (!s) return false;
  if (s.length > 40) return false;
  if (/TO:\s*$/.test(s)) return false; // avoid transitions
  // ALL CAPS with common name chars
  return /^[A-Z0-9() '\-.]+$/.test(s) && s === s.toUpperCase();
}

function textToScriptLines(text: string): ScriptLine[] {
  const out: ScriptLine[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let prevType: LineType = 'action';
  for (const raw of lines) {
    const t = raw; // keep exact text as typed
    let type: LineType = 'action';
    if (isSceneHeading(t)) type = 'scene';
    else if (isParenthetical(t)) type = 'parenthetical';
    else if (isTransition(t)) type = 'transition';
    else if (isLyric(t)) type = 'lyric';
    else if (isCharacter(t)) type = 'character';
    else if (prevType === 'character' || prevType === 'parenthetical') type = 'dialogue';
    else type = 'action';
    out.push({ type, text: t });
    prevType = type;
  }
  return out.length ? out : [{ type: 'action', text: '' }];
}

export default function ScriptEditorPage() {
  const [lines, setLines] = useState<ScriptLine[]>([
    { type: 'scene', text: 'INT. APARTMENT - NIGHT' },
    { type: 'action', text: 'A small room. A laptop hums on a desk.' },
    { type: 'character', text: 'ALEX' },
    { type: 'parenthetical', text: '(whispering)' },
    { type: 'dialogue', text: 'Let’s get this scene on the timeline.' },
  ]);

  const [selectedIdx, setSelectedIdx] = useState<number>(0);

  const setType = (type: LineType) => {
    if (selectedIdx < 0 || selectedIdx >= lines.length) return;
    setLines(prev => prev.map((l, i) => i === selectedIdx ? { ...l, type } : l));
  };

  const addLineBelow = () => {
    const idx = Math.max(0, selectedIdx);
    setLines(prev => {
      const next = prev.slice();
      next.splice(idx + 1, 0, { ...BLANK });
      return next;
    });
    setSelectedIdx(i => Math.min(lines.length, i + 1));
  };

  const deleteLine = () => {
    if (lines.length <= 1) return;
    if (selectedIdx < 0 || selectedIdx >= lines.length) return;
    setLines(prev => prev.filter((_, i) => i !== selectedIdx));
    setSelectedIdx(i => Math.max(0, i - 1));
  };

  const moveUp = () => {
    if (selectedIdx <= 0) return;
    setLines(prev => {
      const next = prev.slice();
      const [row] = next.splice(selectedIdx, 1);
      next.splice(selectedIdx - 1, 0, row);
      return next;
    });
    setSelectedIdx(i => i - 1);
  };

  const moveDown = () => {
    if (selectedIdx >= lines.length - 1) return;
    setLines(prev => {
      const next = prev.slice();
      const [row] = next.splice(selectedIdx, 1);
      next.splice(selectedIdx + 1, 0, row);
      return next;
    });
    setSelectedIdx(i => i + 1);
  };

  const fountain = useMemo(() => linesToFountain(lines), [lines]);

  const download = () => {
    const blob = new Blob([fountain], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = 'script.fountain';
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(fountain);
    alert('Script copied to clipboard! Paste into Timeline → Import Script.');
  };

  const importIntoEditor = (text: string) => {
    const newLines = textToScriptLines(text);
    setLines(newLines);
  };

  const onUpload: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const txt = await f.text();
    importIntoEditor(txt);
    e.currentTarget.value = '';
  };

  return (
    <div className="h-full w-full flex flex-col">
      <div className="border-b border-neutral-800 p-2 flex items-center gap-2">
        <span className="text-sm text-neutral-400">Script Editor</span>

        <div className="ml-4 flex items-center gap-1">
          <button className="px-2 py-1 text-sm rounded bg-neutral-800 hover:bg-neutral-700" onClick={() => setType('scene')}>Scene</button>
          <button className="px-2 py-1 text-sm rounded bg-neutral-800 hover:bg-neutral-700" onClick={() => setType('action')}>Action</button>
          <button className="px-2 py-1 text-sm rounded bg-neutral-800 hover:bg-neutral-700" onClick={() => setType('character')}>Character</button>
          <button className="px-2 py-1 text-sm rounded bg-neutral-800 hover:bg-neutral-700" onClick={() => setType('parenthetical')}>Parenthetical</button>
          <button className="px-2 py-1 text-sm rounded bg-neutral-800 hover:bg-neutral-700" onClick={() => setType('dialogue')}>Dialogue</button>
          <button className="px-2 py-1 text-sm rounded bg-neutral-800 hover:bg-neutral-700" onClick={() => setType('transition')}>Transition</button>
          <button className="px-2 py-1 text-sm rounded bg-neutral-800 hover:bg-neutral-700" onClick={() => setType('lyric')}>Lyric</button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <input id="upload" type="file" accept=".txt,.fountain" className="hidden" onChange={onUpload} />
          <label htmlFor="upload" className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 cursor-pointer">Upload</label>

          <button className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700" onClick={copy}>Copy</button>
          <button className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700" onClick={download}>Download .fountain</button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <tbody>
            {lines.map((l, i) => (
              <tr
                key={i}
                className={i === selectedIdx ? 'bg-neutral-900/60' : ''}
                onClick={() => setSelectedIdx(i)}
              >
                <td className="w-32 px-2 py-1 align-top">
                  <span className="px-2 py-0.5 rounded bg-neutral-800 text-neutral-300">{l.type}</span>
                </td>
                <td className="px-2 py-1">
                  <input
                    className={`w-full bg-transparent outline-none ${typeClasses[l.type]}`}
                    value={l.text}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLines(prev => prev.map((x, idx) => idx === i ? { ...x, text: v } : x));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addLineBelow(); }
                      if (e.key === 'Backspace' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); deleteLine(); }
                      if (e.key === 'ArrowUp' && (e.shiftKey || e.metaKey || e.ctrlKey)) { e.preventDefault(); moveUp(); }
                      if (e.key === 'ArrowDown' && (e.shiftKey || e.metaKey || e.ctrlKey)) { e.preventDefault(); moveDown(); }
                    }}
                  />
                </td>
                <td className="w-28 px-2 py-1 align-top text-right">
                  <div className="inline-flex gap-1">
                    <button className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700" onClick={() => { setSelectedIdx(i); moveUp(); }}>▲</button>
                    <button className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700" onClick={() => { setSelectedIdx(i); moveDown(); }}>▼</button>
                    <button className="px-2 py-1 rounded bg-red-600 hover:bg-red-500" onClick={() => { setSelectedIdx(i); deleteLine(); }}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bottom summary (optional) */}
      <div className="border-t border-neutral-800 p-2 text-xs text-neutral-400">
        {useMemo(() => {
          const { scenes } = parseScript(linesToFountain(lines));
          const total = scenes.reduce((a, s) => a + s.estLengthSec, 0);
          return `Scenes: ${scenes.length} · Est. runtime: ~${Math.round(total)}s`;
        }, [lines])}
      </div>
    </div>
  );
}