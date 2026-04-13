import { tableFromArrays, tableToIPC, tableFromIPC } from 'apache-arrow';
import type { Table } from 'apache-arrow';

/** A single timestamped data point */
export interface DataPoint {
  timestamp: number; // Unix epoch milliseconds
  value: number;
}

/** A time-partitioned chunk with its Arrow IPC buffer */
export interface Chunk {
  startTime: Date;
  endTime: Date;
  pointCount: number;
  buffer: Uint8Array;
}

/**
 * Partition timestamped data points into fixed-duration time chunks.
 * Each chunk contains all points within [chunkStart, chunkStart + duration).
 * Points must be sorted by timestamp ascending.
 *
 * @param points - Sorted array of timestamped data points
 * @param durationSeconds - Chunk duration in seconds
 * @returns Array of chunks with Arrow IPC buffers
 */
export function chunkByTime(points: DataPoint[], durationSeconds: number): Chunk[] {
  if (points.length === 0) return [];

  const durationMs = durationSeconds * 1000;
  const chunks: Chunk[] = [];

  // Find the starting boundary aligned to chunk duration
  const firstTs = points[0].timestamp;
  let chunkStart = firstTs - (firstTs % durationMs);

  let i = 0;
  while (i < points.length) {
    const chunkEnd = chunkStart + durationMs;
    const chunkPoints: DataPoint[] = [];

    // Collect all points in [chunkStart, chunkEnd)
    while (i < points.length && points[i].timestamp < chunkEnd) {
      chunkPoints.push(points[i]);
      i++;
    }

    if (chunkPoints.length > 0) {
      const buffer = serializeToArrowIPC(chunkPoints);
      chunks.push({
        startTime: new Date(chunkStart),
        endTime: new Date(chunkEnd),
        pointCount: chunkPoints.length,
        buffer,
      });
    }

    chunkStart = chunkEnd;
  }

  return chunks;
}

/** Serialize data points to Arrow IPC format */
export function serializeToArrowIPC(points: DataPoint[]): Uint8Array {
  const timestamps = new Float64Array(points.length);
  const values = new Float64Array(points.length);

  for (let i = 0; i < points.length; i++) {
    timestamps[i] = points[i].timestamp;
    values[i] = points[i].value;
  }

  const table = tableFromArrays({ timestamp: timestamps, value: values });
  return tableToIPC(table);
}

/** Deserialize Arrow IPC buffer back to data points */
export function deserializeFromArrowIPC(buffer: Uint8Array): DataPoint[] {
  const table: Table = tableFromIPC(buffer);
  const timestamps = table.getChild('timestamp');
  const values = table.getChild('value');

  if (!timestamps || !values) {
    throw new Error('Arrow table missing expected columns: timestamp, value');
  }

  const points: DataPoint[] = [];
  for (let i = 0; i < table.numRows; i++) {
    points.push({
      timestamp: timestamps.get(i) as number,
      value: values.get(i) as number,
    });
  }

  return points;
}

/** Build the UC Volume path for a chunk file */
export function chunkPath(
  entityId: string,
  parameter: string,
  startTime: Date,
  endTime: Date
): string {
  const startSec = Math.floor(startTime.getTime() / 1000);
  const endSec = Math.floor(endTime.getTime() / 1000);
  return `/${entityId}/${parameter}/${startSec}-${endSec}.arrow`;
}
