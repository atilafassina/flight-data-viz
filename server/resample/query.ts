import type { IndexStore } from './index-store.js';
import type { ChunkMeta } from './types.js';
import { downsampleArrowBuffer, proportionalTargetPoints } from './downsampler.js';
import type { DownsampledPoint } from './downsampler.js';
import { downloadFromVolume } from './volume-io.js';
import type { ChunkCache } from './chunk-cache.js';

export interface QueryRequest {
  entityId: string;
  parameters: string[];
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  targetPoints?: number;
}

export interface ParameterData {
  parameter: string;
  points: DownsampledPoint[];
}

export interface QueryResponse {
  entityId: string;
  data: ParameterData[];
}

/**
 * Stream resample query results as SSE events — one event per parameter's chunk batch.
 * Yields ParameterData objects that can be sent as SSE events.
 */
export async function* streamResampleQuery(
  request: QueryRequest,
  indexStore: IndexStore,
  defaultTargetPoints: number,
  chunkCache?: ChunkCache
): AsyncGenerator<ParameterData> {
  const { entityId, parameters, targetPoints = defaultTargetPoints } = request;
  const startTime = new Date(request.startTime);
  const endTime = new Date(request.endTime);

  const volumePath = process.env.DATABRICKS_VOLUME_FILES;
  if (!volumePath) {
    throw new Error('DATABRICKS_VOLUME_FILES is required for query');
  }

  const chunks = await indexStore.findChunks(entityId, parameters, startTime, endTime);

  if (chunks.length === 0) {
    for (const p of parameters) {
      yield { parameter: p, points: [] };
    }
    return;
  }

  // Group chunks by parameter
  const chunksByParam = new Map<string, ChunkMeta[]>();
  for (const chunk of chunks) {
    const existing = chunksByParam.get(chunk.parameter) ?? [];
    existing.push(chunk);
    chunksByParam.set(chunk.parameter, existing);
  }

  const viewportStart = startTime.getTime();
  const viewportEnd = endTime.getTime();

  for (const param of parameters) {
    const paramChunks = chunksByParam.get(param) ?? [];
    if (paramChunks.length === 0) {
      yield { parameter: param, points: [] };
      continue;
    }

    // Download and downsample all chunks for this parameter in parallel
    const chunkResults = await Promise.all(
      paramChunks.map(async (chunk) => {
        const fullPath = `${volumePath}${chunk.chunk_path}`;

        // Check cache first
        let buffer = chunkCache?.get(chunk.chunk_path);
        if (!buffer) {
          buffer = await downloadFromVolume(fullPath);
          chunkCache?.set(chunk.chunk_path, buffer);
        }

        const chunkTarget = proportionalTargetPoints(
          chunk.start_time.getTime(),
          chunk.end_time.getTime(),
          viewportStart,
          viewportEnd,
          targetPoints
        );

        return downsampleArrowBuffer(buffer, chunkTarget);
      })
    );

    const allPoints = chunkResults.flat().sort((a, b) => a.time - b.time);
    yield { parameter: param, points: allPoints };
  }
}

/**
 * Non-streaming version: collects all parameter data and returns as a single response.
 */
export async function executeResampleQuery(
  request: QueryRequest,
  indexStore: IndexStore,
  defaultTargetPoints: number,
  chunkCache?: ChunkCache
): Promise<QueryResponse> {
  const data: ParameterData[] = [];
  for await (const paramData of streamResampleQuery(request, indexStore, defaultTargetPoints, chunkCache)) {
    data.push(paramData);
  }
  return { entityId: request.entityId, data };
}

