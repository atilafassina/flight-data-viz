import { sql } from '@databricks/appkit';
import type { IndexStore } from './index-store.js';
import type { ResampleConfig, ChunkMeta } from './types.js';
import { chunkByTime, chunkPath } from './chunker.js';
import type { DataPoint } from './chunker.js';
import { chunkDedupKey } from './index-store.js';
import { uploadToVolume, getAuthHeaders } from './volume-io.js';
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
 * Minimal structural type for the analytics handle exposed by `appkit.analytics`.
 *
 * Only `query()` is consumed here. We pass `formatParameters` to switch the
 * underlying `executeStatement` call to `EXTERNAL_LINKS` + `JSON_ARRAY`, then
 * walk `result.external_links` and any `next_chunk_internal_link` ourselves.
 * This bypasses the 25 MiB INLINE cap that previously truncated long flights.
 */
export interface AnalyticsHandle {
  query(
    query: string,
    parameters?: Record<string, unknown>,
    formatParameters?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<unknown>;
}

interface FlightParameterRow {
  timestamp: string;
  value: number;
}

/**
 * Minimal shape we rely on from the SDK's `ResultData` when using
 * `EXTERNAL_LINKS` disposition. Other fields exist but we don't consume them.
 */
interface ExternalLinksResult {
  external_links?: Array<{
    external_link?: string;
    http_headers?: Record<string, string>;
    chunk_index?: number;
    row_count?: number;
  }>;
  next_chunk_internal_link?: string;
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
  analytics: AnalyticsHandle,
  userId: string,
  chunkCache?: ChunkCache
): AsyncGenerator<IngestProgress | IngestResult> {
  const volumePath = process.env.DATABRICKS_VOLUME_FILES;
  if (!volumePath) {
    throw new Error('DATABRICKS_VOLUME_FILES is required for ingest');
  }

  // Phase 1: Query SQL Warehouse via the analytics plugin.
  //
  // `analytics.query()` is a thin wrapper around `executeStatement` whose
  // defaults are INLINE + JSON_ARRAY (capped at ~25 MiB / ~131k rows for our
  // schema). To lift that cap for long flights, we pass `formatParameters` to
  // switch the disposition to EXTERNAL_LINKS + JSON_ARRAY, then walk
  // `external_links` and `next_chunk_internal_link` to download each chunk's
  // presigned URL and concat the rows ourselves.
  yield { phase: 'querying', progress: 0, detail: `Querying ${parameter} for ${entityId}` };

  const statement = `SELECT ${config.source.timeColumn}, value FROM main.default.flight_sensor_data WHERE ${config.source.entityColumn} = :entity_id AND parameter = :parameter ORDER BY ${config.source.timeColumn} ASC`;

  const initialResult = (await analytics.query(
    statement,
    {
      entity_id: sql.string(entityId),
      parameter: sql.string(parameter),
    },
    { disposition: 'EXTERNAL_LINKS', format: 'JSON_ARRAY' }
  )) as ExternalLinksResult;

  const rows: FlightParameterRow[] = [];
  let chunksFetched = 0;
  let current: ExternalLinksResult | null = initialResult;

  while (current) {
    const links = current.external_links ?? [];
    for (const link of links) {
      if (!link.external_link) continue;

      // The presigned URL contains temporary credentials — never log it.
      // `http_headers` carry decryption / auth headers that must be forwarded
      // verbatim; they may also be empty.
      const linkResp = await fetch(link.external_link, {
        headers: link.http_headers ?? {},
      });
      if (!linkResp.ok) {
        const body = await linkResp.text().catch(() => '');
        throw new Error(
          `Failed to download result chunk (${linkResp.status}): ${body.slice(0, 200)}`
        );
      }
      const chunkRows = (await linkResp.json()) as string[][];
      for (const row of chunkRows) {
        rows.push({ timestamp: row[0], value: Number(row[1]) });
      }

      chunksFetched++;
      yield {
        phase: 'querying',
        progress: 0.05 + Math.min(chunksFetched, 50) * 0.003,
        detail: `Fetched ${chunksFetched} result chunk${chunksFetched === 1 ? '' : 's'} (${rows.length} rows)`,
      };
    }

    if (!current.next_chunk_internal_link) break;
    current = await fetchNextChunk(current.next_chunk_internal_link);
  }

  if (rows.length === 0) {
    yield { phase: 'done', progress: 1, detail: 'No data found' };
    return;
  }

  yield { phase: 'querying', progress: 0.2, detail: `Got ${rows.length} rows` };

  // Phase 2: Chunk by time
  yield { phase: 'chunking', progress: 0.3, detail: `Chunking ${rows.length} points` };

  const points: DataPoint[] = rows.map((row) => ({
    timestamp: new Date(row.timestamp).getTime(),
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

/**
 * Fetch a follow-up chunk via the workspace-relative `next_chunk_internal_link`.
 *
 * The path is opaque per the SDK contract — join it with the workspace host and
 * forward the workspace auth headers (cached for 5 min by `getAuthHeaders`).
 * The response body is another `ResultData` with its own `external_links` and
 * possibly its own `next_chunk_internal_link`, so the caller loops.
 */
async function fetchNextChunk(internalLink: string): Promise<ExternalLinksResult> {
  const { host, headers } = await getAuthHeaders();
  const url = `${host}${internalLink}`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(
      `Failed to fetch next result chunk (${resp.status}): ${body.slice(0, 200)}`
    );
  }
  return (await resp.json()) as ExternalLinksResult;
}
