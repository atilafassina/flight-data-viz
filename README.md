# Flight Data Visualization

High-volume time-series visualization for flight sensor data, built with [AppKit](https://databricks.github.io/appkit/). Server-side LTTB downsampling, Arrow IPC chunk caching, and react-plotly.js WebGL rendering.

## Sample Data

| Flight      | Description                | Duration | Points        | Sampling                                                   |
| ----------- | -------------------------- | -------- | ------------- | ---------------------------------------------------------- |
| FL-2026-001 | Short test flight          | 4h       | 72K           | 1Hz all params                                             |
| FL-2026-002 | 12h long-haul              | 12h      | 216K          | 1Hz all params                                             |
| FL-2026-003 | Mixed-Hz stress test       | 10h      | 1,152K        | 20Hz oil_pressure, 5Hz altitude/speed, 1Hz battery/in_air  |
| FL-2026-004 | Transatlantic + turbulence | 12h      | 216K          | 1Hz, sharp oscillations during turbulence events           |
| FL-2026-005 | Domestic + sensor anomaly  | 2h       | 360K          | 10Hz all params, erratic oil_pressure + battery mid-flight |
| **Total**   |                            |          | **2,016,000** |                                                            |

**Parameters:** altitude, speed, oil_pressure, battery_voltage, in_air (binary)

## Prerequisites

- Node.js v22+ and npm
- Databricks CLI v0.287+ (for deployment and Lakebase provisioning)
- Access to a Databricks workspace with:
  - SQL Warehouse
  - UC Volume
  - Lakebase Postgres Autoscaling

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your workspace credentials. Required variables:

| Variable                  | Description                     |
| ------------------------- | ------------------------------- |
| `DATABRICKS_HOST`         | Workspace URL                   |
| `DATABRICKS_WAREHOUSE_ID` | SQL Warehouse ID                |
| `PGUSER`                  | Your email (for Lakebase OAuth) |
| `PGHOST`                  | Lakebase endpoint host          |
| `PGDATABASE`              | Lakebase database name          |
| `LAKEBASE_ENDPOINT`       | Lakebase endpoint resource path |
| `DATABRICKS_VOLUME_FILES` | UC Volume path for chunk cache  |

### 3. Development

```bash
npm run dev
```

The app runs at `http://localhost:8000`. Enter a flight ID and click **Load** to ingest, then click the flight to visualize.

### 4. Build

```bash
npm run build
```

### 5. Production

```bash
npm start
```

## Architecture

```
Server (AppKit + Express)
  server/server.ts              AppKit entry: server, analytics, resample plugins
  server/resample/
    plugin.ts                   Custom Plugin class, 8 routes, SSE streaming
    chunker.ts                  Time-based partitioning + Arrow IPC serialization
    downsampler.ts              LTTB via downsample npm package
    ingest.ts                   SQL Warehouse -> chunk -> UC Volume -> Lakebase index
    query.ts                    Lakebase lookup -> Volume download -> LTTB -> JSON/SSE
    index-store.ts              Lakebase CRUD for chunk metadata
    chunk-cache.ts              In-memory LRU cache (256MB default)
    volume-io.ts                Direct REST API upload/download for UC Volumes

Client (React + Plotly.js WebGL)
  client/src/
    App.tsx                     HUD-themed layout with live clock
    components/
      FlightSelector.tsx        Flight list, ingest trigger with progress bar
      FlightTimeSeries.tsx      Dual-view (overview + detail), multi-Y-axis, scattergl
      ChartLoading.tsx          Retro flight-computer boot sequence
      DangerZone.tsx            Cache eviction (dev-mode only)
    hooks/
      useViewportResampling.ts  Debounced query with abort + client-side cache
      useFlightIngest.ts        SSE ingest progress tracking
      useEntities.ts            Entity list fetching
```

## Performance

| Metric                            | Value                    |
| --------------------------------- | ------------------------ |
| Ingest per parameter              | ~6s                      |
| Query cold (5 params, full range) | ~5.5s                    |
| Query warm (LRU cache hit)        | 0.24s                    |
| Pan/zoom within cached range      | Instant (client cache)   |
| Initial page load                 | ~1s (Plotly lazy-loaded) |

## Code Quality

```bash
npm run typecheck    # TypeScript type checking
npm run lint         # ESLint
npm run build        # Full build (server + client)
npm test             # Vitest (45 tests) + Playwright smoke
```

## Deployment

```bash
databricks apps deploy
```

### First-time Lakebase permissions

Two Lakebase schemas are created the first time you run the app: `resample` (this plugin's chunk index) and `appkit` (AppKit's persistent cache). When you run `npm run dev`, they're created as owned by **your** Postgres user. The deployed app runs as a **service principal**, which has no access to schemas owned by someone else — so startup fails with `permission denied for schema resample` / `permission denied for schema appkit`, and every API call returns empty data.

After the schemas exist (i.e. after you've run `npm run dev` at least once), grant the SP access:

```bash
npx tsx --tsconfig ./tsconfig.server.json --env-file-if-exists=./.env ./scripts/grant-lakebase-access.ts
```

This grants PUBLIC (so both you and the SP can use them) USAGE + CREATE on each schema, full CRUD on existing tables and sequences, plus default privileges for anything created later.

One-time — survives re-deploys. Re-run only if you drop and recreate either schema.

### Other deploy gotchas

Things we hit on this project. Leaving them here so they're not re-discovered:

- **`CREATE INDEX IF NOT EXISTS` needs table ownership.** Even when the index already exists, Postgres enforces ownership at parse time. The SP doesn't own your dev-created tables, so the plugin's first-run migrations would throw "must be owner of table". `IndexStore.createTable()` short-circuits when `pg_tables` shows the table already exists, so on re-deploy it's a no-op instead of an error.
- **TTL dedup vs listing filters.** `findExistingChunks` used to not filter `expires_at > NOW()`, while `listEntities` / `findChunks` did. Result: expired rows silently blocked re-ingest (dedup saw them) but were invisible to the UI (listings filtered them out) — the entity "disappeared" yet never came back no matter how many times you re-ingested. Fix: dedup now also requires `expires_at > NOW()`, and `insertChunks` uses `ON CONFLICT ... DO UPDATE` to refresh expiry on reinsert.
- **Skip `npm_config_omit=dev` in `app.yaml`.** The Databricks Apps build runs `npm install` *then* `npm run build`. Building needs the devDependencies (`tsdown`, `vite`, `tsc`, `appkit`), so pruning them at install time breaks the build phase.

## Tech Stack

- **Backend**: Node.js, Express, AppKit SDK, Apache Arrow, LTTB downsampling
- **Frontend**: React 19, Plotly.js (WebGL scattergl), Tailwind CSS v4
- **Storage**: Lakebase (Postgres), UC Volumes (Arrow IPC)
