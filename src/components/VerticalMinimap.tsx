'use client';

import React, { useEffect, useRef, useState } from 'react';

type DragMode = 'none' | 'window' | 'resizeT' | 'resizeB';

export default function VerticalMinimap({
  contentHeightPx,        // total content height (px)
  viewStartPx,            // current top of visible window (px, 0..contentHeightPx - viewHeightPx)
  viewHeightPx,           // visible height of main viewport (px)
  width = 14,             // CSS px for the bar width
  onJumpY,                // click background to jump -> give top in px
  onWindowChangeY,        // drag window -> new top in px
  onWindowResizeY,        // resize window -> new top & height in px (enables vertical zoom)
  className = '',
}: {
  contentHeightPx: number;
  viewStartPx: number;
  viewHeightPx: number;
  width?: number;
  onJumpY?: (topPx: number) => void;
  onWindowChangeY?: (topPx: number) => void;
  onWindowResizeY?: (topPx: number, heightPx: number) => void;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [trackH, setTrackH] = useState(0);
  const dragRef = useRef<{
    mode: DragMode;
    grabOffsetPx: number;
    startTopPx: number;
    startHeightPx: number;
  }>({ mode: 'none', grabOffsetPx: 0, startTopPx: 0, startHeightPx: 0 });

  // Keep track height in sync with layout
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTrackH(el.clientHeight || 0));
    ro.observe(el);
    setTrackH(el.clientHeight || 0);
    return () => ro.disconnect();
  }, []);

  const safeContent = Math.max(1, contentHeightPx);
  const safeTrack = Math.max(1, trackH);
  const ratio = safeTrack / safeContent;

  // Compute window in track space
  const winH = Math.max(20, Math.floor(viewHeightPx * ratio));
  const winTop = Math.max(
    0,
    Math.min(safeTrack - winH, Math.floor(viewStartPx * ratio)),
  );

  const GRIP = 8; // CSS px for top/bottom grip hit areas
  const MIN_WIN = 24;

  const beginDrag = (yCss: number): boolean => {
    const el = wrapRef.current;
    if (!el) return false;
    // hit test grips and window
    const topHit = Math.abs(yCss - winTop) <= GRIP;
    const botHit = Math.abs(yCss - (winTop + winH)) <= GRIP;
    const inside = yCss >= winTop && yCss <= winTop + winH;

    dragRef.current.startTopPx = winTop;
    dragRef.current.startHeightPx = winH;

    if (topHit) {
      dragRef.current.mode = 'resizeT';
      return true;
    }
    if (botHit) {
      dragRef.current.mode = 'resizeB';
      return true;
    }
    if (inside) {
      dragRef.current.mode = 'window';
      dragRef.current.grabOffsetPx = yCss - winTop;
      return true;
    }
    // background: jump & start window drag centered on click
    const targetTopPx = Math.max(0, Math.min(safeTrack - winH, yCss - winH / 2));
    onJumpY?.((targetTopPx / Math.max(1, ratio)));
    dragRef.current.mode = 'window';
    dragRef.current.grabOffsetPx = winH / 2;
    return true;
  };

  const endDrag = () => {
    dragRef.current.mode = 'none';
    dragRef.current.grabOffsetPx = 0;
    dragRef.current.startTopPx = 0;
    dragRef.current.startHeightPx = 0;
  };

  const handleMove = (yCss: number) => {
    if (dragRef.current.mode === 'none') return;
    const mode = dragRef.current.mode;

    if (mode === 'window') {
      const newTop = Math.max(0, Math.min(safeTrack - winH, yCss - dragRef.current.grabOffsetPx));
      onWindowChangeY?.(newTop / ratio);
      return;
    }

    if (mode === 'resizeT') {
      const bottom = dragRef.current.startTopPx + dragRef.current.startHeightPx;
      const newTop = Math.max(0, Math.min(bottom - MIN_WIN, yCss));
      const newH = Math.max(MIN_WIN, bottom - newTop);
      onWindowResizeY?.(newTop / ratio, newH / ratio);
      return;
    }

    if (mode === 'resizeB') {
      const newBottom = Math.max(winTop + MIN_WIN, Math.min(safeTrack, yCss));
      const newH = Math.max(MIN_WIN, newBottom - winTop);
      onWindowResizeY?.(winTop / ratio, newH / ratio);
      return;
    }
  };

  // Mouse
  const onMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const yCss = e.clientY - rect.top;
    beginDrag(yCss);
  };
  const onMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (dragRef.current.mode === 'none') return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const yCss = e.clientY - rect.top;
    handleMove(yCss);
  };
  const onMouseUp: React.MouseEventHandler<HTMLDivElement> = () => endDrag();
  const onMouseLeave: React.MouseEventHandler<HTMLDivElement> = () => endDrag();

  // Touch
  const onTouchStart: React.TouchEventHandler<HTMLDivElement> = (e) => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const yCss = e.touches[0].clientY - rect.top;
    beginDrag(yCss);
  };
  const onTouchMove: React.TouchEventHandler<HTMLDivElement> = (e) => {
    if (dragRef.current.mode === 'none') return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const yCss = e.touches[0].clientY - rect.top;
    handleMove(yCss);
  };
  const onTouchEnd: React.TouchEventHandler<HTMLDivElement> = () => endDrag();

  return (
    <div
      ref={wrapRef}
      className={`absolute right-1 top-2 bottom-2 rounded-md bg-neutral-900/70 backdrop-blur-sm shadow-inner border border-neutral-800 ${className}`}
      style={{ width }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      title="Vertical Minimap — drag to scroll, drag edges to zoom"
    >
      {/* shaded outside (optional subtle) */}
      <div className="absolute inset-0 opacity-60" />

      {/* window body */}
      <div
        className="absolute left-[1px] right-[1px] rounded bg-sky-400/25 border border-sky-400"
        style={{ top: winTop, height: winH }}
      >
        {/* grips */}
        <div className="absolute left-1 right-1 h-1.5 -top-0.5 rounded bg-sky-300/70" />
        <div className="absolute left-1 right-1 h-1.5 -bottom-0.5 rounded bg-sky-300/70" />
        {/* handle bar */}
        <div className="absolute left-2 right-2 top-1/2 -translate-y-1/2 h-1 rounded bg-sky-300/50" />
      </div>
    </div>
  );
}