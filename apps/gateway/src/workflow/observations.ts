import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertCloudAccess, sameOwner, type CloudBinding, type CloudEvidence } from '@contracts/core/operations';
import { CloudOperationError } from '@contracts/core/workflow';
import { cloudRunSnapshotSchema } from '@contracts/gcp/cloud-run';
import { collectGcpSchema, gcpObservationSchema, gcpResourceSchema, type GcpObservation, type GcpResource } from '@contracts/gcp/observations';
import { cloudDigest } from '../store/integrity';
import { cloudRecordKey } from './workflow';
import type { CloudStore } from '../store/store';
import { cloudRunEvidence, type CloudRunCollector } from '../cloud-run/collector';
import { CloudRunError } from '../cloud-run/transport';
import type { GcpWebAccess, GcpWebSession } from '../auth/web-access';

export type GcpRegistration = { id: string; label: string; binding: CloudBinding; dataMode: 'synthetic' | 'live'; telemetryEnabled?: boolean; collector: Pick<CloudRunCollector, 'collect'> };
type Replay = { fingerprint: string; state: 'pending' | 'complete' | 'failed' | 'unknown'; deadline: number; claim: string; observationId?: string; code?: string };
const error = (status: number, code: string) => new CloudOperationError(status, code, 'The GCP observation is not available. Refresh the current scope.');
/** Persistent idempotency and evidence commit. No provider I/O occurs in a transaction callback. */
export class GcpObservations {
  private readonly resources = new Map<string, { view: GcpResource; collector: GcpRegistration['collector'] }>();
  private readonly store: CloudStore; private readonly access: GcpWebAccess; private readonly now: () => number;
  constructor(store: CloudStore, access: GcpWebAccess, registrations: readonly GcpRegistration[], now = Date.now) {
    this.store = store; this.access = access; this.now = now;
    if (registrations.length > 100) throw error(400, 'configuration_limit');
    for (const item of registrations) {
      const view = gcpResourceSchema.parse({ id: item.id, label: item.label, binding: item.binding, dataMode: item.dataMode, ...(item.telemetryEnabled ? { telemetryEnabled: true } : {}), configurationDigest: cloudDigest([item.id, item.label, item.binding, item.dataMode, ...(item.telemetryEnabled ? ['telemetry-v1'] : [])]) });
      if (this.resources.has(view.id)) throw error(400, 'duplicate_configuration');
      this.resources.set(view.id, { view, collector: item.collector });
    }
  }
  private resource(session: GcpWebSession, id: string) {
    const item = this.resources.get(id);
    if (!item || !sameOwner(item.view.binding.owner, session.context.owner) || item.view.binding.workspaceId !== session.context.workspaceId) throw error(404, 'resource_not_found');
    assertCloudAccess(session.context, item.view.binding); return item;
  }
  async list(session: GcpWebSession) {
    await this.access.current(session);
    const items = [...this.resources.values()].map(item => item.view).filter(item => sameOwner(item.binding.owner, session.context.owner) && item.binding.workspaceId === session.context.workspaceId);
    await this.store.transact(tx => this.access.assertCurrentIn(tx, session));
    return structuredClone({ owner: session.context.owner, workspaceId: session.context.workspaceId, items });
  }
  async get(session: GcpWebSession, id: string): Promise<GcpObservation> {
    z.uuid().parse(id); await this.access.current(session);
    return this.store.transact(async tx => {
      await this.access.assertCurrentIn(tx, session);
      const record = await tx.get<GcpObservation>(cloudRecordKey(session.context, 'gcp-observation', id));
      if (!record) throw error(404, 'observation_not_found');
      return this.validate(session, record);
    });
  }
  private validate(session: GcpWebSession, input: GcpObservation) {
    const record = gcpObservationSchema.parse(input), item = this.resource(session, record.resourceId);
    if (record.configurationDigest !== item.view.configurationDigest || cloudDigest(record.snapshot.binding) !== cloudDigest(item.view.binding)
      || !!record.snapshot.telemetry !== !!item.view.telemetryEnabled || record.snapshot.dataMode !== item.view.dataMode || cloudDigest(cloudRunEvidence(record.snapshot)) !== record.evidenceDigest) throw error(409, 'configuration_changed');
    return record;
  }
  async collect(session: GcpWebSession, input: unknown, requestKey: string): Promise<GcpObservation> {
    const body = collectGcpSchema.parse(input); z.uuid().parse(requestKey);
    await this.access.current(session);
    const item = this.resource(session, body.resourceId); assertCloudAccess(session.context, item.view.binding, 'prepare');
    const key = cloudRecordKey(session.context, 'gcp-request', cloudDigest([session.context.actorId, requestKey]));
    const fingerprint = cloudDigest([body, item.view.configurationDigest]);
    const claim = randomUUID();
    const reserved = await this.store.transact(async tx => {
      await this.access.assertCurrentIn(tx, session);
      const existing = await tx.get<Replay>(key);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw error(409, 'idempotency_conflict');
        if (existing.state === 'pending' && existing.deadline <= this.now()) { const unknown: Replay = { ...existing, state: 'unknown' }; tx.put(key, unknown); return unknown; }
        return existing;
      }
      const pending: Replay = { fingerprint, claim, state: 'pending', deadline: this.now() + 30000 }; tx.put(key, pending); return pending;
    });
    if (reserved.state === 'complete') return this.get(session, reserved.observationId!);
    if (reserved.state === 'unknown') throw error(409, 'collection_unknown');
    if (reserved.state === 'failed') throw error(409, reserved.code ?? 'collection_failed');
    if (reserved.claim !== claim) throw error(409, 'collection_in_progress');
    try {
      const snapshot = cloudRunSnapshotSchema.parse(await item.collector.collect(session.context, { revalidate: () => this.access.current(session) }));
      const evidence = cloudRunEvidence(snapshot);
      const result = this.validate(session, { resourceId: item.view.id, configurationDigest: item.view.configurationDigest, snapshot, evidenceDigest: cloudDigest(evidence) });
      await this.access.current(session);
      const saved = await this.store.transact(async tx => {
        await this.access.assertCurrentIn(tx, session);
        const pending = await tx.get<Replay>(key);
        if (!pending || pending.claim !== claim || pending.state !== 'pending') return false;
        if (pending.deadline <= this.now()) { tx.put(key, { ...pending, state: 'unknown' }); return false; }
        const observationKey = cloudRecordKey(session.context, 'gcp-observation', snapshot.id), evidenceKey = cloudRecordKey(session.context, 'evidence', snapshot.id);
        const old = await tx.get<GcpObservation>(observationKey), oldEvidence = await tx.get<CloudEvidence>(evidenceKey);
        if (old || oldEvidence) throw error(409, 'immutable_evidence');
        tx.put(observationKey, result); tx.put(evidenceKey, evidence); tx.put(key, { ...pending, state: 'complete', observationId: snapshot.id }); return true;
      });
      if (!saved) throw error(409, 'collection_unknown');
      return result;
    } catch (cause) {
      const code = cause instanceof CloudOperationError ? cause.code : cause instanceof CloudRunError ? cause.code : 'collection_failed';
      await this.store.transact(async tx => { const record = await tx.get<Replay>(key); if (record?.state === 'pending' && record.claim === claim) tx.put(key, { ...record, state: record.deadline <= this.now() ? 'unknown' : 'failed', code }); });
      if (cause instanceof CloudOperationError) throw cause;
      throw error(cause instanceof CloudRunError && cause.code === 'busy' ? 409 : 502, code);
    }
  }
}
