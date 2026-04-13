import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IndexStore, chunkDedupKey } from './index-store.js';
import type { Pool, QueryResult } from 'pg';

function createMockPool(queryFn?: (text: string, values?: unknown[]) => QueryResult) {
  const defaultQueryFn = () => ({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });
  return {
    query: vi.fn().mockImplementation(queryFn ?? defaultQueryFn),
    end: vi.fn(),
  } as unknown as Pool;
}

/** Extract mock calls from the pool.query mock */
function getMockCalls(pool: Pool): [string, unknown[]?][] {
  return vi.mocked(pool.query).mock.calls as unknown as [string, unknown[]?][];
}

const INDEX_CONFIG = { schema: 'resample', tableName: 'resample_chunks' };
const TTL_SECONDS = 86400;

describe('IndexStore', () => {
  let pool: Pool;
  let store: IndexStore;

  beforeEach(() => {
    pool = createMockPool();
    store = new IndexStore(pool, INDEX_CONFIG, TTL_SECONDS);
  });

  describe('schema and table', () => {
    it('returns correct schema name', () => {
      expect(store.schema).toBe('resample');
    });

    it('returns fully qualified table name', () => {
      expect(store.table).toBe('resample.resample_chunks');
    });
  });

  describe('createTable', () => {
    it('creates schema and table with correct SQL', async () => {
      await store.createTable();
      const calls = getMockCalls(pool);

      expect(calls).toHaveLength(3);
      expect(calls[0][0]).toContain('CREATE SCHEMA IF NOT EXISTS resample');
      expect(calls[1][0]).toContain('CREATE TABLE IF NOT EXISTS resample.resample_chunks');
      expect(calls[1][0]).toContain('entity_id VARCHAR(255)');
      expect(calls[1][0]).toContain('UNIQUE (entity_id, parameter, start_time, end_time)');
      expect(calls[2][0]).toContain('CREATE INDEX IF NOT EXISTS');
    });
  });

  describe('insertChunks', () => {
    it('returns 0 for empty array', async () => {
      const result = await store.insertChunks([]);
      expect(result).toBe(0);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('builds correct INSERT with ON CONFLICT DO NOTHING', async () => {
      const chunks = [
        {
          entity_id: 'flight-1',
          parameter: 'altitude',
          start_time: new Date('2026-01-01T00:00:00Z'),
          end_time: new Date('2026-01-01T00:30:00Z'),
          chunk_path: '/flight-1/altitude/0-1800.arrow',
          point_count: 1800,
          created_by: 'user@test.com',
          expires_at: new Date('2026-01-02T00:00:00Z'),
        },
      ];

      await store.insertChunks(chunks);
      const calls = getMockCalls(pool);

      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toContain('INSERT INTO resample.resample_chunks');
      expect(calls[0][0]).toContain('ON CONFLICT');
      expect(calls[0][0]).toContain('DO NOTHING');
      expect(calls[0][1]).toContain('flight-1');
      expect(calls[0][1]).toContain('altitude');
    });

    it('batches multiple chunks in one INSERT', async () => {
      const chunks = [
        {
          entity_id: 'flight-1',
          parameter: 'altitude',
          start_time: new Date('2026-01-01T00:00:00Z'),
          end_time: new Date('2026-01-01T00:30:00Z'),
          chunk_path: '/flight-1/altitude/0-1800.arrow',
          point_count: 1800,
          created_by: 'user@test.com',
          expires_at: new Date('2026-01-02T00:00:00Z'),
        },
        {
          entity_id: 'flight-1',
          parameter: 'speed',
          start_time: new Date('2026-01-01T00:00:00Z'),
          end_time: new Date('2026-01-01T00:30:00Z'),
          chunk_path: '/flight-1/speed/0-1800.arrow',
          point_count: 1800,
          created_by: 'user@test.com',
          expires_at: new Date('2026-01-02T00:00:00Z'),
        },
      ];

      await store.insertChunks(chunks);
      const calls = getMockCalls(pool);

      // Single INSERT with multiple value sets
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toHaveLength(14); // 7 params per chunk * 2 chunks
    });
  });

  describe('findChunks', () => {
    it('returns empty array for empty parameters', async () => {
      const result = await store.findChunks('flight-1', [], new Date(), new Date());
      expect(result).toEqual([]);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('builds correct query with time range and parameter filter', async () => {
      const start = new Date('2026-01-01T01:00:00Z');
      const end = new Date('2026-01-01T03:00:00Z');

      await store.findChunks('flight-1', ['altitude', 'speed'], start, end);
      const calls = getMockCalls(pool);

      expect(calls).toHaveLength(1);
      const sql = calls[0][0];
      const values = calls[0][1];
      expect(sql).toContain('entity_id = $1');
      expect(sql).toContain('start_time <= $2'); // chunks that start before viewport end
      expect(sql).toContain('end_time >= $3'); // chunks that end after viewport start
      expect(sql).toContain('IN ($4, $5)');
      expect(sql).toContain('expires_at > NOW()');
      expect(values).toEqual(['flight-1', end, start, 'altitude', 'speed']);
    });

    it('orders results by parameter then start_time', async () => {
      await store.findChunks('flight-1', ['altitude'], new Date(), new Date());
      const sql = getMockCalls(pool)[0][0];
      expect(sql).toContain('ORDER BY parameter, start_time');
    });
  });

  describe('listEntities', () => {
    it('groups by entity_id and filters expired', async () => {
      await store.listEntities();
      const sql = getMockCalls(pool)[0][0];

      expect(sql).toContain('GROUP BY entity_id');
      expect(sql).toContain('expires_at > NOW()');
      expect(sql).toContain('COUNT(DISTINCT parameter)');
      expect(sql).toContain('SUM(point_count)');
    });
  });

  describe('listParameters', () => {
    it('queries distinct parameters for entity', async () => {
      await store.listParameters('flight-1');
      const calls = getMockCalls(pool);

      expect(calls[0][0]).toContain('DISTINCT parameter');
      expect(calls[0][0]).toContain('entity_id = $1');
      expect(calls[0][1]).toEqual(['flight-1']);
    });

    it('returns parameter names from rows', async () => {
      pool = createMockPool(() => ({
        rows: [{ parameter: 'altitude' }, { parameter: 'speed' }],
        rowCount: 2,
        command: 'SELECT',
        oid: 0,
        fields: [],
      }));
      store = new IndexStore(pool, INDEX_CONFIG, TTL_SECONDS);

      const result = await store.listParameters('flight-1');
      expect(result).toEqual(['altitude', 'speed']);
    });
  });

  describe('deleteEntity', () => {
    it('deletes by entity_id and returns chunk paths', async () => {
      pool = createMockPool(() => ({
        rows: [{ chunk_path: '/f1/alt/0-1800.arrow' }, { chunk_path: '/f1/alt/1800-3600.arrow' }],
        rowCount: 2,
        command: 'DELETE',
        oid: 0,
        fields: [],
      }));
      store = new IndexStore(pool, INDEX_CONFIG, TTL_SECONDS);

      const paths = await store.deleteEntity('flight-1');
      const sql = getMockCalls(pool)[0][0];

      expect(sql).toContain('DELETE FROM resample.resample_chunks');
      expect(sql).toContain('entity_id = $1');
      expect(sql).toContain('RETURNING chunk_path');
      expect(paths).toEqual(['/f1/alt/0-1800.arrow', '/f1/alt/1800-3600.arrow']);
    });
  });

  describe('deleteExpired', () => {
    it('deletes rows where expires_at <= NOW()', async () => {
      await store.deleteExpired();
      const sql = getMockCalls(pool)[0][0];

      expect(sql).toContain('DELETE FROM resample.resample_chunks');
      expect(sql).toContain('expires_at <= NOW()');
      expect(sql).toContain('RETURNING chunk_path');
    });
  });

  describe('findExistingChunks', () => {
    it('returns empty set for empty ranges', async () => {
      const result = await store.findExistingChunks('flight-1', 'altitude', []);
      expect(result.size).toBe(0);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('builds OR conditions for each time range', async () => {
      const ranges = [
        { startTime: new Date('2026-01-01T00:00:00Z'), endTime: new Date('2026-01-01T00:30:00Z') },
        { startTime: new Date('2026-01-01T00:30:00Z'), endTime: new Date('2026-01-01T01:00:00Z') },
      ];

      await store.findExistingChunks('flight-1', 'altitude', ranges);
      const calls = getMockCalls(pool);

      const sql = calls[0][0] as string;
      expect(sql).toContain('entity_id = $1');
      expect(sql).toContain('parameter = $2');
      expect(sql).toContain('start_time = $3 AND end_time = $4');
      expect(sql).toContain('start_time = $5 AND end_time = $6');
      expect(calls[0][1]).toHaveLength(6); // entityId + parameter + 2 ranges * 2
    });
  });
});

describe('chunkDedupKey', () => {
  it('creates consistent key from start/end dates', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-01-01T00:30:00Z');
    expect(chunkDedupKey(start, end)).toBe(
      '2026-01-01T00:00:00.000Z_2026-01-01T00:30:00.000Z'
    );
  });
});
