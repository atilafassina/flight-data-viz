import { useState, useEffect, useCallback } from 'react';

interface EntitySummary {
  entityId: string;
  parameters: number;
  startTime: string;
  endTime: string;
  totalPoints: number;
  cachedAt: string;
}

export function useEntities() {
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/resample/entities');
      const data = (await res.json()) as EntitySummary[];
      setEntities(data);
    } catch {
      // silently fail — entities list is non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { entities, loading, refresh };
}
