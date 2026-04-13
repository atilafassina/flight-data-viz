import { describe, it, expect } from 'vitest';
import { downsamplePoints, downsampleArrowBuffer, proportionalTargetPoints } from './downsampler.js';
import { serializeToArrowIPC } from './chunker.js';
import type { DataPoint } from './chunker.js';

function generatePoints(startMs: number, count: number, intervalMs = 1000): DataPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: startMs + i * intervalMs,
    value: Math.sin(i / 100) * 1000 + 5000,
  }));
}

describe('downsamplePoints', () => {
  it('returns empty array for empty input', () => {
    expect(downsamplePoints([], 100)).toEqual([]);
  });

  it('returns all points when fewer than target', () => {
    const points = generatePoints(0, 50);
    const result = downsamplePoints(points, 100);
    expect(result).toHaveLength(50);
  });

  it('returns exactly target number of points when input is larger', () => {
    const points = generatePoints(0, 1000);
    const result = downsamplePoints(points, 100);
    expect(result).toHaveLength(100);
  });

  it('preserves first and last points', () => {
    const points = generatePoints(1000, 500);
    const result = downsamplePoints(points, 50);

    expect(result[0].time).toBe(1000);
    expect(result[result.length - 1].time).toBe(1000 + 499 * 1000);
  });

  it('returns points in sorted order', () => {
    const points = generatePoints(0, 1000);
    const result = downsamplePoints(points, 100);

    for (let i = 1; i < result.length; i++) {
      expect(result[i].time).toBeGreaterThan(result[i - 1].time);
    }
  });

  it('handles single point', () => {
    const points: DataPoint[] = [{ timestamp: 5000, value: 42 }];
    const result = downsamplePoints(points, 100);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ time: 5000, value: 42 });
  });

  it('handles two points', () => {
    const points: DataPoint[] = [
      { timestamp: 1000, value: 1 },
      { timestamp: 2000, value: 2 },
    ];
    const result = downsamplePoints(points, 100);
    expect(result).toHaveLength(2);
  });
});

describe('downsampleArrowBuffer', () => {
  it('round-trips through Arrow IPC and downsamples', () => {
    const points = generatePoints(0, 1000);
    const buffer = serializeToArrowIPC(points);

    const result = downsampleArrowBuffer(buffer, 100);
    expect(result).toHaveLength(100);
    expect(result[0].time).toBe(0);
  });

  it('preserves all points when target exceeds input', () => {
    const points = generatePoints(0, 50);
    const buffer = serializeToArrowIPC(points);

    const result = downsampleArrowBuffer(buffer, 100);
    expect(result).toHaveLength(50);
  });
});

describe('proportionalTargetPoints', () => {
  it('returns full target when chunk covers entire viewport', () => {
    const result = proportionalTargetPoints(0, 1000, 0, 1000, 3000);
    expect(result).toBe(3000);
  });

  it('returns proportional target for partial overlap', () => {
    // Chunk covers 50% of viewport
    const result = proportionalTargetPoints(0, 500, 0, 1000, 3000);
    expect(result).toBe(1500);
  });

  it('returns minimum of 2 points for tiny overlap', () => {
    const result = proportionalTargetPoints(0, 1, 0, 1000000, 3000);
    expect(result).toBe(2);
  });

  it('handles chunk extending beyond viewport', () => {
    // Chunk is 0-2000, viewport is 500-1500 → overlap is 1000/1000 = 100%
    const result = proportionalTargetPoints(0, 2000, 500, 1500, 3000);
    expect(result).toBe(3000);
  });

  it('handles zero-duration viewport', () => {
    const result = proportionalTargetPoints(0, 1000, 500, 500, 3000);
    expect(result).toBe(3000);
  });
});
