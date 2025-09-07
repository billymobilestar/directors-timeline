//'use client';

import React from 'react';
import FilmTimelineCanvas from '@/components/FilmTimelineCanvas';

export const metadata = {
  title: 'Directors Timeline — Film',
  description: 'Visual timeline of scenes. Drag, reorder, attach notes & images.',
};

export default function FilmPage() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 bg-neutral-900/60 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
          <a href="/" className="text-sm text-neutral-400 hover:text-neutral-200">← Welcome</a>
          <nav className="ml-4 flex items-center gap-2 text-sm">
            <a href="/music" className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700">Music</a>
            <a href="/writer" className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700">Script Writer</a>
          </nav>
          <div className="ml-auto text-sm text-neutral-400">Film Workspace</div>
        </div>
      </header>
      <div className="h-[calc(100vh-49px)] overflow-hidden">
        <FilmTimelineCanvas />
      </div>
    </main>
  );
}
