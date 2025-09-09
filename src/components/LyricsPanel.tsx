// src/components/LyricsPanel.tsx
'use client';

import React, { useRef, useState } from 'react';
import { parseLyricsSmart, distributeAcrossDuration, AlignedLine } from '@/lib/lyrics';
import { transliterateIfNeeded, LyricsLang } from '@/lib/transliteration';

type Props = {
  audioDurationSec: number;
  onClose: () => void;
  onAligned: (lines: AlignedLine[]) => void;
};

export default function LyricsPanel({ audioDurationSec, onClose, onAligned }: Props) {
  const [language, setLanguage] = useState<LyricsLang>('en');
  const [normalizeScript, setNormalizeScript] = useState<boolean>(false);
  const [text, setText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const importFile = () => fileRef.current?.click();
  const onFileChosen: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const t = await f.text();
      setText(t);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      if (e.currentTarget) e.currentTarget.value = '';
    }
  };

  const alignNow = () => {
    setError(null);
    try {
      const input = transliterateIfNeeded(text, language, normalizeScript);
      const parsed = parseLyricsSmart(input);
      const aligned = distributeAcrossDuration(parsed, Math.max(1, audioDurationSec || 1));
      if (!aligned.length) {
        setError('No lyric lines detected. Paste TXT/LRC/SRT text first.');
        return;
      }
      onAligned(aligned);
      onClose();
    } catch (err: any) {
      setError(err?.message || String(err));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-4xl max-h-[90vh] rounded-xl bg-neutral-900 border border-neutral-700 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <div className="font-semibold">Lyrics — Align to Audio</div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700" onClick={onClose}>
              Close
            </button>
            <button
              className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
              onClick={alignNow}
              disabled={!text.trim() || !isFinite(audioDurationSec) || audioDurationSec <= 0}
              title={!text.trim() ? 'Paste or import lyrics first' : undefined}
            >
              Align to audio
            </button>
          </div>
        </div>

        <div className="p-4 flex flex-col gap-3 overflow-auto">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-neutral-300">
              Language
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as LyricsLang)}
                className="ml-2 px-2 py-1 rounded bg-neutral-950 border border-neutral-700"
              >
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="hi">Hindi (Devanagari)</option>
                <option value="hi_latn">Hindi (Romanized)</option>
                <option value="pa">Punjabi (Gurmukhi)</option>
                <option value="pa_latn">Punjabi (Romanized)</option>
              </select>
            </label>

            <label className="text-sm text-neutral-300 flex items-center gap-2">
              <input
                type="checkbox"
                checked={normalizeScript}
                onChange={(e) => setNormalizeScript(e.target.checked)}
              />
              Normalize script (for romanized → native)
            </label>

            <button
              className="px-3 py-1.5 rounded border border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
              onClick={importFile}
            >
              Import file (TXT/LRC/SRT)
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.lrc,.srt"
              className="hidden"
              onChange={onFileChosen}
            />

            <div className="ml-auto text-sm text-neutral-400">
              Audio duration: {formatSecs(audioDurationSec)}
            </div>
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste lyrics here...\n\n• For LRC: [00:31.20] Never gonna give you up...\n• For SRT: timecoded blocks\n• For TXT: one line per lyric"
            className="w-full min-h-[40vh] p-3 rounded-md bg-neutral-950 text-neutral-100 border border-neutral-700 outline-none"
          />

          {error && (
            <div className="text-sm text-rose-400">
              {error}
            </div>
          )}

          <p className="text-xs text-neutral-500">
            Tip: We’ll place each line at its timestamp. If no timestamps are present, lines are evenly spaced across the song. You can nudge later.
          </p>
        </div>
      </div>
    </div>
  );
}

function formatSecs(s: number) {
  if (!isFinite(s) || s <= 0) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}