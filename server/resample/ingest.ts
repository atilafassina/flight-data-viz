import { WorkspaceClient } from '@databricks/sdk-experimental';
import type { IndexStore } from './index-store.js';
import type { ResampleConfig, ChunkMeta } from './types.js';
import { chunkByTime, chunkPath } from './chunker.js';
import type { DataPoint } from './chunker.js';
import { chunkDedupKey } from './index-store.js';
import { uploadToVolume } from './volume-io.js';
import type { ChunkCache } from './chunk-cache.js';

export interface IngestProgress {
  phase: 'querying' | 'chunking' | 'uploading' | 'indexing' | 'done';
  progress: number; // 0-1
  detail?: string;
}

export interface IngestResult {
  entityId: string;
  parameter: string;
  chunksCreated: number;
  chunksSkipped: number;
  totalPoints: number;
}

/**
 * Run the ingest pipeline for a single entity + parameter:
 * SQL query → chunk → Arrow IPC → UC Volume → Lakebase index
 *
 * Yields progress events for SSE streaming.
 */
export async function* ingestParameter(
  entityId: string,
  parameter: string,
  config: ResampleConfig,
  indexStore: IndexStore,
  userId: string,
  chunkCache?: ChunkCache
): AsyncGenerator<IngestProgress | IngestResult> {
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) {
    throw new Error('DATABRICKS_WAREHOUSE_ID is required for ingest');
  }

  const volumePath = process.env.DATABRICKS_VOLUME_FILES;
  if (!volumePath) {
    throw new Error('DATABRICKS_VOLUME_FILES is required for ingest');
  }

  const client = new WorkspaceClient({});

  // Phase 1: Query SQL Warehouse
  yield { phase: 'querying', progress: 0, detail: `Querying ${parameter} for ${entityId}` };

  const response = await client.statementExecution.executeStatement({
    warehouse_id: warehouseId,
    statement: `SELECT ${config.source.timeColumn}, value FROM main.default.flight_sensor_data WHERE ${config.source.entityColumn} = :entity_id AND parameter = :parameter ORDER BY ${config.source.timeColumn} ASC`,
    parameters: [
      { name: 'entity_id', value: entityId },
      { name: 'parameter', value: parameter },
    ],
    wait_timeout: '50s',
    disposition: 'INLINE',
    format: 'JSON_ARRAY',
  });

  const rows = extractRows(response);
  if (rows.length === 0) {
    yield { phase: 'done', progress: 1, detail: 'No data found' };
    return;
  }

  yield { phase: 'querying', progress: 0.2, detail: `Got ${rows.length} rows` };

  // Phase 2: Chunk by time
  yield { phase: 'chunking', progress: 0.3, detail: `Chunking ${rows.length} points` };

  const points: DataPoint[] = rows.map((row) => ({
    timestamp: new Date(row.timestamp as string).getTime(),
    value: Number(row.value),
  }));

  const chunks = chunkByTime(points, config.chunks.duration);
  yield { phase: 'chunking', progress: 0.4, detail: `Created ${chunks.length} chunks` };

  // Phase 3: Dedup check
  const timeRanges = chunks.map((c) => ({
    startTime: c.startTime,
    endTime: c.endTime,
  }));
  const existing = await indexStore.findExistingChunks(entityId, parameter, timeRanges);

  let chunksSkipped = 0;
  let chunksCreated = 0;

  // Phase 4: Upload new chunks to UC Volume in parallel (concurrency 8)
  const newChunks = chunks.filter((chunk) => {
    const key = chunkDedupKey(chunk.startTime, chunk.endTime);
    if (existing.has(key)) {
      chunksSkipped++;
      return false;
    }
    return true;
  });

  const CONCURRENCY = 8;
  const newChunkMetas: Omit<ChunkMeta, 'created_at'>[] = [];

  // Upload chunks in parallel batches, yielding per-chunk progress
  for (let batch = 0; batch < newChunks.length; batch += CONCURRENCY) {
    const slice = newChunks.slice(batch, batch + CONCURRENCY);
    const settled: Array<{ chunk: typeof slice[number]; path: string }> = [];

    await Promise.all(
      slice.map(async (chunk, i) => {
        const path = chunkPath(entityId, parameter, chunk.startTime, chunk.endTime);
        const fullPath = `${volumePath}${path}`;
        await uploadToVolume(fullPath, chunk.buffer);
        chunkCache?.set(path, chunk.buffer);
        settled.push({ chunk, path });

        // We can't yield from inside Promise.all, but we track per-chunk for the batch summary
        void i; // used for closure
      })
    );

    // Yield one event per completed chunk in this batch (post-hoc but granular)
    for (const { chunk, path } of settled) {
      chunksCreated++;

      newChunkMetas.push({
        entity_id: entityId,
        parameter,
        start_time: chunk.startTime,
        end_time: chunk.endTime,
        chunk_path: path,
        point_count: chunk.pointCount,
        created_by: userId,
        expires_at: new Date(Date.now() + config.ttl * 1000),
      });

      yield {
        phase: 'uploading' as const,
        progress: 0.5 + (chunksCreated / newChunks.length) * 0.4,
        detail: `Uploaded ${chunksCreated}/${newChunks.length} chunks`,
      };
    }
  }

  // Phase 5: Insert metadata into Lakebase
  if (newChunkMetas.length > 0) {
    yield { phase: 'indexing', progress: 0.9, detail: `Indexing ${newChunkMetas.length} chunks` };
    await indexStore.insertChunks(newChunkMetas);
  }

  yield { phase: 'done', progress: 1 };

  const totalPoints = chunks.reduce((sum, c) => sum + c.pointCount, 0);
  yield {
    entityId,
    parameter,
    chunksCreated,
    chunksSkipped,
    totalPoints,
  } as IngestResult;
}

/** Extract row data from a SQL Statement Execution API response */
function extractRows(response: unknown): Record<string, unknown>[] {
  const resp = response as {
    result?: {
      data_array?: unknown[][];
    };
    manifest?: {
      schema?: {
        columns?: Array<{ name: string; position: number }>;
      };
    };
    status?: { state?: string; error?: { message?: string } };
  };

  if (resp.status?.state !== 'SUCCEEDED') {
    const detail = resp.status?.error?.message ?? resp.status?.state ?? 'unknown';
    throw new Error(`SQL query failed: ${detail}`);
  }

  const columns = resp.manifest?.schema?.columns ?? [];
  const dataArray = resp.result?.data_array ?? [];

  return dataArray.map((row) => {
    const obj: Record<string, unknown> = {};
    for (const col of columns) {
      obj[col.name] = row[col.position];
    }
    return obj;
  });
}
