import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertCloudAccess, evidenceSchema, type CloudBinding, type CloudEvidence, type VerifiedCloudContext } from '../../../src/domain/cloud-operations';
import { cloudRunBindingSchema, cloudRunRevisionId, cloudRunSnapshotSchema, revisionSource, serviceSource,
  type CloudRunRevision, type CloudRunService, type CloudRunSnapshot } from '../../../src/modules/gcp/domain/cloud-run';
import { cloudDigest } from '../../cloud-integrity';
import { CloudRunError, type CloudRunTransport } from './cloud-run-transport';
import { telemetryOperations, telemetryWindow, type CloudRunTelemetry } from '../../../src/modules/gcp/domain/telemetry';
import type { CloudRunTelemetryTransport } from './telemetry-transport';
import { collectTelemetry, skippedTelemetry } from './telemetry-collector';

const generation = z.string().regex(/^\d{1,19}$/).optional();
const condition = z.object({ type: z.string().max(100).optional(), state: z.string().max(100).optional() });
const common = { name: z.string().min(1).max(512), uid: z.string().min(1).max(128), generation, observedGeneration: generation,
  updateTime: z.iso.datetime({ offset: true }).optional(), reconciling: z.boolean().optional() };
// Strip all unselected data again even when the upstream API ignores the partial-response mask.
const serviceInput = z.object({ ...common, etag: z.string().max(256).optional(), terminalCondition: condition.optional(),
  latestCreatedRevision: z.string().max(512).optional(), latestReadyRevision: z.string().max(512).optional(),
  trafficStatuses: z.array(z.object({ revision: z.string().max(512).optional(), percent: z.number().int().min(0).max(100).optional() })).max(100).optional() });
const revisionInput = z.object({ ...common, service: z.string().max(512), conditions: z.array(condition).max(32).optional() });
const states: Readonly<Record<string, CloudRunService['readiness']>> = Object.freeze({ CONDITION_SUCCEEDED: 'succeeded', CONDITION_FAILED: 'failed', CONDITION_PENDING: 'pending', CONDITION_RECONCILING: 'reconciling' });
const readiness = (state?: string): CloudRunService['readiness'] => state && Object.hasOwn(states, state) ? states[state] : 'unknown';
function base(input: z.infer<typeof serviceInput>, state?: string) {
  const missingFields: string[] = [];
  for (const field of ['generation', 'observedGeneration', 'updateTime', 'reconciling'] as const) if (input[field] === undefined) missingFields.push(field);
  if (readiness(state) === 'unknown') missingFields.push('readiness');
  if (input.generation && input.observedGeneration && input.generation !== input.observedGeneration) missingFields.push('generationNotObserved');
  return { name: input.name, uid: input.uid, generation: input.generation ?? null, observedGeneration: input.observedGeneration ?? null,
    updateTime: input.updateTime ? new Date(input.updateTime).toISOString() : null, reconciling: input.reconciling ?? null, readiness: readiness(state), missingFields };
}
const fatal = (error: unknown) => error instanceof CloudRunError && ['identity_changed', 'scope_changed', 'cancelled'].includes(error.code);

