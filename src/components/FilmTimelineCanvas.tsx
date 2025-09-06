'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatTime } from '@/lib/time';
import { parseScript } from '@/lib/scriptParser';
import { importFountainToScenes } from '@/lib/importers/fountain';
import { importFdxToScenes } from '@/lib/importers/fdx';
import { extractPdfText } from '@/lib/importers/pdf';
import { extractDocxText } from '@/lib/importers/docx';

/* ---------- Script types / helpers (single source) ---------- */
type LineType = 'scene' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition' | 'lyric';
type ScriptLine = { type: LineType; text: string };

function isSceneHeading(t: string) { return /^(INT|EXT|EST|INT\.\/EXT\.)\./i.test(t.trim()); }
function isParenthetical(t: string) { return /^\(.+\)$/.test(t.trim()); }
function isTransition(t: string) { return /^[A-Z0-9 .']+TO:\s*$/.test(t.trim()); }
function isLyric(t: string) { return /^~/.test(t.trim()); }
function isCharacter(t: string) {
  const s = t.trim();
  if (!s || s.length > 40) return false;
  if (/TO:\s*$/.test(s)) return false;
  return /^[A-Z0-9() '\-.]+$/.test(s) && s === s.toUpperCase();
}

// Fallback: make lines from description text
function toScriptLinesFromText(text: string): ScriptLine[] {
  const out: ScriptLine[] = [];
  const rows = (text || '').replace(/\r\n/g, '\n').split('\n');
  let prev: LineType = 'action';
  for (const raw of rows) {
    let t: LineType = 'action';
    if (isSceneHeading(raw)) t = 'scene';
    else if (isParenthetical(raw)) t = 'parenthetical';
    else if (isTransition(raw)) t = 'transition';
    else if (isLyric(raw)) t = 'lyric';
    else if (isCharacter(raw)) t = 'character';
    else if (prev === 'character' || prev === 'parenthetical') t = 'dialogue';
    out.push({ type: t, text: raw });
    prev = t;
  }
  return out;
}

// Compose a scene description that includes CHARACTER cues + dialogue
function composeDescription(lines: ScriptLine[] = []): string {
  const out: string[] = [];
  let i = 0;
  const flushBlank = () => { if (out.length && out[out.length - 1] !== '') out.push(''); };
  while (i < lines.length) {
    const L = lines[i];
    if (!L) break;
    if (L.type === 'character') {
      out.push((L.text || '').trim());
      i++;
      if (i < lines.length && lines[i].type === 'parenthetical') { out.push((lines[i].text || '').trim()); i++; }
      while (i < lines.length && lines[i].type === 'dialogue') { out.push((lines[i].text || '').trim()); i++; }
      flushBlank();
      continue;
    }
    if (L.type === 'action' || L.type === 'lyric' || L.type === 'parenthetical') {
      out.push((L.text || '').trim()); flushBlank(); i++; continue;
    }
    i++;
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

/* ---------- Optional formatted preview component ---------- */
function ScriptFormattedView({ lines }: { lines: ScriptLine[] }) {
  const INDENT_CH: Record<LineType, number> = {
    scene: 0, action: 0, character: 22, parenthetical: 16, dialogue: 12, transition: 40, lyric: 10,
  };
  return (
    <div className="font-mono text-sm leading-5 text-neutral-100 bg-neutral-950 border border-neutral-800 rounded-lg p-3 max-h-[55vh] overflow-auto">
      <div className="max-w-[70ch]">
        {lines.map((l, i) => {
          const pl = INDENT_CH[l.type] ?? 0;
          const style: React.CSSProperties =
            l.type === 'transition' ? { paddingLeft: 0, textAlign: 'right', width: '60ch' } : { paddingLeft: `${pl}ch` };
          const cls =
            l.type === 'scene' ? 'font-semibold uppercase text-amber-300'
            : l.type === 'character' ? 'font-semibold'
            : (l.type === 'parenthetical' || l.type === 'lyric') ? 'italic'
            : '';
          return (<div key={i} className={cls} style={style}>{l.text}</div>);
        })}
      </div>
    </div>
  );
}

/* ---------- Timeline types / constants ---------- */
type DragMode = 'none' | 'pan' | 'scene' | 'resizeR' | 'resizeL' | 'note' | 'image' | 'marquee';
type MiniDragKind = 'none' | 'viewport' | 'background';

type Note = {
  id: string;
  sceneId: string;
  text: string;
  order: number;
  relX: number;
  relY: number;
  width: number;
  height: number;
};


type ImageCrop = { xPct: number; yPct: number; wPct: number; hPct: number };

// ---- Project export format (versioned) ----
type ProjectFileV1 = {
  version: 1;
  kind: 'dtfilm';
  projectName: string;
  zoom: number;
  panX: number;
  playheadSec: number;
  scenes: Array<Scene & { imageUrl?: string | null }>;
  notes: Note[];
};

const PROJECT_AUTOSAVE_KEY = 'dt:film:autosave:v1';
const PROJECT_NAME_KEY = 'dt:film:projectName';

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

function downloadBlob(filename: string, data: Blob) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export type Scene = {
  id: string;
  originalSceneNumber: number;
  newSceneNumber: number;
  heading: string;
  description: string;
  positionSec: number;
  lengthSec: number;
  yPx: number;
  color: string;
  collapsed?: boolean;
  imageUrl?: string | null;
  imageMeta?: {
    relX: number;
    relY: number;
    width: number;
    height: number;
    crop?: ImageCrop;
  } | null;
  scriptLines?: ScriptLine[];
};

const ROW_HEIGHT = 40;
const SCENE_MIN_SEC = 1;
const HANDLE_W = 8;
const COLLAPSED_H = 22;
const FOOTER_H = 56; // taller footer preview for better readability
const TOGGLE_SIZE = 12;
const TOGGLE_PAD = 4;

const MIN_ZOOM = 1;     // px/sec
const MAX_ZOOM = 500;   // px/sec

const DEFAULT_SNAP_ENABLED = true;
const DEFAULT_SNAP_STEP = 1;   // seconds

const NOTE_GAP_Y = 8;
const NOTE_DEFAULT_W = 180;
const NOTE_DEFAULT_H = 110;

const IMAGE_CARD_W = 180;
const IMAGE_CARD_H = 110;

type HistoryState = { scenes: Scene[]; notes: Note[] };

/* ---------- Component ---------- */
export default function FilmTimelineCanvas() {
  // canvases
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // --- Touch gesture state ---
  type TouchMode = 'none' | 'pan' | 'pinch';
  const touchModeRef = useRef<TouchMode>('none');
  const touchStartPanRef = useRef<{ panX: number }>({ panX: 0 });
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

  // viewport
  const [zoom, setZoom] = useState(120);
  const [panX, setPanX] = useState(0);
  const [playheadSec, setPlayheadSec] = useState(0);

  // project metadata
  const [projectName, setProjectName] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(PROJECT_NAME_KEY) || 'Untitled Project';
    }
    return 'Untitled Project';
  });

  // data
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);

  // history (undo)
  const [history, setHistory] = useState<HistoryState[]>([]);
  const pushHistory = () => setHistory((h) => [...h, { scenes: structuredClone(scenes), notes: structuredClone(notes) }]);
  const undo = () => setHistory((h) => {
    if (h.length === 0) return h;
    const prev = h[h.length - 1];
    setScenes(prev.scenes); setNotes(prev.notes);
    return h.slice(0, -1);
  });

  // drag state
  const [dragMode, setDragMode] = useState<DragMode>('none');
  const [isMouseDown, setIsMouseDown] = useState(false);
  const dragStartRef = useRef<{ cx: number; cy: number }>({ cx: 0, cy: 0 });
  const activeSceneIdRef = useRef<string | null>(null);
  const sceneStartSnapshotRef = useRef<{ positionSec: number; lengthSec: number; yPx: number } | null>(null);
  const activeNoteIdRef = useRef<string | null>(null);
  const noteStartSnapshotRef = useRef<{ relX: number; relY: number } | null>(null);
  const activeImageSceneIdRef = useRef<string | null>(null);
  const imageStartSnapshotRef = useRef<{ relX: number; relY: number } | null>(null);

  // selection
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedImageSceneId, setSelectedImageSceneId] = useState<string | null>(null);

  // note overlay position (for per-note toolbar)
  const [noteOverlay, setNoteOverlay] = useState<{ left: number; top: number } | null>(null);

  // scene modal
  const [modalSceneId, setModalSceneId] = useState<string | null>(null);
  const [modalText, setModalText] = useState<string>('');

  // note modal
  const [noteModalId, setNoteModalId] = useState<string | null>(null);
  const [noteModalText, setNoteModalText] = useState<string>('');

  // image crop modal
const [cropModalSceneId, setCropModalSceneId] = useState<string | null>(null);
  const [cropValues, setCropValues] = useState<ImageCrop>({ xPct: 0, yPct: 0, wPct: 100, hPct: 100 });

  // computed order for scenes (used by search and rendering)
  const scenesWithOrder = useMemo(() => {
    const sorted = [...scenes].sort((a, b) => a.positionSec - b.positionSec);
    return scenes.map((s) => ({
      ...s,
      newSceneNumber: sorted.findIndex((x) => x.id === s.id) + 1,
    }));
  }, [scenes]);

  // --- Search (scene number or free text) ---
  const [searchQ, setSearchQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  // Show/hide top chrome (minimap + toolbar)
  const [chromeHidden, setChromeHidden] = useState(false);

  // Default-hide on small screens or restore last choice
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const was = localStorage.getItem('dt:film:chromeHidden');
      if (was === 'true' || (was === null && window.innerWidth < 768)) {
        setChromeHidden(true);
      }
    }
  }, []);

  useEffect(() => {
    try { localStorage.setItem('dt:film:chromeHidden', chromeHidden ? 'true' : 'false'); } catch {}
  }, [chromeHidden]);

  function centerOnSceneId(id: string) {
    const s = scenes.find(x => x.id === id);
    const main = canvasRef.current;
    if (!s || !main) return;
    const wCss = Math.max(1, main.clientWidth);
    const sceneW = Math.max(1, s.lengthSec * zoom);
    const leftTarget = s.positionSec * zoom; // left edge of scene in world px
    // Try to center the scene; if longer than viewport, align its left with a small pad
    const pad = 24;
    if (sceneW < wCss) {
      const desiredLeftInView = (wCss - sceneW) / 2; // center
      setPanX(desiredLeftInView - leftTarget);
    } else {
      setPanX(pad - leftTarget);
    }
    setSelectedSceneId(id);
  }

  const searchResults = useMemo(() => {
    const q = searchQ.trim();
    if (!q) return [] as Array<{ id: string; label: string; sub: string }>;

    // If numeric -> try exact match on original or new scene numbers
    const asNum = Number(q);
    const results: Array<{ id: string; label: string; sub: string }> = [];
    if (!Number.isNaN(asNum) && q === String(Math.floor(asNum))) {
      for (const s of scenesWithOrder) {
        if (s.originalSceneNumber === asNum || s.newSceneNumber === asNum) {
          results.push({
            id: s.id,
            label: `Scene #${s.originalSceneNumber} → new #${s.newSceneNumber}`,
            sub: `${formatTime(s.positionSec)} · ${s.heading}`,
          });
        }
      }
      return results;
    }

    // General text search across heading, description, scriptLines, notes
    const needle = q.toLowerCase();
    function matchText(txt?: string | null) {
      return !!(txt && txt.toLowerCase().includes(needle));
    }
    for (const s of scenesWithOrder) {
      let hit = matchText(s.heading) || matchText(s.description);
      if (!hit && s.scriptLines && s.scriptLines.length) {
        hit = s.scriptLines.some(l => matchText(l.text));
      }
      if (!hit) {
        const sceneNotes = notes.filter(n => n.sceneId === s.id);
        hit = sceneNotes.some(n => matchText(n.text));
      }
      if (hit) {
        // compute a small snippet from description
        const src = (s.description || s.heading || '').toString();
        const i = src.toLowerCase().indexOf(needle);
        let snip = src.slice(Math.max(0, i - 30), Math.min(src.length, i + 70));
        if (i > 30) snip = '…' + snip;
        if (i + 70 < src.length) snip = snip + '…';
        results.push({ id: s.id, label: s.heading || 'Untitled Scene', sub: snip });
      }
    }
    return results;
  }, [searchQ, scenesWithOrder, notes, zoom]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const main = canvasRef.current;
      if (!main) return;
      if (e.target instanceof Element && main.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  // snapping
  const [snapEnabled, setSnapEnabled] = useState(DEFAULT_SNAP_ENABLED);
  const [snapStep, setSnapStep] = useState(DEFAULT_SNAP_STEP);

  // note reattach toggle
  const [reattachMode, setReattachMode] = useState(false);

  // marquee (multi select scenes)
  const [marquee, setMarquee] = useState<null | { x0: number; y0: number; x1: number; y1: number }>(null);
  const [multiSelIds, setMultiSelIds] = useState<Set<string>>(new Set());

  // image cache for thumbnails
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // helpers
  const cssToSec = (xCss: number) => (xCss - panX) / zoom;
  const secToCss = (sec: number) => sec * zoom + panX;

  function clampZoom(z: number) { return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)); }
  function applyZoomAbout(cursorXCss: number, nextZoom: number) {
    const z = clampZoom(nextZoom);
    const worldUnderCursor = cssToSec(cursorXCss);
    const nextPan = cursorXCss - worldUnderCursor * z;
    setZoom(z); setPanX(nextPan);
  }
  function pickGridStepSec(z: number): number {
    const targetPx = 120;
    const raw = targetPx / z;
    const steps = [0.25, 0.5, 1, 2, 3, 5, 10, 15, 30, 60, 120, 300, 600];
    for (const s of steps) if (raw <= s) return s;
    return 1200;
  }
  function roundToSnap(v: number): number {
    if (!snapEnabled) return v;
    const step = Math.max(0.001, snapStep);
    return Math.round(v / step) * step;
  }
  function totalDurationSec(): number {
    if (scenes.length === 0) return 60;
    return Math.max(60, scenes.reduce((m, s) => Math.max(m, s.positionSec + s.lengthSec), 0));
  }

  /* ---------- Drawing helpers: rounded rect + chevron + grid ---------- */
  function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const rr = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  function drawChevron(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, collapsed: boolean) {
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath();
    if (collapsed) { ctx.moveTo(x, y); ctx.lineTo(x, y + size); ctx.lineTo(x + size, y + size / 2); }
    else { ctx.moveTo(x, y); ctx.lineTo(x + size, y); ctx.lineTo(x + size / 2, y + size); }
    ctx.closePath(); ctx.fill();
  }

  function drawTimeGridAndLabels(ctx: CanvasRenderingContext2D, w: number, h: number, DPR: number) {
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1;
    for (let y = 0; y < h; y += ROW_HEIGHT * DPR) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    const secStep = pickGridStepSec(zoom);
    const startSec = Math.max(0, (-panX) / zoom);
    const endSec = startSec + (w / DPR) / zoom;
    const startTick = Math.floor(startSec / secStep) * secStep;

    for (let s = startTick; s <= endSec; s += secStep) {
      const xCss = secToCss(s);
      const x = xCss * DPR;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }

    ctx.fillStyle = '#d1d5db'; // brighter labels for readability
    ctx.font = `${12 * DPR}px ui-sans-serif, system-ui`;
    const labelStep = secStep * (zoom < 80 ? 5 : zoom < 150 ? 2 : 1);
    const startLabel = Math.floor(startSec / labelStep) * labelStep;
    for (let s = startLabel; s <= endSec; s += labelStep) {
      const xCss = secToCss(s);
      ctx.fillText(formatTime(s), xCss * DPR + 2 * DPR, 12 * DPR);
    }
  }


  // stable, dense order (0..n-1) per scene
  const notesByScene = useMemo(() => {
    const map = new Map<string, Note[]>();
    const grouped = new Map<string, Note[]>();
    for (const n of notes) {
      if (!grouped.has(n.sceneId)) grouped.set(n.sceneId, []);
      grouped.get(n.sceneId)!.push(n);
    }
    for (const [sid, arr] of grouped) {
      const sorted = arr.sort((a, b) => a.order - b.order).map((n, i) => ({ ...n, order: i }));
      map.set(sid, sorted);
    }
    return map;
  }, [notes]);

  function baseNotesY(scene: Scene) {
    const scnTopCss = scene.yPx + 4;
    const scnHcss = (scene.collapsed ? COLLAPSED_H : ROW_HEIGHT - 6 + FOOTER_H);
    return scnTopCss + scnHcss + NOTE_GAP_Y;
  }
  function getImageRectCss(scene: Scene) {
    if (!scene.imageUrl || !scene.imageMeta || scene.collapsed) return null;
    const leftCss = secToCss(scene.positionSec);
    return { x: leftCss + scene.imageMeta.relX, y: baseNotesY(scene) + scene.imageMeta.relY, w: scene.imageMeta.width, h: scene.imageMeta.height };
  }
  function getSceneNotesStack(sid: string) {
    const s = scenes.find(x => x.id === sid);
    if (!s) return [];
    const arr = notesByScene.get(sid) || [];
    const imgRect = getImageRectCss(s);
    const yOffset = imgRect ? (imgRect.h + NOTE_GAP_Y) : 0;
    return arr.map((n, i) => {
      const x = secToCss(s.positionSec) + n.relX;
      const y = baseNotesY(s) + yOffset + n.relY + i * (NOTE_DEFAULT_H + NOTE_GAP_Y);
      return { note: n, x, y, w: n.width, h: n.height, index: i };
    });
  }

  /* ---------- Main draw loop ---------- */
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
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.clearRect(0, 0, w, h);

      // background
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, h);

      // grid + labels
      drawTimeGridAndLabels(ctx, w, h, DPR);

      // playhead
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 2;
      const phx = (playheadSec * zoom + panX) * DPR;
      ctx.beginPath(); ctx.moveTo(phx, 0); ctx.lineTo(phx, h); ctx.stroke();

      // scenes + images + notes
      for (const s of scenesWithOrder) {
        const leftCss = secToCss(s.positionSec);
        const widthCss = Math.max(s.lengthSec * zoom, 2);
        const height = (s.collapsed ? COLLAPSED_H : ROW_HEIGHT - 6 + FOOTER_H) * DPR;
        const x = leftCss * DPR;
        const y = s.yPx * DPR + 4 * DPR;

        // scene block (rounded)
        const radius = 6 * DPR;
        const bodyX = x, bodyY = y, bodyW = widthCss * DPR, bodyH = height;

        // border shadow
        ctx.save();
        drawRoundedRect(ctx, bodyX, bodyY, bodyW, bodyH, radius);
        ctx.fillStyle = s.color;
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 8 * DPR;
        ctx.fill();
        ctx.restore();

        // subtle inner overlay to help text readability
        ctx.save();
        drawRoundedRect(ctx, bodyX, bodyY, bodyW, bodyH, radius);
        const grad = ctx.createLinearGradient(0, bodyY, 0, bodyY + bodyH);
        grad.addColorStop(0, 'rgba(0,0,0,0.08)');
        grad.addColorStop(1, 'rgba(0,0,0,0.18)');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();

        // selection border
        if (s.id === selectedSceneId) {
          ctx.save();
          ctx.lineWidth = 2 * DPR;
          ctx.strokeStyle = '#ffffff';
          drawRoundedRect(ctx, bodyX - 1 * DPR, bodyY - 1 * DPR, bodyW + 2 * DPR, bodyH + 2 * DPR, radius + 1 * DPR);
          ctx.stroke();
          ctx.restore();
        }

        // resize handles (keep same hit area, paint darker bands)
        ctx.fillStyle = 'rgba(10, 10, 10, 0.35)';
        ctx.fillRect(x, y, HANDLE_W * DPR, height);
        ctx.fillRect(x + bodyW - HANDLE_W * DPR, y, HANDLE_W * DPR, height);

        // chevron
        drawChevron(ctx, (leftCss + TOGGLE_PAD) * DPR, (s.yPx + 8) * DPR, TOGGLE_SIZE * DPR, !!s.collapsed);

        // text labels (heavier weight + clipped to card to avoid bleeding)
        const textLeft = x + (TOGGLE_PAD + TOGGLE_SIZE + 8) * DPR;
        const textTop1 = y + 12 * DPR;
        const textTop2 = y + 30 * DPR; // extra spacing between heading lines

        // Clip to the body so text doesn't overflow when zoomed out
        ctx.save();
        drawRoundedRect(ctx, bodyX, bodyY, bodyW, bodyH, radius);
        ctx.clip();

        const numbers = `#${s.originalSceneNumber} → new #${s.newSceneNumber}`;
        const title = s.heading || 'Untitled Scene';
        const line1 = `[${formatTime(s.positionSec)}–${formatTime(s.positionSec + s.lengthSec)}]  ${numbers}`;
        const line2 = s.collapsed ? title : `${title}  ·  ${Math.round(s.lengthSec)}s`;

        function ellipsize(str: string, max = 180) {
          return str.length > max ? str.slice(0, max - 1) + '…' : str;
        }

        // First line: slightly smaller/lighter
        ctx.fillStyle = '#0b0b0b';
        ctx.font = `500 ${11 * DPR}px ui-sans-serif, system-ui`;
        ctx.save();
        ctx.shadowColor = 'rgba(255,255,255,0.22)';
        ctx.shadowBlur = 2 * DPR;
        ctx.fillText(ellipsize(line1), textLeft, textTop1);
        ctx.restore();

        // Second line: primary, heavier
        ctx.fillStyle = '#0a0a0a';
        ctx.font = `600 ${12 * DPR}px ui-sans-serif, system-ui`;
        ctx.save();
        ctx.shadowColor = 'rgba(255,255,255,0.25)';
        ctx.shadowBlur = 2 * DPR;
        ctx.fillText(ellipsize(line2), textLeft, textTop2);
        ctx.restore();

        ctx.restore(); // end clip

        // --- footer content band (only when expanded) ---
        if (!s.collapsed) {
          const footerH = FOOTER_H * DPR;
          const footerY = y + height - footerH;

          // footer background (slightly darker overlay)
          ctx.save();
          drawRoundedRect(ctx, x, footerY, widthCss * DPR, footerH, 6 * DPR);
          ctx.clip();
          ctx.fillStyle = 'rgba(0,0,0,0.5)'; // darker footer background for contrast
          ctx.fillRect(x, footerY, widthCss * DPR, footerH);
          // Keep clip active for footer text too

          // divider line
          ctx.strokeStyle = 'rgba(0,0,0,0.65)';
          ctx.lineWidth = 1 * DPR;
          ctx.beginPath();
          ctx.moveTo(x, footerY);
          ctx.lineTo(x + widthCss * DPR, footerY);
          ctx.stroke();

          // footer text: brief description preview (first 3 lines)
          ctx.fillStyle = '#e5e7eb';
          ctx.font = `600 ${12 * DPR}px ui-sans-serif, system-ui`;
          const preview = (s.description || '').split('\n').filter(Boolean);
          const maxLines = 3;
          const px = x + 10 * DPR;
          let py = footerY + 16 * DPR;

          function trimToWidth(str: string) {
            // quick trim based on char count; clipping already prevents bleed
            return str.length > 220 ? str.slice(0, 219) + '…' : str;
          }

          for (let i = 0; i < Math.min(maxLines, preview.length); i++) {
            const line = trimToWidth(preview[i]);
            ctx.fillText(line, px, py);
            py += 16 * DPR;
          }

          // end footer clip
          ctx.restore();
        }

        // ===== IMAGE CARD (draggable/selectable) =====
        const imgRect = getImageRectCss(s);
        if (imgRect) {
          const key = `${s.id}:${s.imageUrl}`;
          let img = imageCacheRef.current.get(key);
          const bx = imgRect.x * DPR, by = imgRect.y * DPR, bw = imgRect.w * DPR, bh = imgRect.h * DPR;

          // card bg
          ctx.save();
          drawRoundedRect(ctx, bx, by, bw, bh, 6 * DPR);
          ctx.fillStyle = '#0f172a';
          ctx.fill();
          ctx.restore();

          // border
          ctx.save();
          ctx.lineWidth = 2 * DPR;
          ctx.strokeStyle = selectedImageSceneId === s.id ? '#60a5fa' : '#1f2937';
          drawRoundedRect(ctx, bx, by, bw, bh, 6 * DPR);
          ctx.stroke();
          ctx.restore();

          // connector to scene
          ctx.strokeStyle = '#9ca3af';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo((leftCss + 4) * DPR, (s.yPx + 4 + (s.collapsed ? COLLAPSED_H : ROW_HEIGHT - 6 + FOOTER_H)) * DPR);
          ctx.lineTo(bx, by);
          ctx.stroke();

          // load/draw
          if (img && img.complete) {
            try {
              const iw = img.naturalWidth || 1;
              const ih = img.naturalHeight || 1;
              const crop = s.imageMeta?.crop ?? { xPct: 0, yPct: 0, wPct: 100, hPct: 100 };
              const sx = Math.floor((crop.xPct / 100) * iw);
              const sy = Math.floor((crop.yPct / 100) * ih);
              const sw = Math.max(1, Math.floor((crop.wPct / 100) * iw));
              const sh = Math.max(1, Math.floor((crop.hPct / 100) * ih));
              const scale = Math.max(bw / sw, bh / sh);
              const dw = sw * scale;
              const dh = sh * scale;
              const dx = bx + (bw - dw) / 2;
              const dy = by + (bh - dh) / 2;
              ctx.save();
              // clip to rounded rect
              drawRoundedRect(ctx, bx, by, bw, bh, 6 * DPR);
              ctx.clip();
              ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
              ctx.restore();
            } catch { /* ignore */ }
          } else {
            if (!img) {
              img = new Image();
              img.crossOrigin = 'anonymous';
              img.src = s.imageUrl!;
              imageCacheRef.current.set(key, img);
            }
            ctx.fillStyle = '#111827';
            ctx.fillRect(bx + 6 * DPR, by + 6 * DPR, bw - 12 * DPR, bh - 12 * DPR);
          }
        }

        // ===== TEXT NOTES (stacked after optional image) =====
        const stacked = getSceneNotesStack(s.id);
        for (const item of stacked) {
          const noteX = item.x * DPR;
          const noteY = item.y * DPR;

          // body (rounded)
          ctx.save();
          drawRoundedRect(ctx, noteX, noteY, item.w * DPR, item.h * DPR, 6 * DPR);
          ctx.fillStyle = '#fef9c3';
          ctx.fill();
          ctx.restore();

          // border
          ctx.save();
          ctx.lineWidth = 2 * DPR;
          ctx.strokeStyle = selectedNoteId === item.note.id ? '#ef4444' : '#a16207';
          drawRoundedRect(ctx, noteX, noteY, item.w * DPR, item.h * DPR, 6 * DPR);
          ctx.stroke();
          ctx.restore();

          // connector
          ctx.strokeStyle = '#9ca3af';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo((leftCss + 4) * DPR, (s.yPx + 4 + (s.collapsed ? COLLAPSED_H : ROW_HEIGHT - 6 + FOOTER_H)) * DPR);
          ctx.lineTo(noteX, noteY);
          ctx.stroke();

          // text (slightly darker for contrast)
          ctx.fillStyle = '#111827';
          ctx.font = `${11 * DPR}px ui-sans-serif, system-ui`;
          const lines = (item.note.text || '').split('\n').slice(0, 6);
          lines.forEach((line, li) =>
            ctx.fillText(line.slice(0, 40), noteX + 8 * DPR, noteY + (16 + li * 12) * DPR)
          );
        }
      }

      // marquee
      if (marquee) {
        const x = Math.min(marquee.x0, marquee.x1) * DPR;
        const y = Math.min(marquee.y0, marquee.y1) * DPR;
        const ww = Math.abs(marquee.x1 - marquee.x0) * DPR;
        const hh = Math.abs(marquee.y1 - marquee.y0) * DPR;
        ctx.strokeStyle = '#93c5fd';
        ctx.setLineDash([4 * DPR, 4 * DPR]);
        ctx.strokeRect(x, y, ww, hh);
        ctx.setLineDash([]);
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [scenesWithOrder, zoom, panX, playheadSec, notesByScene, marquee, selectedNoteId, selectedSceneId, selectedImageSceneId]);

  // keep note overlay near selected note
  useEffect(() => {
    if (!selectedNoteId) { setNoteOverlay(null); return; }
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const note = notes.find(n => n.id === selectedNoteId);
    if (!note) { setNoteOverlay(null); return; }
    const s = scenes.find(x => x.id === note.sceneId);
    if (!s) { setNoteOverlay(null); return; }
    const stack = getSceneNotesStack(s.id);
    const entry = stack.find(it => it.note.id === selectedNoteId);
    if (!entry) { setNoteOverlay(null); return; }
    const left = entry.x + rect.left;
    const top = entry.y + rect.top - 28; // toolbar above the note
    setNoteOverlay({ left, top });
  }, [selectedNoteId, panX, zoom, scenes, notes]);

  /* ---------- Minimap (top bar is not scrollable/zoomable) ---------- */
  const miniDragRef = useRef<{ kind: MiniDragKind; offsetX?: number }>({ kind: 'none' });

  useEffect(() => {
    const mini = miniCanvasRef.current;
    const main = canvasRef.current;
    if (!mini || !main) return;
    const ctx = mini.getContext('2d');
    if (!ctx) return;

    const DPR = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(mini.clientWidth * DPR));
    const h = Math.max(1, Math.floor(mini.clientHeight * DPR));
    if (mini.width !== w || mini.height !== h) { mini.width = w; mini.height = h; }
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(0, 0, w, h);

    const dur = totalDurationSec();

    for (const s of scenes) {
      const x0 = (s.positionSec / dur) * w;
      const x1 = ((s.positionSec + s.lengthSec) / dur) * w;
      ctx.fillStyle = s.color;
      ctx.fillRect(x0, h * 0.25, Math.max(1, x1 - x0), h * 0.5);
    }

    const wCss = main.clientWidth;
    const startSec = Math.max(0, (-panX) / zoom);
    const viewSec = Math.max(0.0001, wCss / zoom);
    const endSec = Math.min(dur, startSec + viewSec);
    const clampedStart = Math.max(0, endSec - viewSec);
    const vx0 = (clampedStart / dur) * w;
    const vx1 = ((clampedStart + viewSec) / dur) * w;

    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 2 * DPR;
    ctx.strokeRect(vx0, 0.5 * DPR, Math.max(1, vx1 - vx0), h - 1 * DPR);

    const phx = (playheadSec / dur) * w;
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 2 * DPR;
    ctx.beginPath(); ctx.moveTo(phx, 0); ctx.lineTo(phx, h); ctx.stroke();
  }, [scenes, panX, zoom, playheadSec]);

  function miniMetrics() {
    const mini = miniCanvasRef.current!;
    const main = canvasRef.current!;
    const rect = mini.getBoundingClientRect();
    const dur = totalDurationSec();
    const w = rect.width;
    const viewSec = Math.max(0.0001, main.clientWidth / zoom);
    const startSec = Math.max(0, (-panX) / zoom);
    const endSec = Math.min(dur, startSec + viewSec);
    const clampedStart = Math.max(0, endSec - viewSec);
    const vx0 = (clampedStart / dur) * w;
    const vx1 = ((clampedStart + viewSec) / dur) * w;
    return { rect, dur, w, viewSec, vx0, vx1 };
  }
  function secFromMiniX(xMini: number, dur: number, w: number) {
    return (xMini / Math.max(1, w)) * dur;
  }
  const onMiniDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { rect, dur, w, vx0, vx1 } = miniMetrics();
    const x = e.clientX - rect.left;
    if (x >= vx0 && x <= vx1) {
      miniDragRef.current = { kind: 'viewport', offsetX: x - vx0 };
    } else {
      miniDragRef.current = { kind: 'background' };
      jumpViewportCenterTo(secFromMiniX(x, dur, w));
    }
  };
  const onMiniMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const kind = miniDragRef.current.kind;
    if (kind === 'none') return;
    const { rect, dur, w, viewSec } = miniMetrics();
    const x = e.clientX - rect.left;
    if (kind === 'viewport') {
      const dx = miniDragRef.current.offsetX ?? 0;
      const newVx0 = Math.max(0, Math.min(w - (viewSec / dur) * w, x - dx));
      const newStartSec = secFromMiniX(newVx0, dur, w);
      setPanX(-(newStartSec * zoom));
    } else {
      jumpViewportCenterTo(secFromMiniX(x, dur, w));
    }
  };
  const onMiniUp = () => { miniDragRef.current = { kind: 'none' }; };
  const onMiniLeave = () => { miniDragRef.current = { kind: 'none' }; };

  // --- Minimap touch handlers (tap to jump, drag viewport) ---
  const onMiniTouchStart: React.TouchEventHandler<HTMLCanvasElement> = (e) => {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    const { rect, dur, w, vx0, vx1 } = miniMetrics();
    const x = e.touches[0].clientX - rect.left;
    if (x >= vx0 && x <= vx1) {
      miniDragRef.current = { kind: 'viewport', offsetX: x - vx0 };
    } else {
      miniDragRef.current = { kind: 'background' };
      jumpViewportCenterTo(secFromMiniX(x, dur, w));
    }
  };
  const onMiniTouchMove: React.TouchEventHandler<HTMLCanvasElement> = (e) => {
    if (e.touches.length !== 1) return;
    const kind = miniDragRef.current.kind;
    if (kind === 'none') return;
    e.preventDefault();
    const { rect, dur, w, viewSec } = miniMetrics();
    const x = e.touches[0].clientX - rect.left;
    if (kind === 'viewport') {
      const dx = miniDragRef.current.offsetX ?? 0;
      const newVx0 = Math.max(0, Math.min(w - (viewSec / dur) * w, x - dx));
      const newStartSec = secFromMiniX(newVx0, dur, w);
      setPanX(-(newStartSec * zoom));
    } else {
      jumpViewportCenterTo(secFromMiniX(x, dur, w));
    }
  };
  const onMiniTouchEnd: React.TouchEventHandler<HTMLCanvasElement> = () => {
    miniDragRef.current = { kind: 'none' };
  };
  function jumpViewportCenterTo(centerSec: number) {
    const main = canvasRef.current!;
    const viewSec = Math.max(0.0001, main.clientWidth / zoom);
    const half = viewSec / 2;
    const dur = totalDurationSec();
    let startSec = Math.max(0, centerSec - half);
    let endSec = Math.min(dur, startSec + viewSec);
    startSec = Math.max(0, endSec - viewSec);
    setPanX(-(startSec * zoom));
  }

  /* ---------- Interactions ---------- */

  // --- Touch handlers (one-finger pan, two-finger pinch zoom) ---
  const onTouchStart: React.TouchEventHandler<HTMLCanvasElement> = (e) => {
    if (!canvasRef.current) return;
    if (e.touches.length === 1) {
      e.preventDefault();
      touchModeRef.current = 'pan';
      touchLastRef.current = touchPointInCanvas(e.touches[0]);
      touchStartPanRef.current = { panX };
      // set playhead on tap start
      const p = touchLastRef.current;
      if (p) setPlayheadSec(Math.max(0, cssToSec(p.x)));
    } else if (e.touches.length >= 2) {
      e.preventDefault();
      touchModeRef.current = 'pinch';
      const a = e.touches[0], b = e.touches[1];
      const dist = pinchDistance(a, b);
      const center = pinchCenterCss(a, b);
      pinchStartRef.current = { dist, zoom, centerXCss: center.x };
    }
  };

  const onTouchMove: React.TouchEventHandler<HTMLCanvasElement> = (e) => {
    if (!canvasRef.current) return;
    if (touchModeRef.current === 'pan' && e.touches.length === 1) {
      e.preventDefault();
      const cur = touchPointInCanvas(e.touches[0]);
      const last = touchLastRef.current;
      if (!last) { touchLastRef.current = cur; return; }
      const dx = cur.x - last.x;
      touchLastRef.current = cur;
      setPanX((p) => p + dx);
    } else if (touchModeRef.current === 'pinch' && e.touches.length >= 2) {
      e.preventDefault();
      const a = e.touches[0], b = e.touches[1];
      const start = pinchStartRef.current;
      if (!start) return;
      const dist = pinchDistance(a, b);
      const scale = dist / Math.max(1, start.dist);
      const nextZoom = clampZoom(start.zoom * scale);
      // zoom around initial pinch center
      applyZoomAbout(start.centerXCss, nextZoom);
    }
  };

  const onTouchEnd: React.TouchEventHandler<HTMLCanvasElement> = (e) => {
    if (e.touches.length === 0) {
      touchModeRef.current = 'none';
      touchLastRef.current = null;
      pinchStartRef.current = null;
    } else if (e.touches.length === 1) {
      touchModeRef.current = 'pan';
      touchLastRef.current = touchPointInCanvas(e.touches[0]);
      pinchStartRef.current = null;
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (e.ctrlKey) {
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const nextZoom = zoom * (e.deltaY > 0 ? 0.9 : 1.1);
      applyZoomAbout(cursorX, nextZoom);
    } else {
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      setPanX((p) => p - dx);
    }
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setIsMouseDown(true);
    dragStartRef.current = { cx: e.clientX, cy: e.clientY };

    // scrub
    setPlayheadSec(Math.max(0, cssToSec(x)));

    // — try note first
    const hitN = hitNoteAt(x, y);
    if (hitN) {
      pushHistory();
      setSelectedImageSceneId(null);
      setSelectedNoteId(hitN.note.id);
      activeNoteIdRef.current = hitN.note.id;
      noteStartSnapshotRef.current = { relX: hitN.note.relX, relY: hitN.note.relY };
      setDragMode('note');
      setSelectedSceneId(null);
      return;
    }

    // — then image card
    const hitImg = hitImageAt(x, y);
    if (hitImg) {
      pushHistory();
      setSelectedNoteId(null);
      setSelectedImageSceneId(hitImg.scene.id);
      activeImageSceneIdRef.current = hitImg.scene.id;
      imageStartSnapshotRef.current = { relX: hitImg.meta.relX, relY: hitImg.meta.relY };
      setDragMode('image');
      setSelectedSceneId(null);
      return;
    }

    // — then scene
    const hit = hitSceneAt(x, y);
    if (hit) {
      const { scene, region } = hit;
      if (hitChevron(scene, x, y)) {
        pushHistory();
        setScenes(prev => prev.map(s => s.id === scene.id ? { ...s, collapsed: !s.collapsed } : s));
        setSelectedSceneId(scene.id);
        setIsMouseDown(false);
        setDragMode('none');
        return;
      }
      pushHistory();
      setSelectedSceneId(scene.id);
      setSelectedNoteId(null);
      setSelectedImageSceneId(null);
      activeSceneIdRef.current = scene.id;
      sceneStartSnapshotRef.current = { positionSec: scene.positionSec, lengthSec: scene.lengthSec, yPx: scene.yPx };
      setDragMode(region);
    } else {
      // start marquee
      setSelectedSceneId(null);
      setSelectedNoteId(null);
      setSelectedImageSceneId(null);
      setDragMode('marquee');
      setMarquee({ x0: x, y0: y, x1: x, y1: y });
      setMultiSelIds(new Set());
    }
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isMouseDown) return;

    const dx = e.clientX - dragStartRef.current.cx;
    const dy = e.clientY - dragStartRef.current.cy;

    if (dragMode === 'pan') {
      setPanX(p => p + (e.movementX || 0));
      return;
    }

    if (dragMode === 'marquee') {
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const x = e.clientX - rect.left; const y = e.clientY - rect.top;
      setMarquee(prev => prev ? { ...prev, x1: x, y1: y } : prev);

      const sel = new Set<string>();
      const [mx0, mx1] = [Math.min(marquee!.x0, x), Math.max(marquee!.x0, x)];
      const [my0, my1] = [Math.min(marquee!.y0, y), Math.max(marquee!.y0, y)];
      for (const s of scenes) {
        const left = secToCss(s.positionSec);
        const width = s.lengthSec * zoom;
        const height = (s.collapsed ? COLLAPSED_H : ROW_HEIGHT - 6);
        const top = s.yPx + 4;
        if (rectsOverlap(mx0, my0, mx1 - mx0, my1 - my0, left, top, width, height)) {
          sel.add(s.id);
        }
      }
      setMultiSelIds(sel);
      return;
    }

    if (dragMode === 'note') {
      const id = activeNoteIdRef.current;
      const snap = noteStartSnapshotRef.current;
      if (!id || !snap) return;
      setNotes(prev => prev.map(n => n.id === id ? { ...n, relX: snap.relX + dx, relY: snap.relY + dy } : n));
      return;
    }

    if (dragMode === 'image') {
      const sid = activeImageSceneIdRef.current;
      const snap = imageStartSnapshotRef.current;
      if (!sid || !snap) return;
      setScenes(prev => prev.map(s => {
        if (s.id !== sid || !s.imageMeta) return s;
        return { ...s, imageMeta: { ...s.imageMeta, relX: snap.relX + dx, relY: snap.relY + dy } };
      }));
      return;
    }

    const sceneId = activeSceneIdRef.current;
    const snap = sceneStartSnapshotRef.current;
    if (!sceneId || !snap) return;

    if (dragMode === 'scene') {
      const newPos = roundToSnap(Math.max(0, snap.positionSec + dx / zoom));
      const lockedY = snap.yPx;
      if (multiSelIds.size > 0 && multiSelIds.has(sceneId)) {
        const deltaSec = newPos - snap.positionSec;
        setScenes(prev => prev.map(s =>
          multiSelIds.has(s.id)
            ? { ...s, positionSec: Math.max(0, s.positionSec + deltaSec), yPx: lockedY }
            : s
        ));
      } else {
        setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, positionSec: newPos, yPx: lockedY } : s));
      }
      return;
    }

    if (dragMode === 'resizeR' || dragMode === 'resizeL') {
      let newLen = snap.lengthSec;
      let newPos = snap.positionSec;
      if (dragMode === 'resizeR') newLen = roundToSnap(Math.max(SCENE_MIN_SEC, snap.lengthSec + dx / zoom));
      if (dragMode === 'resizeL') {
        const deltaSec = dx / zoom;
        newPos = roundToSnap(Math.max(0, snap.positionSec + deltaSec));
        newLen = roundToSnap(Math.max(SCENE_MIN_SEC, snap.lengthSec - deltaSec));
      }
      const deltaLen = newLen - snap.lengthSec;
      setScenes(prev => prev.map(s => {
        if (s.id === sceneId) return { ...s, positionSec: newPos, lengthSec: newLen };
        const resizedEndOld = snap.positionSec + snap.lengthSec;
        if (deltaLen !== 0 && s.positionSec >= resizedEndOld) {
          return { ...s, positionSec: Math.max(0, roundToSnap(s.positionSec + deltaLen)) };
        }
        return s;
      }));
      return;
    }
  };

  const endDrag = () => {
    setIsMouseDown(false);
    if (dragMode === 'marquee') {
      setSelectedSceneId(null);
      setSelectedNoteId(null);
      setSelectedImageSceneId(null);
    }
    setDragMode('none');
    activeSceneIdRef.current = null;
    sceneStartSnapshotRef.current = null;
    activeNoteIdRef.current = null;
    noteStartSnapshotRef.current = null;
    activeImageSceneIdRef.current = null;
    imageStartSnapshotRef.current = null;
    setMarquee(null);
  };
  const onMouseUp = endDrag;
  const onMouseLeave = endDrag;

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isMouseDown) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setPlayheadSec(Math.max(0, cssToSec(x)));

    // reattach: click a scene to move the selected note under it
    if (reattachMode && selectedNoteId) {
      const hit = hitSceneAt(x, y);
      if (hit) {
        pushHistory();
        const newScene = hit.scene;
        setNotes(prev => {
          const sceneNotes = notesByScene.get(newScene.id) || [];
          return prev.map(n =>
            n.id === selectedNoteId
              ? { ...n, sceneId: newScene.id, relX: 12, relY: 0, order: sceneNotes.length }
              : n
          );
        });
        setReattachMode(false);
      }
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // note editor
    const nHit = hitNoteAt(x, y);
    if (nHit) { setSelectedNoteId(nHit.note.id); setNoteModalId(nHit.note.id); setNoteModalText(nHit.note.text); return; }

    // image crop
    const iHit = hitImageAt(x, y);
    if (iHit) {
      setSelectedImageSceneId(iHit.scene.id);
      const crop = iHit.scene.imageMeta?.crop ?? { xPct: 0, yPct: 0, wPct: 100, hPct: 100 };
      setCropValues(crop);
      setCropModalSceneId(iHit.scene.id);
      return;
    }

    // scene editor
    const hit = hitSceneAt(x, y);
    if (!hit) return;
    const s = hit.scene;
    setModalSceneId(s.id);
    setModalText(s.description);
  };

  /* ---------- Scene ops ---------- */
  const addScene = () => {
    pushHistory();
    const id = crypto.randomUUID();
    const yBase = 8; // linear lane

    // next available original number
    const existing = new Set(scenes.map(s => s.originalSceneNumber));
    let num = scenes.length + 1;
    while (existing.has(num)) num += 1;

    const newScene: Scene = {
      id,
      originalSceneNumber: num,
      newSceneNumber: num,
      heading: 'INT./EXT. LOCATION – DAY',
      description: 'Describe action in screenplay format...',
      positionSec: roundToSnap(playheadSec),
      lengthSec: 30,
      yPx: yBase,
      color: pickColor(scenes.length),
      collapsed: false,
      imageUrl: null,
      imageMeta: null,
    };

    const placed = autoPlaceByOriginalNumber(newScene, scenes);
    setScenes(prev => prev.concat(placed));
    setSelectedSceneId(id);
  };

  const deleteSelectedScene = () => {
    if (!selectedSceneId) return;
    pushHistory();
    setNotes(prev => prev.filter(n => n.sceneId !== selectedSceneId));
    setScenes(prev => prev.filter(s => s.id !== selectedSceneId));
    setSelectedSceneId(null);
  };

  const updateHeading = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (!selectedSceneId) return;
    pushHistory();
    setScenes(prev => prev.map(s => s.id === selectedSceneId ? { ...s, heading: v } : s));
  };

  const updateLength = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedSceneId) return;
    const v = roundToSnap(Math.max(SCENE_MIN_SEC, Number(e.target.value) || SCENE_MIN_SEC));
    pushHistory();
    setScenes(prev => {
      const cur = prev.find(s => s.id === selectedSceneId)!;
      const delta = v - cur.lengthSec;
      return prev.map(s => {
        if (s.id === selectedSceneId) return { ...s, lengthSec: v };
        const curEnd = cur.positionSec + cur.lengthSec;
        if (delta !== 0 && s.positionSec >= curEnd) {
          return { ...s, positionSec: Math.max(0, roundToSnap(s.positionSec + delta)) };
        }
        return s;
      });
    });
  };

  const updateOriginalNumber = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vRaw = Math.max(1, Math.floor(Number(e.target.value) || 1));
    if (!selectedSceneId) return;

    pushHistory();
    setScenes(prev => {
      const cur = prev.find(s => s.id === selectedSceneId);
      if (!cur) return prev;

      const duplicate = prev.some(s => s.id !== cur.id && s.originalSceneNumber === vRaw);
      if (duplicate) { alert(`Scene number #${vRaw} already exists. Choose a unique number.`); return prev; }

      const updated = prev.map(s => s.id === cur.id ? { ...s, originalSceneNumber: vRaw } : s);
      const placed = autoPlaceByOriginalNumber(updated.find(s => s.id === cur.id)!, updated.filter(s => s.id !== cur.id));
      return updated.map(s => s.id === placed.id ? placed : s);
    });
  };

  /* ---------- Notes ---------- */
  const addNoteToSelectedScene = () => {
    if (!selectedSceneId) return;
    pushHistory();
    const sceneNotes = notesByScene.get(selectedSceneId) || [];
    const newNote: Note = {
      id: crypto.randomUUID(),
      sceneId: selectedSceneId,
      text: 'New note',
      order: sceneNotes.length,
      relX: 12,
      relY: 0,
      width: NOTE_DEFAULT_W,
      height: NOTE_DEFAULT_H,
    };
    setNotes(prev => prev.concat(newNote));
    setSelectedNoteId(newNote.id);
  };

  const deleteSelectedNote = () => {
    if (!selectedNoteId) return;
    pushHistory();
    setNotes(prev => prev.filter(n => n.id !== selectedNoteId));
    setSelectedNoteId(null);
  };

  const moveNoteUp = () => {
    if (!selectedNoteId) return;
    pushHistory();
    setNotes(prev => {
      const note = prev.find(n => n.id === selectedNoteId);
      if (!note) return prev;
      const siblings = prev.filter(n => n.sceneId === note.sceneId).sort((a, b) => a.order - b.order);
      const idx = siblings.findIndex(n => n.id === note.id);
      if (idx <= 0) return prev;
      const above = siblings[idx - 1];
      return prev.map(n => {
        if (n.id === note.id) return { ...n, order: above.order };
        if (n.id === above.id) return { ...n, order: note.order };
        return n;
      });
    });
  };

  const moveNoteDown = () => {
    if (!selectedNoteId) return;
    pushHistory();
    setNotes(prev => {
      const note = prev.find(n => n.id === selectedNoteId);
      if (!note) return prev;
      const siblings = prev.filter(n => n.sceneId === note.sceneId).sort((a, b) => a.order - b.order);
      const idx = siblings.findIndex(n => n.id === note.id);
      if (idx === -1 || idx >= siblings.length - 1) return prev;
      const below = siblings[idx + 1];
      return prev.map(n => {
        if (n.id === note.id) return { ...n, order: below.order };
        if (n.id === below.id) return { ...n, order: note.order };
        return n;
      });
    });
  };

  /* ---------- Image attach/crop ---------- */
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const onPickImage = () => { fileInputRef.current?.click(); };
  const onImageChosen: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !selectedSceneId) return;
    pushHistory();
    const dataUrl = await fileToDataUrl(file);
    setScenes(prev => prev.map(s => s.id === selectedSceneId
      ? {
          ...s,
          imageUrl: dataUrl,
          imageMeta: s.imageMeta ?? {
            relX: 12,
            relY: 0,
            width: IMAGE_CARD_W,
            height: IMAGE_CARD_H,
            crop: { xPct: 0, yPct: 0, wPct: 100, hPct: 100 },
          },
        }
      : s
    ));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const deleteSelectedImage = () => {
    if (!selectedImageSceneId) return;
    pushHistory();
    setScenes(prev => prev.map(s => s.id === selectedImageSceneId ? { ...s, imageUrl: null, imageMeta: null } : s));
    setSelectedImageSceneId(null);
  };

  const saveCrop = () => {
    if (!cropModalSceneId) return;
    pushHistory();
    setScenes(prev => prev.map(s => {
      if (s.id !== cropModalSceneId || !s.imageMeta) return s;
      return { ...s, imageMeta: { ...s.imageMeta, crop: { ...cropValues } } };
    }));
    setCropModalSceneId(null);
  };

  /* ---------- Import Script (Fountain/FDX/PDF/DOCX/TXT) ---------- */
  const importScriptInputRef = useRef<HTMLInputElement | null>(null);
  const onImportScriptClick = () => importScriptInputRef.current?.click();
  const onScriptFileChosen: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const baseY = 8;
    const palette = ['#a78bfa', '#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#38bdf8', '#fb7185', '#84cc16'];

    try {
      let parsed:
        | Awaited<ReturnType<typeof importFountainToScenes>>
        | ReturnType<typeof importFdxToScenes>;

      if (ext === 'fountain' || ext === 'txt') {
        const txt = await file.text();
        parsed = await importFountainToScenes(txt);
      } else if (ext === 'fdx') {
        const xml = await file.text();
        parsed = importFdxToScenes(xml);
      } else if (ext === 'pdf') {
        const txt = await extractPdfText(file);
        parsed = parseScript(txt);
      } else if (ext === 'docx') {
        const txt = await extractDocxText(file);
        parsed = parseScript(txt);
      } else if (ext === 'doc') {
        alert('Legacy .doc files are not supported in-browser. Please save/export as .docx and try again.');
        return;
      } else {
        alert('Unsupported file type. Use .fountain, .txt, .fdx, .pdf, or .docx');
        return;
      }

      if (!parsed.scenes.length) {
        console.error('[Importer] No scenes detected:', parsed);
        alert('No scenes detected in the file. Check formatting or try Fountain/FDX.');
        return;
      }

      const imported = parsed.scenes.map((s, i) => ({
        id: crypto.randomUUID(),
        originalSceneNumber: s.index,
        newSceneNumber: s.index,
        heading: s.heading,
        description: composeDescription((s as any).lines || []) || s.description || '',
        positionSec: Math.max(0, s.positionSec),
        lengthSec: Math.max(1, Math.round(s.estLengthSec)),
        yPx: baseY,
        color: palette[i % palette.length],
        collapsed: false,
        imageUrl: null,
        imageMeta: null,
        scriptLines: (s as any).lines || [],
      }));

      setScenes(imported);
      setNotes([]);
    } catch (err: any) {
      console.error('[Importer] Failed to import script:', err);
      const msg = (err && err.message) ? err.message : String(err);
      alert(`Failed to import script: ${msg}`);
    } finally {
      if (e.currentTarget) e.currentTarget.value = '';
    }
  };

  // ---- Save / Open (export/import project) ----
  function makeProject(): ProjectFileV1 {
    return {
      version: 1,
      kind: 'dtfilm',
      projectName,
      zoom,
      panX,
      playheadSec,
      scenes,
      notes,
    };
  }

  function exportProject() {
    const payload = makeProject();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const name = (projectName || 'Untitled Project').replace(/[\/\\?%*:|"<>]/g, '_');
    downloadBlob(`${name}.dtfilm.json`, blob);
  }

  function loadProject(data: unknown) {
    const p = data as Partial<ProjectFileV1>;
    if (!p || p.kind !== 'dtfilm' || p.version !== 1 || !Array.isArray(p.scenes) || !Array.isArray(p.notes)) {
      throw new Error('Invalid project file');
    }
    setScenes(p.scenes);
    setNotes(p.notes);
    setZoom(clampZoom(p.zoom ?? zoom));
    setPanX(p.panX ?? 0);
    setPlayheadSec(p.playheadSec ?? 0);
    setProjectName(p.projectName || 'Untitled Project');
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
      console.error('[Open Project] Failed:', err);
      alert(`Failed to open project: ${err?.message || String(err)}`);
    } finally {
      if (e.currentTarget) e.currentTarget.value = '';
    }
  };

  // Persist project name
  useEffect(() => {
    try { localStorage.setItem(PROJECT_NAME_KEY, projectName); } catch {}
  }, [projectName]);

  // Autosave (debounced)
  useEffect(() => {
    const handle = setTimeout(() => {
      try {
        const payload = makeProject();
        localStorage.setItem(PROJECT_AUTOSAVE_KEY, JSON.stringify(payload));
      } catch {}
    }, 500);
    return () => clearTimeout(handle);
  }, [projectName, scenes, notes, zoom, panX, playheadSec]);

  // Load autosave on mount if present and no scenes yet
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROJECT_AUTOSAVE_KEY);
      if (raw && scenes.length === 0) {
        const data = JSON.parse(raw);
        loadProject(data);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Zoom to fit ---------- */
  function fitAll() {
    const main = canvasRef.current; if (!main) return;
    const wCss = Math.max(1, main.clientWidth - 24);
    const dur = totalDurationSec();
    const z = clampZoom(wCss / dur);
    const pad = 12;
    setZoom(z);
    setPanX(pad - 0 * z);
  }
  function fitSelected() {
    if (!selectedSceneId) return;
    const s = scenes.find(x => x.id === selectedSceneId);
    if (!s) return;
    const main = canvasRef.current; if (!main) return;
    const wCss = Math.max(1, main.clientWidth - 48);
    const dur = Math.max(SCENE_MIN_SEC, s.lengthSec);
    const z = clampZoom(wCss / dur);
    const pad = 24;
    setZoom(z);
    setPanX(pad - s.positionSec * z);
  }

  /* ---------- Keyboard (Delete only, ignore when typing) ---------- */
  return (
    <div
      className="h-full flex flex-col bg-neutral-950 text-neutral-100"
      tabIndex={0}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement;
        const tag = (target?.tagName || '').toLowerCase();
        const typing = tag === 'input' || tag === 'textarea' || (target as any).isContentEditable;
        const modalOpen = !!modalSceneId || !!noteModalId || !!cropModalSceneId;
        if (!typing && !modalOpen && e.key === 'Delete') {
          if (selectedNoteId) { e.preventDefault(); deleteSelectedNote(); }
          else if (selectedImageSceneId) { e.preventDefault(); deleteSelectedImage(); }
          else if (selectedSceneId) { e.preventDefault(); deleteSelectedScene(); }
        }
      }}
    >
      {/* Minimap (TOP BAR — no wheel zoom/scroll) */}
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
          title="Overview — drag the box to pan; click background to jump"
        />
      </div>

      {/* Toolbar (TOP BAR — no wheel zoom/scroll) */}
      <div
        className={`border-b border-neutral-800 flex items-center gap-3 flex-wrap transition-[height,padding,margin,border] duration-200 ease-out ${chromeHidden ? 'h-0 p-0 overflow-hidden border-b-0' : 'p-2'}`}
        onWheel={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <button className="px-3 py-1.5 rounded bg-amber-500 text-black hover:bg-amber-400" onClick={addScene}>
          Add Scene @ {formatTime(playheadSec)}
        </button>

        {/* Import Script */}
        <input
          ref={importScriptInputRef}
          type="file"
          accept=".txt,.fountain,.fdx,.pdf,.docx,.doc"
          className="hidden"
          onChange={onScriptFileChosen}
        />
        <button
          className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700"
          onClick={onImportScriptClick}
          title="Import a script (.fountain / .txt / .fdx / .pdf / .docx)"
        >
          Import Script
        </button>

        {/* Project Name */}
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
          title="Save to .dtfilm.json"
        >
          Save Project
        </button>
        <input
          ref={openProjectInputRef}
          type="file"
          accept=".json,.dtfilm.json"
          className="hidden"
          onChange={onOpenProjectChosen}
        />
        <button
          className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700"
          onClick={onOpenProjectClick}
          title="Open a saved .dtfilm.json project"
        >
          Open Project
        </button>

        {/* Search */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!searchQ.trim()) return;
            if (searchResults.length === 1) {
              centerOnSceneId(searchResults[0].id);
              setSearchOpen(false);
            } else {
              setSearchOpen(true);
            }
          }}
          className="relative"
        >
          <input
            type="text"
            value={searchQ}
            onChange={(e) => { setSearchQ(e.target.value); setSearchOpen(true); }}
            placeholder="Search scene # or text…"
            className="px-3 py-1.5 rounded bg-neutral-900 border border-neutral-700 w-72"
          />
        </form>

        <button className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700" onClick={undo} disabled={history.length === 0}>
          Undo
        </button>

        {selectedSceneId && (
          <>
            <label className="text-sm text-neutral-300 flex items-center gap-2">
              Scene #
              <input
                type="number"
                min={1}
                value={scenes.find(s => s.id === selectedSceneId)?.originalSceneNumber ?? 1}
                onChange={updateOriginalNumber}
                className="px-2 py-1 rounded bg-neutral-900 border border-neutral-700 w-24"
              />
            </label>

            <label className="text-sm text-neutral-300 flex items-center gap-2">
              Heading
              <input
                type="text"
                value={scenes.find(s => s.id === selectedSceneId)?.heading ?? ''}
                onChange={updateHeading}
                className="px-2 py-1 rounded bg-neutral-900 border border-neutral-700 w-72"
                placeholder="INT. LOCATION – DAY"
              />
            </label>

            <label className="text-sm text-neutral-300 flex items-center gap-2">
              Length (s)
              <input
                type="number"
                min={SCENE_MIN_SEC}
                step={snapEnabled ? snapStep : 0.01}
                value={scenes.find(s => s.id === selectedSceneId)?.lengthSec ?? SCENE_MIN_SEC}
                onChange={updateLength}
                className="px-2 py-1 rounded bg-neutral-900 border border-neutral-700 w-24"
              />
            </label>

            {/* Notes controls */}
            <button className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700" onClick={addNoteToSelectedScene}>
              Add Note
            </button>

            {/* Reattach note toggle (works when a note is selected) */}
            <button
              className={`px-3 py-1.5 rounded border ${reattachMode ? 'bg-blue-600 border-blue-500' : 'bg-neutral-800 hover:bg-neutral-700 border-neutral-700'}`}
              onClick={() => setReattachMode((v) => !v)}
              disabled={!selectedNoteId}
              title="Click to toggle, then click a scene to reattach selected note"
            >
              {reattachMode ? 'Reattach: ON' : 'Reattach Note'}
            </button>

            {/* Image */}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onImageChosen} />
            <button className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700" onClick={onPickImage}>
              Attach Image
            </button>

            {/* Image ops (only when selected) */}
            {selectedImageSceneId && (
              <>
                <button
                  className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700"
                  onClick={() => {
                    const s = scenes.find(x => x.id === selectedImageSceneId);
                    if (!s?.imageMeta) return;
                    setCropValues(s.imageMeta.crop ?? { xPct: 0, yPct: 0, wPct: 100, hPct: 100 });
                    setCropModalSceneId(selectedImageSceneId);
                  }}
                >
                  Crop Image
                </button>
                <button className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500" onClick={deleteSelectedImage}>
                  Delete Image
                </button>
              </>
            )}

            <button className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700" onClick={fitSelected} title="Zoom to selected">
              Fit Scene
            </button>

            <button className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500" onClick={deleteSelectedScene}>
              Delete Scene
            </button>
          </>
        )}

        <button className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700" onClick={fitAll} title="Fit entire script">
          Fit All
        </button>

        {/* Snapping */}
        <label className="ml-auto text-sm text-neutral-300 flex items-center gap-2">
          <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} />
          Snap
        </label>
        <label className="text-sm text-neutral-300 flex items-center gap-2">
          Step (s)
          <input
            type="number"
            min={0.01}
            step={0.01}
            value={snapStep}
            onChange={(e) => setSnapStep(Math.max(0.01, Number(e.target.value) || 0.01))}
            className="px-2 py-1 rounded bg-neutral-900 border border-neutral-700 w-24"
          />
        </label>

        {/* Zoom */}
        <label className="text-sm text-neutral-300 flex items-center gap-2">
          Zoom
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={1}
            value={zoom}
            onChange={(e) => setZoom(clampZoom(parseFloat(e.target.value)))}
            className="w-40"
          />
          <span className="w-20 text-right tabular-nums">{Math.round(zoom)} px/s</span>
        </label>
      </div>

      {/* Floating UI toggle (mobile-first) */}
      <button
        onClick={() => setChromeHidden(v => !v)}
        className="sm:hidden fixed right-3 top-3 z-50 px-3 py-1.5 rounded-full border border-neutral-700 bg-neutral-900/80 backdrop-blur hover:bg-neutral-800 text-sm"
        title={chromeHidden ? 'Show controls' : 'Hide controls'}
      >
        {chromeHidden ? 'Show UI' : 'Hide UI'}
      </button>

      {/* Search Results Panel */}
      {searchOpen && searchQ.trim() && (
        <div
          className={`border-b border-neutral-800 bg-neutral-950/95 backdrop-blur sticky z-20 ${chromeHidden ? 'top-0' : 'top-[4rem]'}`}
          onWheel={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <div className="max-h-60 overflow-auto p-2 space-y-1">
            {searchResults.length === 0 && (
              <div className="text-sm text-neutral-400 px-2 py-1">No matches</div>
            )}
            {searchResults.map((r) => (
              <button
                key={r.id}
                onClick={() => { centerOnSceneId(r.id); setSearchOpen(false); }}
                className="w-full text-left px-3 py-2 rounded hover:bg-neutral-800 flex items-center gap-3"
              >
                <span className="text-xs text-neutral-400">{(() => {
                  const s = scenesWithOrder.find(x => x.id === r.id);
                  return s ? `#${s.originalSceneNumber} → ${s.newSceneNumber} · ${formatTime(s.positionSec)}` : '';
                })()}</span>
                <span className="flex-1 font-medium text-neutral-100 truncate">{r.label}</span>
                <span className="hidden sm:block text-xs text-neutral-400 truncate">{r.sub}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Canvas (the only scroll/zoom area) */}
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

        {/* Per-note toolbar (appears near selected note) */}
        {noteOverlay && selectedNoteId && (
          <div
            className="absolute z-40 flex gap-1 items-center"
            style={{ left: noteOverlay.left, top: noteOverlay.top }}
          >
            <button
              className="px-2 py-1 text-xs rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
              onClick={moveNoteUp}
              title="Move note up"
            >
              ▲
            </button>
            <button
              className="px-2 py-1 text-xs rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
              onClick={moveNoteDown}
              title="Move note down"
            >
              ▼
            </button>
            <button
              className="px-2 py-1 text-xs rounded bg-red-600 hover:bg-red-500"
              onClick={deleteSelectedNote}
              title="Delete note"
            >
              Delete
            </button>
          </div>
        )}

        {/* Scene Modal */}
        {modalSceneId && (
          <div
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setModalSceneId(null); }}
          >
            <div className="w-full max-w-3xl max-h-[80vh] bg-neutral-900 text-neutral-100 rounded-xl shadow-2xl border border-neutral-700 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
                <div className="font-medium">
                  {(() => {
                    const s = scenesWithOrder.find(x => x.id === modalSceneId);
                    if (!s) return 'Scene';
                    return `Scene #${s.originalSceneNumber} → new #${s.newSceneNumber} @ ${formatTime(s.positionSec)}`;
                  })()}
                </div>
                <div className="flex items-center gap-2">
                  <button className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700" onClick={() => setModalSceneId(null)}>Close</button>
                  <button
                    className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500"
                    onClick={() => {
                      if (!modalSceneId) return;
                      pushHistory();
                      setScenes(prev => prev.map(s =>
                        s.id === modalSceneId
                          ? { ...s, description: modalText, scriptLines: toScriptLinesFromText(modalText) }
                          : s
                      ));
                      setModalSceneId(null);
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>

              <div className="p-4 space-y-3 overflow-auto">
                <input
                  type="text"
                  className="w-full px-3 py-2 rounded-lg bg-neutral-950 border border-neutral-700"
                  value={scenes.find(s => s.id === modalSceneId)?.heading ?? ''}
                  onChange={(e) =>
                    setScenes(prev => prev.map(s => s.id === modalSceneId ? { ...s, heading: e.target.value } : s))
                  }
                  placeholder="INT. APARTMENT – NIGHT"
                />

                <label className="text-sm text-neutral-300 flex items-center gap-2">
                  Scene #
                  <input
                    type="number"
                    min={1}
                    value={scenes.find(s => s.id === modalSceneId)?.originalSceneNumber ?? 1}
                    onChange={(e) => {
                      const vRaw = Math.max(1, Math.floor(Number(e.target.value) || 1));
                      pushHistory();
                      setScenes(prev => {
                        const cur = prev.find(s => s.id === modalSceneId);
                        if (!cur) return prev;
                        const dup = prev.some(s => s.id !== cur.id && s.originalSceneNumber === vRaw);
                        if (dup) { alert(`Scene number #${vRaw} already exists.`); return prev; }
                        const updated = prev.map(s => s.id === cur.id ? { ...s, originalSceneNumber: vRaw } : s);
                        const placed = autoPlaceByOriginalNumber(updated.find(s => s.id === cur.id)!, updated.filter(s => s.id !== cur.id));
                        return updated.map(s => s.id === placed.id ? placed : s);
                      });
                    }}
                    className="px-2 py-1 rounded bg-neutral-950 border border-neutral-700 w-28"
                  />
                </label>

                <div className="flex items-center gap-3">
                  <label className="text-sm text-neutral-300 flex items-center gap-2">
                    Length (s)
                    <input
                      type="number"
                      min={SCENE_MIN_SEC}
                      step={snapEnabled ? snapStep : 0.01}
                      value={scenes.find(s => s.id === modalSceneId)?.lengthSec ?? SCENE_MIN_SEC}
                      onChange={(e) => {
                        const v = roundToSnap(Math.max(SCENE_MIN_SEC, Number(e.target.value) || SCENE_MIN_SEC));
                        pushHistory();
                        setScenes(prev => {
                          const cur = prev.find(s => s.id === modalSceneId)!;
                          const delta = v - cur.lengthSec;
                          return prev.map(s => {
                            if (s.id === modalSceneId) return { ...s, lengthSec: v };
                            const curEnd = cur.positionSec + cur.lengthSec;
                            if (delta !== 0 && s.positionSec >= curEnd) {
                              return { ...s, positionSec: Math.max(0, roundToSnap(s.positionSec + delta)) };
                            }
                            return s;
                          });
                        });
                      }}
                      className="px-2 py-1 rounded bg-neutral-950 border border-neutral-700 w-28"
                    />
                  </label>
                </div>

                <textarea
                  value={modalText}
                  onChange={(e) => setModalText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { e.preventDefault(); setModalSceneId(null); }
                    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                      e.preventDefault();
                      if (!modalSceneId) return;
                      pushHistory();
                      setScenes(prev => prev.map(s =>
                        s.id === modalSceneId
                          ? { ...s, description: modalText, scriptLines: toScriptLinesFromText(modalText) }
                          : s
                      ));
                      setModalSceneId(null);
                    }
                  }}
                  className="w-full h-[50vh] p-3 rounded-lg bg-neutral-950 text-neutral-100 outline-none border border-neutral-700"
                  placeholder="Full scene description in screenplay style…"
                />

                {/* Formatted (read-only) */}
                <div className="mt-4">
                  <div className="text-xs text-neutral-400 mb-2">Formatted (read-only preview)</div>
                  {(() => {
                    const s = scenes.find(x => x.id === modalSceneId);
                    const lines =
                      (s?.scriptLines && s.scriptLines.length > 0)
                        ? s.scriptLines
                        : toScriptLinesFromText(modalText || s?.description || '');
                    return <ScriptFormattedView lines={lines} />;
                  })()}
                </div>
              </div>

              <div className="px-4 py-3 border-t border-neutral-800 text-sm text-neutral-400">
                Tip: <kbd className="px-1 py-0.5 bg-neutral-800 rounded">Esc</kbd> to close ·{' '}
                <kbd className="px-1 py-0.5 bg-neutral-800 rounded">Ctrl/⌘</kbd>+<kbd className="px-1 py-0.5 bg-neutral-800 rounded">S</kbd> to save
              </div>
            </div>
          </div>
        )}

        {/* Note Modal */}
        {noteModalId && (
          <div
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setNoteModalId(null); }}
          >
            <div className="w-full max-w-2xl max-h-[70vh] bg-neutral-900 text-neutral-100 rounded-xl shadow-2xl border border-neutral-700 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
                <div className="font-medium">Edit Note</div>
                <div className="flex items-center gap-2">
                  <button className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700" onClick={() => setNoteModalId(null)}>Close</button>
                  <button
                    className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500"
                    onClick={() => {
                      if (!noteModalId) return;
                      pushHistory();
                      setNotes(prev => prev.map(n => n.id === noteModalId ? { ...n, text: noteModalText } : n));
                      setNoteModalId(null);
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>

              <div className="p-4 space-y-3 overflow-auto">
                <textarea
                  value={noteModalText}
                  onChange={(e) => setNoteModalText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { e.preventDefault(); setNoteModalId(null); }
                    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                      e.preventDefault();
                      if (!noteModalId) return;
                      pushHistory();
                      setNotes(prev => prev.map(n => n.id === noteModalId ? { ...n, text: noteModalText } : n));
                      setNoteModalId(null);
                    }
                  }}
                  className="w-full h-[45vh] p-3 rounded-lg bg-neutral-950 text-neutral-100 outline-none border border-neutral-700"
                  placeholder="Write note…"
                />
              </div>

              <div className="px-4 py-3 border-t border-neutral-800 text-sm text-neutral-400">
                Tip: <kbd className="px-1 py-0.5 bg-neutral-800 rounded">Esc</kbd> to close ·{' '}
                <kbd className="px-1 py-0.5 bg-neutral-800 rounded">Ctrl/⌘</kbd>+<kbd className="px-1 py-0.5 bg-neutral-800 rounded">S</kbd> to save
              </div>
            </div>
          </div>
        )}

        {/* Image Crop Modal */}
        {cropModalSceneId && (
          <div
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setCropModalSceneId(null); }}
          >
            <div className="w-full max-w-md bg-neutral-900 text-neutral-100 rounded-xl shadow-2xl border border-neutral-700 overflow-hidden">
              <div className="px-4 py-3 border-b border-neutral-800 font-medium">Crop Image</div>
              <div className="p-4 grid grid-cols-2 gap-3">
                <label className="text-sm text-neutral-300">
                  X (%)
                  <input
                    type="number" min={0} max={100}
                    value={cropValues.xPct}
                    onChange={(e) => setCropValues(v => ({ ...v, xPct: clampPct(e.target.value) }))}
                    className="w-full mt-1 px-2 py-1 rounded bg-neutral-950 border border-neutral-700"
                  />
                </label>
                <label className="text-sm text-neutral-300">
                  Y (%)
                  <input
                    type="number" min={0} max={100}
                    value={cropValues.yPct}
                    onChange={(e) => setCropValues(v => ({ ...v, yPct: clampPct(e.target.value) }))}
                    className="w-full mt-1 px-2 py-1 rounded bg-neutral-950 border border-neutral-700"
                  />
                </label>
                <label className="text-sm text-neutral-300">
                  W (%)
                  <input
                    type="number" min={1} max={100}
                    value={cropValues.wPct}
                    onChange={(e) => setCropValues(v => ({ ...v, wPct: clampPct(e.target.value, 1) }))}
                    className="w-full mt-1 px-2 py-1 rounded bg-neutral-950 border border-neutral-700"
                  />
                </label>
                <label className="text-sm text-neutral-300">
                  H (%)
                  <input
                    type="number" min={1} max={100}
                    value={cropValues.hPct}
                    onChange={(e) => setCropValues(v => ({ ...v, hPct: clampPct(e.target.value, 1) }))}
                    className="w-full mt-1 px-2 py-1 rounded bg-neutral-950 border border-neutral-700"
                  />
                </label>
              </div>
              <div className="px-4 py-3 border-t border-neutral-800 flex items-center justify-end gap-2">
                <button className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700" onClick={() => setCropModalSceneId(null)}>
                  Cancel
                </button>
                <button className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500" onClick={saveCrop}>
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  /* ---------- helpers (hit tests, auto place, etc.) ---------- */
  function hitSceneAt(xCss: number, yCss: number): { scene: Scene; region: DragMode } | null {
    for (let i = scenes.length - 1; i >= 0; i--) {
      const s = scenes[i];
      const left = secToCss(s.positionSec);
      const width = s.lengthSec * zoom;
      const height = (s.collapsed ? COLLAPSED_H : ROW_HEIGHT - 6 + FOOTER_H);
      const top = s.yPx + 4;

      if (xCss >= left && xCss <= left + width && yCss >= top && yCss <= top + height) {
        if (xCss <= left + HANDLE_W) return { scene: s, region: 'resizeL' };
        if (xCss >= left + width - HANDLE_W) return { scene: s, region: 'resizeR' };
        return { scene: s, region: 'scene' };
      }
    }
    return null;
  }
  function hitChevron(s: Scene, xCss: number, yCss: number) {
    const left = secToCss(s.positionSec);
    const top = s.yPx + 4;
    const x0 = left + TOGGLE_PAD;
    const y0 = top + 6;
    return (xCss >= x0 && xCss <= x0 + TOGGLE_SIZE && yCss >= y0 && yCss <= y0 + TOGGLE_SIZE);
  }
  function hitNoteAt(xCss: number, yCss: number): { scene: Scene; note: Note } | null {
    for (let i = scenes.length - 1; i >= 0; i--) {
      const s = scenes[i];
      const stack = getSceneNotesStack(s.id).slice().reverse();
      for (const item of stack) {
        if (xCss >= item.x && xCss <= item.x + item.w && yCss >= item.y && yCss <= item.y + item.h) {
          return { scene: s, note: item.note };
        }
      }
    }
    return null;
  }
  function hitImageAt(xCss: number, yCss: number): { scene: Scene; meta: NonNullable<Scene['imageMeta']> } | null {
    for (let i = scenes.length - 1; i >= 0; i--) {
      const s = scenes[i];
      if (!s.imageUrl || !s.imageMeta || s.collapsed) continue;
      const r = getImageRectCss(s)!;
      if (xCss >= r.x && xCss <= r.x + r.w && yCss >= r.y && yCss <= r.y + r.h) {
        return { scene: s, meta: s.imageMeta };
      }
    }
    return null;
  }
  function rectsOverlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }
  function autoPlaceByOriginalNumber(scene: Scene, others: Scene[]): Scene {
    const gap = 1;
    const all = [...others].sort((a, b) => a.originalSceneNumber - b.originalSceneNumber);
    const prev = [...all].reverse().find(s => s.originalSceneNumber < scene.originalSceneNumber) || null;
    const next = all.find(s => s.originalSceneNumber > scene.originalSceneNumber) || null;
    if (!prev && !next) return { ...scene, positionSec: roundToSnap(scene.positionSec) };
    if (prev) {
      const candidate = roundToSnap(prev.positionSec + prev.lengthSec + gap);
      if (!next || candidate + scene.lengthSec <= next.positionSec - gap) {
        return { ...scene, positionSec: candidate };
      }
    }
    if (next) {
      const candidate = roundToSnap(Math.max(0, next.positionSec - scene.lengthSec - gap));
      if (!prev || candidate >= prev.positionSec + prev.lengthSec + gap) {
        return { ...scene, positionSec: candidate };
      }
    }
    const leftEdge = prev ? (prev.positionSec + prev.lengthSec) : 0;
    const rightEdge = next ? next.positionSec : (leftEdge + scene.lengthSec + 2 * gap);
    const mid = roundToSnap(Math.max(0, (leftEdge + rightEdge - scene.lengthSec) / 2));
    return { ...scene, positionSec: mid };
  }
  function clampPct(v: string | number, min = 0) { return Math.max(min, Math.min(100, Number(v) || 0)); }
}

function pickColor(i: number) {
  const palette = ['#a78bfa', '#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#38bdf8', '#fb7185', '#84cc16'];
  return palette[i % palette.length];
}