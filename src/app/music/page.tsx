'use client';

import React, { useRef, useState } from 'react';
import WaveformCanvas from '@/components/WaveformCanvas';
import { decodeAudioFile } from '@/lib/audio';

export default function MusicPage() {
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const ab = await decodeAudioFile(file);
      setAudioBuffer(ab);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Failed to decode audio.';
      setErrorMsg(message);
      setAudioBuffer(null);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900/60 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
          <a href="/" className="text-sm text-neutral-400 hover:text-neutral-200">← Welcome</a>

          <div className="ml-auto flex items-center gap-3">
            <label className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 cursor-pointer border border-neutral-700">
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={onFileChange}
              />
              {loading ? 'Loading…' : 'Upload audio'}
            </label>

            <div className="text-sm text-neutral-400">
              {audioBuffer ? `Loaded: ${Math.round(audioBuffer.duration)}s` : 'No audio loaded'}
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="mx-auto max-w-6xl px-4 pb-3 text-sm text-red-400">{errorMsg}</div>
        )}
      </header>

      {/* Canvas */}
      <div className="h-[calc(100vh-65px)]">
        <WaveformCanvas audioBuffer={audioBuffer} />
      </div>
    </main>
  );
}