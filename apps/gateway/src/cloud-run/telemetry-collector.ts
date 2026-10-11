import { z } from 'zod';
import type { CloudBinding } from '@contracts/core/operations';
import { cloudRunTelemetrySchema, loggingSource, monitoringSource, requestMetric, latencyMetric, severity, telemetryOperations,
  type CloudRunTelemetry, type TelemetryWindow, type TelemetryOperation } from '@contracts/gcp/telemetry';
import { CloudRunError } from './transport';
import type { CloudRunTelemetryTransport } from './telemetry-transport';

const time = z.iso.datetime({ offset: true });
const resource = z.object({ type: z.literal('cloud_run_revision'), labels: z.record(z.string(), z.string().max(512)) });
const response = { nextPageToken: z.string().max(8192).optional() };
const rawLog = z.object({ timestamp: time, logName: z.string().max(512), resource, severity: z.string().max(32).optional(),
  httpRequest: z.object({ status: z.number().int().min(100).max(599).optional(), latency: z.string().regex(/^\d{1,5}(\.\d{1,9})?s$/).optional() }).optional() });
const rawSeries = z.object({ resource, metric: z.object({ type: z.string().max(100), labels: z.object({ response_code: z.string().regex(/^[1-5][0-9]{2}$/), response_code_class: z.string().regex(/^[1-5]xx$/), route: z.literal('').optional() }).strict() }),
  metricKind: z.enum(['DELTA', 'GAUGE']), valueType: z.enum(['INT64', 'DOUBLE']), points: z.array(z.object({ interval: z.object({ startTime: time.optional(), endTime: time }), value: z.object({ int64Value: z.string().regex(/^\d{1,16}$/).optional(), doubleValue: z.number().finite().optional() }).strict() })).min(1).max(15) });

