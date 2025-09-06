import { describe, it, expect } from 'vitest';
import { formatTime } from '@/lib/time';

describe('formatTime edge cases', () => {
  it('handles negative and NaN by clamping to 0:00', () => {
    // @ts-expect-error forcing invalid to ensure clamp
    expect(formatTime(NaN)).toBe('0:00');
    expect(formatTime(-5)).toBe('0:00');
  });
});
