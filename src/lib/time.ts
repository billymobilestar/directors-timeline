export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`
    : `${m}:${s.toString().padStart(2,'0')}`;
}

export function timeToX(tSec: number, zoomPxPerSec: number, panX: number): number {
  return tSec * zoomPxPerSec + panX;
}

export function xToTime(xPx: number, zoomPxPerSec: number, panX: number): number {
  return (xPx - panX) / zoomPxPerSec;
}
