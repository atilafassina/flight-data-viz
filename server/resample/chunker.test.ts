import { describe, it, expect } from 'vitest';
import {
  chunkByTime,
  serializeToArrowIPC,
  deserializeFromArrowIPC,
  chunkPath,
} from './chunker.js';
import type { DataPoint } from './chunker.js';

/** Generate synthetic data points at 1Hz for a time range */
function generatePoints(startMs: number, count: number, intervalMs = 1000): DataPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: startMs + i * intervalMs,
    value: Math.sin(i / 100) * 1000 + 5000,
  }));
}

describe('chunkByTime', () => {
  it('returns empty array for empty input', () => {
    expect(chunkByTime([], 1800)).toEqual([]);
  });

  it('puts a single point in one chunk', () => {
    const points = [{ timestamp: 1000000, value: 42 }];
    const chunks = chunkByTime(points, 1800);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].pointCount).toBe(1);
    expect(chunks[0].startTime.getTime()).toBeLessThanOrEqual(1000000);
    expect(chunks[0].endTime.getTime()).toBeGreaterThan(1000000);
  });

  it('creates correct number of chunks for 1 hour at 30-min chunks', () => {
    // 3600 points at 1Hz = 1 hour, 30-min chunks = 2 chunks
    const startMs = new Date('2026-01-01T00:00:00Z').getTime();
    const points = generatePoints(startMs, 3600);
    const chunks = chunkByTime(points, 1800);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].pointCount).toBe(1800);
    expect(chunks[1].pointCount).toBe(1800);
  });

  it('handles data not aligned to chunk boundaries', () => {
    // Start at 15 minutes into a 30-min window
    const startMs = new Date('2026-01-01T00:15:00Z').getTime();
    const points = generatePoints(startMs, 2700); // 45 minutes of data

    const chunks = chunkByTime(points, 1800); // 30-min chunks

    // First chunk: 00:00-00:30, contains 15 min of data (900 points)
    // Second chunk: 00:30-01:00, contains 30 min of data (1800 points)
    expect(chunks).toHaveLength(2);
    expect(chunks[0].pointCount).toBe(900); // 00:15 to 00:30
    expect(chunks[1].pointCount).toBe(1800); // 00:30 to 01:00
  });

  it('creates single chunk when all data fits', () => {
    const startMs = new Date('2026-01-01T00:00:00Z').getTime();
    const points = generatePoints(startMs, 100);
    const chunks = chunkByTime(points, 1800);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].pointCount).toBe(100);
  });

  it('handles large gap between points (skips empty chunks)', () => {
    const startMs = new Date('2026-01-01T00:00:00Z').getTime();
    const gapMs = 3600 * 1000; // 1 hour gap

    const points: DataPoint[] = [
      { timestamp: startMs, value: 1 },
      { timestamp: startMs + 1000, value: 2 },
      // gap of 1 hour
      { timestamp: startMs + gapMs, value: 3 },
      { timestamp: startMs + gapMs + 1000, value: 4 },
    ];

    const chunks = chunkByTime(points, 1800); // 30-min chunks

    // First chunk has 2 points, then gap, then another chunk with 2 points
    expect(chunks).toHaveLength(2);
    expect(chunks[0].pointCount).toBe(2);
    expect(chunks[1].pointCount).toBe(2);
  });

  it('aligns chunk boundaries to duration from first point', () => {
    const startMs = new Date('2026-01-01T00:00:00Z').getTime();
    const points = generatePoints(startMs, 1800);
    const chunks = chunkByTime(points, 1800);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].startTime.getTime()).toBe(startMs);
    expect(chunks[0].endTime.getTime()).toBe(startMs + 1800 * 1000);
  });

  it('produces valid Arrow IPC buffers in each chunk', () => {
    const startMs = new Date('2026-01-01T00:00:00Z').getTime();
    const points = generatePoints(startMs, 100);
    const chunks = chunkByTime(points, 1800);

    const recovered = deserializeFromArrowIPC(chunks[0].buffer);
    expect(recovered).toHaveLength(100);
    expect(recovered[0].timestamp).toBe(startMs);
    expect(recovered[99].timestamp).toBe(startMs + 99 * 1000);
  });

  it('handles high-frequency data (20Hz) correctly', () => {
    const startMs = new Date('2026-01-01T00:00:00Z').getTime();
    // 20Hz for 30 min = 36,000 points
    const points = generatePoints(startMs, 36000, 50);
    const chunks = chunkByTime(points, 1800);

    expect(chunks).toHaveLength(1); // All within one 30-min chunk
    expect(chunks[0].pointCount).toBe(36000);
  });
});

describe('Arrow IPC serialization', () => {
  it('round-trips data points through Arrow IPC', () => {
    const points: DataPoint[] = [
      { timestamp: 1000, value: 1.5 },
      { timestamp: 2000, value: 2.5 },
      { timestamp: 3000, value: 3.5 },
    ];

    const buffer = serializeToArrowIPC(points);
    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(buffer.length).toBeGreaterThan(0);

    const recovered = deserializeFromArrowIPC(buffer);
    expect(recovered).toHaveLength(3);
    expect(recovered[0]).toEqual({ timestamp: 1000, value: 1.5 });
    expect(recovered[1]).toEqual({ timestamp: 2000, value: 2.5 });
    expect(recovered[2]).toEqual({ timestamp: 3000, value: 3.5 });
  });

  it('handles large datasets efficiently', () => {
    const points = generatePoints(0, 50000);
    const buffer = serializeToArrowIPC(points);

    // Arrow IPC should be much more compact than JSON
    const jsonSize = JSON.stringify(points).length;
    expect(buffer.length).toBeLessThan(jsonSize);

    const recovered = deserializeFromArrowIPC(buffer);
    expect(recovered).toHaveLength(50000);
  });

  it('preserves numeric precision', () => {
    const points: DataPoint[] = [
      { timestamp: 1704067200000, value: 35782.123456789 },
    ];

    const recovered = deserializeFromArrowIPC(serializeToArrowIPC(points));
    expect(recovered[0].timestamp).toBe(1704067200000);
    expect(recovered[0].value).toBeCloseTo(35782.123456789, 6);
  });
});

describe('chunkPath', () => {
  it('builds correct UC Volume path', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-01-01T00:30:00Z');

    expect(chunkPath('flight-1', 'altitude', start, end)).toBe(
      '/flight-1/altitude/1767225600-1767227400.arrow'
    );
  });

  it('handles entity IDs with special characters', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-01-01T00:30:00Z');

    const path = chunkPath('FL-2026-001', 'oil_pressure', start, end);
    expect(path).toContain('FL-2026-001');
    expect(path).toContain('oil_pressure');
    expect(path.endsWith('.arrow')).toBe(true);
  });
});
