'use client';

import React, { useMemo, useRef, useState, useEffect } from 'react';
// PDF export uses dynamic import('jspdf') in the handlers below

// --------------------------------------
// Types
// --------------------------------------
 type LineType = 'scene' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition' | 'lyric' | 'unknown';
 type ScriptLine = { type: LineType; text: string };

// --------------------------------------
// Parsing / Formatting Heuristics
// --------------------------------------
const SCENE_RE = /^\s*(?:\d+[A-Z]?[:.)]?\s+)?(INT|EXT|EST|I\/E)\.?\s/i;
const TRANSITION_RE = /(FADE (IN|OUT):|CUT TO:|MATCH CUT TO:|SMASH CUT TO:|DISSOLVE TO:|WIPE TO:|TO:)$/;
const PAREN_RE = /^\(.+\)$/;
const CHARACTER_RE = /^[A-Z0-9 .'\-()]+$/; // CAPS, allows (CONT'D)

function isLikelyScene(s: string) {
  return SCENE_RE.test(s);
}
function isLikelyTransition(s: string) {
  return TRANSITION_RE.test(s);
}
function isLikelyParenthetical(s: string) {
  return PAREN_RE.test(s);
}
function isLikelyCharacter(s: string) {
  if (!CHARACTER_RE.test(s)) return false;
  if (s.length > 30) return false; // names are short
  if (/[.!?]$/.test(s)) return false; // not sentences
  if (isLikelyScene(s)) return false; // avoid INT/EXT
  return true;
}

function toLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

// Two-pass stateful analyzer closer to Fountain semantics
function analyze(text: string): ScriptLine[] {
  const raw = toLines(text);
  const out: ScriptLine[] = [];
  let inDialogueBlock = false; // after a character (or parenthetical under a character)

  // Remove leading tokens like "2", "12A.", "3)" and trailing tokens like "\t2" or double-space + 2
  const stripSceneNumbers = (s: string) => {
    let t = s.trim();
    // leading scene number tokens
    t = t.replace(/^\s*\d+[A-Z]?[.)]?\s+/, '');
    // trailing numbers separated by tabs or 2+ spaces
    t = t.replace(/(?:\s{2,}|\t)+\d+[A-Z]?\s*$/, '');
    return t;
  };

  for (let i = 0; i < raw.length; i++) {
    const original = raw[i];
    const t = original.trim();

    if (t === '') {
      out.push({ type: 'unknown', text: '' });
      inDialogueBlock = false;
      continue;
    }

    // Hard classifiers first
    if (isLikelyScene(t)) {
      const normalized = stripSceneNumbers(t).toUpperCase();
      out.push({ type: 'scene', text: normalized });
      inDialogueBlock = false;
      continue;
    }
    if (isLikelyTransition(t.toUpperCase())) {
      out.push({ type: 'transition', text: t.toUpperCase() });
      inDialogueBlock = false;
      continue;
    }

    // Character starts a dialogue block
    if (isLikelyCharacter(t)) {
      out.push({ type: 'character', text: t.toUpperCase() });
      inDialogueBlock = true;
      continue;
    }

    // Parenthetical: if inside a dialogue block, keep as parenthetical, else action
    if (isLikelyParenthetical(t)) {
      if (inDialogueBlock) {
        out.push({ type: 'parenthetical', text: t });
      } else {
        out.push({ type: 'action', text: original });
      }
      continue;
    }

    // Dialogue lines continue until blank or new block
    if (inDialogueBlock) {
      out.push({ type: 'dialogue', text: original });
      continue;
    }

    // Lyrics
    if (/^~/.test(t)) {
      out.push({ type: 'lyric', text: original.replace(/^~/, '') });
      continue;
    }

    // Default to action
    out.push({ type: 'action', text: original });
  }

  return out;
}

