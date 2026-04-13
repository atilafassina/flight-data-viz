import { useState, useCallback } from 'react';
import { useEntities } from '../hooks/useEntities';

export function DangerZone() {
  const { entities, refresh } = useEntities();
  const [evicting, setEvicting] = useState(false);

  const handleEvictAll = useCallback(async () => {
    setEvicting(true);
    try {
      for (const entity of entities) {
        await fetch(`/api/resample/cache/${entity.entityId}`, { method: 'DELETE' });
      }
      await refresh();
    } finally {
      setEvicting(false);
    }
  }, [entities, refresh]);

  if (entities.length === 0) return null;

  return (
    <div className="mt-4 border-t border-red-500/10 pt-4">
      <div className="flex items-center justify-between rounded-lg border border-red-500/10 bg-zinc-950 px-5 py-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-red-400/50">Danger Zone</p>
          <p className="mt-0.5 text-xs text-zinc-600">
            Remove all {entities.length} cached flight{entities.length !== 1 ? 's' : ''} from index
          </p>
        </div>
        <button
          onClick={() => void handleEvictAll()}
          disabled={evicting}
          className="rounded border border-red-500/20 bg-red-500/5 px-4 py-1.5 text-xs uppercase tracking-wider text-red-400/70 transition-all hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-30"
        >
          {evicting ? 'Evicting...' : 'Evict Cached Flights'}
        </button>
      </div>
    </div>
  );
}