/** One immutable server binding; browser inputs never choose project, resource, URL or credentials. */
export class CloudRunCollector {
  private readonly binding: CloudBinding;
  private readonly transport: CloudRunTransport;
  private readonly expectedIdentity: string;
  private readonly now: () => number;
  private readonly telemetry?: CloudRunTelemetryTransport;
  private active = false;
  constructor(options: { binding: CloudBinding; transport: CloudRunTransport; expectedIdentity: string; now?: () => number; telemetry?: CloudRunTelemetryTransport }) {
    this.binding = cloudRunBindingSchema.parse(options.binding); this.transport = options.transport;
    this.expectedIdentity = z.string().min(1).max(1024).parse(options.expectedIdentity); this.now = options.now ?? Date.now;
    if (options.telemetry && options.telemetry.dataMode !== this.transport.dataMode) throw new CloudRunError('scope_changed');
    this.telemetry = options.telemetry;
  }
  async collect(context: VerifiedCloudContext, options: { signal?: AbortSignal; revalidate?: () => Promise<VerifiedCloudContext>; metadataOnly?: boolean } = {}): Promise<CloudRunSnapshot> {
    assertCloudAccess(context, this.binding);
    if (this.transport.dataMode === 'live' && (process.env.MOBILEOPS_OFFLINE_TEST === '1' || !options.revalidate)) throw new CloudRunError('disabled');
    if (this.active) throw new CloudRunError('busy');
    this.active = true;
    const controller = new AbortController(), onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timer = setTimeout(onAbort, 15000);
    const signal = controller.signal;
    const step = async <T>(operation: () => Promise<T>): Promise<T> => {
      if (signal.aborted) throw new CloudRunError('cancelled');
      let stop: () => void = () => {};
      const cancelled = new Promise<never>((_, reject) => { stop = () => reject(new CloudRunError('cancelled')); signal.addEventListener('abort', stop, { once: true }); });
      try { const value = await Promise.race([operation(), cancelled]); if (signal.aborted) throw new CloudRunError('cancelled'); return value; }
      finally { signal.removeEventListener('abort', stop); }
    };
    const at = () => new Date(this.now()).toISOString();
    const target = this.binding.target;
    if (target.provider !== 'gcp') throw new CloudRunError('scope_changed');
    const serviceName = target.resourceName, revisionName = `${serviceName}/revisions/${target.revision}`;
    const identity = async () => { if (await step(() => this.transport.identity(signal)) !== this.expectedIdentity) throw new CloudRunError('identity_changed'); };
    const authorize = async () => {
      if (!options.revalidate) return;
      const fresh = await step(options.revalidate);
      assertCloudAccess(fresh, this.binding);
      if (fresh.actorId !== context.actorId || fresh.channel !== context.channel) throw new CloudRunError('identity_changed');
    };
    const revisionId = (value?: string): string | null => {
      if (!value) return null;
      const id = value.startsWith(`${serviceName}/revisions/`) ? value.slice(`${serviceName}/revisions/`.length) : value;
      if (!cloudRunRevisionId.safeParse(id).success) throw new CloudRunError('scope_changed');
      return id;
    };
    let serviceFingerprint: string | undefined, recheckFingerprint: string | undefined;
    const service = async (recheck = false): Promise<CloudRunSnapshot['service']> => {
      try {
        const raw = serviceInput.parse(await step(() => this.transport.read('service', signal)));
        if (raw.name !== serviceName || raw.uid !== target.resourceUid) throw new CloudRunError('scope_changed');
        const value: CloudRunService = { ...base(raw, raw.terminalCondition?.state), latestCreatedRevision: revisionId(raw.latestCreatedRevision), latestReadyRevision: revisionId(raw.latestReadyRevision),
          traffic: raw.trafficStatuses?.map(item => ({ revision: revisionId(item.revision), percent: item.percent ?? null })) ?? null };
        if (!value.latestCreatedRevision) value.missingFields.push('latestCreatedRevision');
        if (!value.latestReadyRevision) value.missingFields.push('latestReadyRevision');
        if (!value.traffic?.length) value.missingFields.push('trafficStatuses');
        else if (value.traffic.some(item => item.revision === null || item.percent === null) || value.traffic.reduce((sum, item) => sum + (item.percent ?? 0), 0) !== 100) value.missingFields.push('trafficAllocationIncomplete');
        const fingerprint = cloudDigest([value, raw.etag ?? null]);
        if (recheck) recheckFingerprint = fingerprint; else serviceFingerprint = fingerprint;
        return { status: 'collected', source: serviceSource, resourceName: serviceName, observedAt: at(), value };
      } catch (error) { return failure(error, serviceSource, serviceName, at()); }
    };
    const revision = async (): Promise<CloudRunSnapshot['revision']> => {
      try {
        const raw = revisionInput.parse(await step(() => this.transport.read('revision', signal)));
        // Cloud Run v2 reports the parent as the short service ID; accept only this service's exact ID or full name.
        if (raw.name !== revisionName || raw.service !== serviceName && raw.service !== serviceName.slice(serviceName.lastIndexOf('/') + 1)) throw new CloudRunError('scope_changed');
        const ready = raw.conditions?.filter(item => item.type === 'Ready') ?? [];
        const value: CloudRunRevision = { ...base(raw, ready.length === 1 ? ready[0].state : undefined), service: serviceName };
        return { status: 'collected', source: revisionSource, resourceName: revisionName, observedAt: at(), value };
      } catch (error) { return failure(error, revisionSource, revisionName, at()); }
    };
    try {
      await authorize(); await identity(); const startedAt = at();
      const first = await service();
      const pinned = first.status === 'collected' ? await revision() : skipped(revisionSource, revisionName, at());
      let telemetry: CloudRunTelemetry | undefined;
      if (this.telemetry && !options.metadataOnly) {
        const window = telemetryWindow(Date.parse(startedAt));
        telemetry = first.status === 'collected' && pinned.status === 'collected'
          ? await step(() => collectTelemetry({ binding: this.binding, transport: this.telemetry!, expectedIdentity: this.expectedIdentity, window, signal, now: this.now }))
          : skippedTelemetry(window, at());
      }
      const last = first.status === 'collected' ? await service(true) : skipped(serviceSource, serviceName, at());
      await identity(); await authorize();
      return cloudRunSnapshotSchema.parse({ schemaVersion: 1, id: randomUUID(), binding: this.binding, dataMode: this.transport.dataMode,
        startedAt, observedAt: at(), service: first, revision: pinned, recheck: last, ...(telemetry ? { telemetry } : {}),
        consistency: serviceFingerprint && recheckFingerprint ? serviceFingerprint === recheckFingerprint ? 'stable' : 'changed' : 'unverified', serviceAssessment: 'unknown' });
    } finally { clearTimeout(timer); controller.abort(); options.signal?.removeEventListener('abort', onAbort); this.active = false; }
  }
}
function failure<S extends string>(error: unknown, source: S, resourceName: string, observedAt: string) {
  if (fatal(error)) throw error;
  const code: 'access_denied' | 'not_found' | 'throttled' | 'unavailable' | 'invalid_response' = error instanceof CloudRunError && ['access_denied', 'not_found', 'throttled', 'unavailable'].includes(error.code)
    ? error.code as 'access_denied' | 'not_found' | 'throttled' | 'unavailable' : 'invalid_response';
  return { status: code === 'access_denied' ? 'denied' as const : code === 'not_found' ? 'missing' as const : 'unavailable' as const, source, resourceName, observedAt, code };
}
const skipped = <S extends string>(source: S, resourceName: string, observedAt: string) => ({ status: 'skipped' as const, source, resourceName, observedAt, code: 'service_unverified' as const });