// --------------------------------------
// Render helpers — mimic screenplay page layout
// --------------------------------------
function LineView({ line }: { line: ScriptLine }) {
  // Page width ~ 8.5in with ~1in margins → content ~6.5in ≈ 624px
  // Use Courier-like monospaced face (classic screenplay look)
  const base = 'whitespace-pre-wrap';

  switch (line.type) {
    case 'scene':
      return (
        <div className={`${base} font-bold tracking-wide text-[13px] text-neutral-100`} style={{ marginLeft: 0 }}>
          {line.text.trim()}
        </div>
      );

    case 'transition':
      return (
        <div className={`${base} text-[13px] text-neutral-200`} style={{ textAlign: 'right' }}>
          {line.text.trim()}
        </div>
      );

    case 'character':
      return (
        <div className={`${base} text-[13px] font-bold text-neutral-200`} style={{ textAlign: 'center', marginTop: 16, marginBottom: 4 }}>
          {line.text.trim()}
        </div>
      );

    case 'parenthetical':
      return (
        <div className={`${base} italic text-[13px] text-neutral-300`} style={{ textAlign: 'center', maxWidth: 360, margin: '0 auto 4px' }}>
          {line.text.trim()}
        </div>
      );

    case 'dialogue':
      return (
        <div className={`${base} text-[13px] leading-6 text-neutral-100`} style={{ maxWidth: 360, margin: '0 auto' }}>
          {line.text}
        </div>
      );

    case 'lyric':
      return (
        <div className={`${base} text-[13px] leading-6 text-cyan-300`} style={{ maxWidth: 360, margin: '0 auto' }}>
          {line.text}
        </div>
      );

    case 'action':
    default:
      return (
        <div className={`${base} text-[13px] leading-6 text-neutral-200`} style={{ marginLeft: 0 }}>
          {line.text}
        </div>
      );
  }
}

