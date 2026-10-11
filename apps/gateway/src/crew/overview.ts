import { overviewSchema, type Overview, type OverviewService } from '@contracts/gcp/overview';
import { CloudOperationError } from '@contracts/core/workflow';
import type { CrewEntitlement } from './agent-tasks';
import type { GcpWebAccess, GcpWebSession } from '../auth/web-access';

export type OverviewTarget = { name: string; project: string; region: string };
export type OverviewPorts = { token(signal: AbortSignal): Promise<string>; fetcher?: typeof fetch; now?: () => number };
const RUN = 'https://run.googleapis.com/v2', MONITORING = 'https://monitoring.googleapis.com/v3', LOGGING = 'https://logging.googleapis.com/v2/entries:list';
const WINDOW_MINUTES = 15, CACHE_MS = 20_000, MAX_BYTES = 1_000_000;
const short = (value?: string) => value ? value.slice(value.lastIndexOf('/') + 1) : undefined;
const clean = (value: unknown) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 180);
const revisionName = /^[a-z][a-z0-9-]{0,62}$/;

/** Reads Cloud Run, Cloud Monitoring and Cloud Logging for the registered services only. Reads are bounded, cached briefly, and never change anything. */
export class GcpOverview {
  private readonly targets: OverviewTarget[]; private readonly ports: OverviewPorts; private readonly access: GcpWebAccess; private readonly entitled: CrewEntitlement;
  private readonly cache = new Map<string, { at: number; value: Promise<OverviewService> }>();
  constructor(access: GcpWebAccess, targets: OverviewTarget[], ports: OverviewPorts, entitled: CrewEntitlement) { this.access = access; this.targets = targets; this.ports = ports; this.entitled = entitled; }
  private now() { return (this.ports.now ?? Date.now)(); }

  private async get(url: string, signal: AbortSignal, init?: { method: string; body: string }): Promise<unknown> {
    const origin = new URL(url).origin;
    if (!['https://run.googleapis.com', 'https://monitoring.googleapis.com', 'https://logging.googleapis.com'].includes(origin)) throw new Error('Unexpected Google API host.');
    const response = await (this.ports.fetcher ?? fetch)(url, { method: init?.method ?? 'GET', signal, redirect: 'error', headers: { Authorization: `Bearer ${await this.ports.token(signal)}`, ...(init ? { 'Content-Type': 'application/json' } : {}) }, ...(init ? { body: init.body } : {}) });
    const text = await response.text();
    if (!response.ok || text.length > MAX_BYTES) throw new Error('Google API read failed.');
    return text ? JSON.parse(text) : {};
  }

