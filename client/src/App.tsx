import { useState, useEffect } from 'react';
import { FlightTimeSeries } from './components/FlightTimeSeries';
import { FlightScatterPlot } from './components/FlightScatterPlot';
import { FlightSelector } from './components/FlightSelector';
import { DangerZone } from './components/DangerZone';
import { useViewportResampling } from './hooks/useViewportResampling';
import { useDebouncedValue } from './hooks/useDebouncedValue';

const PARAMETERS = ['altitude', 'speed', 'oil_pressure', 'battery_voltage', 'in_air'];

type ViewMode = 'timeseries' | 'scatter';

function Clock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="tabular-nums text-emerald-500/70">
      {time.toISOString().slice(11, 19)}
      <span className="text-emerald-500/30">Z</span>
    </span>
  );
}

export default function App() {
  const [selectedFlight, setSelectedFlight] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<{ start: string; end: string } | null>(null);
  const [viewport, setViewport] = useState<{ start: string; end: string } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('timeseries');

  const debouncedViewport = useDebouncedValue(viewport, 300);

  useEffect(() => {
    if (debouncedViewport) {
      // Bridge debounced viewport into the data-fetching key. This is a
      // setState-in-effect by design: the effect's job is to translate one
      // piece of React state (viewport, written from a Plotly callback) into
      // another (timeRange, consumed by useViewportResampling) only after the
      // user has settled on a range.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTimeRange(debouncedViewport);
    }
  }, [debouncedViewport]);

  const { data, loading, error } = useViewportResampling({
    entityId: selectedFlight,
    parameters: PARAMETERS,
    startTime: timeRange?.start ?? null,
    endTime: timeRange?.end ?? null,
    targetPoints: viewMode === 'scatter' ? 100_000 : 3000,
  });

  const handleFlightSelect = (entityId: string, startTime: string, endTime: string) => {
    setSelectedFlight(entityId);
    setTimeRange({ start: startTime, end: endTime });
    setViewport(null);
  };

  return (
    <div className="relative min-h-screen p-4">
      {/* Top bar */}
      <header className="mb-4 flex items-center justify-between border-b border-zinc-800/80 pb-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-semibold uppercase tracking-widest text-emerald-400">
            Flight Data Viz
          </h1>
          <span className="text-xs text-zinc-600">AppKit Resample Engine</span>
        </div>
        <div className="flex items-center gap-6 text-xs">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            <span className="text-zinc-500">CONNECTED</span>
          </div>
          <Clock />
        </div>
      </header>

      {/* Main layout */}
      <div className="grid grid-cols-[280px_1fr] gap-4">
        <FlightSelector onSelect={handleFlightSelect} selectedFlight={selectedFlight} />

        <div className="space-y-3">
          {/* Chart header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-baseline gap-2">
                <span className="text-xs uppercase tracking-wider text-zinc-500">Primary Display</span>
                {selectedFlight && (
                  <>
                    <span className="text-zinc-700">/</span>
                    <span className="text-xs font-medium text-emerald-400">{selectedFlight}</span>
                  </>
                )}
              </div>

              {/* View toggle */}
              <div className="flex rounded border border-zinc-700 font-mono text-xs">
                <button
                  onClick={() => setViewMode('timeseries')}
                  className={`px-2.5 py-1 transition-colors ${
                    viewMode === 'timeseries'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Time Series
                </button>
                <button
                  onClick={() => setViewMode('scatter')}
                  className={`border-l border-zinc-700 px-2.5 py-1 transition-colors ${
                    viewMode === 'scatter'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Scatter
                </button>
              </div>
            </div>
            {selectedFlight && timeRange && (
              <span className="text-xs tabular-nums text-zinc-600">
                {new Date(timeRange.start).toISOString().slice(11, 19)}
                <span className="text-zinc-700"> — </span>
                {new Date(timeRange.end).toISOString().slice(11, 19)}
              </span>
            )}
          </div>

          {/* Chart */}
          {viewMode === 'timeseries' ? (
            <FlightTimeSeries
              data={data}
              loading={loading}
              error={error}
              onViewportChange={(startMs, endMs) =>
                setViewport({
                  start: new Date(startMs).toISOString(),
                  end: new Date(endMs).toISOString(),
                })
              }
            />
          ) : (
            <FlightScatterPlot data={data} loading={loading} error={error} />
          )}
        </div>
      </div>

      {/* Dev-only danger zone, aligned to the plot column */}
      {import.meta.env.DEV && (
        <div className="grid grid-cols-[280px_1fr] gap-4">
          <div />
          <DangerZone />
        </div>
      )}
    </div>
  );
}
