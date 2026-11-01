import { createClientErrorPayload, sourcePosition } from '../shared/telemetry.ts';

export { sourcePosition };

type ReporterFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createClientDiagnostics(fetcher: ReporterFetch = fetch) {
  return function reportClientError(
    kind: 'UI_ERROR' | 'UNHANDLED_REJECTION' | 'API_ERROR',
    component: string,
    requestId?: string,
    position?: { file: string; line: number; column: number },
  ) {
    // Send identifiers only. A failed telemetry request is swallowed here so it cannot recurse.
    const payload = createClientErrorPayload(kind, component, requestId, position);
    void fetcher('/api/diagnostics/events', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'logistics-os' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  };
}

export const reportClientError = createClientDiagnostics();