/** Fits the immutable owner/provider/digest workflow contract without inventing logs or health. */
export function cloudRunEvidence(input: CloudRunSnapshot): CloudEvidence {
  const snapshot = cloudRunSnapshotSchema.parse(input);
  return evidenceSchema.parse({ schemaVersion: 1, id: snapshot.id, dataMode: snapshot.dataMode, ...snapshot.binding, observedAt: snapshot.observedAt,
    observations: [
      ...(['service', 'revision', 'recheck'] as const).map((key, index) => {
        const item = snapshot[key];
        const complete = item.status === 'collected' && item.value.missingFields.length === 0 && snapshot.consistency === 'stable';
        return { id: `gcp-run-${key}`, source: item.status === 'skipped' ? 'mobileops:collection-scope' : item.source,
          label: ['Service metadata', 'Pinned revision metadata', 'Service recheck'][index], observedAt: item.observedAt,
          quality: item.status === 'collected' ? complete ? 'complete' : 'partial' : item.status === 'denied' ? 'denied' : item.status === 'missing' || item.status === 'skipped' ? 'missing' : 'unknown',
          value: item.status === 'collected' ? item.value : null,
          ...(!complete ? { limitation: item.status === 'collected' ? 'Metadata is incomplete or changed during collection; inspect missing fields and consistency.' : item.code } : {}),
        };
      }),
      { id: 'gcp-run-consistency', source: 'mobileops:collection-consistency', observedAt: snapshot.observedAt,
        quality: snapshot.consistency === 'stable' ? 'complete' : 'partial', value: { consistency: snapshot.consistency, startedAt: snapshot.startedAt, finishedAt: snapshot.observedAt },
        limitation: 'Sequential reads are not an atomic snapshot. Stable metadata does not establish application health.' },
      ...(snapshot.telemetry ? telemetryOperations.map(key => {
        const item = snapshot.telemetry![key];
        return { id: `gcp-run-${key}`, source: item.status === 'skipped' ? 'mobileops:collection-scope' : item.source, observedAt: item.observedAt,
          quality: item.status === 'collected' ? 'partial' as const : item.status === 'denied' ? 'denied' as const : item.status === 'no_data' || item.status === 'skipped' ? 'missing' as const : 'unknown' as const,
          value: item.status === 'collected' ? { window: snapshot.telemetry!.window, truncated: item.truncated, samples: item.value } : null,
          limitation: item.status === 'collected'
            ? 'One bounded page for the named revision, not a health verdict or a full interval total. Missing samples are not zero. Telemetry has no service UID: historical name reuse is unverified. Logs exclude payloads; latency is per-code per-minute p95, not an interval percentile.' : item.code,
        };
      }) : []),
      { id: 'gcp-run-missing-signals', source: 'mobileops:collection-scope', quality: 'missing', value: null,
        limitation: snapshot.telemetry ? 'Request probes, change history and log payloads were not collected. Bounded telemetry cannot establish cause or application health.' : 'Logs, metrics, request probes and change history were not collected. This is metadata-only evidence, not a service health assessment.' },
    ], notice: snapshot.telemetry ? 'Bounded Cloud Run metadata and telemetry reads. No service invocation, deployment or resource change.' : 'Cloud Run metadata observation only. No service invocation, deployment, log query, metric query or resource change was performed.' });
}
