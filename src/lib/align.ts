export type Word = { text: string; start: number; end: number };
export type AlignedLine = { text: string; startSec: number; endSec?: number };

/**
 * Segment words into line-level clips by pauses:
 * - A new clip starts when there is a gap >= pauseThreshold (seconds)
 * - A clip’s end is the last word’s end time
 */
export function wordsToClipsByPause(
  words: Word[],
  pauseThreshold = 0.6,
  maxCharsPerClip = 120
): AlignedLine[] {
  const out: AlignedLine[] = [];
  if (!words.length) return out;

  let curStart = words[0].start;
  let curEnd = words[0].end;
  let curText: string[] = [words[0].text];

  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    const prev = words[i - 1];
    const gap = w.start - prev.end;

    const wouldBe = curText.join(' ').length + 1 + (w.text || '').length;
    const tooLong = wouldBe > maxCharsPerClip;

    if (gap >= pauseThreshold || tooLong) {
      out.push({ text: curText.join(' '), startSec: curStart, endSec: curEnd });
      curStart = w.start;
      curText = [w.text];
    } else {
      curText.push(w.text);
    }
    curEnd = w.end;
  }
  out.push({ text: curText.join(' '), startSec: curStart, endSec: curEnd });
  return out;
}

/**
 * If user provides full lyrics lines, align by first/last word match per line.
 * Simple fuzzy strategy: case-insensitive, strip punctuation; match by sequence.
 * Returns only lines that matched at least one word.
 */
export function alignProvidedLyricsToWords(lines: string[], words: Word[]): AlignedLine[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();
  const wnorm = words.map(w => ({ ...w, n: norm(w.text) }));

  const out: AlignedLine[] = [];
  for (const line of lines) {
    const tokens = norm(line).split(' ').filter(Boolean);
    if (!tokens.length) continue;

    // find first & last token positions
    let firstIdx = -1;
    let lastIdx = -1;

    // first token
    for (let i = 0; i < wnorm.length; i++) {
      if (wnorm[i].n === tokens[0]) { firstIdx = i; break; }
    }
    if (firstIdx === -1) continue;

    // last token — search forward to keep order
    for (let j = firstIdx; j < wnorm.length; j++) {
      if (wnorm[j].n === tokens[tokens.length - 1]) lastIdx = j;
    }
    if (lastIdx === -1) continue;

    const start = Math.max(0, wnorm[firstIdx].start);
    const end = Math.max(start, wnorm[lastIdx].end);
    out.push({ text: line, startSec: start, endSec: end });
  }
  return out;
}