'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatTime } from '@/lib/time';
import LyricsPanel from '@/components/LyricsPanel';
import type { AlignedLine } from '@/lib/lyrics';
import type { Word as ASRWord } from '@/lib/align';
import { wordsToClipsByPause, alignProvidedLyricsToWords } from '@/lib/align';
import { Note, LyricsClip, Marker, AudioProjectV1 } from '@/types/music';
import { fmtLrcTime, fmtSrtTime } from '@/lib/subtitle';
import { downloadBlob } from '@/lib/download';
import Minimap from '@/components/Minimap';
import VerticalMinimap from '@/components/VerticalMinimap';
import WaveformToolbar from '@/components/music/WaveformToolbar';
import NoteModal from '@/components/music/NoteModal';
import LyricModal from '@/components/music/LyricModal';


type DragMode = 'none' | 'pan' | 'note' | 'lyric';
const COLLAPSED_H = 18;      // px
const TOGGLE_SIZE = 12;      // px chevron hit area
const TOGGLE_PAD = 4;        // padding inside note


const MUSIC_AUTOSAVE_KEY = 'dt:music:autosave:v1';
const MUSIC_PROJECT_NAME_KEY = 'dt:music:projectName';



export default function WaveformCanvas({ audioBuffer, setAudioBuffer }: { audioBuffer: AudioBuffer | null, setAudioBuffer?: (ab: AudioBuffer) => void }) {
  // Drag-and-drop area state
  const [dragOver, setDragOver] = useState(false);

  // File drop handler for audio files
  const onAudioDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith('audio/')) {
      alert('Please drop an audio file (.mp3, .wav, etc.)');
      return;
    }
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      ctx.decodeAudioData(arrayBuffer, (decoded) => {
        if (setAudioBuffer) {
          // Attach filename for project export
          (decoded as any)._fileName = file.name;
          setAudioBuffer(decoded);
        }
      }, (err) => {
        alert('Failed to decode audio: ' + err?.message || String(err));
      });
    } catch (err: any) {
      alert('Audio load failed: ' + (err?.message || String(err)));
    }
  };

  // Only show drop area if no audioBuffer loaded
  const showDropArea = !audioBuffer && setAudioBuffer;
  // Main canvas & container
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Canonical viewport height derived from the canvas element
  const [viewportHState, setViewportHState] = useState(0);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportHState(el.clientHeight || 0));
    ro.observe(el);
    setViewportHState(el.clientHeight || 0);
    return () => ro.disconnect();
  }, []);
// Track main viewport width so minimap window shows correctly
const [viewportW, setViewportW] = useState(0);
useEffect(() => {
  const el = containerRef.current;
  if (!el) return;
  const update = () => setViewportW(el.clientWidth || 0);
  const ro = new ResizeObserver(update);
  ro.observe(el);
  update();
  return () => ro.disconnect();
}, []);

// Track main viewport height for vertical scrollbar math
const [viewportH, setViewportH] = useState(0);
useEffect(() => {
  const el = containerRef.current;
  if (!el) return;
  const update = () => setViewportH(el.clientHeight || 0);
  const ro = new ResizeObserver(update);
  ro.observe(el);
  update();
  return () => ro.disconnect();
}, []);

function clampPanX(nextPan: number, nextZoom = zoom) {
  const dur = audioBuffer?.duration ?? peaks?.duration ?? 0;
  const canvasW = canvasRef.current?.clientWidth ?? 0;
  if (!dur || !canvasW || !isFinite(dur)) return nextPan;
  const viewSec = canvasW / Math.max(1, nextZoom);
  const maxLeftSec = Math.max(0, dur - viewSec);
  const minPan = -maxLeftSec * nextZoom; // see end of track
  const maxPan = 0;                      // see start of track
  return Math.max(minPan, Math.min(maxPan, nextPan));
}


// Markers
const [markers, setMarkers] = useState<Marker[]>([]);
const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
const draggingMarkerIdRef = useRef<string | null>(null);

// Loop A/B
const [loopEnabled, setLoopEnabled] = useState(false);
const [loopA, setLoopA] = useState<number | null>(null);
const [loopB, setLoopB] = useState<number | null>(null);
const loopDragRef = useRef<'none' | 'A' | 'B'>('none');

  // Notes & transport state
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const MIN_ZOOM = 1;     // px/sec (more zoom-out range)
const MAX_ZOOM = 300;   // px/sec cap
const [zoom, setZoom] = useState<number>(100); // px/sec (horizontal scale)
  const [panX, setPanX] = useState<number>(0);   // px (horizontal offset)
  const [playheadSec, setPlayheadSec] = useState<number>(0);
  // Vertical pan for notes (audio waveform stays centered)
  const [panY, setPanY] = useState<number>(0);   // px, clamped to [minY, 0]

  // Project name and top-chrome visibility (minimap + toolbar)
  const [projectName, setProjectName] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(MUSIC_PROJECT_NAME_KEY) || 'Untitled Audio Project';
    }
    return 'Untitled Audio Project';
  });
  const [chromeHidden, setChromeHidden] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(MUSIC_PROJECT_NAME_KEY, projectName); } catch {}
  }, [projectName]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const was = localStorage.getItem('dt:music:chromeHidden');
      if (was === 'true' || (was === null && window.innerWidth < 768)) {
        setChromeHidden(true);
      }
    }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('dt:music:chromeHidden', chromeHidden ? 'true' : 'false'); } catch {}
  }, [chromeHidden]);

  // Waveform height control (as % of canvas height)
  const [waveAmp, setWaveAmp] = useState<number>(0.22); // 0.1–0.5 good range

  // Global toggle: does dragging a note horizontally change timestamp?
  // (If false, horizontal drag only changes visual xOffset; timestamp stays fixed)
