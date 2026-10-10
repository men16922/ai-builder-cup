import type { CloudRunTelemetry } from './telemetry';

/** Display only: a bounded page is not a full interval total or percentile. */
export function summarizeTelemetry(telemetry: CloudRunTelemetry) {
  const counts = telemetry.requests.status === 'collected'
    ? telemetry.requests.value.map(series => ({ code: series.responseCode, count: series.points.reduce((sum, point) => sum + point.count, 0) })) : [];
  const total = counts.length ? counts.reduce((sum, series) => sum + series.count, 0) : null;
  const errors = counts.filter(series => series.code.startsWith('5'));
  const errorCount = errors.length ? errors.reduce((sum, series) => sum + series.count, 0) : null;
  const latency = telemetry.latency.status === 'collected' ? telemetry.latency.value.flatMap(series => series.points.map(point => point.p95Ms)) : [];
  const highestP95Ms = latency.length ? Math.max(...latency) : null;
  const logs = telemetry.logs.status === 'collected' ? telemetry.logs.value : [];
  return { counts, total, errorCount, highestP95Ms, logs };
}
