'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatTime } from '@/lib/time';

export type Note = {
  id: string;
  timestampSec: number; // anchor time on the x-axis (seconds)
  xOffsetPx: number;    // visual x offset in CSS px (for fine alignment)
  yPx: number;          // vertical position in CSS px (purely visual “lane”)
  text: string;
  color: string;
  w: number;
  h: number;
  collapsed?: boolean;  // collapsed state
};

type DragMode = 'none' | 'pan' | 'note';

const COLLAPSED_H = 18;      // px
const TOGGLE_SIZE = 12;      // px chevron hit area
const TOGGLE_PAD = 4;        // padding inside note

// ---- Project export format (versioned) for Music/Waveform page ----
type AudioProjectV1 = {
  version: 1;
  kind: 'dtmusic';
  projectName: string;
  zoom: number;
  panX: number;
  playheadSec: number;
  waveAmp: number;
  notes: Note[];
  audioMeta?: { fileName?: string; duration?: number } | null;
};

const MUSIC_AUTOSAVE_KEY = 'dt:music:autosave:v1';
const MUSIC_PROJECT_NAME_KEY = 'dt:music:projectName';

function downloadBlob(filename: string, data: Blob) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function WaveformCanvas({ audioBuffer }: { audioBuffer: AudioBuffer | null }) {
  // Main canvas & container
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Minimap (overview) — TOP
  const miniCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniDraggingRef = useRef(false);

  // Notes & transport state
  const [notes, setNotes] = useState<Note[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoom, setZoom] = useState<number>(100); // px/sec (horizontal scale)
  const [panX, setPanX] = useState<number>(0);   // px (horizontal offset)
  const [playheadSec, setPlayheadSec] = useState<number>(0);

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
  const [dragMovesTimestamp, setDragMovesTimestamp] = useState<boolean>(true);

  // Inline editor (small)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editorText, setEditorText] = useState<string>('');
  const [editorPos, setEditorPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Full-screen modal editor (large)
  const [modalNoteId, setModalNoteId] = useState<string | null>(null);
  const [modalText, setModalText] = useState<string>('');

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
      const top = n.yPx;
      const { w, h } = noteRect(n);
      if (xCss >= left && xCss <= left + w && yCss >= top && yCss <= top + h) {
        return n;
      }
    }
    return null;
  }
  function hitToggleZone(n: Note, xCss: number, yCss: number): boolean {
    const left = worldTimeToCss(n.timestampSec) + n.xOffsetPx;
    const top = n.yPx;
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
      y: (note.yPx) + 4
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
        const y = n.yPx * DPR;

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
        drawChevron(ctx, (noteLeftCss + TOGGLE_PAD) * DPR, (n.yPx + TOGGLE_PAD) * DPR, TOGGLE_SIZE * DPR, !!n.collapsed);

        // “trace line” from note to its time anchor on waveform midline
        const anchorX = (n.timestampSec * zoom + panX) * DPR;
        const midY = (h / 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3 * DPR, 3 * DPR]);
        ctx.beginPath();
        ctx.moveTo(x + (nw * DPR) / 2, y + nh * DPR);
        ctx.lineTo(anchorX, midY);
        ctx.stroke();
        ctx.setLineDash([]);

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
  }, [peaks, zoom, panX, playheadSec, notes, selectedNoteId, waveAmp]);

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
  useEffect(() => {
    if (!isPlaying || !audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    let raf = 0;
    const tick = () => {
      const t = baseTimeRef.current + (ctx.currentTime - startedAtRef.current);
      setPlayheadSec(Math.min(t, audioBuffer?.duration || t));
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
      touchLastRef.current = cur;
      setPanX((p) => p + dx);
      return;
    } else if (touchModeRef.current === 'pinch' && e.touches.length >= 2) {
      e.preventDefault();
      const a = e.touches[0], b = e.touches[1];
      const start = pinchStartRef.current;
      if (!start) return;
      const dist = pinchDistance(a, b);
      const scale = dist / Math.max(1, start.dist);
      const nextZoom = Math.min(800, Math.max(20, start.zoom * scale));
      const center = start.centerXCss;
      const worldUnder = (center - panX) / zoom;
      const nextPan = center - worldUnder * nextZoom;
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

    // Two-finger scroll pans only; pinch-zoom (ctrlKey) zooms.
    if (e.ctrlKey) {
      // Pinch gesture -> zoom about cursor
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const worldTimeUnderCursor = (cursorX - panX) / zoom;
      const nextZoom = Math.min(800, Math.max(20, zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
      const nextPan = cursorX - worldTimeUnderCursor * nextZoom;
      setZoom(nextZoom);
      setPanX(nextPan);
    } else {
      // 2-finger scroll -> pan horizontally
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      setPanX((p) => p - dx); // invert for natural feel
    }
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    isMouseDownRef.current = true;
    dragStartClientXRef.current = e.clientX;
    dragStartClientYRef.current = e.clientY;

    const hit = hitTestNote(x, y);
    if (hit) {
      // If clicked chevron zone, toggle collapse immediately
      if (hitToggleZone(hit, x, y)) {
        setNotes(prev => prev.map(n => n.id === hit.id ? ({ ...n, collapsed: !n.collapsed }) : n));
        // Stop drag initiation
        isMouseDownRef.current = false;
        dragModeRef.current = 'none';
        setSelectedNoteId(hit.id);
        return;
      }
      // else: prep for dragging the note
      dragModeRef.current = 'note';
      activeNoteIdRef.current = hit.id;
      noteStartRef.current = {
        timestampSec: hit.timestampSec,
        xOffsetPx: hit.xOffsetPx,
        yPx: hit.yPx
      };
      setSelectedNoteId(hit.id);
    } else {
      dragModeRef.current = 'pan';
      setSelectedNoteId(null);
    }
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isMouseDownRef.current) return;

    const totalDx = e.clientX - dragStartClientXRef.current;
    const totalDy = e.clientY - dragStartClientYRef.current;

    if (dragModeRef.current === 'pan') {
      // Smooth panning using incremental movement
      setPanX((p) => p + (e.movementX || 0));
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
            return {
              ...n,
              timestampSec: Math.max(0, newTime),
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
  };

  const onMouseUp = () => endDrag();
  const onMouseLeave = () => endDrag();

  // Click anywhere scrubs playhead; also selects a note if present
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isMouseDownRef.current) return; // ignore click after drag
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const t = Math.max(0, (x - panX) / zoom);
    setPlayheadSec(t);

    const hit = hitTestNote(x, y);
    setSelectedNoteId(hit?.id ?? null);
  };

  // Double-click any note -> open big modal
  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
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
  // --- Minimap touch support ---
  const onMiniTouchStart: React.TouchEventHandler<HTMLCanvasElement> = (e) => {
    if (!peaks || !miniCanvasRef.current) return;
    if (e.touches.length !== 1) return;
    e.preventDefault();
    // behave like click: jump center to touch
    const rect = miniCanvasRef.current.getBoundingClientRect();
    const x = e.touches[0].clientX - rect.left;
    const w = rect.width;
    const targetT = Math.max(0, Math.min(peaks.duration, (x / w) * peaks.duration));
    const main = canvasRef.current;
    const wCss = main ? main.clientWidth : 0;
    const viewportSec = wCss / zoom;
    const startSec = Math.max(0, targetT - viewportSec / 2);
    const endSec = Math.min(peaks.duration, startSec + viewportSec);
    const clampedStart = Math.max(0, endSec - viewportSec);
    setPanX(-(clampedStart * zoom));
  };
  const onMiniTouchMove: React.TouchEventHandler<HTMLCanvasElement> = (e) => {
    // treat as continuous jump while dragging
    onMiniTouchStart(e);
  };
  const onMiniTouchEnd: React.TouchEventHandler<HTMLCanvasElement> = () => {};
  useEffect(() => {
    const mini = miniCanvasRef.current;
    if (!mini || !peaks) return;
    const ctx = mini.getContext('2d');
    if (!ctx) return;

    const DPR = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(mini.clientWidth * DPR));
    const h = Math.max(1, Math.floor(mini.clientHeight * DPR));
    if (mini.width !== w || mini.height !== h) {
      mini.width = w; mini.height = h;
    }
    ctx.clearRect(0, 0, w, h);

    // bg
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(0, 0, w, h);

    // draw compact waveform (across entire duration)
    const mid = h / 2;
    const amp = h * 0.35;
    ctx.fillStyle = '#334155'; // subtler color
    const buckets = peaks.buckets;
    const len = buckets.length;
    for (let i = 0; i < len; i++) {
      const x = (i / len) * w;
      const barH = buckets[i] * amp;
      ctx.fillRect(x, mid - barH / 2, Math.max(1, 0.5 * DPR), barH);
    }

    // current viewport window box
    const { startSec, endSec } = getViewportSec();
    const dur = peaks.duration || 1;
    const x0 = (startSec / dur) * w;
    const x1 = (endSec / dur) * w;
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 2 * DPR;
    ctx.strokeRect(x0, 0.5 * DPR, Math.max(1, x1 - x0), h - 1 * DPR);
  }, [peaks, panX, zoom]);

  const onMiniDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    miniDraggingRef.current = true;
    onMiniMove(e);
  };
  const onMiniUp = () => { miniDraggingRef.current = false; };
  const onMiniLeave = () => { miniDraggingRef.current = false; };
  const onMiniMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!miniDraggingRef.current || !miniCanvasRef.current || !peaks) return;
    const rect = miniCanvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width;
    const t = Math.max(0, Math.min(peaks.duration, (x / w) * peaks.duration)); // target center time
    // set pan so that viewport center aligns to t
    const main = canvasRef.current;
    const wCss = main ? main.clientWidth : 0;
    const viewportSec = wCss / zoom;
    const startSec = Math.max(0, t - viewportSec / 2);
    const endSec = Math.min(peaks.duration, startSec + viewportSec);
    const clampedStart = Math.max(0, endSec - viewportSec); // keep width
    setPanX(-(clampedStart * zoom));
  };

  // ---------- Render ----------
  return (
    <div ref={containerRef} className="h-full flex flex-col" onClick={onContainerClick}>
      {/* Minimap at TOP */}
      <div
        className={`border-b border-neutral-800 bg-neutral-950 flex items-center transition-[height,padding,margin,border] duration-200 ease-out ${chromeHidden ? 'h-0 overflow-hidden border-b-0' : 'h-16'}`}
        onWheel={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <canvas
          ref={miniCanvasRef}
          onMouseDown={onMiniDown}
          onMouseMove={onMiniMove}
          onMouseUp={onMiniUp}
          onMouseLeave={onMiniLeave}
          onTouchStart={onMiniTouchStart}
          onTouchMove={onMiniTouchMove}
          onTouchEnd={onMiniTouchEnd}
          style={{ touchAction: 'none' }}
          className="w-full h-12 mx-3 mt-1 rounded-md border border-neutral-800 cursor-pointer"
          title="Overview — click, drag, or touch to navigate"
        />
      </div>

      {/* Toolbar */}
      <div
        className={`border-b border-neutral-800 flex items-center gap-3 flex-wrap transition-[height,padding,margin,border] duration-200 ease-out ${chromeHidden ? 'h-0 p-0 overflow-hidden border-b-0' : 'p-2'}`}
        onWheel={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <button className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500" onClick={() => isPlaying ? pause() : play()}>
          {isPlaying ? 'Pause' : 'Play'}
        </button>

        <button className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700" onClick={() => setPlayheadSec((s) => Math.max(0, s - 5))}>-5s</button>
        <button className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700" onClick={() => setPlayheadSec((s) => s + 5)}>+5s</button>
        <button className="px-3 py-1.5 rounded bg-amber-500 text-black hover:bg-amber-400" onClick={addNote}>Add note @ {formatTime(playheadSec)}</button>

        {/* Project name */}
        <input
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          className="px-2 py-1 rounded bg-neutral-900 border border-neutral-700 w-56"
          placeholder="Project name"
        />

        {/* Save / Open */}
        <button
          className="px-3 py-1.5 rounded bg-emerald-600 text-black hover:bg-emerald-500"
          onClick={exportProject}
          title="Save to .dtmusic.json"
        >
          Save Project
        </button>
        <input
          ref={openProjectInputRef}
          type="file"
          accept=".json,.dtmusic.json"
          className="hidden"
          onChange={onOpenProjectChosen}
        />
        <button
          className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700"
          onClick={onOpenProjectClick}
          title="Open a saved .dtmusic.json project"
        >
          Open Project
        </button>

        {/* Waveform amplitude control */}
        <label className="ml-2 text-sm text-neutral-300 flex items-center gap-2">
          WF amp
          <input
            type="range"
            min={0.1}
            max={0.5}
            step={0.01}
            value={waveAmp}
            onChange={(e) => setWaveAmp(parseFloat(e.target.value))}
            className="w-28"
          />
          <span className="w-10 text-right tabular-nums">{Math.round(waveAmp * 100)}%</span>
        </label>

        {/* Horizontal zoom slider */}
        <label className="text-sm text-neutral-300 flex items-center gap-2">
          Zoom
          <input
            type="range"
            min={20}
            max={800}
            step={1}
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="w-40"
          />
            <span className="w-14 text-right tabular-nums">{Math.round(zoom)} px/s</span>
        </label>

        {/* Drag behavior toggle */}
        <label className="text-sm text-neutral-300 flex items-center gap-2">
          <input
            type="checkbox"
            checked={dragMovesTimestamp}
            onChange={(e) => setDragMovesTimestamp(e.target.checked)}
          />
          Drag moves timestamp
        </label>

        <div className="ml-auto flex items-center gap-3 text-sm text-neutral-400">
          <span>Playhead: {formatTime(playheadSec)}</span>
        </div>
      </div>

      {/* Floating UI toggle (mobile-first) */}
      <button
        onClick={() => setChromeHidden(v => !v)}
        className="sm:hidden fixed right-3 top-3 z-50 px-3 py-1.5 rounded-full border border-neutral-700 bg-neutral-900/80 backdrop-blur hover:bg-neutral-800 text-sm"
        title={chromeHidden ? 'Show controls' : 'Hide controls'}
      >
        {chromeHidden ? 'Show UI' : 'Hide UI'}
      </button>

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
        {modalNoteId && (
          <div
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onMouseDown={(e) => {
              // click backdrop to close (ignore clicks inside panel)
              if (e.target === e.currentTarget) closeModal();
            }}
          >
            <div className="w-full max-w-3xl max-h-[80vh] bg-neutral-900 text-neutral-100 rounded-xl shadow-2xl border border-neutral-700 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
                <div className="font-medium">
                  Note @{' '}
                  {(() => {
                    const n = notes.find(n => n.id === modalNoteId);
                    return n ? formatTime(n.timestampSec) : '—';
                  })()}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700"
                    onClick={() => closeModal()}
                  >
                    Close
                  </button>
                  <button
                    className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500"
                    onClick={() => saveModal()}
                  >
                    Save
                  </button>
                </div>
              </div>

              <div className="p-4 overflow-auto">
                <textarea
                  value={modalText}
                  onChange={(e) => setModalText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
                    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveModal(); }
                  }}
                  className="w-full h-[50vh] p-3 rounded-lg bg-neutral-950 text-neutral-100 outline-none border border-neutral-700"
                  placeholder="Write your full note here…"
                />
              </div>

              <div className="px-4 py-3 border-t border-neutral-800 text-sm text-neutral-400">
                Tip: <kbd className="px-1 py-0.5 bg-neutral-800 rounded">Esc</kbd> to close ·
                <span className="ml-2">
                  <kbd className="px-1 py-0.5 bg-neutral-800 rounded">Ctrl/⌘</kbd>+<kbd className="px-1 py-0.5 bg-neutral-800 rounded">S</kbd> to save
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