const [dragMovesTimestamp, setDragMovesTimestamp] = useState<boolean>(false);
  // Inline editor (small)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editorText, setEditorText] = useState<string>('');
  const [editorPos, setEditorPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Full-screen modal editor (large)
  const [modalNoteId, setModalNoteId] = useState<string | null>(null);
  const [modalText, setModalText] = useState<string>('');

  // Lyrics state
  const [lyricsClips, setLyricsClips] = useState<LyricsClip[]>([]);
  const [selectedLyricId, setSelectedLyricId] = useState<string | null>(null);
  const lyricStartRef = useRef<{ timestampSec: number } | null>(null);

  const [snappingEnabled, setSnappingEnabled] = useState<boolean>(false);

  // Lyric modal editor
  const [modalLyricId, setModalLyricId] = useState<string | null>(null);
  const [modalLyricText, setModalLyricText] = useState<string>('');
  const [lyricsOffsetSec, setLyricsOffsetSec] = useState<number>(0);

  // Audio graph
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const startedAtRef = useRef<number>(0);
  const baseTimeRef = useRef<number>(0);

  useEffect(() => {
    if (audioBuffer) {
      audioCtxRef.current ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }, [audioBuffer]);

  // Dragging state
  const dragModeRef = useRef<DragMode>('none');
  const isMouseDownRef = useRef<boolean>(false);
  const dragStartClientXRef = useRef<number>(0);
  const dragStartClientYRef = useRef<number>(0);

  // Note-dragging specifics
  const activeNoteIdRef = useRef<string | null>(null);
  const noteStartRef = useRef<{ timestampSec: number; xOffsetPx: number; yPx: number } | null>(null);

  // --- Touch drag state (single-finger for note or background pan) ---
  const touchDragRef = useRef<{
    mode: 'none' | 'note' | 'pan';
    id?: string; // note id when mode === 'note'
    startX: number;
    startY: number;
    noteStart?: { timestampSec: number; xOffsetPx: number; yPx: number };
    panStartX?: number;
    panStartPanX?: number;
  }>({ mode: 'none', startX: 0, startY: 0 });

  // --- Touch gesture state ---
  type TouchMode = 'none' | 'pan' | 'pinch';
  const touchModeRef = useRef<TouchMode>('none');
  const touchLastRef = useRef<{ x: number; y: number } | null>(null);
  const pinchStartRef = useRef<{ dist: number; zoom: number; centerXCss: number } | null>(null);

  function touchPointInCanvas(t: React.Touch | Touch) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }
  function pinchDistance(a: React.Touch | Touch, b: React.Touch | Touch) {
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.hypot(dx, dy);
  }
  function pinchCenterCss(a: React.Touch | Touch, b: React.Touch | Touch) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const cx = ((a.clientX + b.clientX) / 2) - rect.left;
    const cy = ((a.clientY + b.clientY) / 2) - rect.top;
    return { x: cx, y: cy };
  }

  
function lyricRect(clip: LyricsClip, zoomPxPerSec: number, DPR: number, canvasH: number) {
  const mid = canvasH / DPR / 2; // CSS px midline
  const h = clip.h ?? 40; // clip height in CSS px
  const startCss = worldTimeToCss(clip.timestampSec + lyricsOffsetSec);
  let wCss: number;
  if (typeof clip.endSec === 'number' && clip.endSec > clip.timestampSec) {
    const dur = Math.max(0, clip.endSec - clip.timestampSec);
    wCss = Math.max(40, dur * zoomPxPerSec);
  } else if (clip.w) {
    wCss = clip.w;
  } else {
    wCss = 60; // small default if we truly lack an end
  }
  return { left: startCss, top: mid - h / 2, w: wCss, h };
}
function estimateLyricDurationSec(text: string): number {
  // very light heuristic: ~2.5 words/sec, clamp between 0.5s and 8s
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
  const est = words / 2.5;
  return Math.min(8, Math.max(0.5, est));
}

function snapTime(t: number) {
  if (!snappingEnabled) return Math.max(0, t);
  const step = pickGridStepSec(zoom); // seconds
  const half = step / 2;
  return Math.max(0, Math.round(t / half) * half);
}

function hitTestLyric(xCss: number, yCss: number, DPR: number, canvasH: number): LyricsClip | null {
  for (let i = lyricsClips.length - 1; i >= 0; i--) {
    const c = lyricsClips[i];
    const r = lyricRect(c, zoom, DPR, canvasH);
    if (xCss >= r.left && xCss <= r.left + r.w && yCss >= r.top && yCss <= r.top + r.h) {
      return c;
    }
  }
  return null;
}

function normalizeAlignedLines(lines: AlignedLine[], audioDur: number | undefined): AlignedLine[] {
  if (!lines?.length) return lines;
  const maxStart = Math.max(...lines.map(l => typeof l.startSec === 'number' ? l.startSec : 0));
  const dur = typeof audioDur === 'number' && isFinite(audioDur) ? audioDur : undefined;
  let scale = 1;
  // If largest start time is way beyond track duration, assume ms and convert
  if (dur && maxStart > dur * 1.5) {
    scale = 1 / 1000;
  }
  return lines.map(l => ({
    ...l,
    startSec: Math.max(0, (l.startSec ?? 0) * scale),
    endSec: typeof l.endSec === 'number' ? Math.max(0, (l.endSec as number) * scale) : undefined,
  }));
}

