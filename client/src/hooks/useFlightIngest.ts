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

interface SSEEvent {
  event: string;
  data: string;
}

/**
 * Parses one SSE event block (text between blank lines) into an event name and
 * concatenated data string.
 *
 * Per the SSE spec the default event name is `message` when no `event:` line is
 * present. Comment lines (leading `:`) and `id:` lines are ignored — we only
 * care about the event/data pair. Multiple `data:` lines in a single block are
 * joined with newlines, matching the spec.
 */
function parseSSEBlock(block: string): SSEEvent | null {
  const lines = block.split('\n');
  let eventName = 'message';
  const dataLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line === '' || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trimStart();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
    // ignore `id:`, `retry:`, and anything else
  }

  if (dataLines.length === 0) return null;
  return { event: eventName, data: dataLines.join('\n') };
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
      // Ingest each parameter sequentially.
      //
      // We can't use `connectSSE` from `@databricks/appkit-ui` here: its
      // `SSEMessage` type carries only `{id, data}` and its parser drops
      // `event:` lines on the floor. The server emits `event: error\n
      // data: {error:...}` after `writeHead(200)`, so without event-name
      // routing we'd silently treat truncation/upload failures as success.
      // Instead we keep the explicit fetch (POST + JSON body) and parse
      // event blocks ourselves, tracking the `event:` name across the block
      // so `error` events surface correctly.
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
        let serverError: string | null = null;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          // SSE events are delimited by a blank line (`\n\n`). Normalise CRLF
          // first so we don't miss boundaries on any server flavour.
          const normalised = buffer.replace(/\r\n/g, '\n');
          const blocks = normalised.split('\n\n');
          buffer = blocks.pop() ?? '';

          for (const block of blocks) {
            const parsed = parseSSEBlock(block);
            if (!parsed) continue;

            if (parsed.event === 'error') {
              try {
                const payload = JSON.parse(parsed.data) as { error?: string };
                serverError = payload.error ?? 'Unknown ingest error';
              } catch {
                serverError = parsed.data || 'Unknown ingest error';
              }
              // Server will follow with `res.end()`; stop processing this
              // parameter and surface the error after the loop.
              break;
            }

            if (parsed.event === 'progress') {
              try {
                const data = JSON.parse(parsed.data) as IngestProgress;
                if (data.phase) {
                  setState((prev) => ({ ...prev, progress: data }));
                }
              } catch {
                // ignore malformed progress payloads
              }
            }
            // `result` and `done` events are informational here; the run
            // completes when the stream closes (reader returns done=true).
          }

          if (serverError) break;
        }

        if (serverError) {
          throw new Error(serverError);
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