  private async service(target: OverviewTarget): Promise<OverviewService> {
    const signal = AbortSignal.timeout(12_000), at = this.now(), end = new Date(at), start = new Date(at - WINDOW_MINUTES * 60_000);
    const stamp = (value: Date) => value.toISOString().replace(/\.\d{3}Z$/, 'Z'), seconds = WINDOW_MINUTES * 60;
    const resource = `projects/${target.project}/locations/${target.region}/services/${target.name}`;
    const base = `resource.type="cloud_run_revision" AND resource.labels.service_name="${target.name}" AND resource.labels.location="${target.region}"`;
    const series = (type: string, aligner: string, reducer: string, groups: string[]) => {
      const params = new URLSearchParams({ filter: `metric.type="${type}" AND ${base}`, 'interval.startTime': stamp(start), 'interval.endTime': stamp(end), 'aggregation.alignmentPeriod': `${seconds}s`, 'aggregation.perSeriesAligner': aligner, 'aggregation.crossSeriesReducer': reducer, view: 'FULL' });
      for (const group of groups) params.append('aggregation.groupByFields', group);
      return `${MONITORING}/projects/${target.project}/timeSeries?${params}`;
    };
    const [state, revisionList, counts, latency, logs] = await Promise.allSettled([
      this.get(`${RUN}/${resource}`, signal), this.get(`${RUN}/${resource}/revisions?pageSize=10`, signal),
      this.get(series('run.googleapis.com/request_count', 'ALIGN_SUM', 'REDUCE_SUM', ['resource.label.revision_name', 'metric.label.response_code_class']), signal),
      this.get(series('run.googleapis.com/request_latencies', 'ALIGN_PERCENTILE_95', 'REDUCE_MAX', ['resource.label.revision_name']), signal),
      this.get(LOGGING, signal, { method: 'POST', body: JSON.stringify({ resourceNames: [`projects/${target.project}`], filter: `${base} AND severity>=WARNING AND timestamp>="${stamp(start)}"`, orderBy: 'timestamp desc', pageSize: 12 }) }),
    ]);
    const value = <T,>(result: PromiseSettledResult<unknown>) => result.status === 'fulfilled' ? result.value as T : undefined;
    const run = value<{ trafficStatuses?: { revision?: string; percent?: number }[] }>(state), listing = value<{ revisions?: { name?: string; createTime?: string; conditions?: { type?: string; state?: string }[] }[] }>(revisionList);
    const percent = new Map((run?.trafficStatuses ?? []).filter(item => item.revision).map(item => [short(item.revision)!, Number(item.percent ?? 0)]));
    const revisions = (listing?.revisions ?? []).map(item => {
      const ready = item.conditions?.find(condition => condition.type === 'Ready')?.state;
      return { name: short(item.name) ?? '', ready: ready === 'CONDITION_SUCCEEDED' ? 'ready' as const : ready ? 'not_ready' as const : 'unknown' as const, ...(item.createTime ? { createdAt: new Date(item.createTime).toISOString() } : {}), percent: percent.get(short(item.name) ?? '') ?? 0 };
    }).filter(item => revisionName.test(item.name));
    const countRows = value<{ timeSeries?: { resource?: { labels?: { revision_name?: string } }; metric?: { labels?: { response_code_class?: string } }; points?: { value?: { int64Value?: string } }[] }[] }>(counts)?.timeSeries ?? [];
    const requests = countRows.flatMap(row => {
      const revision = row.resource?.labels?.revision_name ?? '', klass = row.metric?.labels?.response_code_class ?? '';
      return revisionName.test(revision) ? [{ revision, responseClass: (['2xx', '3xx', '4xx', '5xx'].includes(klass) ? klass : 'other') as '2xx', count: Number(row.points?.[0]?.value?.int64Value ?? 0) }] : [];
    });
    const latencyRows = value<{ timeSeries?: { resource?: { labels?: { revision_name?: string } }; points?: { value?: { doubleValue?: number } }[] }[] }>(latency)?.timeSeries ?? [];
    const p95 = latencyRows.flatMap(row => { const revision = row.resource?.labels?.revision_name ?? ''; return revisionName.test(revision) ? [{ revision, p95Ms: Math.round(Number(row.points?.[0]?.value?.doubleValue ?? 0) * 10) / 10 }] : []; });
    const entries = value<{ entries?: { timestamp?: string; severity?: string; textPayload?: string; jsonPayload?: { message?: string }; resource?: { labels?: { revision_name?: string } }; httpRequest?: { status?: number } }[] }>(logs)?.entries ?? [];
    const logRows = entries.slice(0, 12).flatMap(entry => entry.timestamp && !Number.isNaN(Date.parse(entry.timestamp)) ? [{ at: new Date(entry.timestamp).toISOString(), severity: clean(entry.severity).slice(0, 20), ...(entry.resource?.labels?.revision_name && revisionName.test(entry.resource.labels.revision_name) ? { revision: entry.resource.labels.revision_name } : {}),
      ...(Number.isInteger(entry.httpRequest?.status) ? { status: entry.httpRequest!.status } : {}), message: clean(entry.textPayload ?? entry.jsonPayload?.message) }] : []);
    const coverage = (result: PromiseSettledResult<unknown>, rows: unknown[]) => result.status === 'rejected' ? 'error' as const : rows.length ? 'ok' as const : 'empty' as const;
    return { name: target.name, region: target.region, observedAt: end.toISOString(), revisions, requests, latency: p95, logs: logRows,
      coverage: { service: state.status === 'rejected' || revisionList.status === 'rejected' ? 'error' : 'ok', requests: coverage(counts, requests), logs: coverage(logs, logRows) } };
  }

  async read(session: GcpWebSession): Promise<Overview> {
    await this.access.current(session);
    if (!this.entitled(session)) throw new CloudOperationError(403, 'crew_not_entitled', 'The agent request is not available.');
    const at = this.now(), services = await Promise.all(this.targets.map(target => {
      const hit = this.cache.get(target.name);
      if (hit && at - hit.at < CACHE_MS) return hit.value;
      const value = this.service(target); this.cache.set(target.name, { at, value }); value.catch(() => this.cache.delete(target.name)); return value;
    }));
    return overviewSchema.parse({ generatedAt: new Date(at).toISOString(), windowMinutes: WINDOW_MINUTES, services });
  }
}
