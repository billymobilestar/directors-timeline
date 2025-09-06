'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';

type Command = {
  id: string;
  title: string;
  hint?: string;
  run: () => void;
};

export default function CommandMenu({
  getContext,
}: {
  // You can pass lambdas to perform actions from the page (switch tabs, call ref.click(), etc.)
  getContext: () => {
    activeTab: 'music' | 'film';
    setTab: (t: 'music' | 'film') => void;
    triggerMusicImport?: () => void;
    triggerScriptImport?: () => void;
    zoomIn?: () => void;
    zoomOut?: () => void;
    openShortcuts?: () => void;
    gotoWriter?: () => void;
  };
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Global hotkey: ⌘/Ctrl + K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
    else setQ('');
  }, [open]);

  const cmds = useMemo<Command[]>(() => {
    const ctx = getContext();
    return [
      { id: 'switch-music', title: 'Switch to Music', run: () => ctx.setTab('music') },
      { id: 'switch-film', title: 'Switch to Film', run: () => ctx.setTab('film') },
      { id: 'import-audio', title: 'Upload audio…', hint: 'Music', run: () => ctx.triggerMusicImport?.() },
      { id: 'import-script', title: 'Import script…', hint: 'Film', run: () => ctx.triggerScriptImport?.() },
      { id: 'zoom-in', title: 'Zoom in timeline', run: () => ctx.zoomIn?.() },
      { id: 'zoom-out', title: 'Zoom out timeline', run: () => ctx.zoomOut?.() },
      { id: 'shortcuts', title: 'Show shortcuts', run: () => ctx.openShortcuts?.() },
      { id: 'writer', title: 'Open Script Writer', run: () => ctx.gotoWriter?.() },
    ];
  }, [getContext]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return cmds;
    return cmds.filter((c) => c.title.toLowerCase().includes(qq) || (c.hint || '').toLowerCase().includes(qq));
  }, [cmds, q]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/50" onClick={() => setOpen(false)}>
      <div
        className="mx-auto mt-24 w-full max-w-xl rounded-2xl border border-neutral-800 bg-neutral-900 p-2 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type a command…"
          className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-neutral-100 outline-none"
        />
        <div className="mt-2 max-h-80 overflow-auto">
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setOpen(false);
                c.run();
              }}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-neutral-800 flex items-center justify-between"
            >
              <span>{c.title}</span>
              {c.hint ? <span className="text-xs text-neutral-400">{c.hint}</span> : null}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-neutral-400">No commands</div>
          )}
        </div>
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
        </div>
      </div>
    </div>
  );
}