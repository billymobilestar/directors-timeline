// src/lib/lyrics.ts
export type AlignedLine = {
  text: string;
  startSec: number;
  endSec?: number;
  confidence?: number;
};

/** Detects format and returns array of { text, startSec, endSec? } */
export function parseLyricsSmart(input: string): AlignedLine[] {
  const txt = (input || '').replace(/\r\n/g, '\n').trim();
  if (!txt) return [];

  // Detect LRC: lines like [mm:ss.xx] lyric
  if (/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/.test(txt)) {
    return parseLRC(txt);
  }

  // Detect SRT: blocks with numeric index, time --> time
  if (/^\s*\d+\s*\n\s*\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/m.test(txt)) {
    return parseSRT(txt);
  }

  // Fallback: plain lines (no times)
  return parsePlain(txt);
}

function parsePlain(txt: string): AlignedLine[] {
  const lines = txt
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
  return lines.map(l => ({ text: l, startSec: 0 }));
}

function parseLRC(txt: string): AlignedLine[] {
  // supports multiple time-tags per line
  const out: AlignedLine[] = [];
  const re = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)/g;
  for (const rawLine of txt.split('\n')) {
    let m: RegExpExecArray | null;
    let lineText = rawLine;
    const times: number[] = [];
    re.lastIndex = 0;
    while ((m = re.exec(rawLine))) {
      const mm = parseInt(m[1], 10);
      const ss = parseInt(m[2], 10);
      const ms = m[3] ? parseInt(pad3(m[3]), 10) : 0;
      const t = mm * 60 + ss + ms / 1000;
      times.push(t);
      lineText = m[4] ?? lineText;
    }
    const text = (lineText || '').trim();
    if (!times.length || !text) continue;
    for (const t of times) {
      out.push({ text, startSec: t });
    }
  }
  // optional endSec by looking ahead
  out.sort((a, b) => a.startSec - b.startSec);
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i].startSec < out[i + 1].startSec) {
      out[i].endSec = out[i + 1].startSec;
    }
  }
  return out;
}

function parseSRT(txt: string): AlignedLine[] {
  const out: AlignedLine[] = [];
  // blocks like:
  // 1
  // 00:00:01,000 --> 00:00:03,000
  // line text...
  const blocks = txt.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').map(s => s.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    // first line may be the index
    let idx = 0;
    if (/^\d+$/.test(lines[0])) idx = 1;
    const timeLine = lines[idx];
    const m = /^\s*(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/.exec(timeLine);
    if (!m) continue;
    const startSec = hmsMsToSec(m[1]);
    const endSec = hmsMsToSec(m[2]);
    const text = lines.slice(idx + 1).join(' ').trim();
    if (!text) continue;
    out.push({ text, startSec, endSec });
  }
  return out;
}

function pad3(s: string) {
  return (s + '000').slice(0, 3);
}
function hmsMsToSec(s: string) {
  // "HH:MM:SS,mmm"
  const [hh, mm, rest] = s.split(':');
  const [ss, msStr] = rest.split(',');
  const h = parseInt(hh, 10) || 0;
  const m = parseInt(mm, 10) || 0;
  const sec = parseInt(ss, 10) || 0;
  const ms = parseInt(msStr, 10) || 0;
  return h * 3600 + m * 60 + sec + ms / 1000;
}

/** Distribute lines without timestamps evenly across duration */
export function distributeAcrossDuration(lines: AlignedLine[], durationSec: number): AlignedLine[] {
  const pure = lines.filter(l => isFinite(l.startSec) && l.startSec >= 0);
  if (!pure.length) return [];
  // if they already have times, return as-is
  const hasAnyTiming = pure.some(l => l.startSec > 0 || typeof l.endSec === 'number');
  if (hasAnyTiming) return pure.sort((a, b) => a.startSec - b.startSec);

  const n = pure.length;
  const spacing = durationSec / (n + 1);
  const out: AlignedLine[] = pure.map((l, i) => ({
    text: l.text,
    startSec: Math.max(0, (i + 1) * spacing),
  }));
  // fill endSec as lookahead (optional)
  for (let i = 0; i < out.length - 1; i++) {
    out[i].endSec = out[i + 1].startSec;
  }
  return out;
}