import { useState, useCallback, useRef } from 'react';

interface IngestProgress {
  phase: string;
  progress: number;
  detail?: string;
}

interface IngestState {
  ingesting: boolean;
  progress: IngestProgress | null;
  error: string | null;
}

export function useFlightIngest() {
  const [state, setState] = useState<IngestState>({
    ingesting: false,
    progress: null,
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const ingest = useCallback(async (entityId: string, parameters: string[]) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ ingesting: true, progress: null, error: null });

    try {
      // Ingest each parameter sequentially
      for (const param of parameters) {
        if (controller.signal.aborted) break;

        const response = await fetch(`/api/resample/ingest/${entityId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parameter: param }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Ingest failed for ${param}: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6)) as IngestProgress;
                if (data.phase) {
                  setState((prev) => ({ ...prev, progress: data }));
                }
              } catch {
                // ignore parse errors for non-JSON events
              }
            }
          }
        }
      }

      setState({ ingesting: false, progress: null, error: null });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setState({
        ingesting: false,
        progress: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState({ ingesting: false, progress: null, error: null });
  }, []);

  return { ...state, ingest, cancel };
}
