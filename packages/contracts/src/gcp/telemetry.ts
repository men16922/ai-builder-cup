import { z } from 'zod';

export const telemetryWindowSchema = z.object({ start: z.iso.datetime(), end: z.iso.datetime() }).strict()
  .refine(value => Date.parse(value.end) - Date.parse(value.start) === 900000 && Date.parse(value.end) % 60000 === 0, 'A fixed fifteen-minute window is required.');
export const loggingSource = 'logging.googleapis.com/v2/entries.list';
export const monitoringSource = 'monitoring.googleapis.com/v3/projects.timeSeries.list';
export const requestMetric = 'run.googleapis.com/request_count';
export const latencyMetric = 'run.googleapis.com/request_latencies';
export const telemetryOperations = ['logs', 'requests', 'latency'] as const;
export type TelemetryOperation = typeof telemetryOperations[number];
export type TelemetryWindow = z.infer<typeof telemetryWindowSchema>;
export const severity = z.enum(['DEFAULT', 'DEBUG', 'INFO', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY', 'UNKNOWN']);
const log = z.object({ timestamp: z.iso.datetime(), severity, stream: z.enum(['requests', 'stdout', 'stderr']),
  responseCode: z.number().int().min(100).max(599).nullable(), latencyMs: z.number().min(0).max(86400000).nullable() }).strict();
const point = { start: z.iso.datetime(), end: z.iso.datetime() };
const series = { responseCode: z.string().regex(/^[1-5][0-9]{2}$/), responseClass: z.string().regex(/^[1-5]xx$/) };
export const requestSeriesSchema = z.object({ ...series, points: z.array(z.object({ ...point, count: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict()).min(1).max(15) }).strict();
export const latencySeriesSchema = z.object({ ...series, points: z.array(z.object({ ...point, p95Ms: z.number().min(0).max(86400000) }).strict()).min(1).max(15) }).strict();
const read = <T extends z.ZodType>(value: T, source: string) => z.discriminatedUnion('status', [
  z.object({ status: z.literal('collected'), source: z.literal(source), observedAt: z.iso.datetime(), truncated: z.boolean(), value }).strict(),
  z.object({ status: z.enum(['no_data', 'denied', 'unavailable', 'skipped']), source: z.literal(source), observedAt: z.iso.datetime(),
    code: z.enum(['no_matching_data', 'access_denied', 'not_found', 'throttled', 'unavailable', 'invalid_response', 'service_unverified']) }).strict(),
]);
export const cloudRunTelemetrySchema = z.object({
  window: telemetryWindowSchema,
  logs: read(z.array(log).max(50), loggingSource),
  requests: read(z.array(requestSeriesSchema).max(40), monitoringSource),
  latency: read(z.array(latencySeriesSchema).max(40), monitoringSource),
}).strict().superRefine((value, ctx) => {
  const start = Date.parse(value.window.start), end = Date.parse(value.window.end);
  const check = (ok: boolean) => { if (!ok) ctx.addIssue({ code: 'custom', message: 'Telemetry does not match the bounded window.' }); };
  if (value.requests.status === 'collected') check(Number.isSafeInteger(value.requests.value.reduce((sum, series) => sum + series.points.reduce((subtotal, point) => subtotal + point.count, 0), 0)));
  if (value.logs.status === 'collected') {
    check(value.logs.value.length > 0 || value.logs.truncated);
    for (const log of value.logs.value) check(Date.parse(log.timestamp) >= start && Date.parse(log.timestamp) < end);
  }
  for (const operation of ['requests', 'latency'] as const) {
    const result = value[operation]; if (result.status !== 'collected') continue;
    check(result.value.length > 0 || result.truncated);
    check(result.value.reduce((sum, series) => sum + series.points.length, 0) <= 120);
    check(new Set(result.value.map(series => series.responseCode)).size === result.value.length);
    for (const series of result.value) {
      check(series.responseClass === `${series.responseCode[0]}xx`);
      check(new Set(series.points.map(point => point.end)).size === series.points.length);
      for (const point of series.points) check(Date.parse(point.start) >= start && Date.parse(point.end) <= end && Date.parse(point.end) - Date.parse(point.start) === 60000 && Date.parse(point.end) % 60000 === 0);
    }
  }
});
export type CloudRunTelemetry = z.infer<typeof cloudRunTelemetrySchema>;
export function telemetryWindow(now: number): TelemetryWindow {
  const end = Math.floor(now / 60000) * 60000 - 120000;
  return { start: new Date(end - 900000).toISOString(), end: new Date(end).toISOString() };
}
