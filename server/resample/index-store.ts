import type { Pool } from 'pg';
import type { ChunkMeta, EntitySummary, ResampleIndex } from './types.js';

export type QueryablePool = Pick<Pool, 'query'>;

export class IndexStore {
  constructor(
    private pool: QueryablePool,
    private indexConfig: ResampleIndex,
    private ttlSeconds: number
  ) {}

  get schema() {
    return this.indexConfig.schema;
  }

  get table() {
    return `${this.indexConfig.schema}.${this.indexConfig.tableName}`;
  }

  /** Create the schema and index table if they don't exist */
  async createTable(): Promise<void> {
    const { rows } = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2
       ) AS exists`,
      [this.indexConfig.schema, this.indexConfig.tableName]
    );
    if (rows[0]?.exists) return;

    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        id SERIAL PRIMARY KEY,
        entity_id VARCHAR(255) NOT NULL,
        parameter VARCHAR(255) NOT NULL,
        start_time TIMESTAMPTZ NOT NULL,
        end_time TIMESTAMPTZ NOT NULL,
        chunk_path TEXT NOT NULL,
        point_count INTEGER NOT NULL,
        created_by VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        UNIQUE (entity_id, parameter, start_time, end_time)
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chunks_entity_param_time
      ON ${this.table} (entity_id, parameter, start_time, end_time)
    `);
  }

  /** Insert chunk metadata rows, skipping duplicates */
  async insertChunks(chunks: Omit<ChunkMeta, 'created_at'>[]): Promise<number> {
    if (chunks.length === 0) return 0;

    const values: unknown[] = [];
    const placeholders: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const offset = i * 7;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`
      );
      values.push(
        c.entity_id,
        c.parameter,
        c.start_time,
        c.end_time,
        c.chunk_path,
        c.point_count,
        c.created_by,
      );
    }

    // expires_at is computed from ttl
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);

    const result = await this.pool.query(
      `INSERT INTO ${this.table}
        (entity_id, parameter, start_time, end_time, chunk_path, point_count, created_by, expires_at)
       VALUES ${placeholders.map((p) => p.replace(/\)$/, `, '${expiresAt.toISOString()}')`)).join(', ')}
       ON CONFLICT (entity_id, parameter, start_time, end_time) DO UPDATE SET
         chunk_path = EXCLUDED.chunk_path,
         point_count = EXCLUDED.point_count,
         created_by = EXCLUDED.created_by,
         created_at = NOW(),
         expires_at = EXCLUDED.expires_at`,
      values
    );

    return result.rowCount ?? 0;
  }

  /** Find chunks overlapping a time range for given entity and parameters */
  async findChunks(
    entityId: string,
    parameters: string[],
    startTime: Date,
    endTime: Date
  ): Promise<ChunkMeta[]> {
    if (parameters.length === 0) return [];

    const paramPlaceholders = parameters.map((_, i) => `$${i + 4}`).join(', ');

    const result = await this.pool.query<ChunkMeta>(
      `SELECT entity_id, parameter, start_time, end_time, chunk_path, point_count, created_by, created_at, expires_at
       FROM ${this.table}
       WHERE entity_id = $1
         AND start_time <= $2
         AND end_time >= $3
         AND parameter IN (${paramPlaceholders})
         AND expires_at > NOW()
       ORDER BY parameter, start_time`,
      [entityId, endTime, startTime, ...parameters]
    );

    return result.rows;
  }

  /** List all cached entities with summary metadata */
  async listEntities(): Promise<EntitySummary[]> {
    const result = await this.pool.query<EntitySummary>(
      `SELECT
         entity_id AS "entityId",
         COUNT(DISTINCT parameter)::int AS parameters,
         MIN(start_time) AS "startTime",
         MAX(end_time) AS "endTime",
         SUM(point_count)::int AS "totalPoints",
         MAX(created_at) AS "cachedAt"
       FROM ${this.table}
       WHERE expires_at > NOW()
       GROUP BY entity_id
       ORDER BY MAX(created_at) DESC`
    );

    return result.rows;
  }

  /** List available parameters for a specific entity */
  async listParameters(entityId: string): Promise<string[]> {
    const result = await this.pool.query<{ parameter: string }>(
      `SELECT DISTINCT parameter
       FROM ${this.table}
       WHERE entity_id = $1 AND expires_at > NOW()
       ORDER BY parameter`,
      [entityId]
    );

    return result.rows.map((r) => r.parameter);
  }

  /** Delete all chunks for an entity (both metadata and returns paths for file cleanup) */
  async deleteEntity(entityId: string): Promise<string[]> {
    const result = await this.pool.query<{ chunk_path: string }>(
      `DELETE FROM ${this.table}
       WHERE entity_id = $1
       RETURNING chunk_path`,
      [entityId]
    );

    return result.rows.map((r) => r.chunk_path);
  }

  /** Delete expired chunks and return their paths for file cleanup */
  async deleteExpired(): Promise<string[]> {
    const result = await this.pool.query<{ chunk_path: string }>(
      `DELETE FROM ${this.table}
       WHERE expires_at <= NOW()
       RETURNING chunk_path`
    );

    return result.rows.map((r) => r.chunk_path);
  }

  /** Check which chunks already exist (for dedup during ingest) */
  async findExistingChunks(
    entityId: string,
    parameter: string,
    timeRanges: Array<{ startTime: Date; endTime: Date }>
  ): Promise<Set<string>> {
    if (timeRanges.length === 0) return new Set();

    const conditions: string[] = [];
    const values: unknown[] = [entityId, parameter];
    let paramIndex = 3;

    for (const range of timeRanges) {
      conditions.push(`(start_time = $${paramIndex} AND end_time = $${paramIndex + 1})`);
      values.push(range.startTime, range.endTime);
      paramIndex += 2;
    }

    const result = await this.pool.query<{ start_time: Date; end_time: Date }>(
      `SELECT start_time, end_time
       FROM ${this.table}
       WHERE entity_id = $1 AND parameter = $2
         AND expires_at > NOW()
         AND (${conditions.join(' OR ')})`,
      values
    );

    return new Set(
      result.rows.map((r) => `${r.start_time.toISOString()}_${r.end_time.toISOString()}`)
    );
  }
}

/** Build a dedup key from start/end timestamps */
export function chunkDedupKey(startTime: Date, endTime: Date): string {
  return `${startTime.toISOString()}_${endTime.toISOString()}`;
}
