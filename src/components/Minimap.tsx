'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

type MinimapProps = {
  duration: number;               // seconds
  buckets: number[];              // normalized peak-to-peak amplitudes (0..1-ish)
  viewStartSec?: number;          // current view start (seconds)
  viewDurationSec?: number;       // current view width (seconds)
  onJump?: (sec: number) => void; // click/tap to jump
  onWindowChange?: (startSec: number) => void; // drag window to new start
  onWindowResize?: (startSec: number, durationSec: number) => void; // resize handles
  height?: number;                // CSS height (px)
};

type DragMode = 'none' | 'window' | 'resizeL' | 'resizeR';

export default function Minimap({
  duration,
  buckets,
  viewStartSec = 0,
  viewDurationSec = 0,
  onJump,
  onWindowChange,
  onWindowResize,
  height = 48,
}: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Track viewport (main canvas) width so Minimap window knows how wide the view is
  const [viewportW, setViewportW] = useState(0);
  useEffect(() => {
    const el = canvasRef.current as HTMLCanvasElement | null;
    if (!el) return;
    const update = () => setViewportW(el.clientWidth || 0);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, []);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(0);
  const dragRef = useRef<{
    mode: DragMode;
    grabOffsetSec: number;   // offset within window where we grabbed (sec)
    startStartSec: number;   // window start when drag began
    startDurationSec: number;// window duration when drag began
  }>({ mode: 'none', grabOffsetSec: 0, startStartSec: 0, startDurationSec: 0 });

  // Resize observer to keep canvas crisp
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setWidth(Math.max(0, Math.floor(el.clientWidth)));
    });
    ro.observe(el);
    setWidth(Math.max(0, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);

  // Helpers
  const DPR = Math.max(1, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const safeDuration = duration > 0 && Number.isFinite(duration) ? duration : 0.000001;

  const toX = (sec: number) => (sec / safeDuration) * width;
  const toSec = (x: number) => (x / Math.max(1, width)) * safeDuration;

  const MIN_WINDOW_SEC = Math.max(0.01, safeDuration * 0.005); // 0.5% of duration or 10ms
  const GRIP_CSS = 8; // px in CSS space for hit-testing grips

  // Precompute downsample of buckets to canvas width
  const peaks = useMemo(() => {
    if (!buckets?.length || width <= 0) return null;
    const out = new Float32Array(width);
    const N = buckets.length;
    for (let x = 0; x < width; x++) {
      const start = Math.floor((x / width) * N);
      const end = Math.min(N, Math.floor(((x + 1) / width) * N));
      let max = 0;
      for (let i = start; i < end; i++) {
        const v = Math.abs(buckets[i]) || 0;
        if (v > max) max = v;
      }
      out[x] = max;
    }
    return out;
  }, [buckets, width]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = Math.max(1, Math.floor(width * DPR));
    const H = Math.max(1, Math.floor(height * DPR));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W; canvas.height = H;
    }

    // bg
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, W, H);

    // waveform
    if (peaks) {
      const mid = H / 2;
      const amp = (H * 0.7) / 2;
      ctx.fillStyle = '#334155';
      for (let x = 0; x < width; x++) {
        const v = peaks[x] ?? 0;
        const h = Math.max(1, v * amp);
        const xx = Math.floor(x * DPR);
        ctx.fillRect(xx, Math.floor(mid - h), Math.max(1, DPR), Math.max(1, h * 2));
      }
    }

    // view window
    if (viewDurationSec > 0) {
      const vxCss = toX(Math.max(0, viewStartSec));
      const vwCss = Math.max(2, toX(viewStartSec + viewDurationSec) - toX(viewStartSec));
      const vx = vxCss * DPR;
      const vw = vwCss * DPR;

      // shaded outside
      ctx.fillStyle = 'rgba(15,23,42,0.60)';
      ctx.fillRect(0, 0, vx, H);                // left shade
      ctx.fillRect(vx + vw, 0, W - (vx + vw), H); // right shade

      // window body with subtle pattern
      ctx.fillStyle = 'rgba(148,163,184,0.20)';
      ctx.fillRect(vx, 0, vw, H);

      // border
      ctx.strokeStyle = '#93c5fd';
      ctx.lineWidth = Math.max(2, DPR);
      ctx.strokeRect(vx + 0.5 * DPR, 0.5 * DPR, vw - 1 * DPR, H - 1 * DPR);

      // grips
      const gripW = Math.max(6 * DPR, 6);
      ctx.fillStyle = '#93c5fd';
      ctx.fillRect(vx - gripW / 2, 0, gripW, H);           // left grip
      ctx.fillRect(vx + vw - gripW / 2, 0, gripW, H);      // right grip

      // center handle indicator
      ctx.fillStyle = 'rgba(147,197,253,0.35)';
      ctx.fillRect(vx + vw * 0.45, H * 0.25, vw * 0.10, H * 0.5);
    }
  }, [width, height, peaks, DPR, viewStartSec, viewDurationSec, safeDuration]);

  // Events
  const beginDragWindow = (xCss: number) => {
    if (!(viewDurationSec > 0)) return false;
    const vx = toX(viewStartSec);
    const vw = Math.max(0, toX(viewStartSec + viewDurationSec) - vx);

    dragRef.current.startStartSec = viewStartSec;
    dragRef.current.startDurationSec = Math.max(MIN_WINDOW_SEC, viewDurationSec);

    // Hit-test grips first
    if (Math.abs(xCss - vx) <= GRIP_CSS) {
      dragRef.current.mode = 'resizeL';
      return true;
    }
    if (Math.abs(xCss - (vx + vw)) <= GRIP_CSS) {
      dragRef.current.mode = 'resizeR';
      return true;
    }

    // Then the window body
    if (xCss >= vx && xCss <= vx + vw) {
      dragRef.current.mode = 'window';
      dragRef.current.grabOffsetSec = toSec(xCss - vx); // where inside window we grabbed
      return true;
    }
    return false;
  };

  const onMouseDown: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left; // CSS px
    if (beginDragWindow(x)) return;
    // background click => jump
    if (onJump) {
      const sec = toSec(x);
      onJump(sec);
    }
  };
  const onMouseMove: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    if (dragRef.current.mode === 'none') return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const xCss = e.clientX - rect.left;

    if (dragRef.current.mode === 'window') {
      if (!onWindowChange) return;
      const newStart = toSec(xCss) - dragRef.current.grabOffsetSec;
      const maxStart = Math.max(0, duration - (viewDurationSec || 0));
      const clamped = Math.max(0, Math.min(maxStart, newStart));
      onWindowChange(clamped);
      return;
    }

    // Resize modes
    if (!onWindowResize && !onWindowChange) return;
    const start0 = dragRef.current.startStartSec;
    const dur0 = dragRef.current.startDurationSec;

    if (dragRef.current.mode === 'resizeL') {
      const newLeftSec = Math.max(0, Math.min(viewStartSec + viewDurationSec - MIN_WINDOW_SEC, toSec(xCss)));
      const newStart = Math.min(newLeftSec, viewStartSec + viewDurationSec - MIN_WINDOW_SEC);
      const newDur = Math.max(MIN_WINDOW_SEC, viewStartSec + viewDurationSec - newStart);
      if (onWindowResize) onWindowResize(newStart, newDur);
      else onWindowChange && onWindowChange(newStart);
      return;
    }

    if (dragRef.current.mode === 'resizeR') {
      const newRightSec = Math.max(viewStartSec + MIN_WINDOW_SEC, Math.min(duration, toSec(xCss)));
      const newDur = Math.max(MIN_WINDOW_SEC, newRightSec - viewStartSec);
      if (onWindowResize) onWindowResize(viewStartSec, newDur);
      else onWindowChange && onWindowChange(viewStartSec);
      return;
    }
  };
  const endDrag = () => {
    dragRef.current.mode = 'none';
    dragRef.current.grabOffsetSec = 0;
    dragRef.current.startStartSec = 0;
    dragRef.current.startDurationSec = 0;
  };
  const onMouseUp: React.MouseEventHandler<HTMLCanvasElement> = () => endDrag();
  const onMouseLeave: React.MouseEventHandler<HTMLCanvasElement> = () => endDrag();

  // Touch: tap to jump, drag to move window
  const onTouchStart: React.TouchEventHandler<HTMLCanvasElement> = (e) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = e.touches[0].clientX - rect.left;
    if (!beginDragWindow(x)) {
      if (onJump) onJump(toSec(x));
    }
  };
  const onTouchMove: React.TouchEventHandler<HTMLCanvasElement> = (e) => {
    if (dragRef.current.mode === 'none') return;
    if (e.touches.length < 1) return;
    e.preventDefault();

    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const xCss = e.touches[0].clientX - rect.left;

    if (dragRef.current.mode === 'window') {
      if (!onWindowChange) return;
      const newStart = toSec(xCss) - dragRef.current.grabOffsetSec;
      const maxStart = Math.max(0, duration - (viewDurationSec || 0));
      const clamped = Math.max(0, Math.min(maxStart, newStart));
      onWindowChange(clamped);
      return;
    }

    if (!onWindowResize && !onWindowChange) return;

    if (dragRef.current.mode === 'resizeL') {
      const newLeftSec = Math.max(0, Math.min(viewStartSec + viewDurationSec - MIN_WINDOW_SEC, toSec(xCss)));
      const newStart = Math.min(newLeftSec, viewStartSec + viewDurationSec - MIN_WINDOW_SEC);
      const newDur = Math.max(MIN_WINDOW_SEC, viewStartSec + viewDurationSec - newStart);
      if (onWindowResize) onWindowResize(newStart, newDur);
      else onWindowChange && onWindowChange(newStart);
      return;
    }

    if (dragRef.current.mode === 'resizeR') {
      const newRightSec = Math.max(viewStartSec + MIN_WINDOW_SEC, Math.min(duration, toSec(xCss)));
      const newDur = Math.max(MIN_WINDOW_SEC, newRightSec - viewStartSec);
      if (onWindowResize) onWindowResize(viewStartSec, newDur);
      else onWindowChange && onWindowChange(viewStartSec);
      return;
    }
  };
  const onTouchEnd: React.TouchEventHandler<HTMLCanvasElement> = () => endDrag();

  return (
    <div
      ref={wrapRef}
      className="w-full select-none"
      style={{ height, position: 'relative' }}
      title="Minimap — drag window to scroll, drag edges to resize, click to jump"
      onWheel={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      />
    </div>
  );
}