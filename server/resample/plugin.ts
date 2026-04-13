import { Plugin, toPlugin, createLakebasePool } from '@databricks/appkit';
import type { PluginManifest, BasePluginConfig } from '@databricks/appkit';
import type { Router } from 'express';
import type { Pool } from 'pg';
import { resolveConfig } from './types.js';
import type { ResampleConfig, ResampleConfigInput } from './types.js';
import { IndexStore } from './index-store.js';
import { ingestParameter } from './ingest.js';
import { executeResampleQuery, streamResampleQuery } from './query.js';
import type { QueryRequest } from './query.js';
import { ChunkCache } from './chunk-cache.js';

export interface ResamplePluginConfig extends BasePluginConfig {
  source?: ResampleConfigInput['source'];
  chunks?: ResampleConfigInput['chunks'];
  downsample?: ResampleConfigInput['downsample'];
  index?: ResampleConfigInput['index'];
  ttl?: number;
}

class ResamplePlugin extends Plugin<ResamplePluginConfig> {
  static manifest = {
    name: 'resample',
    displayName: 'Resample Plugin',
    description: 'Server-side time-series downsampling with chunk caching and Lakebase metadata index',
    hidden: true,
    resources: {
      required: [],
      optional: [],
    },
  } satisfies PluginManifest<'resample'>;

  private pool: Pool | null = null;
  private indexStore: IndexStore | null = null;
  private parsedConfig!: ResampleConfig;
  private chunkCache = new ChunkCache();

  async setup() {
    if (!this.config.source) {
      throw new Error('resample plugin requires a "source" config with queryKey, timeColumn, valueColumns, and entityColumn');
    }

    this.parsedConfig = resolveConfig({
      source: this.config.source,
      chunks: this.config.chunks,
      downsample: this.config.downsample,
      index: this.config.index,
      ttl: this.config.ttl,
    });

    try {
      this.pool = createLakebasePool();
      this.indexStore = new IndexStore(this.pool, this.parsedConfig.index, this.parsedConfig.ttl);
      await this.indexStore.createTable();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[resample] Lakebase not available — index store disabled. ${msg}`);
    }
  }

  injectRoutes(router: Router) {
    router.get('/entities', async (_req, res) => {
      if (!this.indexStore) {
        res.json([]);
        return;
      }
      const result = await this.execute(
        () => this.indexStore!.listEntities(),
        { default: {} }
      );
      res.json(result ?? []);
    });

    router.get('/entities/:id/parameters', async (req, res) => {
      if (!this.indexStore) {
        res.json([]);
        return;
      }
      const { id } = req.params;
      const result = await this.execute(
        () => this.indexStore!.listParameters(id),
        { default: {} }
      );
      res.json(result ?? []);
    });

    router.delete('/cache/:entityId', async (req, res) => {
      if (!this.indexStore) {
        res.json({ deleted: 0, paths: [] });
        return;
      }
      const { entityId } = req.params;
      this.chunkCache.evictByPrefix(`/${entityId}/`);
      const paths = await this.execute(
        () => this.indexStore!.deleteEntity(entityId),
        { default: {} }
      );
      res.json({ deleted: paths?.length ?? 0, paths: paths ?? [] });
    });

    router.post('/query', async (req, res) => {
      if (!this.indexStore) {
        res.status(503).json({ error: 'Lakebase not available — query disabled' });
        return;
      }

      const body = req.body as Partial<QueryRequest>;
      if (!body.entityId || !body.parameters || !body.startTime || !body.endTime) {
        res.status(400).json({ error: 'entityId, parameters, startTime, and endTime are required' });
        return;
      }

      const wantsSSE = req.headers.accept === 'text/event-stream';

      if (wantsSSE) {
        // SSE streaming: one event per parameter
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        try {
          const stream = streamResampleQuery(
            body as QueryRequest,
            this.indexStore,
            this.parsedConfig.downsample.defaultTargetPoints,
            this.chunkCache
          );

          for await (const paramData of stream) {
            res.write(`event: parameter\ndata: ${JSON.stringify(paramData)}\n\n`);
          }

          res.write('event: done\ndata: {}\n\n');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
        } finally {
          res.end();
        }
      } else {
        // JSON response: collect all and return
        try {
          const result = await executeResampleQuery(
            body as QueryRequest,
            this.indexStore,
            this.parsedConfig.downsample.defaultTargetPoints,
            this.chunkCache
          );
          res.json(result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.status(500).json({ error: message });
        }
      }
    });

    router.post('/ingest/:entityId', async (req, res) => {
      if (!this.indexStore) {
        res.status(503).json({ error: 'Lakebase not available — ingest disabled' });
        return;
      }

      const { entityId } = req.params;
      const { parameter } = req.body as { parameter?: string };

      if (!parameter) {
        res.status(400).json({ error: 'parameter is required in request body' });
        return;
      }

      const userId = this.resolveUserId(req);

      // SSE streaming
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      try {
        const pipeline = ingestParameter(
          entityId,
          parameter,
          this.parsedConfig,
          this.indexStore,
          userId,
          this.chunkCache
        );

        for await (const event of pipeline) {
          const isResult = 'entityId' in event;
          const eventType = isResult ? 'result' : 'progress';
          res.write(`event: ${eventType}\ndata: ${JSON.stringify(event)}\n\n`);
        }

        res.write('event: done\ndata: {}\n\n');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
      } finally {
        res.end();
      }
    });
  }

  exports() {
    return {
      getIndexStore: () => this.indexStore,
      getConfig: () => this.parsedConfig,
      getPool: () => this.pool,
    };
  }

  async shutdown() {
    await this.pool?.end();
  }
}

export const resample = toPlugin(ResamplePlugin);
