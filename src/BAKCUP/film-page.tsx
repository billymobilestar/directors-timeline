'use client';

import React, { useRef, useState } from 'react';
import WaveformCanvas from '@/components/WaveformCanvas';
import FilmTimelineCanvas from '@/components/FilmTimelineCanvas';
import { decodeAudioFile } from '@/lib/audio';

import CommandMenu from '@/components/CommandMenu';
import ShortcutsModal from '@/components/ShortcutsModal';
import { Button } from '@/components/ui/Button';

type TabKey = 'music' | 'film';


export default function Page() {
  const [tab, setTab] = useState<TabKey>('music');

  // Music state
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // UI state
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Command menu actions
  const musicUploadClick = () => fileInputRef.current?.click();
  const filmImportClick = () => {
    // Film canvas can listen for this to open its importer
    window.dispatchEvent(new CustomEvent('film:openImport'));
  };
  const zoomIn = () => window.dispatchEvent(new CustomEvent('timeline:zoomIn'));
  const zoomOut = () => window.dispatchEvent(new CustomEvent('timeline:zoomOut'));

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const ab = await decodeAudioFile(file);
      setAudioBuffer(ab);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Failed to decode audio.';
      alert(message);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="h-screen flex flex-col bg-neutral-950 text-neutral-100">
      {/* App header */}
      <div className="px-4 py-3 border-b border-neutral-800 flex items-center gap-4">
        <div className="text-lg font-semibold">Director’s Timeline</div>
        {/* Tabs */}
        <div className="flex items-center gap-1">
          <button
            className={`px-3 py-1.5 rounded ${tab === 'music' ? 'bg-blue-600' : 'bg-neutral-800 hover:bg-neutral-700'}`}
            onClick={() => setTab('music')}
          >
            Music
          </button>
          <button
            className={`px-3 py-1.5 rounded ${tab === 'film' ? 'bg-blue-600' : 'bg-neutral-800 hover:bg-neutral-700'}`}
            onClick={() => setTab('film')}
          >
            Film
          </button>
          <a
            href="/script-writer"
            className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700"
          >
            Script Writer
          </a>
        </div>
        <Button variant="ghost" className="ml-1" onClick={() => setShortcutsOpen(true)}>
          Help
        </Button>

        <div className="ml-auto text-sm text-neutral-400">
          {tab === 'music' ? 'Music mode: upload audio and annotate' : 'Film mode: plot scenes on timeline'}
        </div>
      </div>

      {/* Per-tab body */}
      <div className="flex-1">
        {tab === 'music' ? (
          <div className="h-full flex flex-col">
            {/* Music toolbar */}
            <div className="p-2 border-b border-neutral-800 flex items-center gap-3">
              <label className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 cursor-pointer">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={onFileChange}
                />
                Upload audio
              </label>
              <span className="text-sm text-neutral-400">
                {audioBuffer ? `Loaded: ${Math.round(audioBuffer.duration)}s` : 'No audio loaded'}
              </span>
            </div>

            {/* Music canvas */}
            <div className="flex-1">
              <WaveformCanvas audioBuffer={audioBuffer} />
            </div>
          </div>
        ) : (
          <div className="h-screen overflow-hidden bg-neutral-950">
            <FilmTimelineCanvas />
          </div>
        )}
      </div>

      <CommandMenu
        getContext={() => ({
          activeTab: tab,
          setTab,
          triggerMusicImport: musicUploadClick,
          triggerScriptImport: filmImportClick,
          zoomIn,
          zoomOut,
          openShortcuts: () => setShortcutsOpen(true),
          gotoWriter: () => (window.location.href = '/script-writer'),
        })}
      />

      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
