import { LTTB } from 'downsample';
import { deserializeFromArrowIPC } from './chunker.js';
import type { DataPoint } from './chunker.js';

/** Downsampled time-series point for client consumption */
export interface DownsampledPoint {
  time: number; // Unix epoch milliseconds
  value: number;
}

/**
 * Downsample an array of data points using LTTB algorithm.
 * Returns at most `targetPoints` points while preserving visual shape.
 *
 * If input has fewer points than target, returns all points unchanged.
 */
export function downsamplePoints(points: DataPoint[], targetPoints: number): DownsampledPoint[] {
  if (points.length === 0) return [];
  if (points.length <= targetPoints) {
    return points.map((p) => ({ time: p.timestamp, value: p.value }));
  }

  const tuples: [number, number][] = points.map((p) => [p.timestamp, p.value]);
  const result = LTTB(tuples, targetPoints) as [number, number][];

  return result.map(([time, value]) => ({ time, value }));
}

/**
 * Downsample an Arrow IPC buffer using LTTB.
 * Deserializes the buffer, applies LTTB, returns downsampled points.
 */
export function downsampleArrowBuffer(
  buffer: Uint8Array,
  targetPoints: number
): DownsampledPoint[] {
  const points = deserializeFromArrowIPC(buffer);
  return downsamplePoints(points, targetPoints);
}

/**
 * Calculate proportional target points for a chunk based on its share of the viewport.
 * A chunk that covers 50% of the viewport gets 50% of the total target points.
 */
export function proportionalTargetPoints(
  chunkStart: number,
  chunkEnd: number,
  viewportStart: number,
  viewportEnd: number,
  totalTargetPoints: number
): number {
  const viewportDuration = viewportEnd - viewportStart;
  if (viewportDuration <= 0) return totalTargetPoints;

  // Clamp chunk to viewport bounds
  const overlapStart = Math.max(chunkStart, viewportStart);
  const overlapEnd = Math.min(chunkEnd, viewportEnd);
  const overlapDuration = Math.max(0, overlapEnd - overlapStart);

  const proportion = overlapDuration / viewportDuration;
  return Math.max(2, Math.round(totalTargetPoints * proportion));
}
