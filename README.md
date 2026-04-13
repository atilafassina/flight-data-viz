# Flight Data Visualization

High-volume time-series visualization for flight sensor data, built with [AppKit](https://databricks.github.io/appkit/). Server-side LTTB downsampling, Arrow IPC chunk caching, and react-plotly.js WebGL rendering.

**Solves:** Databricks Dashboard's ~16K point rendering cap. Aviation customers need to visualize 43K-720K+ points per flight parameter.

## Sample Data

| Flight | Description | Duration | Points | Sampling |
|---|---|---|---|---|
| FL-2026-001 | Short test flight | 4h | 72K | 1Hz all params |
| FL-2026-002 | 12h long-haul | 12h | 216K | 1Hz all params |
| FL-2026-003 | Mixed-Hz stress test | 10h | 1,152K | 20Hz oil_pressure, 5Hz altitude/speed, 1Hz battery/in_air |
| FL-2026-004 | Transatlantic + turbulence | 12h | 216K | 1Hz, sharp oscillations during turbulence events |
| FL-2026-005 | Domestic + sensor anomaly | 2h | 360K | 10Hz all params, erratic oil_pressure + battery mid-flight |
| **Total** | | | **2,016,000** | |

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

| Variable | Description |
|---|---|
| `DATABRICKS_HOST` | Workspace URL |
| `DATABRICKS_WAREHOUSE_ID` | SQL Warehouse ID |
| `PGUSER` | Your email (for Lakebase OAuth) |
| `PGHOST` | Lakebase endpoint host |
| `PGDATABASE` | Lakebase database name |
| `LAKEBASE_ENDPOINT` | Lakebase endpoint resource path |
| `DATABRICKS_VOLUME_FILES` | UC Volume path for chunk cache |

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

| Metric | Value |
|---|---|
| Ingest per parameter | ~6s |
| Query cold (5 params, full range) | ~5.5s |
| Query warm (LRU cache hit) | 0.24s |
| Pan/zoom within cached range | Instant (client cache) |
| Initial page load | ~1s (Plotly lazy-loaded) |

## Code Quality

```bash
npm run typecheck    # TypeScript type checking
npm run lint         # ESLint
npm run build        # Full build (server + client)
npm test             # Vitest (45 tests) + Playwright smoke
```

## Deployment

```bash
databricks bundle validate
databricks bundle deploy
databricks bundle run flight-v
```

## Tech Stack

- **Backend**: Node.js, Express, AppKit SDK, Apache Arrow, LTTB downsampling
- **Frontend**: React 19, Plotly.js (WebGL scattergl), Tailwind CSS v4
- **Storage**: Lakebase (Postgres), UC Volumes (Arrow IPC)
- **Design**: Retro flight-computer HUD aesthetic
