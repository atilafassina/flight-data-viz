import { useState, useCallback, useRef, useEffect } from 'react';

interface DownsampledPoint {
  time: number;
  value: number;
}

interface ParameterData {
  parameter: string;
  points: DownsampledPoint[];
}

interface QueryResponse {
  entityId: string;
  data: ParameterData[];
}

interface UseViewportResamplingOptions {
  entityId: string | null;
  parameters: string[];
  startTime: string | null;
  endTime: string | null;
  targetPoints?: number;
}

interface UseViewportResamplingResult {
  data: ParameterData[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

interface CachedResult {
  entityId: string;
  startTime: number;
  endTime: number;
  targetPoints: number;
  data: ParameterData[];
}

function isWithinCache(
  cache: CachedResult,
  entityId: string,
  startMs: number,
  endMs: number,
  targetPoints: number
): boolean {
  return (
    cache.entityId === entityId &&
    cache.targetPoints === targetPoints &&
    cache.startTime === startMs &&
    cache.endTime === endMs
  );
}

export function useViewportResampling({
  entityId,
  parameters,
  startTime,
  endTime,
  targetPoints = 3000,
}: UseViewportResamplingOptions): UseViewportResamplingResult {
  const [data, setData] = useState<ParameterData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<CachedResult | null>(null);

  const fetchData = useCallback(async () => {
    if (!entityId || !startTime || !endTime || parameters.length === 0) {
      setData([]);
      setLoading(false);
      return;
    }

    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();

    // Invalidate cache if entity changed
    if (cacheRef.current && cacheRef.current.entityId !== entityId) {
      cacheRef.current = null;
    }

    // Cache hit — serve locally, no loading state
    const cached = cacheRef.current;
    if (cached && isWithinCache(cached, entityId, startMs, endMs, targetPoints)) {
      setData(cached.data);
      setLoading(false);
      return;
    }

    // Cache miss — fetch from server
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Only show loading if we have no data at all (avoid flicker on viewport changes)
    if (data.length === 0 || cacheRef.current?.entityId !== entityId) {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await fetch('/api/resample/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityId, parameters, startTime, endTime, targetPoints }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `Query failed: ${response.status}`);
      }

      const result = (await response.json()) as QueryResponse;
      if (!controller.signal.aborted) {
        setData(result.data);
        setLoading(false);

        cacheRef.current = {
          entityId,
          targetPoints,
          startTime: startMs,
          endTime: endMs,
          data: result.data,
        };
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, parameters, startTime, endTime, targetPoints]);

  useEffect(() => {
    void fetchData();
    return () => abortRef.current?.abort();
  }, [fetchData]);

  const refetch = useCallback(() => {
    cacheRef.current = null;
    void fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch };
}