/** Project safe log fields and aligned samples; raw messages/IPs/URLs/payloads never leave this function. */
export function projectTelemetry(operation: TelemetryOperation, input: unknown, binding: CloudBinding, window: TelemetryWindow, observedAt: string): CloudRunTelemetry[TelemetryOperation] {
  const target = binding.target; if (target.provider !== 'gcp') throw new CloudRunError('scope_changed');
  const scope = (value: z.infer<typeof resource>) => {
    for (const [key, expected] of Object.entries({ project_id: target.projectId, location: target.location, service_name: target.resourceName.split('/').at(-1), revision_name: target.revision })) {
      if (value.labels[key] !== expected) throw new CloudRunError('scope_changed');
    }
  };
  const source = operation === 'logs' ? loggingSource : monitoringSource;
  if (operation === 'logs') {
    const body = z.object({ ...response, entries: z.array(rawLog).max(50).optional() }).parse(input);
    const value = (body.entries ?? []).map(entry => {
      scope(entry.resource);
      const stream = (['requests', 'stdout', 'stderr'] as const).find(stream => entry.logName === `projects/${target.projectId}/logs/run.googleapis.com%2F${stream}`);
      if (!stream) throw new CloudRunError('scope_changed');
      const timestamp = new Date(entry.timestamp).toISOString();
      if (Date.parse(timestamp) < Date.parse(window.start) || Date.parse(timestamp) >= Date.parse(window.end)) throw new CloudRunError('scope_changed');
      return { timestamp, stream, severity: severity.safeParse(entry.severity ?? 'DEFAULT').success ? severity.parse(entry.severity ?? 'DEFAULT') : 'UNKNOWN' as const,
        responseCode: entry.httpRequest?.status ?? null, latencyMs: entry.httpRequest?.latency ? Number(entry.httpRequest.latency.slice(0, -1)) * 1000 : null };
    });
    return !value.length && !body.nextPageToken ? { status: 'no_data', source, observedAt, code: 'no_matching_data' }
      : { status: 'collected', source, observedAt, value, truncated: !!body.nextPageToken };
  }
  const body = z.object({ ...response, timeSeries: z.array(rawSeries).max(40).optional(), executionErrors: z.array(z.unknown()).max(10).optional() }).parse(input);
  if (body.executionErrors?.length) throw new CloudRunError('unavailable');
  const series = (body.timeSeries ?? []).map(item => {
    scope(item.resource);
    if (item.metric.type !== (operation === 'requests' ? requestMetric : latencyMetric)) throw new CloudRunError('scope_changed');
    if (item.metricKind !== (operation === 'requests' ? 'DELTA' : 'GAUGE') || item.valueType !== (operation === 'requests' ? 'INT64' : 'DOUBLE')) throw new CloudRunError('invalid_response');
    const points = item.points.map(point => {
      const endMs = Date.parse(point.interval.endTime), startMs = endMs - 60000;
      if (endMs > Date.parse(window.end) || startMs < Date.parse(window.start) || endMs % 60000 !== 0) throw new CloudRunError('scope_changed');
      const suppliedStart = point.interval.startTime ? Date.parse(point.interval.startTime) : undefined;
      if (operation === 'requests' ? suppliedStart !== startMs : suppliedStart !== undefined && suppliedStart !== endMs && suppliedStart !== startMs) throw new CloudRunError('invalid_response');
      const bounds = { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };
      if (operation === 'requests') {
        if (point.value.int64Value === undefined || point.value.doubleValue !== undefined || !Number.isSafeInteger(Number(point.value.int64Value))) throw new CloudRunError('invalid_response');
        return { ...bounds, count: Number(point.value.int64Value) };
      }
      if (point.value.doubleValue === undefined || point.value.int64Value !== undefined) throw new CloudRunError('invalid_response');
      return { ...bounds, p95Ms: point.value.doubleValue };
    });
    return { responseCode: item.metric.labels.response_code, responseClass: item.metric.labels.response_code_class, points };
  });
  return !series.length && !body.nextPageToken ? { status: 'no_data', source, observedAt, code: 'no_matching_data' }
    : { status: 'collected', source, observedAt, value: series, truncated: !!body.nextPageToken } as CloudRunTelemetry[TelemetryOperation];
}
export function skippedTelemetry(window: TelemetryWindow, observedAt: string): CloudRunTelemetry {
  const read = (source: string) => ({ status: 'skipped' as const, source, observedAt, code: 'service_unverified' as const });
  return cloudRunTelemetrySchema.parse({ window, logs: read(loggingSource), requests: read(monitoringSource), latency: read(monitoringSource) });
}
export async function collectTelemetry(options: { binding: CloudBinding; transport: CloudRunTelemetryTransport; expectedIdentity: string; window: TelemetryWindow; signal: AbortSignal; now: () => number }): Promise<CloudRunTelemetry> {
  const { transport, signal, window } = options;
  if (await transport.identity(signal) !== options.expectedIdentity) throw new CloudRunError('identity_changed');
  const reads = await Promise.all(telemetryOperations.map(async operation => {
    try {
      const input = await transport.read(operation, window, signal);
      signal.throwIfAborted();
      const observedAt = new Date(options.now()).toISOString();
      const projected = projectTelemetry(operation, input, options.binding, window, observedAt);
      const checked = cloudRunTelemetrySchema.parse({ ...skippedTelemetry(window, observedAt), [operation]: projected });
      return [operation, checked[operation]] as const;
    } catch (error) {
      if (signal.aborted) throw new CloudRunError('cancelled');
      if (error instanceof CloudRunError && ['identity_changed', 'scope_changed', 'disabled', 'cancelled'].includes(error.code)) throw error;
      const code = error instanceof CloudRunError && ['access_denied', 'not_found', 'throttled', 'unavailable'].includes(error.code) ? error.code : 'invalid_response';
      return [operation, { status: code === 'access_denied' ? 'denied' : 'unavailable', source: operation === 'logs' ? loggingSource : monitoringSource, observedAt: new Date(options.now()).toISOString(), code }] as const;
    }
  }));
  if (await transport.identity(signal) !== options.expectedIdentity) throw new CloudRunError('identity_changed');
  return cloudRunTelemetrySchema.parse({ window, ...Object.fromEntries(reads) });
}
