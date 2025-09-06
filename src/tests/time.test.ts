import { describe, it, expect } from 'vitest';
import { timeToX, xToTime, formatTime } from '@/lib/time';

describe('time mapping helpers', () => {
  it('timeToX and xToTime should be inverses', () => {
    const zoom = 100; const pan = -250; const t = 12.34;
    const x = timeToX(t, zoom, pan);
    expect(xToTime(x, zoom, pan)).toBeCloseTo(t, 6);
  });

  it('formatTime should format under an hour correctly', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(5)).toBe('0:05');
    expect(formatTime(65)).toBe('1:05');
  });

  it('formatTime should handle hours', () => {
    expect(formatTime(3661)).toBe('1:01:01');
  });

  it('x<->time should handle negative pan', () => {
    const zoom = 50; const pan = -1000; const t = 0.5;
    const x = timeToX(t, zoom, pan);
    expect(xToTime(x, zoom, pan)).toBeCloseTo(t, 6);
  });
});
