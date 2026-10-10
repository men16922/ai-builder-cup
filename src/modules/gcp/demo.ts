import { cloudRunTelemetrySchema, loggingSource, monitoringSource, telemetryWindow } from './domain/telemetry';
export type DemoScenario = 'signals' | 'empty' | 'denied';
/** Auth-free browser rehearsal data. Never submitted to a server or saved as operational evidence. */
export function demoTelemetry(scenario: DemoScenario) {
  const observedAt = '2026-10-10T01:00:00.000Z', window = telemetryWindow(Date.parse(observedAt));
  const point = { start: '2026-10-10T00:56:00.000Z', end: '2026-10-10T00:57:00.000Z' };
  const empty = (source: string) => ({ status: 'no_data', source, observedAt, code: 'no_matching_data' });
  return cloudRunTelemetrySchema.parse({ window,
    logs: scenario === 'empty' ? empty(loggingSource) : { status: 'collected', source: loggingSource, observedAt, truncated: true,
      value: [{ timestamp: point.end, severity: 'ERROR', stream: 'requests', responseCode: 503, latencyMs: 1250 }] },
    requests: scenario === 'empty' ? empty(monitoringSource) : { status: 'collected', source: monitoringSource, observedAt, truncated: false, value: [
      { responseCode: '200', responseClass: '2xx', points: [{ ...point, count: 88 }] },
      { responseCode: '503', responseClass: '5xx', points: [{ ...point, count: 12 }] },
    ] },
    latency: scenario === 'empty' ? empty(monitoringSource) : scenario === 'denied' ? { status: 'denied', source: monitoringSource, observedAt, code: 'access_denied' }
      : { status: 'collected', source: monitoringSource, observedAt, truncated: false, value: [{ responseCode: '503', responseClass: '5xx', points: [{ ...point, p95Ms: 1250 }] }] },
  });
}
