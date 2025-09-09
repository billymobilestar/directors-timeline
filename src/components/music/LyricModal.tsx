'use client';
import React from 'react';

export default function LyricModal({
  open,
  text,
  onChangeText,
  onClose,
  onSave,
}: {
  open: boolean;
  text: string;
  onChangeText: (v: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-3xl max-h-[80vh] bg-neutral-900 text-neutral-100 rounded-xl shadow-2xl border border-neutral-700 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <div className="font-medium">Lyric Clip</div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700" onClick={onClose}>Close</button>
            <button className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500" onClick={onSave}>Save</button>
          </div>
        </div>
        <div className="p-4 overflow-auto">
          <textarea
            value={text}
            onChange={(e) => onChangeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); onClose(); }
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); onSave(); }
            }}
            className="w-full h-[50vh] p-3 rounded-lg bg-neutral-950 text-neutral-100 outline-none border border-neutral-700"
            placeholder="Edit lyric text…"
          />
        </div>
      </div>
    </div>
  );
}