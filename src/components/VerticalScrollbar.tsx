'use client';

import React, { useEffect, useRef, useState } from 'react';

/**
 * Lightweight vertical scrollbar with a draggable thumb.
 *
 * Props
 *  - trackHeight: total height of the rail in CSS px
 *  - thumbHeight: height of the thumb in CSS px
 *  - thumbTop: top offset of the thumb (0..trackHeight-thumbHeight)
 *  - onScroll(nextThumbTop): called as the user drags or clicks the rail
 *
 * Notes
 *  - UI-only; parent owns content height and pan state.
 */
export default function VerticalScrollbar({
  trackHeight,
  thumbHeight,
  thumbTop,
  onScroll,
}: {
  trackHeight: number;
  thumbHeight: number;
  thumbTop: number;
  onScroll: (nextThumbTop: number) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ y: number; top: number } | null>(null);

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const startDrag = (clientY: number) => {
    setDragging(true);
    dragStartRef.current = { y: clientY, top: thumbTop };
    document.body.style.userSelect = 'none';
  };

  const onMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    const rail = railRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    const y = e.clientY - rect.top;

    // If clicking on the thumb -> start drag
    const withinThumb = y >= thumbTop && y <= thumbTop + thumbHeight;
    if (withinThumb) {
      startDrag(e.clientY);
      return;
    }

    // Otherwise jump so the thumb centers around the click
    const next = clamp(y - thumbHeight / 2, 0, trackHeight - thumbHeight);
    onScroll(next);
    // Start drag for smooth UX
    startDrag(e.clientY);
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!dragging || !dragStartRef.current) return;
    const delta = e.clientY - dragStartRef.current.y;
    const next = clamp(dragStartRef.current.top + delta, 0, trackHeight - thumbHeight);
    onScroll(next);
  };

  const endDrag = () => {
    setDragging(false);
    dragStartRef.current = null;
    document.body.style.userSelect = '';
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => onMouseMove(e);
    const up = () => endDrag();
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dragging]);

  // Touch support
  const onTouchStart: React.TouchEventHandler<HTMLDivElement> = (e) => {
    const rail = railRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    const y = e.touches[0].clientY - rect.top;
    const withinThumb = y >= thumbTop && y <= thumbTop + thumbHeight;
    if (withinThumb) {
      startDrag(e.touches[0].clientY);
    } else {
      const next = clamp(y - thumbHeight / 2, 0, trackHeight - thumbHeight);
      onScroll(next);
      startDrag(e.touches[0].clientY);
    }
  };
  const onTouchMove: React.TouchEventHandler<HTMLDivElement> = (e) => {
    if (!dragging || !dragStartRef.current) return;
    e.preventDefault();
    const delta = e.touches[0].clientY - dragStartRef.current.y;
    const next = clamp(dragStartRef.current.top + delta, 0, trackHeight - thumbHeight);
    onScroll(next);
  };
  const onTouchEnd: React.TouchEventHandler<HTMLDivElement> = () => endDrag();

  // Keyboard (small nudges)
  const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    const step = e.shiftKey ? 40 : 8;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      onScroll(clamp(thumbTop - step, 0, trackHeight - thumbHeight));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      onScroll(clamp(thumbTop + step, 0, trackHeight - thumbHeight));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onScroll(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onScroll(trackHeight - thumbHeight);
    }
  };

  return (
    <div
      ref={railRef}
      role="scrollbar"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={trackHeight - thumbHeight}
      aria-valuenow={thumbTop}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onKeyDown={onKeyDown}
      className="absolute right-1 top-2 bottom-2 w-3 rounded-full bg-neutral-800/70 backdrop-blur-sm shadow-inner"
      style={{ height: trackHeight }}
    >
      <div
        className={`absolute left-0 right-0 mx-auto w-3 rounded-full bg-neutral-400 hover:bg-neutral-300 active:bg-neutral-200 transition-colors ${
          dragging ? 'ring-2 ring-blue-400' : ''
        }`}
        style={{
          height: thumbHeight,
          top: Math.max(0, Math.min(trackHeight - thumbHeight, thumbTop)),
        }}
      />
    </div>
  );
}