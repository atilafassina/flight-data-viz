import { z } from 'zod';

export const resampleSourceSchema = z.object({
  /** Analytics query key (filename in config/queries/ without .sql extension) */
  queryKey: z.string(),
  /** Column name containing the timestamp */
  timeColumn: z.string(),
  /** Column names containing the values to resample */
  valueColumns: z.array(z.string()).min(1),
  /** Column name identifying the entity (e.g. flight_id) */
  entityColumn: z.string(),
});

export const resampleChunksSchema = z.object({
  /** Chunk duration in seconds (default: 1800 = 30 minutes) */
  duration: z.number().positive().default(1800),
  /** Output format for cached chunks */
  format: z.literal('arrow').default('arrow'),
});

export const resampleDownsampleSchema = z.object({
  /** Downsampling algorithm */
  algorithm: z.enum(['lttb', 'ltob', 'ltd']).default('lttb'),
  /** Default target points per parameter per request */
  defaultTargetPoints: z.number().positive().default(3000),
});

export const resampleIndexSchema = z.object({
  /** Lakebase schema name for the index table */
  schema: z.string().default('resample'),
  /** Index table name */
  tableName: z.string().default('resample_chunks'),
});

export const resampleConfigSchema = z.object({
  source: resampleSourceSchema,
  chunks: resampleChunksSchema.optional(),
  downsample: resampleDownsampleSchema.optional(),
  index: resampleIndexSchema.optional(),
  /** Cache TTL in seconds (default: 86400 = 24 hours) */
  ttl: z.number().positive().default(86400),
});

export type ResampleConfigInput = z.input<typeof resampleConfigSchema>;
export type ResampleSource = z.infer<typeof resampleSourceSchema>;
export type ResampleChunks = z.infer<typeof resampleChunksSchema>;
export type ResampleDownsample = z.infer<typeof resampleDownsampleSchema>;
export type ResampleIndex = z.infer<typeof resampleIndexSchema>;

/** Fully resolved config with all defaults applied */
export interface ResampleConfig {
  source: ResampleSource;
  chunks: ResampleChunks;
  downsample: ResampleDownsample;
  index: ResampleIndex;
  ttl: number;
}

const CHUNK_DEFAULTS: ResampleChunks = { duration: 1800, format: 'arrow' };
const DOWNSAMPLE_DEFAULTS: ResampleDownsample = { algorithm: 'lttb', defaultTargetPoints: 3000 };
const INDEX_DEFAULTS: ResampleIndex = { schema: 'resample', tableName: 'resample_chunks' };

/** Parse and apply defaults to raw config input */
export function resolveConfig(input: ResampleConfigInput): ResampleConfig {
  const parsed = resampleConfigSchema.parse(input);
  return {
    source: parsed.source,
    chunks: { ...CHUNK_DEFAULTS, ...parsed.chunks },
    downsample: { ...DOWNSAMPLE_DEFAULTS, ...parsed.downsample },
    index: { ...INDEX_DEFAULTS, ...parsed.index },
    ttl: parsed.ttl,
  };
}

/** Metadata row stored in Lakebase for each cached chunk */
export interface ChunkMeta {
  entity_id: string;
  parameter: string;
  start_time: Date;
  end_time: Date;
  chunk_path: string;
  point_count: number;
  created_by: string;
  created_at: Date;
  expires_at: Date;
}

/** Entity summary returned by GET /entities */
export interface EntitySummary {
  entityId: string;
  parameters: number;
  startTime: Date;
  endTime: Date;
  totalPoints: number;
  cachedAt: Date;
}
