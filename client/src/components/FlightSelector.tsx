import { useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { useEntities } from '../hooks/useEntities';
import { useFlightIngest } from '../hooks/useFlightIngest';

const DEFAULT_PARAMETERS = ['altitude', 'speed', 'oil_pressure', 'battery_voltage', 'in_air'];

function phaseLabel(phase: string, detail?: string): string {
  if (detail) return detail;
  const labels: Record<string, string> = {
    querying: 'QUERYING WAREHOUSE',
    chunking: 'PARTITIONING DATA',
    uploading: 'CACHING CHUNKS',
    indexing: 'INDEXING METADATA',
    done: 'COMPLETE',
  };
  return labels[phase] ?? phase;
}

interface FlightSelectorProps {
  onSelect: (entityId: string, startTime: string, endTime: string) => void;
  selectedFlight: string | null;
}

export function FlightSelector({ onSelect, selectedFlight }: FlightSelectorProps) {
  const { entities, loading: entitiesLoading, refresh } = useEntities();
  const { ingesting, progress, error, ingest } = useFlightIngest();
  const [flightId, setFlightId] = useState('FL-2026-001');
  const handleIngest = async () => {
    await ingest(flightId, DEFAULT_PARAMETERS);
    await refresh();
  };

  const handleSelect = (entityId: string, startTime: string, endTime: string) => {
    onSelect(entityId, startTime, endTime);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Load panel */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wider text-zinc-500">
          <span className="h-px flex-1 bg-zinc-800" />
          <span>Ingest</span>
          <span className="h-px flex-1 bg-zinc-800" />
        </div>

        <div className="flex gap-2">
          <input
            value={flightId}
            onChange={(e) => setFlightId(e.target.value)}
            placeholder="FL-2026-001"
            disabled={ingesting}
            className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-emerald-400 caret-emerald-400 placeholder:text-zinc-700 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/20"
          />
          <button
            onClick={() => void handleIngest()}
            disabled={ingesting || !flightId}
            className="flex items-center justify-center rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-emerald-400 transition-all hover:border-emerald-500/50 hover:bg-emerald-500/20 hover:shadow-[0_0_12px_rgba(52,211,153,0.15)] disabled:opacity-30 disabled:hover:border-emerald-500/30 disabled:hover:bg-emerald-500/10 disabled:hover:shadow-none"
          >
            {ingesting ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          </button>
        </div>

        {/* Progress */}
        {ingesting && progress && (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-amber-400/70">{phaseLabel(progress.phase, progress.detail)}</span>
              <span className="tabular-nums text-zinc-500">{Math.round(progress.progress * 100)}%</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-emerald-500/80 transition-all duration-500 ease-out"
                style={{ width: `${progress.progress * 100}%` }}
              />
            </div>
          </div>
        )}

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>

      {/* Flight list */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wider text-zinc-500">
          <span className="h-px flex-1 bg-zinc-800" />
          <span>Cached Flights</span>
          <span className="h-px flex-1 bg-zinc-800" />
        </div>

        {entitiesLoading ? (
          <p className="text-xs text-zinc-600">Scanning index...</p>
        ) : entities.length === 0 ? (
          <p className="text-xs text-zinc-600">No cached flights</p>
        ) : (
          <div className="space-y-1.5">
            {entities.map((entity) => {
              const isActive = selectedFlight === entity.entityId;
              return (
                <button
                  key={entity.entityId}
                  onClick={() => handleSelect(entity.entityId, entity.startTime, entity.endTime)}
                  className={`group w-full rounded border p-2.5 text-left transition-all ${
                    isActive
                      ? 'border-emerald-500/40 bg-emerald-500/5 shadow-[0_0_15px_rgba(52,211,153,0.06)]'
                      : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]' : 'bg-zinc-700'}`}
                      />
                      <span
                        className={`text-xs font-medium ${isActive ? 'text-emerald-400' : 'text-zinc-300'}`}
                      >
                        {entity.entityId}
                      </span>
                    </div>
                    <span className="text-xs tabular-nums text-zinc-600">
                      {entity.parameters} params
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between pl-3.5 text-xs tabular-nums text-zinc-600">
                    <span>{entity.totalPoints.toLocaleString()} pts</span>
                    <span className="text-zinc-700">
                      {new Date(entity.startTime).toISOString().slice(11, 16)}–
                      {new Date(entity.endTime).toISOString().slice(11, 16)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