function addAlignedLyricsAsClips(lines: AlignedLine[]) {
  if (!lines?.length) return;

  // 1) normalize timing units
  const norm0 = normalizeAlignedLines(lines, audioBuffer?.duration);

  // 2) keep only lines with finite start, then sort by time
  const norm = norm0
    .filter(l => typeof l.startSec === 'number' && isFinite(l.startSec as number))
    .sort((a, b) => (a.startSec! - b.startSec!));

  // 3) assign ends: prefer explicit, otherwise use next.start, else estimate
  const colors = ['#34d399', '#60a5fa', '#f59e0b', '#f472b6', '#a78bfa'];
  const dur = audioBuffer?.duration ?? undefined;
  const out: LyricsClip[] = [];
  for (let i = 0; i < norm.length; i++) {
    const cur = norm[i];
    const next = norm[i + 1];
    const start = Math.max(0, cur.startSec!);

    let end: number | undefined = undefined;
    if (typeof cur.endSec === 'number' && isFinite(cur.endSec)) {
      if (cur.endSec > start) end = cur.endSec;
    }
    // If no good explicit end, use next start if valid and after start
    if (end == null && next && typeof next.startSec === 'number' && next.startSec > start) {
      end = next.startSec;
    }
    // If still no end, estimate by words
    if (end == null) {
      end = start + estimateLyricDurationSec(cur.text || '');
    }
    // Clamp to audio duration
    if (dur && isFinite(dur)) {
      end = Math.min(end, dur);
    }
    // Ensure non-zero width
    if (!(end > start)) {
      end = start + 0.5;
    }

    out.push({
      id: crypto.randomUUID(),
      text: cur.text,
      timestampSec: start,
      endSec: end,
      color: colors[i % colors.length],
      h: 40,
    });
  }

  setLyricsClips(prev => prev.concat(out));
  setSelectedLyricId(out[0]?.id ?? null);
}
  // Downsample into 100ms peaks (simple starter)
  const peaks = useMemo(() => {
    if (!audioBuffer) return null;
    const channelData = audioBuffer.getChannelData(0);
    const duration = audioBuffer.duration;
    const sr = audioBuffer.sampleRate;
    const bucketsPerSecond = 10; // 100ms
    const arrLen = Math.ceil(duration * bucketsPerSecond);
    const arr: number[] = new Array(arrLen).fill(0);
    const bucketSize = Math.floor(sr / bucketsPerSecond);
    for (let i = 0; i < arrLen; i++) {
      const start = i * bucketSize;
      const end = Math.min((i + 1) * bucketSize, channelData.length);
      let min = 1, max = -1;
      for (let j = start; j < end; j += 64) {
        const v = channelData[j];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      arr[i] = max - min; // peak-to-peak
    }
    return { buckets: arr, bucketSec: 1 / bucketsPerSecond, duration };
  }, [audioBuffer]);

  // ---------- Helpers (DECLARATIONS FIRST) ----------
  function noteRect(n: Note) {
    return { w: n.w, h: n.collapsed ? COLLAPSED_H : n.h };
  }

  const contentHeightPx = useMemo(() => {
    let maxY = 0;
    for (const n of notes) {
      const r = noteRect(n);
      maxY = Math.max(maxY, n.yPx + r.h);
    }
    const derived = maxY + 60; // bottom padding
    const baseline = 1200; // keep canvas vertically scrollable even when empty
    return Math.max(derived, baseline);
  }, [notes]);

function hitTestMarker(xCss: number): Marker | null {
  const tol = 6; // px tolerance around the vertical line
  for (let i = markers.length - 1; i >= 0; i--) {
    const m = markers[i];
    const mx = worldTimeToCss(m.sec);
    if (Math.abs(xCss - mx) <= tol) return m;
  }
  return null;
}

function hitTestLoopHandle(xCss: number): 'A' | 'B' | null {
  if (!(loopEnabled && loopA != null && loopB != null && loopB > loopA)) return null;
  const tol = 6;
  const ax = worldTimeToCss(loopA);
  const bx = worldTimeToCss(loopB);
  if (Math.abs(xCss - ax) <= tol) return 'A';
  if (Math.abs(xCss - bx) <= tol) return 'B';
  return null;
}

  function clampPanY(next: number, viewportH: number) {
    const minY = Math.min(0, viewportH - contentHeightPx);
    const maxY = 0;
    return Math.max(minY, Math.min(maxY, next));
  }

  // Clamp panY reactively when sizes change
  useEffect(() => {
    setPanY((prev) => clampPanY(prev, viewportHState));
  }, [viewportHState, contentHeightPx]);
  function cssToWorldTime(xCss: number): number {
    return (xCss - panX) / zoom; // seconds
  }
  function worldTimeToCss(tSec: number): number {
    return tSec * zoom + panX;   // css px
  }
  function getViewportSec() {
    const c = canvasRef.current;
    const wCss = c ? c.clientWidth : 0;
    const startSec = Math.max(0, (-panX) / zoom);
    const endSec = startSec + (wCss / zoom);
    return { startSec, endSec, wCss };
  }
  function pickGridStepSec(z: number): number {
    // target ~120px between major lines
    const targetPx = 120;
    const raw = targetPx / z; // seconds between lines
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    for (const s of steps) if (raw <= s) return s;
    return 600; // 10 min
  }
  function drawChevron(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, collapsed: boolean) {
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath();
    if (collapsed) {
      // right-pointing triangle
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + size);
      ctx.lineTo(x + size, y + size / 2);
    } else {
      // down-pointing triangle
      ctx.moveTo(x, y);
      ctx.lineTo(x + size, y);
      ctx.lineTo(x + size / 2, y + size);
    }
    ctx.closePath();
    ctx.fill();
  }
  function drawTimeGridAndLabels(ctx: CanvasRenderingContext2D, w: number, h: number, DPR: number) {
    // grid
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1;
    const secStep = pickGridStepSec(zoom); // step in seconds
    const { startSec, endSec } = getViewportSec();
    const startTick = Math.floor(startSec / secStep) * secStep;
    for (let s = startTick; s <= endSec; s += secStep) {
      const xCss = worldTimeToCss(s);
      const x = xCss * DPR;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // labels (top)
    ctx.fillStyle = '#9ca3af';
    ctx.font = `${12 * DPR}px ui-sans-serif, system-ui`;
    const labelStep = secStep * (zoom < 80 ? 5 : zoom < 150 ? 2 : 1);
    const startLabel = Math.floor(startSec / labelStep) * labelStep;
    for (let s = startLabel; s <= endSec; s += labelStep) {
      const xCss = worldTimeToCss(s);
      const x = xCss * DPR + 2 * DPR;
      ctx.fillText(formatTime(s), x, 12 * DPR);
    }
  }
  function hitTestNote(xCss: number, yCss: number): Note | null {
    // Hit test in CSS pixels (not DPR)
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      const left = worldTimeToCss(n.timestampSec) + n.xOffsetPx;
      const top = n.yPx + panY;
      const { w, h } = noteRect(n);
      if (xCss >= left && xCss <= left + w && yCss >= top && yCss <= top + h) {
        return n;
      }
    }
    return null;
  }
  function hitToggleZone(n: Note, xCss: number, yCss: number): boolean {
    const left = worldTimeToCss(n.timestampSec) + n.xOffsetPx;
    const top = n.yPx + panY;
    const x0 = left + TOGGLE_PAD;
    const y0 = top + TOGGLE_PAD;
    return xCss >= x0 && xCss <= x0 + TOGGLE_SIZE && yCss >= y0 && yCss <= y0 + TOGGLE_SIZE;
  }
  function openEditorFor(note: Note) {
    if (note.collapsed) {
      setNotes(prev => prev.map(n => n.id === note.id ? { ...n, collapsed: false } : n));
    }
    setEditingNoteId(note.id);
    setEditorText(note.text);
    setSelectedNoteId(note.id);
    setEditorPos({
      x: worldTimeToCss(note.timestampSec) + note.xOffsetPx + 4,
      y: (note.yPx + panY) + 4
    });
  }
  function openModalFor(note: Note) {
    if (note.collapsed) {
      setNotes(prev => prev.map(n => n.id === note.id ? { ...n, collapsed: false } : n));
    }
    setModalNoteId(note.id);
    setModalText(note.text);
    setSelectedNoteId(note.id);
  }
  function saveModal() {
    if (!modalNoteId) return;
    setNotes(prev => prev.map(n => (n.id === modalNoteId ? { ...n, text: modalText } : n)));
    setModalNoteId(null);
  }
  function closeModal() {
    setModalNoteId(null);
  }

  // ---- Save / Open (export/import project) ----
  function makeProject(): AudioProjectV1 {
    return {
      version: 1,
      kind: 'dtmusic',
      projectName,
      zoom,
      panX,
      playheadSec,
      waveAmp,
      notes,
      audioMeta: audioBuffer ? { fileName: (audioBuffer as any)._fileName, duration: audioBuffer.duration } : null,
    };
  }

  function exportProject() {
    const payload = makeProject();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const safe = (projectName || 'Untitled Audio Project').replace(/[\/\\?%*:|"<>]/g, '_');
    downloadBlob(`${safe}.dtmusic.json`, blob);
  }

  function loadProject(data: unknown) {
    const p = data as Partial<AudioProjectV1>;
    if (!p || p.kind !== 'dtmusic' || p.version !== 1 || !Array.isArray(p.notes)) {
      throw new Error('Invalid music project file');
    }
    setNotes(p.notes);
    setZoom(typeof p.zoom === 'number' ? p.zoom : zoom);
    setPanX(typeof p.panX === 'number' ? p.panX : 0);
    setPlayheadSec(typeof p.playheadSec === 'number' ? p.playheadSec : 0);
    setWaveAmp(typeof p.waveAmp === 'number' ? p.waveAmp : waveAmp);
    setProjectName(p.projectName || 'Untitled Audio Project');
    // Note: audio is not embedded; user may re-upload the same file if desired.
  }

  const openProjectInputRef = useRef<HTMLInputElement | null>(null);
  const onOpenProjectClick = () => openProjectInputRef.current?.click();
  const onOpenProjectChosen: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      loadProject(json);
    } catch (err: any) {
      console.error('[Open Music Project] Failed:', err);
      alert(`Failed to open project: ${err?.message || String(err)}`);
    } finally {
      if (e.currentTarget) e.currentTarget.value = '';
    }
  };

  // ---------- Main canvas drawing ----------
  // Autosave (debounced)
  useEffect(() => {
    const h = setTimeout(() => {
      try { localStorage.setItem(MUSIC_AUTOSAVE_KEY, JSON.stringify(makeProject())); } catch {}
    }, 400);
    return () => clearTimeout(h);
  }, [projectName, zoom, panX, playheadSec, waveAmp, notes]);

  // Load autosave on mount (if present and nothing yet)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(MUSIC_AUTOSAVE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data?.kind === 'dtmusic') loadProject(data);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const draw = () => {
      const DPR = Math.max(1, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.floor(canvas.clientWidth * DPR));
      const h = Math.max(1, Math.floor(canvas.clientHeight * DPR));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);

      // background
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, h);

      // time grid + labels
      drawTimeGridAndLabels(ctx, w, h, DPR);

      // waveform
      if (peaks) {
        const mid = h / 2;
        const amp = h * waveAmp; // adjustable
        ctx.fillStyle = '#2563eb';
        const bucketsPerSec = 1 / peaks.bucketSec;
        const startSec = Math.max(0, (-panX) / zoom);
        const endSec = startSec + (w / DPR) / zoom;
        const startIdx = Math.floor(startSec * bucketsPerSec);
        const endIdx = Math.min(peaks.buckets.length - 1, Math.ceil(endSec * bucketsPerSec));
        for (let i = startIdx; i <= endIdx; i++) {
          const sec = i / bucketsPerSec;
          const x = (sec * zoom + panX) * DPR;
          const v = peaks.buckets[i];
          const barH = v * amp;
          ctx.fillRect(x, mid - barH / 2, Math.max(1, 0.5 * DPR), barH);
        }
      }

      // lyrics clips (centered over waveform)
      {
        const DPRv = DPR;
        for (const c of lyricsClips) {
          const r = lyricRect(c, zoom, DPRv, h);
          const x = r.left * DPRv;
          const y = r.top * DPRv;
          const wCss = r.w; const hCss = r.h;
          // body
          ctx.fillStyle = c.color;
          ctx.fillRect(x, y, wCss * DPRv, hCss * DPRv);
          // border if selected
          if (c.id === selectedLyricId) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2 * DPRv;
            ctx.strokeRect(x - 1 * DPRv, y - 1 * DPRv, wCss * DPRv + 2 * DPRv, hCss * DPRv + 2 * DPRv);
          }
          // text
          ctx.fillStyle = '#0a0a0a';
          ctx.font = `${12 * DPRv}px ui-sans-serif, system-ui`;
          ctx.fillText(c.text.slice(0, 100), x + 6 * DPRv, y + 16 * DPRv);
        }
      }