// --------------------------------------
// Page Component
// --------------------------------------
export default function WriterPage() {
  const [text, setText] = useState<string>(
    'INT. STUDIO - NIGHT\n\nThe band sets up. A neon sign flickers.\n\nJESSICA\nLet\'s roll from the top.\n\n(whispers)\nOkay...\n\nCUT TO:'
  );
  const [liveFormat, setLiveFormat] = useState(true);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Notify if film autosave key is missing to avoid data loss
  const [missingAutosave, setMissingAutosave] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const HAS = !!localStorage.getItem('dt:film:autosave');
      setMissingAutosave(!HAS);
      // Try a system notification once (non-blocking). Falls back to banner below.
      if (!HAS && 'Notification' in window) {
        const notify = () => new Notification('Missing film autosave', { body: 'dt:film:autosave not found. Save your film timeline to avoid data loss.' });
        if (Notification.permission === 'granted') {
          notify();
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then(p => p === 'granted' && notify());
        }
      }
    } catch {
      // ignore storage errors (e.g., Safari private mode)
    }
  }, []);

  // Tag current line helpers — transforms the selected line's text conveniently
  function tagCurrentLine(as: LineType) {
    const ta = taRef.current; if (!ta) return;
    const value = text.replace(/\r\n?/g, '\n');
    const start = ta.selectionStart ?? 0;
    const before = value.lastIndexOf('\n', Math.max(0, start - 1));
    const after = value.indexOf('\n', start);
    const lineStart = before === -1 ? 0 : before + 1;
    const lineEnd = after === -1 ? value.length : after;
    const line = value.slice(lineStart, lineEnd);

    let replaced = line;
    switch (as) {
      case 'scene':
        replaced = line.toUpperCase();
        // strip any leading scene number like "12A." or "3)" and any trailing number columns
        replaced = replaced.replace(/^\s*\d+[A-Z]?[.)]?\s+/, '');
        replaced = replaced.replace(/(?:\s{2,}|\t)+\d+[A-Z]?\s*$/, '');
        if (!SCENE_RE.test(replaced)) replaced = 'INT. ' + replaced;
        break;
      case 'character':
        replaced = line.toUpperCase();
        break;
      case 'parenthetical':
        replaced = line.trim();
        if (!PAREN_RE.test(replaced)) replaced = `(${replaced})`;
        break;
      case 'transition':
        replaced = line.replace(/\s+$/, '').toUpperCase();
        if (!/ TO:$/.test(replaced)) replaced = replaced + ' TO:';
        break;
      case 'dialogue':
      case 'action':
      case 'lyric':
      default:
        // no-op; preview will classify based on context
        break;
    }

    const next = value.slice(0, lineStart) + replaced + value.slice(lineEnd);
    setText(next);
    const pos = lineStart + replaced.length;
    requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = pos; ta.focus(); });
  }

  const lines = useMemo(
    () => (liveFormat ? analyze(text) : toLines(text).map(t => ({ type: 'action' as LineType, text: t }))),
    [text, liveFormat]
  );

  async function exportPdfFormatted() {
    try {
      const { jsPDF } = await import('jspdf');
      // Letter size in points (1pt = 1/72in): 8.5 x 11 in => 612 x 792 pt
      const doc = new jsPDF({ unit: 'pt', format: 'letter' });

      // Margins similar to screenplay (1.0" left, 1.0" right, ~1.0" top/bottom)
      const pageW = 612, pageH = 792;
      const left = 72, right = 72, top = 72, bottom = 72;
      const contentW = pageW - left - right;

      // Use Courier family
      const baseFont = 'courier';
      const baseSize = 12; // ~ standard screenplay font size
      const leading = 18; // line height in pt

      let x = left;
      let y = top;

      const writeLine = (txt: string, opts?: { align?: 'left' | 'center' | 'right'; bold?: boolean; italic?: boolean }) => {
        const align = opts?.align || 'left';
        const style = opts?.bold ? (opts?.italic ? 'bolditalic' : 'bold') : (opts?.italic ? 'italic' : 'normal');
        doc.setFont(baseFont, style as any);
        doc.setFontSize(baseSize);
        // simple wrap: split by content width using jsPDF splitTextToSize
        const wrapped = doc.splitTextToSize(txt, contentW);
        for (const w of wrapped) {
          if (y + leading > pageH - bottom) {
            doc.addPage('letter', 'portrait');
            x = left; y = top;
          }
          if (align === 'center') {
            const width = doc.getTextWidth(w);
            doc.text(w, left + (contentW - width) / 2, y);
          } else if (align === 'right') {
            const width = doc.getTextWidth(w);
            doc.text(w, left + contentW - width, y);
          } else {
            doc.text(w, x, y);
          }
          y += leading;
        }
      };

      // Render analyzed lines with simple screenplay-like formatting
      for (const ln of lines) {
        switch (ln.type) {
          case 'scene':
            y += 6; // extra space before scene
            writeLine(ln.text.trim(), { bold: true });
            y += 6;
            break;
          case 'transition':
            writeLine(ln.text.trim(), { align: 'right' });
            break;
          case 'character':
            y += 6;
            writeLine(ln.text.trim(), { align: 'center', bold: true });
            break;
          case 'parenthetical':
            writeLine(ln.text.trim(), { align: 'center', italic: true });
            break;
          case 'dialogue':
            // center column narrower (about 3 inches)
            {
              const oldContentW = contentW;
              const dialogW = 324; // 4.5in
              const dialogLeft = left + (contentW - dialogW) / 2;
              const txt = ln.text;
              const wrapped = (new jsPDF({ unit: 'pt', format: 'letter' })).splitTextToSize(txt, dialogW);
              // Use existing doc with our helper:
              doc.setFont(baseFont, 'normal');
              doc.setFontSize(baseSize);
              for (const w of wrapped) {
                if (y + leading > pageH - bottom) {
                  doc.addPage('letter', 'portrait');
                  x = left; y = top;
                }
                doc.text(w, dialogLeft, y);
                y += leading;
              }
            }
            break;
          case 'lyric':
            writeLine(ln.text, { align: 'center' });
            break;
          case 'action':
          default:
            writeLine(ln.text);
            break;
        }
      }

      doc.save('script.pdf');
    } catch (err) {
      console.error('Export PDF (formatted) failed:', err);
      alert('Failed to export formatted PDF');
    }
  }

  async function exportPdfFountain() {
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'pt', format: 'letter' });
      const pageW = 612, pageH = 792;
      const left = 72, right = 72, top = 72, bottom = 72;
      const contentW = pageW - left - right;
      const baseFont = 'courier';
      const baseSize = 12;
      const leading = 18;

      doc.setFont(baseFont, 'normal');
      doc.setFontSize(baseSize);

      let y = top;
      const paras = text.replace(/\r\n?/g, '\n').split('\n');
      const split: string[] = [];
      for (const p of paras) {
        const lines = doc.splitTextToSize(p, contentW) as unknown as string[];
        if (Array.isArray(lines)) split.push(...lines);
        else if (typeof lines === 'string') split.push(lines);
      }
      for (const line of split) {
        if (y + leading > pageH - bottom) {
          doc.addPage('letter', 'portrait');
          y = top;
        }
        doc.text(line, left, y);
        y += leading;
      }
      doc.save('script_fountain.pdf');
    } catch (err) {
      console.error('Export PDF (fountain) failed:', err);
      alert('Failed to export PDF from fountain text');
    }
  }

  function exportFountain() {
    try {
      const filename = 'script.fountain';
      const mime = 'text/x-fountain;charset=utf-8';

      // Safari (especially iOS) can ignore `download` on blob URLs; use data URL fallback
      const isSafari = typeof navigator !== 'undefined'
        && /safari/i.test(navigator.userAgent)
        && !/chrome|crios|android/i.test(navigator.userAgent);

      if (isSafari) {
        const dataUrl = 'data:text/x-fountain;charset=utf-8,' + encodeURIComponent(text);
        const a = document.createElement('a');
        a.href = dataUrl;
        a.setAttribute('download', filename);
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
      }

      // Default path for modern browsers
      const blob = new Blob([text], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.setAttribute('download', filename);
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Failed to export .fountain');
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900/60 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
          <a href="/" className="text-sm text-neutral-400 hover:text-neutral-200">← Welcome</a>
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-neutral-400">
              <input type="checkbox" className="accent-blue-500" checked={liveFormat} onChange={(e) => setLiveFormat(e.target.checked)} />
              Live format
            </label>
            <button
              onClick={exportFountain}
              className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
              title="Download current draft as .fountain"
            >
              Export .fountain
            </button>
            <button
              onClick={exportPdfFormatted}
              className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-sm font-medium"
              title="Export formatted preview to PDF"
            >
              Export PDF (formatted)
            </button>
            <button
              onClick={exportPdfFountain}
              className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-sm font-medium"
              title="Export raw Fountain text to PDF"
            >
              Export PDF (from Fountain)
            </button>
          </div>
        </div>
      </header>

      {missingAutosave && (
        <div className="mx-auto max-w-6xl px-4 pt-3">
          <div className="flex items-start gap-3 rounded-lg border border-amber-700 bg-amber-900/40 text-amber-100 px-3 py-2 text-sm">
            <div className="mt-0.5">⚠️</div>
            <div className="flex-1">
              <div className="font-medium">Missing film autosave</div>
              <div className="opacity-90">We couldn’t find <code className="font-mono">dt:film:autosave</code> in your browser. Open your Film timeline and save to avoid data loss.</div>
            </div>
            <button
              onClick={() => setMissingAutosave(false)}
              className="shrink-0 rounded-md px-2 py-1 text-amber-200 hover:bg-amber-800/60"
              title="Dismiss"
            >Dismiss</button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="mx-auto max-w-6xl px-4 pt-4">
        <div className="flex flex-wrap gap-2 text-sm">
          <button className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700" onClick={() => tagCurrentLine('scene')}>Scene</button>
          <button className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700" onClick={() => tagCurrentLine('character')}>Character</button>
          <button className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700" onClick={() => tagCurrentLine('parenthetical')}>Parenthetical</button>
          <button className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700" onClick={() => tagCurrentLine('dialogue')}>Dialogue</button>
          <button className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700" onClick={() => tagCurrentLine('action')}>Action</button>
          <button className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700" onClick={() => tagCurrentLine('transition')}>Transition</button>
          <button className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700" onClick={() => tagCurrentLine('lyric')}>Lyric</button>
        </div>
      </div>

      {/* Editor + Preview */}
      <section className="mx-auto max-w-6xl px-4 py-6 grid gap-6 md:grid-cols-2">
        <div>
          <label className="block text-sm text-neutral-400 mb-2">Draft</label>
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full h-[70vh] rounded-xl bg-neutral-900 border border-neutral-800 p-3 text-[13px] leading-6"
            style={{ fontFamily: 'Courier New, Courier, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
            placeholder="Write your script here in Fountain style..."
          />
        </div>

        <div>
          <label className="block text-sm text-neutral-400 mb-2">Formatted Preview</label>
          <div className="w-full h-[70vh] overflow-auto rounded-xl bg-neutral-900 border border-neutral-800 p-6">
            <div
              className="mx-auto"
              style={{ width: 624, fontFamily: 'Courier New, Courier, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
            >
              {lines.map((ln, i) => (
                <LineView key={i} line={ln} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-800">
        <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-neutral-500">
          Tips: Use CAPS for scene headings & character names. Parentheticals in (parentheses). Transitions end with TO:
        </div>
      </footer>
    </main>
  );
}