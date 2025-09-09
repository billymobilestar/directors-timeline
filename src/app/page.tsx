import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Directors Timeline — Welcome',
  description: 'Choose a workspace: Music Video, Film, or Script Writer.',
};

export default function WelcomePage() {
  const tiles = [
    {
      href: '/music',
      title: 'Music Video',
      desc: 'Upload audio, mark beats, add sticky notes and images.',
      gradient: 'from-blue-600/30 via-blue-500/10 to-transparent',
      border: 'border-blue-500/40',
      icon: (
        <svg viewBox="0 0 24 24" className="w-6 h-6 opacity-90" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M9 18V5l11-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      ),
    },
    {
      href: '/film',
      title: 'Film',
      desc: 'Visual timeline of scenes. Drag, reorder, attach notes & images.',
      gradient: 'from-emerald-600/30 via-emerald-500/10 to-transparent',
      border: 'border-emerald-500/40',
      icon: (
        <svg viewBox="0 0 24 24" className="w-6 h-6 opacity-90" fill="none" stroke="currentColor" strokeWidth="1.7">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M7 5v14M17 5v14M3 9h18M3 15h18" />
        </svg>
      ),
    },
    {
      href: '/writer',
      title: 'Script Writer',
      desc: 'Write or paste a script. Format (scene, action, dialogue) + export Fountain.',
      gradient: 'from-amber-600/30 via-amber-500/10 to-transparent',
      border: 'border-amber-500/40',
      icon: (
        <svg viewBox="0 0 24 24" className="w-6 h-6 opacity-90" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M4 19.5V5a2 2 0 0 1 2-2h7l7 7v9.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
          <path d="M13 3v5a2 2 0 0 0 2 2h5" />
          <path d="M8 14h8M8 18h6M8 10h3" />
        </svg>
      ),
    },
  ];

  return (
    <main
      className="h-[100svh] md:h-screen bg-neutral-950 text-neutral-100 overflow-y-auto overscroll-y-contain overflow-x-hidden touch-pan-y"
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900/60 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-6 flex items-center gap-4">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-blue-500 to-emerald-500" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Directors Timeline</h1>
            <p className="text-sm text-neutral-400">Plan music videos & films, or write scripts — faster.</p>
          </div>
          <div className="ml-auto">
            <Link
              href="/"
              className="text-sm text-neutral-400 hover:text-neutral-200 underline underline-offset-4"
              title="Go to current default page"
            >
              Open current workspace
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="grid gap-6 md:grid-cols-3">
          {tiles.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={`group relative rounded-2xl border ${t.border} bg-neutral-900/50 p-5 transition hover:border-neutral-500/60 hover:bg-neutral-900`}
            >
              <div
                className={`pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br ${t.gradient} opacity-0 transition-opacity group-hover:opacity-100`}
              />
              <div className="relative z-10 flex items-center gap-3">
                <div className="rounded-lg bg-neutral-800/70 p-2">{t.icon}</div>
                <div>
                  <h2 className="text-base font-semibold tracking-wide">{t.title}</h2>
                  <p className="mt-1 text-sm text-neutral-400 leading-relaxed">{t.desc}</p>
                </div>
              </div>

              <div className="relative z-10 mt-6 flex items-center justify-between">
                <span className="text-xs text-neutral-400">Open</span>
                <svg
                  viewBox="0 0 24 24"
                  className="w-5 h-5 text-neutral-400 transition-transform group-hover:translate-x-1"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                >
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>

        {/* Tips */}
        <div className="mt-10 grid gap-3 md:grid-cols-3 text-sm text-neutral-400">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
            <div className="font-medium text-neutral-300 mb-1">Music Video</div>
            Add notes by the playhead, drag with touch or mouse, and save as a project file.
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
            <div className="font-medium text-neutral-300 mb-1">Film</div>
            Drag scenes, snap, auto-reorder, and attach images & notes below each clip.
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
            <div className="font-medium text-neutral-300 mb-1">Script Writer</div>
            Type with screenplay formatting shortcuts and export to <code>.fountain</code>.
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-800">
        <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-neutral-500">
          © {new Date().getFullYear()} Directors Timeline • Built for creativity. Build by Diljot Garcha
        </div>
      </footer>
    </main>
  );
}