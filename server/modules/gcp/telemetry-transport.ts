import { cloudRunBindingSchema } from '../../../src/modules/gcp/domain/cloud-run';
import { latencyMetric, requestMetric, telemetryWindowSchema, type TelemetryOperation, type TelemetryWindow } from '../../../src/modules/gcp/domain/telemetry';
import type { CloudBinding } from '../../../src/domain/cloud-operations';
import { CloudRunError, principalKey, type CloudRunCredentials } from './cloud-run-transport';

export interface CloudRunTelemetryTransport {
  readonly dataMode: 'live' | 'synthetic';
  identity(signal: AbortSignal): Promise<string>;
  read(operation: TelemetryOperation, window: TelemetryWindow, signal: AbortSignal): Promise<unknown>;
}
type Options = { binding: CloudBinding; principal: string; sessionId: string; credentials: CloudRunCredentials };
export const logFields = 'entries(timestamp,severity,logName,resource(type,labels),httpRequest(status,latency)),nextPageToken';
export const metricFields = 'timeSeries(metric,resource,metricKind,valueType,points),nextPageToken,executionErrors';
export function createCloudRunTelemetryTransport(options: Options & { enabled: boolean }): CloudRunTelemetryTransport {
  if (!options.enabled || process.env.MOBILEOPS_OFFLINE_TEST === '1') throw new CloudRunError('disabled');
  return transport(options, globalThis.fetch.bind(globalThis), 'live');
}
export function createSyntheticTelemetryTransport(options: Options, fetcher: typeof fetch): CloudRunTelemetryTransport {
  if (process.env.MOBILEOPS_OFFLINE_TEST !== '1' || fetcher === globalThis.fetch) throw new CloudRunError('disabled');
  return transport(options, fetcher, 'synthetic');
}
/** Fixed read queries only. No browser filters, log payloads, pagination, retries or endpoints. */
function transport(options: Options, fetcher: typeof fetch, dataMode: 'live' | 'synthetic'): CloudRunTelemetryTransport {
  const target = cloudRunBindingSchema.parse(options.binding).target;
  if (target.provider !== 'gcp') throw new CloudRunError('scope_changed');
  const expected = principalKey(options);
  const current = async (signal: AbortSignal) => {
    if (dataMode === 'live' && process.env.MOBILEOPS_OFFLINE_TEST === '1') throw new CloudRunError('disabled');
    signal.throwIfAborted();
    try {
      const value = await options.credentials.current(signal); signal.throwIfAborted();
      if (principalKey(value) !== expected || !/^[A-Za-z0-9._~+/-]{10,16384}={0,2}$/.test(value.accessToken)) throw Error();
      return value;
    } catch { throw new CloudRunError(signal.aborted ? 'cancelled' : 'identity_changed'); }
  };
  const resourceFilter = ['resource.type="cloud_run_revision"', ...Object.entries({ project_id: target.projectId, location: target.location, service_name: target.resourceName.split('/').at(-1), revision_name: target.revision }).map(([key, value]) => `resource.labels.${key}="${value}"`)].join(' AND ');
  return { dataMode, async identity(signal) { return principalKey(await current(signal)); },
    async read(operation, input, signal) {
      const window = telemetryWindowSchema.parse(input);
      if (!['logs', 'requests', 'latency'].includes(operation)) throw new CloudRunError('scope_changed');
      const credential = await current(signal);
      const url = new URL(operation === 'logs' ? 'https://logging.googleapis.com/v2/entries:list' : `https://monitoring.googleapis.com/v3/projects/${target.projectId}/timeSeries`);
      let body: string | undefined;
      if (operation === 'logs') {
        url.searchParams.set('fields', logFields);
        const logs = ['requests', 'stdout', 'stderr'].map(stream => `logName="projects/${target.projectId}/logs/run.googleapis.com%2F${stream}"`).join(' OR ');
        body = JSON.stringify({ resourceNames: [`projects/${target.projectId}`], filter: `${resourceFilter} AND (${logs}) AND timestamp>="${window.start}" AND timestamp<"${window.end}"`, orderBy: 'timestamp desc', pageSize: 50 });
      } else {
        url.searchParams.set('filter', `${resourceFilter} AND metric.type="${operation === 'requests' ? requestMetric : latencyMetric}"`);
        url.searchParams.set('interval.startTime', window.start); url.searchParams.set('interval.endTime', window.end);
        url.searchParams.set('aggregation.alignmentPeriod', '60s'); url.searchParams.set('aggregation.perSeriesAligner', operation === 'requests' ? 'ALIGN_SUM' : 'ALIGN_PERCENTILE_95');
        url.searchParams.set('view', 'FULL'); url.searchParams.set('pageSize', '120'); url.searchParams.set('fields', metricFields);
      }
      let response: Response;
      try { response = await fetcher(url, { method: operation === 'logs' ? 'POST' : 'GET', ...(body ? { body } : {}), redirect: 'error', credentials: 'omit', cache: 'no-store', signal,
        headers: { Authorization: `Bearer ${credential.accessToken}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) } }); }
      catch { throw new CloudRunError(signal.aborted ? 'cancelled' : 'unavailable'); }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new CloudRunError(response.status === 401 ? 'identity_changed' : response.status === 403 ? 'access_denied' : response.status === 404 ? 'not_found' : response.status === 429 ? 'throttled' : 'unavailable');
      }
      const reader = response.body?.getReader(); if (!reader) throw new CloudRunError('invalid_response');
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        while (true) { signal.throwIfAborted(); const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 131072) throw Error(); chunks.push(value); }
        signal.throwIfAborted(); return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch { throw new CloudRunError(signal.aborted ? 'cancelled' : 'invalid_response'); }
      finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    },
  };
}