// Loop region & handles
if (loopEnabled && loopA != null && loopB != null && loopB > loopA) {
  const xA = (loopA * zoom + panX) * DPR;
  const xB = (loopB * zoom + panX) * DPR;
  ctx.fillStyle = 'rgba(168,85,247,0.12)';
  ctx.fillRect(xA, 0, xB - xA, h);
  ctx.fillStyle = '#a855f7';
  ctx.fillRect(xA - 2, 0, 4, h);
  ctx.fillRect(xB - 2, 0, 4, h);
}

      // Markers
      for (const m of markers) {
        const x = (m.sec * zoom + panX) * DPR;
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 2 * DPR;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
        // pill label
        ctx.fillStyle = m.color;
        ctx.fillRect(x - 24 * DPR, 4 * DPR, 48 * DPR, 16 * DPR);
        ctx.fillStyle = '#0a0a0a';
        ctx.font = `${10 * DPR}px ui-sans-serif, system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(m.label, x, 12 * DPR);
      }

      // playhead
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 2;
      const phx = (playheadSec * zoom + panX) * DPR;
      ctx.beginPath(); ctx.moveTo(phx, 0); ctx.lineTo(phx, h); ctx.stroke();

      // notes (with timestamp and “trace line” to anchor)
      for (const n of notes) {
        const { w: nw, h: nh } = noteRect(n);
        const noteLeftCss = worldTimeToCss(n.timestampSec) + n.xOffsetPx;
        const x = noteLeftCss * DPR;
        const y = (n.yPx + panY) * DPR;

        // sticky
        ctx.fillStyle = n.color;
        ctx.fillRect(x, y, nw * DPR, nh * DPR);

        // border if selected
        if (n.id === selectedNoteId) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.strokeRect(x - 1 * DPR, y - 1 * DPR, nw * DPR + 2 * DPR, nh * DPR + 2 * DPR);
        }

        // chevron (toggle)
        drawChevron(ctx, (noteLeftCss + TOGGLE_PAD) * DPR, (n.yPx + panY + TOGGLE_PAD) * DPR, TOGGLE_SIZE * DPR, !!n.collapsed);

        // “trace line” from note to its time anchor on waveform midline (thicker & clearer)
        const anchorX = (n.timestampSec * zoom + panX) * DPR;
        const midY = (h / 2);
        // Outer soft halo for visibility
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 4 * DPR;
        ctx.beginPath();
        ctx.moveTo(x + (nw * DPR) / 2, y + nh * DPR);
        ctx.lineTo(anchorX, midY);
        ctx.stroke();
        // Inner bright core
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 2 * DPR;
        ctx.beginPath();
        ctx.moveTo(x + (nw * DPR) / 2, y + nh * DPR);
        ctx.lineTo(anchorX, midY);
        ctx.stroke();

        // text: timestamp + (maybe) note text
        ctx.fillStyle = '#0a0a0a';
        ctx.font = `${12 * DPR}px ui-sans-serif, system-ui`;
        const ts = formatTime(n.timestampSec);
        const base = `[${ts}]`;
        const label = n.collapsed ? base : `${base} ${n.text}`;
        ctx.fillText(label.slice(0, 60), x + (TOGGLE_PAD + TOGGLE_SIZE + 4) * DPR, y + 14 * DPR);
      }


      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  // Dependency array updated to track markers, selectedMarkerId, loopEnabled, loopA, loopB
  }, [peaks, zoom, panX, panY, playheadSec, notes, selectedNoteId, waveAmp, lyricsClips, selectedLyricId, lyricsOffsetSec, markers, selectedMarkerId, loopEnabled, loopA, loopB]);

  // ---------- Playback ----------
  const play = () => {
    if (!audioBuffer || !audioCtxRef.current) return;
    if (isPlaying) return;
    const ctx = audioCtxRef.current;
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);
    src.start(0, playheadSec);
    sourceRef.current = src;
    startedAtRef.current = ctx.currentTime;
    baseTimeRef.current = playheadSec;
    setIsPlaying(true);
    src.onended = () => setIsPlaying(false);
  };
  const pause = () => {
    sourceRef.current?.stop();
    sourceRef.current = null;
    setIsPlaying(false);
  };
function seekTo(sec: number) {
  setPlayheadSec(sec);
  if (!audioBuffer || !audioCtxRef.current) return;
  if (!isPlaying) return;
  try { sourceRef.current?.stop(); } catch {}
  const ctx = audioCtxRef.current;
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(ctx.destination);
  src.start(0, sec);
  sourceRef.current = src;
  startedAtRef.current = ctx.currentTime;
  baseTimeRef.current = sec;
  src.onended = () => setIsPlaying(false);
}

  // Reset view to center playhead horizontally and reset vertical pan
  function resetViewPosition() {
    // reset vertical pan
    setPanY(0);

    // center playhead in the viewport if we can measure it; otherwise go to start
    const dur = audioBuffer?.duration ?? peaks?.duration ?? 0;
    const wCss = canvasRef.current?.clientWidth ?? 0;
    if (!wCss || !zoom) {
      setPanX(0);
      return;
    }
    const viewDur = wCss / Math.max(1, zoom);
    const targetStartSec = Math.max(0, Math.min(
      // center on current playhead
      Math.max(0, playheadSec - viewDur / 2),
      // but don’t scroll past the end
      Math.max(0, dur - viewDur)
    ));
    const nextPanX = clampPanX(-(targetStartSec * zoom));
    setPanX(nextPanX);
  }

  // New Canvas helper
  function newCanvas() {
    const ok = window.confirm(
      'Create a new canvas?\n\nThis will CLEAR all notes, lyrics, markers, loop settings, selections, and view position. Your current autosave for this project will also be cleared.'
    );
    if (!ok) return;

    // Clear timeline entities
    setNotes([]);
    setLyricsClips([]);
    setMarkers([]);

    // Clear selections and interactions
    setSelectedNoteId(null);
    setEditingNoteId(null);
    setModalNoteId(null);
    setSelectedLyricId(null);
    setModalLyricId(null);
    setSelectedMarkerId(null);

    // Reset loop
    setLoopEnabled(false);
    setLoopA(null);
    setLoopB(null);

    // Reset view/transport
    setPanX(0);
    setPanY(0);
    setZoom(100);
    setPlayheadSec(0);

    // Clear autosave for music canvas
    try { localStorage.removeItem(MUSIC_AUTOSAVE_KEY); } catch {}
  }

  useEffect(() => {
    if (!isPlaying || !audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    let raf = 0;
    const tick = () => {
      const t = baseTimeRef.current + (ctx.currentTime - startedAtRef.current);

      const endCap = audioBuffer?.duration || t;
      let next = Math.min(t, endCap);
      if (loopEnabled && loopA != null && loopB != null && loopB > loopA) {
        if (next >= loopB) {
          seekTo(loopA);
          return;
        }
      }
      setPlayheadSec(next);

raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, audioBuffer]);

  // ---------- Interactions ----------
  // --- Touch handlers (one-finger pan/note drag, two-finger pinch zoom, tap to scrub) ---
  const onTouchStart: React.TouchEventHandler<HTMLCanvasElement> = (e) => {
    if (!canvasRef.current) return;
    if (e.touches.length === 1) {
      e.preventDefault();
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const x = e.touches[0].clientX - rect.left;
      const y = e.touches[0].clientY - rect.top;

      // If touching a note: start note drag (unless tapping the chevron zone -> toggle)
      const hit = hitTestNote(x, y);
      if (hit) {
        if (hitToggleZone(hit, x, y)) {
          // tap on toggle chevron: collapse/expand, no drag
          setNotes(prev => prev.map(n => n.id === hit.id ? ({ ...n, collapsed: !n.collapsed }) : n));
          setSelectedNoteId(hit.id);
          touchDragRef.current = { mode: 'none', startX: 0, startY: 0 };
          return;
        }
        // begin dragging this note
        touchDragRef.current = {
          mode: 'note',
          id: hit.id,
          startX: x,
          startY: y,
          noteStart: { timestampSec: hit.timestampSec, xOffsetPx: hit.xOffsetPx, yPx: hit.yPx },
        };
        setSelectedNoteId(hit.id);
        // scrub playhead on touch-down too
        setPlayheadSec(Math.max(0, cssToWorldTime(x)));
        return;
      }

      // Otherwise: background pan with one finger
      touchDragRef.current = {
        mode: 'pan',
        startX: x,
        startY: y,
        panStartX: x,
        panStartPanX: panX,
      };
      touchModeRef.current = 'pan';
      touchLastRef.current = { x, y };
      setPlayheadSec(Math.max(0, cssToWorldTime(x)));
    } else if (e.touches.length >= 2) {
      e.preventDefault();
      // pinch zoom
      touchDragRef.current = { mode: 'none', startX: 0, startY: 0 };
      touchModeRef.current = 'pinch';
      const a = e.touches[0], b = e.touches[1];
      const dist = pinchDistance(a, b);
      const center = pinchCenterCss(a, b);
      pinchStartRef.current = { dist, zoom, centerXCss: center.x };
    }
  };
  const onTouchMove: React.TouchEventHandler<HTMLCanvasElement> = (e) => {
    if (!canvasRef.current) return;

    // If dragging a note, handle first
    const drag = touchDragRef.current;
    if (drag.mode === 'note') {
      if (e.touches.length !== 1 || !drag.id || !drag.noteStart) return;
      e.preventDefault();
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const x = e.touches[0].clientX - rect.left;
      const y = e.touches[0].clientY - rect.top;
      const dx = x - drag.startX;
      const dy = y - drag.startY;

      // Honor the global "dragMovesTimestamp" toggle (no shift on touch)
      setNotes(prev =>
        prev.map(n => {
          if (n.id !== drag.id) return n;
          if (!dragMovesTimestamp) {
            // timestamp stays; change xOffset + y
            const fixedLeftPx = worldTimeToCss(drag.noteStart!.timestampSec);
            const newOffset = (fixedLeftPx + drag.noteStart!.xOffsetPx + dx) - fixedLeftPx;
            return { ...n, xOffsetPx: newOffset, yPx: Math.max(0, drag.noteStart!.yPx + dy) };
          } else {
            // timestamp changes based on new left; keep current xOffset relative
            const newLeftPx = worldTimeToCss(drag.noteStart!.timestampSec) + drag.noteStart!.xOffsetPx + dx;
            const newTime = cssToWorldTime(newLeftPx - n.xOffsetPx);
            return { ...n, timestampSec: Math.max(0, newTime), yPx: Math.max(0, drag.noteStart!.yPx + dy) };
          }
        })
      );
      return;
    }

    // Otherwise fall back to pan / pinch
    if (touchModeRef.current === 'pan' && e.touches.length === 1) {
      e.preventDefault();
      const cur = touchPointInCanvas(e.touches[0]);
      const last = touchLastRef.current;
      if (!last) { touchLastRef.current = cur; return; }
      const dx = cur.x - last.x;
      const dy = cur.y - last.y;
      touchLastRef.current = cur;
      setPanX((p) => clampPanX(p + dx));
      setPanY((y) => clampPanY(y + dy, viewportHState));
      return;
    } else if (touchModeRef.current === 'pinch' && e.touches.length >= 2) {
      e.preventDefault();
      const a = e.touches[0], b = e.touches[1];
      const start = pinchStartRef.current;
      if (!start) return;
      const dist = pinchDistance(a, b);
      const scale = dist / Math.max(1, start.dist);
      const unclampedZoom = start.zoom * scale;
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, unclampedZoom));
      const center = start.centerXCss;
      const worldUnder = (center - panX) / zoom;
      let nextPan = center - worldUnder * nextZoom;
      nextPan = clampPanX(nextPan, nextZoom);
      setZoom(nextZoom);
      setPanX(nextPan);
      return;
    }
  };
  const onTouchEnd: React.TouchEventHandler<HTMLCanvasElement> = (e) => {
    if (e.touches.length === 0) {
      touchModeRef.current = 'none';
      touchLastRef.current = null;
      pinchStartRef.current = null;
      touchDragRef.current = { mode: 'none', startX: 0, startY: 0 };
    } else if (e.touches.length === 1) {
      touchModeRef.current = 'pan';
      const cur = touchPointInCanvas(e.touches[0]);
      touchLastRef.current = cur;
      pinchStartRef.current = null;
      touchDragRef.current = { mode: 'none', startX: 0, startY: 0 };
    }
  };
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const cursorX = e.clientX - rect.left;

    // Ctrl/trackpad pinch => zoom around cursor
    if (e.ctrlKey) {
      const worldUnder = (cursorX - panX) / zoom;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const unclamped = zoom * factor;
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, unclamped));
      let nextPan = cursorX - worldUnder * nextZoom;
      nextPan = clampPanX(nextPan, nextZoom);
      setZoom(nextZoom);
      setPanX(nextPan);
      return;
    }

    // Normal wheel: choose dominant axis and pan, with clamping
    const viewportH = viewportHState;
    const absX = Math.abs(e.deltaX);
    const absY = Math.abs(e.deltaY);
    if (absX >= absY) {
      setPanX((p) => clampPanX(p - e.deltaX));
    } else {
      setPanY((y) => clampPanY(y - e.deltaY, viewportH));
    }
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    isMouseDownRef.current = true;
    dragStartClientXRef.current = e.clientX;
    dragStartClientYRef.current = e.clientY;

    // Lyrics first
    const DPR = Math.max(1, window.devicePixelRatio || 1);
    
    // Loop handle hit
    const handle = hitTestLoopHandle(x);
    if (handle) {
      loopDragRef.current = handle;
      isMouseDownRef.current = true;
      return;
    }

    // Marker hit
    const mHit = hitTestMarker(x);
    if (mHit) {
      draggingMarkerIdRef.current = mHit.id;
      setSelectedMarkerId(mHit.id);
      isMouseDownRef.current = true;
      dragModeRef.current = 'pan'; // reuse flow; we update marker directly in move
      return;
    }

    const hitLyric = hitTestLyric(x, y, DPR, (e.target as HTMLCanvasElement).height);
    if (hitLyric) {
      dragModeRef.current = 'lyric';
      lyricStartRef.current = { timestampSec: hitLyric.timestampSec };
      setSelectedLyricId(hitLyric.id);
      setSelectedNoteId(null);
      return;
    }

    const hit = hitTestNote(x, y);
    if (hit) {
      if (hitToggleZone(hit, x, y)) {
        setNotes(prev => prev.map(n => n.id === hit.id ? ({ ...n, collapsed: !n.collapsed }) : n));
        isMouseDownRef.current = false;
        dragModeRef.current = 'none';
        setSelectedNoteId(hit.id);
        setSelectedLyricId(null);
        return;
      }
      dragModeRef.current = 'note';
      activeNoteIdRef.current = hit.id;
      noteStartRef.current = { timestampSec: hit.timestampSec, xOffsetPx: hit.xOffsetPx, yPx: hit.yPx };
      setSelectedNoteId(hit.id);
      setSelectedLyricId(null);
    } else {
      dragModeRef.current = 'pan';
      setSelectedNoteId(null);
      setSelectedLyricId(null);
    }
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isMouseDownRef.current) return;

    const totalDx = e.clientX - dragStartClientXRef.current;
    const totalDy = e.clientY - dragStartClientYRef.current;

    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const xCss = e.clientX - rect.left;
    const sec = cssToWorldTime(xCss);
    const s = snapTime(sec);

    // Loop handle dragging
    if (loopDragRef.current !== 'none') {
      if (loopDragRef.current === 'A') {
        const nextA = s;
        // keep A < B if B exists
        setLoopA(prev => {
          const newA = Math.max(0, nextA);
          if (loopB != null && newA >= loopB) return Math.max(0, loopB - 0.01);
          return newA;
        });
      } else if (loopDragRef.current === 'B') {
        const nextB = s;
        // keep B > A if A exists
        setLoopB(prev => {
          const newB = Math.max(0, nextB);
          if (loopA != null && newB <= loopA) return loopA + 0.01;
          return newB;
        });
      }
      return;
    }

    // Marker dragging
    if (draggingMarkerIdRef.current) {
      const id = draggingMarkerIdRef.current;
      const next = Math.max(0, s);
      setMarkers(prev => prev.map(m => m.id === id ? { ...m, sec: next } : m));
      return;
    }

   if (dragModeRef.current === 'pan') {
    setPanX((p) => clampPanX(p + (e.movementX || 0)));
    setPanY((y) => clampPanY(y + (e.movementY || 0), viewportHState));
    return;
  }
    if (dragModeRef.current === 'lyric' && lyricStartRef.current && selectedLyricId) {
      const totalDx = e.clientX - dragStartClientXRef.current;
      const start = lyricStartRef.current;

      // account for global lyrics offset when converting pixels <-> seconds
      const newLeftPx = worldTimeToCss(start.timestampSec + lyricsOffsetSec) + totalDx;
      const newTimeWithOffset = cssToWorldTime(newLeftPx);
      const rawClipTime = newTimeWithOffset - lyricsOffsetSec;

      const snapped = snapTime(rawClipTime);
      setLyricsClips(prev => prev.map(c => c.id === selectedLyricId ? { ...c, timestampSec: snapped } : c));
      return;
    }

    if (dragModeRef.current === 'note' && activeNoteIdRef.current && noteStartRef.current) {
      const noteId = activeNoteIdRef.current;
      const start = noteStartRef.current;
      // Shift temporarily inverts the checkbox behavior
      const shouldMoveTimestamp = e.shiftKey ? !dragMovesTimestamp : dragMovesTimestamp;

      setNotes((prev) =>
        prev.map((n) => {
          if (n.id !== noteId) return n;

          // Start position (CSS px)
          const startLeftPx = worldTimeToCss(start.timestampSec) + start.xOffsetPx;
          const newLeftPx = startLeftPx + totalDx;

          if (!shouldMoveTimestamp) {
            // keep timestamp fixed; update xOffset only
            const fixedTLeftPx = worldTimeToCss(start.timestampSec);
            const newOffset = newLeftPx - fixedTLeftPx;
            return {
              ...n,
              xOffsetPx: newOffset,
              yPx: Math.max(0, start.yPx + totalDy)
            };
          } else {
            // update timestamp from newLeftPx; keep current xOffset relative
            const newTime = cssToWorldTime(newLeftPx - n.xOffsetPx);
            const snappedTime = snapTime(newTime);
            return {
              ...n,
              timestampSec: Math.max(0, snappedTime),
              yPx: Math.max(0, start.yPx + totalDy)
            };
          }
        })
      );
    }
  };

const endDrag = () => {
  isMouseDownRef.current = false;
  dragModeRef.current = 'none';
  activeNoteIdRef.current = null;
  noteStartRef.current = null;
  loopDragRef.current = 'none';
  draggingMarkerIdRef.current = null;
};
const onMouseUp = () => endDrag();
  const onMouseLeave = () => endDrag();

  // Click anywhere scrubs playhead; also selects a note or lyric if present
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isMouseDownRef.current) return; // ignore click after drag
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const DPR = Math.max(1, window.devicePixelRatio || 1);
    const hitLyric = hitTestLyric(x, y, DPR, (e.target as HTMLCanvasElement).height);
    if (hitLyric) {
      setSelectedLyricId(hitLyric.id);
      setSelectedNoteId(null);
    } else {
      setSelectedLyricId(null);
    }

    const t = Math.max(0, (x - panX) / zoom);
    setPlayheadSec(t);

    const hit = hitTestNote(x, y);
    setSelectedNoteId(hit?.id ?? null);
  };

  // Double-click any note or lyric -> open big modal
  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const DPR = Math.max(1, window.devicePixelRatio || 1);
    const hitLyric = hitTestLyric(x, y, DPR, (e.target as HTMLCanvasElement).height);
    if (hitLyric) {
      setModalLyricId(hitLyric.id);
      setModalLyricText(hitLyric.text);
      return;
    }
    const hit = hitTestNote(x, y);
    if (!hit) return;
    openModalFor(hit);
  };

  const addNote = () => {
    const id = crypto.randomUUID();
    const yBase = 20 + (notes.length % 6) * 30;
    const newNote: Note = {
      id,
      timestampSec: playheadSec,
      xOffsetPx: 0,
      yPx: yBase,
      text: `Note ${notes.length + 1}`,
      color: '#eab308',
      w: 160,
      h: 26,
      collapsed: false
    };
    setNotes((ns) => ns.concat(newNote));
    setSelectedNoteId(id);
  };

  // ---------- Inline editor overlay (kept for future triggers) ----------
  const saveEditor = () => {
    if (!editingNoteId) return;
    setNotes((prev) => prev.map((n) => (n.id === editingNoteId ? { ...n, text: editorText } : n)));
    setEditingNoteId(null);
  };
  const cancelEditor = () => setEditingNoteId(null);
  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); saveEditor();
    } else if (e.key === 'Escape') {
      e.preventDefault(); cancelEditor();
    }
  };
  const onContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!editingNoteId) return;
    const target = e.target as HTMLElement;
    if (target.dataset.role !== 'note-editor') saveEditor();
  };

  // ---------- Minimap (overview) ----------

  

  


  // ---------- Render ----------
  return (
 <div
    ref={containerRef}
    className="h-full flex flex-col bg-neutral-950"
     onClick={onContainerClick}>

      <input
  id="ai-audio-input"
  type="file"
accept="audio/*,video/*,application/octet-stream,.mp3,.wav,.m4a,.aac,.ogg,.flac,.aif,.aiff,.caf"  className="hidden"
  onChange={async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      ctx.decodeAudioData(
        arrayBuffer,
        (decoded) => {
          if (setAudioBuffer) {
            (decoded as any)._fileName = file.name;
            setAudioBuffer(decoded);
          }
        },
        (err) => {
          alert('Failed to decode audio: ' + (err?.message || String(err)));
        }
      );
    } catch (err: any) {
      alert('Audio load failed: ' + (err?.message || String(err)));
    } finally {
      e.currentTarget.value = '';
    }
  }}
/>
      {/* Drag-and-drop audio upload area */}
      {showDropArea && (
        <div
          onDrop={onAudioDrop}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={e => { setDragOver(false); }}
          className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg mt-8 mx-8 py-16 transition-colors duration-200
            ${dragOver ? 'border-blue-500 bg-blue-950/40' : 'border-neutral-500 bg-neutral-950/80'}
            `}
          style={{ minHeight: 220 }}
        >
          <svg width="48" height="48" fill="none" viewBox="0 0 48 48" className="mb-4 text-blue-400">
            <path d="M24 6v24m0 0l-8-8m8 8l8-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            <rect x="8" y="34" width="32" height="6" rx="2" fill="currentColor" fillOpacity="0.1"/>
          </svg>
          <div className="text-lg font-medium text-blue-100 mb-2">Drag & drop your audio file here</div>
          <div className="text-sm text-neutral-300">or click <label htmlFor="ai-audio-input" className="underline cursor-pointer text-blue-400">here</label> to select</div>
          <div className="mt-2 text-xs text-neutral-500">Supported formats: .mp3, .wav, .ogg, .m4a, etc.</div>
        </div>
      )}
      {/* Minimap at TOP */}
      <div
        className="border-b border-neutral-800 bg-neutral-950 flex items-center"
        onWheel={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <Minimap
          duration={peaks?.duration ?? 0}
          buckets={peaks?.buckets ?? []}
          viewStartSec={Math.max(0, (-panX) / Math.max(1, zoom))}
          viewDurationSec={(viewportW || 1) / Math.max(1, zoom)}
          onJump={(targetSec) => {
            const dur = audioBuffer?.duration ?? peaks?.duration ?? 0;
            const viewDur = (canvasRef.current?.clientWidth ?? 1) / Math.max(1, zoom);
            const startSec = Math.max(0, Math.min(targetSec - viewDur / 2, Math.max(0, dur - viewDur)));
            setPanX((p) => clampPanX(-(startSec * zoom)));
          }}
          onWindowChange={(startSec) => {
            setPanX((p) => clampPanX(-(startSec * zoom)));
          }}
          onWindowResize={(startSec, durationSec) => {
            // resize via zoom so the requested duration fits the main viewport
            const wCss = viewportW || 1;           
            const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, wCss / Math.max(0.001, durationSec)));
            setZoom(nextZoom);
            setPanX((p) => clampPanX(-(startSec * nextZoom), nextZoom));
          }}
          height={56}
        />
      </div>

      {/* Toolbar */}
      {/* Toolbar */}
{!chromeHidden && (
  <WaveformToolbar
    isPlaying={isPlaying}
    onPlay={play}
    onPause={pause}
    onStep={(d) => setPlayheadSec((s) => Math.max(0, s + d))}
    onAddNote={addNote}

    projectName={projectName}
    onProjectNameChange={setProjectName}

    onExportProject={exportProject}
    openProjectInputRef={openProjectInputRef}
    onOpenProjectChosen={onOpenProjectChosen}
    onOpenProjectClick={onOpenProjectClick}

    onAnalyzeClick={() => document.getElementById('ai-audio-input')?.click()}
    onLyricsOpen={() => setLyricsOpen(true)}

    onAddMarkerAtPlayhead={() => {
      const id = crypto.randomUUID();
      const color = '#22c55e';
      const label = `${markers.length + 1}`;
      setMarkers(prev => prev.concat({ id, sec: playheadSec, label, color }));
      setSelectedMarkerId(id);
    }}

    onDeleteSelected={() => {
      if (selectedMarkerId) {
        setMarkers(prev => prev.filter(m => m.id !== selectedMarkerId));
        setSelectedMarkerId(null);
        return;
      }
      if (selectedNoteId) {
        setNotes(prev => prev.filter(n => n.id !== selectedNoteId));
        setSelectedNoteId(null);
        return;
      }
      if (selectedLyricId) {
        setLyricsClips(prev => prev.filter(c => c.id !== selectedLyricId));
        setSelectedLyricId(null);
      }
    }}
    deleteDisabled={!selectedNoteId && !selectedLyricId && !selectedMarkerId}

    loopEnabled={loopEnabled}
    setLoopEnabled={setLoopEnabled}
    onSetLoopA={() => setLoopA(playheadSec)}
    onSetLoopB={() => { if (loopA != null && playheadSec <= loopA) { alert('Loop B must be after A'); return; } setLoopB(playheadSec); }}
    onClearLoop={() => { setLoopA(null); setLoopB(null); }}

    snappingEnabled={snappingEnabled}
    setSnappingEnabled={setSnappingEnabled}

    lyricsOffsetSec={lyricsOffsetSec}
    setLyricsOffsetSec={setLyricsOffsetSec}

    waveAmp={waveAmp}
    setWaveAmp={setWaveAmp}

    zoom={zoom}
    setZoom={(z) => setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)))}


    dragMovesTimestamp={dragMovesTimestamp}
    setDragMovesTimestamp={setDragMovesTimestamp}

    playheadLabel={formatTime(playheadSec)}
  />
)}

      {/* Floating controls (mobile-first, always visible) */}
      <div className="fixed right-3 top-3 z-50 flex flex-col gap-2">
        <button
          onClick={() => setChromeHidden(v => !v)}
          className="px-3 py-1.5 rounded-full border border-neutral-700 bg-neutral-900/80 backdrop-blur hover:bg-neutral-800 text-sm"
          title={chromeHidden ? 'Show controls' : 'Hide controls'}
        >
          {chromeHidden ? 'Show UI' : 'Hide UI'}
        </button>
        <button
          onClick={resetViewPosition}
          className="px-3 py-1.5 rounded-full border border-neutral-700 bg-neutral-900/80 backdrop-blur hover:bg-neutral-800 text-sm"
          title="Reset view to center on playhead and re-center vertically"
        >
          Reset View
        </button>
        <button
          onClick={newCanvas}
          className="px-3 py-1.5 rounded-full border border-red-600 text-red-200 bg-red-900/60 backdrop-blur hover:bg-red-800 text-sm"
          title="Create a new canvas (clears current work)"
        >
          New Canvas
        </button>
      </div>

      {/* Main canvas */}
      <div className="flex-1 relative">
        <canvas
          ref={canvasRef}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{ touchAction: 'none' }}
          className="w-full h-full cursor-crosshair"
        />

        {/* Vertical minimap (always visible for vertical navigation) */}
        <VerticalMinimap
          contentHeightPx={contentHeightPx}
          viewStartPx={Math.max(0, -panY)}
          viewHeightPx={viewportHState}
          onJumpY={(topPx) => {
            setPanY((_) => clampPanY(-topPx, viewportHState));
          }}
          onWindowChangeY={(topPx) => {
            setPanY((_) => clampPanY(-topPx, viewportHState));
          }}
          onWindowResizeY={(topPx, _heightPx) => {
            // If/when you add vertical zoom, adjust zoomY from _heightPx here.
            setPanY((_) => clampPanY(-topPx, viewportHState));
          }}
          className="z-20"
        />

        {/* Inline editor overlay (small) */}
        {editingNoteId && (
          <textarea
            data-role="note-editor"
            value={editorText}
            onChange={(e) => setEditorText(e.target.value)}
            onKeyDown={onEditorKeyDown}
            autoFocus
            style={{
              position: 'absolute',
              left: Math.round(editorPos.x),
              top: Math.round(editorPos.y),
              width: 240,
              height: 80
            }}
            className="p-2 rounded-md bg-white/95 text-black shadow-lg outline-none border border-neutral-300"
          />
        )}

        {/* Full-screen Note Modal (large) */}
        <NoteModal
  open={!!modalNoteId}
  timestampSec={(() => {
    const n = notes.find(n => n.id === modalNoteId);
    return n ? n.timestampSec : null;
  })()}
  text={modalText}
  onChangeText={setModalText}
  onClose={() => setModalNoteId(null)}
  onSave={() => {
    if (!modalNoteId) return;
    setNotes(prev => prev.map(n => (n.id === modalNoteId ? { ...n, text: modalText } : n)));
    setModalNoteId(null);
  }}
/>

        {/* Full-screen Lyric Modal (large) */}
        <LyricModal
  open={!!modalLyricId}
  text={modalLyricText}
  onChangeText={setModalLyricText}
  onClose={() => setModalLyricId(null)}
  onSave={() => {
    if (!modalLyricId) return;
    setLyricsClips(prev => prev.map(c => c.id === modalLyricId ? { ...c, text: modalLyricText } : c));
    setModalLyricId(null);
  }}
/>
        {/* Lyrics Panel Overlay */}
        {lyricsOpen && (
          <LyricsPanel
            audioDurationSec={audioBuffer?.duration || 0}
            onClose={() => setLyricsOpen(false)}
            onAligned={(lines) => {
              addAlignedLyricsAsClips(lines);
              setLyricsOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
