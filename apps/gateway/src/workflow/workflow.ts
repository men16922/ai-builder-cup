import { randomUUID } from 'node:crypto';
import {
  assertCloudAccess, bindingSchema, cloudDecisionSchema, cloudExecutionSchema, cloudPlanVersionSchema,
  evidenceSchema, planPayloadSchema, type CloudBinding, type CloudEvidence, type CloudPlanPayload,
  type CloudTarget, type VerifiedCloudContext,
} from '@contracts/core/operations';
import {
  cloudHandoffSchema, cloudRequestKeySchema, CloudOperationError,
  type CloudExecution, type CloudIntent, type CloudPlan,
} from '@contracts/core/workflow';
import { cloudDigest, validatePinnedCloudPlan } from '../store/integrity';
import type { CloudStore, CloudTransaction } from '../store/store';

type Scope = Pick<CloudBinding, 'owner' | 'workspaceId'>;
type StoredExecution = CloudExecution & { claim?: { tokenDigest: string; expiresAt: string } };
type Replay<T> = { fingerprint: string; response: T };
export interface CloudReadAdapter {
  actionId: CloudPlanPayload['action']['id']; dataMode: 'synthetic' | 'live';
  requiredSources: readonly string[];
  /** Resolve the server-owned target again; never accept a new endpoint from the request. */
  currentTarget(plan: CloudPlanPayload): Promise<CloudTarget>;
  /** Bounded fixed reads only. Return fresh evidence; do not execute model-generated code. */
  inspect(plan: CloudPlanPayload): Promise<CloudEvidence>;
}
export const cloudRecordKey = (scope: Scope, kind: string, id: string) => `${kind}:${cloudDigest([scope.owner, scope.workspaceId, id])}`;
const conflict = (code = 'state_changed') => new CloudOperationError(409, code, 'The operation changed. Refresh before continuing.');
const absent = () => new CloudOperationError(404, 'not_found', 'The record is not available in this workspace.');
const bindingOf = (plan: CloudPlanPayload) => bindingSchema.parse({ owner: plan.owner, workspaceId: plan.workspaceId, environmentId: plan.environmentId, target: plan.target });
const publicExecution = (stored: StoredExecution): CloudExecution => {
  const { claim: _claim, ...result } = stored;
  return result;
};

/** Provider-neutral application workflow. No demo, local CLI, identity SDK or cloud SDK imports. */
export class CloudWorkflow {
  private readonly adapters = new Map<string, CloudReadAdapter>();
  private readonly store: CloudStore;
  private readonly now: () => number;
  constructor(store: CloudStore, adapters: readonly CloudReadAdapter[] = [], now = Date.now) {
    this.store = store; this.now = now;
    for (const adapter of adapters) {
      const key = `${adapter.dataMode}:${adapter.actionId}`;
      if (this.adapters.has(key) || adapter.requiredSources.length === 0) throw new Error('Invalid or duplicate read adapter.');
      this.adapters.set(key, adapter);
    }
  }
  private adapter(plan: CloudPlanPayload): CloudReadAdapter {
    const adapter = this.adapters.get(`${plan.dataMode}:${plan.action.id}`);
    if (!adapter) throw new CloudOperationError(503, 'capability_unavailable', 'This inspection is not connected.');
    return adapter;
  }
  supports(actionId: CloudPlanPayload['action']['id'], dataMode: CloudPlanPayload['dataMode']): boolean {
    return this.adapters.has(`${dataMode}:${actionId}`);
  }
  private async readPlan(tx: CloudTransaction, scope: Scope, id: string): Promise<CloudPlan> {
    const plan = await tx.get<CloudPlan>(cloudRecordKey(scope, 'plan', id));
    if (!plan) throw absent();
    if (plan.digest !== cloudDigest(plan.payload)) throw conflict('integrity_mismatch');
    return plan;
  }
  private active(plan: CloudPlan, expected: { expectedVersion: number; expectedDigest: string }, now: number) {
    if (plan.payload.version !== expected.expectedVersion || plan.digest !== expected.expectedDigest) throw conflict('version_mismatch');
    if (plan.lifecycle !== 'prepared') throw conflict();
    if (Date.parse(plan.payload.expiresAt) <= now) throw new CloudOperationError(410, 'plan_expired', 'The plan expired. Collect fresh evidence and prepare a new plan.');
    if (Date.parse(plan.payload.createdAt) > now) throw conflict('invalid_time');
  }
  private validate(plan: CloudPlan, evidence: CloudEvidence | undefined, now: number) {
    try { validatePinnedCloudPlan(plan.payload, evidence, plan.digest, now); }
    catch { throw conflict('integrity_mismatch'); }
  }
  private replayKey(context: VerifiedCloudContext, operation: string, key: string) {
    cloudRequestKeySchema.parse(key);
    return cloudRecordKey(context, 'request', cloudDigest([context.actorId, operation, key]));
  }
  private async replay<T>(tx: CloudTransaction, key: string, fingerprint: string): Promise<T | undefined> {
    const existing = await tx.get<Replay<T>>(key);
    if (existing && existing.fingerprint !== fingerprint) throw conflict('idempotency_conflict');
    return existing?.response;
  }
  private audit(tx: CloudTransaction, key: string, context: VerifiedCloudContext, operation: string, id: string, at: string) {
    // Only metadata belongs in this journal; notes/evidence stay in their scoped records.
    tx.put(key, { owner: context.owner, workspaceId: context.workspaceId, actorId: context.actorId, operation, recordId: id, at });
  }

  /** Internal collector entry, never a client-supplied evidence upload. */
  async saveEvidence(context: VerifiedCloudContext, input: unknown): Promise<CloudEvidence> {
    const evidence = evidenceSchema.parse(input);
    assertCloudAccess(context, evidence, 'prepare');
    return this.store.transact(async tx => {
      const key = cloudRecordKey(context, 'evidence', evidence.id), existing = await tx.get<CloudEvidence>(key);
      if (existing && cloudDigest(existing) !== cloudDigest(evidence)) throw conflict('immutable_evidence');
      if (!existing) tx.put(key, evidence);
      return evidence;
    });
  }

  /** Only the server planner calls this; HTTP callers submit evidence ID/objective instead. */
  async registerPlan(context: VerifiedCloudContext, input: unknown, replaces?: string): Promise<CloudPlan> {
    return this.store.transact(tx => this.registerPlanIn(tx, context, input, replaces));
  }

  /** Compose an atomic planner result/plan commit. Callers must finish their reads before this writes. */
  async registerPlanIn(tx: CloudTransaction, context: VerifiedCloudContext, input: unknown, replaces?: string): Promise<CloudPlan> {
    const payload = planPayloadSchema.parse(input);
    assertCloudAccess(context, payload, 'prepare');
    this.adapter(payload);
    const plan: CloudPlan = { payload, digest: cloudDigest(payload), lifecycle: 'prepared', review: { status: 'not_requested' } };
    const key = cloudRecordKey(context, 'plan', payload.planId), existing = await tx.get<CloudPlan>(key);
    if (existing) {
      if (existing.digest !== plan.digest) throw conflict('immutable_plan');
      return existing;
    }
    const evidence = await tx.get<CloudEvidence>(cloudRecordKey(context, 'evidence', payload.evidence.snapshotId));
    const previous = replaces ? await this.readPlan(tx, context, replaces) : undefined;
    const auditKey = cloudRecordKey(context, 'audit', `prepare:${payload.planId}`);
    await tx.get(auditKey);
    this.validate(plan, evidence, this.now());
    if (previous) {
      assertCloudAccess(context, previous.payload, 'prepare');
      if (previous.lifecycle !== 'prepared' || payload.version !== previous.payload.version + 1
        || cloudDigest(bindingOf(payload)) !== cloudDigest(bindingOf(previous.payload))
        || payload.action.id !== previous.payload.action.id || payload.dataMode !== previous.payload.dataMode) throw conflict('invalid_revision');
      previous.lifecycle = 'superseded'; previous.supersededBy = payload.planId;
      tx.put(cloudRecordKey(context, 'plan', replaces!), previous);
    } else if (payload.version !== 1) throw conflict('invalid_revision');
    tx.put(key, plan);
    this.audit(tx, auditKey, context, 'prepare', payload.planId, new Date(this.now()).toISOString());
    return plan;
  }

  async getPlan(context: VerifiedCloudContext, id: string): Promise<CloudPlan> {
    return this.store.transact(async tx => { const plan = await this.readPlan(tx, context, id); assertCloudAccess(context, plan.payload); return plan; });
  }
  async getEvidence(context: VerifiedCloudContext, id: string): Promise<CloudEvidence> {
    return this.store.transact(async tx => {
      const evidence = await tx.get<CloudEvidence>(cloudRecordKey(context, 'evidence', id));
      if (!evidence) throw absent(); assertCloudAccess(context, evidence); return evidence;
    });
  }
  async getExecution(context: VerifiedCloudContext, id: string): Promise<CloudExecution> {
    return this.store.transact(async tx => {
      const execution = await tx.get<StoredExecution>(cloudRecordKey(context, 'execution', id));
      if (!execution) throw absent(); assertCloudAccess(context, execution.binding); return publicExecution(execution);
    });
  }

  async requestReview(context: VerifiedCloudContext, id: string, raw: unknown, requestKey: string): Promise<CloudPlan> {
    const input = cloudPlanVersionSchema.parse(raw), key = this.replayKey(context, 'request-review', requestKey);
    const fingerprint = cloudDigest({ id, input });
    return this.store.transact(async tx => {
      const plan = await this.readPlan(tx, context, id); assertCloudAccess(context, plan.payload, 'prepare');
      const replay = await this.replay<CloudPlan>(tx, key, fingerprint); if (replay) return replay;
      const evidence = await tx.get<CloudEvidence>(cloudRecordKey(context, 'evidence', plan.payload.evidence.snapshotId));
      const intentKey = cloudRecordKey(context, 'review-intent', id), auditKey = `${key}:audit`;
      await tx.get(intentKey); await tx.get(auditKey);
      const now = this.now(), at = new Date(now).toISOString(); this.active(plan, input, now); this.validate(plan, evidence, now);
      if (plan.review.status !== 'not_requested') throw conflict();
      plan.review = { status: 'pending', requestedAt: at, requestedBy: context.actorId };
      const intent: CloudIntent = { id, kind: 'review-notification', binding: bindingOf(plan.payload), planId: id, state: 'pending', createdAt: at };
      tx.put(cloudRecordKey(context, 'plan', id), plan); tx.put(intentKey, intent);
      tx.put(key, { fingerprint, response: plan }); this.audit(tx, auditKey, context, 'request-review', id, at);
      return plan;
    });
  }

  async decide(context: VerifiedCloudContext, id: string, raw: unknown, requestKey: string): Promise<CloudPlan> {
    const input = cloudDecisionSchema.parse(raw), key = this.replayKey(context, 'decide', requestKey), fingerprint = cloudDigest({ id, input });
    return this.store.transact(async tx => {
      const plan = await this.readPlan(tx, context, id); assertCloudAccess(context, plan.payload, 'decide');
      const replay = await this.replay<CloudPlan>(tx, key, fingerprint); if (replay) return replay;
      const evidence = await tx.get<CloudEvidence>(cloudRecordKey(context, 'evidence', plan.payload.evidence.snapshotId));
      const intentKey = cloudRecordKey(context, 'review-intent', id), intent = await tx.get<CloudIntent>(intentKey), auditKey = `${key}:audit`;
      await tx.get(auditKey);
      const now = this.now(), at = new Date(now).toISOString(); this.active(plan, input, now); this.validate(plan, evidence, now);
      if (plan.review.status !== 'pending' || !intent) throw conflict();
      plan.review = { ...plan.review, status: ({ approve: 'approved', reject: 'rejected', request_changes: 'changes_requested' } as const)[input.decision], decidedAt: at, decidedBy: context.actorId, note: input.note };
      intent.state = 'closed';
      tx.put(cloudRecordKey(context, 'plan', id), plan); tx.put(intentKey, intent);
      tx.put(key, { fingerprint, response: plan }); this.audit(tx, auditKey, context, 'decide', id, at);
      return plan;
    });
  }

  async requestExecution(context: VerifiedCloudContext, raw: unknown, requestKey: string): Promise<CloudExecution> {
    return (await this.requestExecutionReceipt(context, raw, requestKey)).execution;
  }

  /** Only the caller that durably creates an intent may dispatch it. A replay is read-only. */
  async requestExecutionReceipt(context: VerifiedCloudContext, raw: unknown, requestKey: string): Promise<{ execution: CloudExecution; created: boolean }> {
    const input = cloudExecutionSchema.parse(raw), key = this.replayKey(context, 'execute', requestKey), fingerprint = cloudDigest(input);
    // A replay is authorized before any provider call or expiry check.
    const preflight = await this.store.transact(async tx => {
      const plan = await this.readPlan(tx, context, input.planId); assertCloudAccess(context, plan.payload, 'execute');
      const replay = await this.replay<CloudExecution>(tx, key, fingerprint);
      if (replay) return { replay, plan };
      const evidence = await tx.get<CloudEvidence>(cloudRecordKey(context, 'evidence', plan.payload.evidence.snapshotId));
      this.active(plan, input, this.now()); this.validate(plan, evidence, this.now());
      if (plan.review.status !== 'approved') throw conflict('review_required');
      return { plan };
    });
    if (preflight.replay) return { execution: preflight.replay, created: false };
    const target = await this.adapter(preflight.plan.payload).currentTarget(structuredClone(preflight.plan.payload));
    if (cloudDigest(target) !== cloudDigest(preflight.plan.payload.target)) throw conflict('target_changed');
    const checkedAt = this.now(), executionId = randomUUID();
    return this.store.transact(async tx => {
      const plan = await this.readPlan(tx, context, input.planId); assertCloudAccess(context, plan.payload, 'execute');
      const replay = await this.replay<CloudExecution>(tx, key, fingerprint); if (replay) return { execution: replay, created: false };
      const evidence = await tx.get<CloudEvidence>(cloudRecordKey(context, 'evidence', plan.payload.evidence.snapshotId));
      const executionKey = cloudRecordKey(context, 'execution', executionId), intentKey = cloudRecordKey(context, 'dispatch-intent', executionId), auditKey = `${key}:audit`;
      await tx.get(executionKey); await tx.get(intentKey); await tx.get(auditKey);
      const now = this.now(), at = new Date(now).toISOString(); this.active(plan, input, now); this.validate(plan, evidence, now);
      this.adapter(plan.payload);
      if (plan.review.status !== 'approved' || now - checkedAt > 30_000 || now < checkedAt
        || plan.digest !== preflight.plan.digest) throw conflict();
      const execution: CloudExecution = {
        id: executionId, binding: bindingOf(plan.payload), planId: input.planId, planDigest: plan.digest,
        dataMode: plan.payload.dataMode, actionId: plan.payload.action.id, state: 'queued',
        createdAt: at, updatedAt: at, createdBy: context.actorId, message: 'Inspection queued. No provider work has started.', handoffs: [],
      };
      plan.lifecycle = 'consumed'; plan.executionId = executionId;
      const intent: CloudIntent = { id: executionId, kind: 'execution-dispatch', binding: execution.binding, planId: input.planId, executionId, state: 'pending', createdAt: at };
      tx.put(cloudRecordKey(context, 'plan', input.planId), plan); tx.put(executionKey, execution); tx.put(intentKey, intent);
      tx.put(key, { fingerprint, response: execution }); this.audit(tx, auditKey, context, 'execute', executionId, at);
      return { execution, created: true };
    });
  }

  async handoff(context: VerifiedCloudContext, id: string, raw: unknown, requestKey: string): Promise<CloudExecution> {
    const input = cloudHandoffSchema.parse(raw), key = this.replayKey(context, 'handoff', requestKey), fingerprint = cloudDigest({ id, input });
    return this.store.transact(async tx => {
      const executionKey = cloudRecordKey(context, 'execution', id), execution = await tx.get<StoredExecution>(executionKey);
      if (!execution) throw absent(); assertCloudAccess(context, execution.binding, 'handoff');
      const replay = await this.replay<CloudExecution>(tx, key, fingerprint); if (replay) return replay;
      const auditKey = `${key}:audit`; await tx.get(auditKey);
      if (execution.handoffs.length >= 100) throw new CloudOperationError(409, 'handoff_limit', 'This execution has reached its follow-up limit.');
      const at = new Date(this.now()).toISOString();
      execution.handoffs.push({ id: requestKey, at, actorId: context.actorId, note: input.note });
      // The original outcome, completion time and worker claim remain unchanged.
      tx.put(executionKey, execution); tx.put(key, { fingerprint, response: publicExecution(execution) });
      this.audit(tx, auditKey, context, 'handoff', id, at); return publicExecution(execution);
    });
  }

  async cancelQueued(context: VerifiedCloudContext, id: string, requestKey: string): Promise<CloudExecution> {
    const key = this.replayKey(context, 'cancel', requestKey), fingerprint = cloudDigest({ id });
    return this.store.transact(async tx => {
      const executionKey = cloudRecordKey(context, 'execution', id), execution = await tx.get<StoredExecution>(executionKey);
      if (!execution) throw absent(); assertCloudAccess(context, execution.binding, 'execute');
      const replay = await this.replay<CloudExecution>(tx, key, fingerprint); if (replay) return replay;
      const intentKey = cloudRecordKey(context, 'dispatch-intent', id), intent = await tx.get<CloudIntent>(intentKey), auditKey = `${key}:audit`;
      await tx.get(auditKey);
      if (execution.state !== 'queued' || !intent) throw conflict();
      const at = new Date(this.now()).toISOString();
      execution.state = 'cancelled'; execution.updatedAt = at; execution.finishedAt = at;
      execution.message = 'Cancelled before worker claim. No rollback was performed.'; intent.state = 'closed';
      tx.put(executionKey, execution); tx.put(intentKey, intent); tx.put(key, { fingerprint, response: publicExecution(execution) });
      this.audit(tx, auditKey, context, 'cancel', id, at); return publicExecution(execution);
    });
  }

  /** Internal worker entry. The transport must authenticate its task service identity. */
  async runExecution(scope: Scope, id: string, authorizeCommit?: (tx: CloudTransaction) => Promise<void>): Promise<void> {
    const token = randomUUID();
    const claimed = await this.store.transact(async tx => {
      const executionKey = cloudRecordKey(scope, 'execution', id), execution = await tx.get<StoredExecution>(executionKey);
      if (!execution || execution.state !== 'queued') return undefined;
      const plan = await this.readPlan(tx, scope, execution.planId);
      const evidence = await tx.get<CloudEvidence>(cloudRecordKey(scope, 'evidence', plan.payload.evidence.snapshotId));
      const intentKey = cloudRecordKey(scope, 'dispatch-intent', id), intent = await tx.get<CloudIntent>(intentKey);
      if (!intent || intent.state !== 'pending' || plan.executionId !== id || plan.lifecycle !== 'consumed' || execution.planDigest !== plan.digest) throw conflict();
      const now = this.now(), at = new Date(now).toISOString();
      if (Date.parse(plan.payload.expiresAt) <= now) {
        execution.state = 'cancelled'; execution.finishedAt = at; execution.updatedAt = at;
        execution.message = 'The plan expired before worker claim. No inspection was started.'; intent.state = 'closed';
        tx.put(executionKey, execution); tx.put(intentKey, intent); return undefined;
      }
      this.validate(plan, evidence, now); this.adapter(plan.payload);
      execution.state = 'running'; execution.startedAt = at; execution.updatedAt = at;
      execution.message = 'Collecting the fixed inspection.';
      execution.claim = { tokenDigest: cloudDigest(token), expiresAt: new Date(now + 120_000).toISOString() };
      intent.state = 'claimed'; tx.put(executionKey, execution); tx.put(intentKey, intent);
      return plan.payload;
    });
    if (!claimed) return;
    try {
      const adapter = this.adapter(claimed), target = await adapter.currentTarget(structuredClone(claimed));
      if (cloudDigest(target) !== cloudDigest(claimed.target)) {
        await this.finish(scope, id, token, { state: 'failed', message: 'The target changed before inspection. Prepare a new plan.' }); return;
      }
      // Recheck the lease after target lookup, which may have taken arbitrarily long.
      if (!await this.claimIsCurrent(scope, id, token)) { await this.expireClaim(scope, id); return; }
      const evidence = evidenceSchema.parse(await adapter.inspect(structuredClone(claimed)));
      const validScope = cloudDigest(bindingOf(claimed)) === cloudDigest(bindingSchema.parse({ owner: evidence.owner, workspaceId: evidence.workspaceId, environmentId: evidence.environmentId, target: evidence.target }));
      if (!validScope || evidence.dataMode !== claimed.dataMode) throw conflict('result_scope_mismatch');
      const complete = adapter.requiredSources.every(source => evidence.observations.some(item => item.source === source && item.quality === 'complete'));
      await this.finish(scope, id, token, {
        state: complete ? 'succeeded' : 'failed', evidence,
        message: complete ? 'Required inspection reads completed. This does not establish service health or remediation.' : 'Required observations are missing. Inspect the persisted evidence.',
      }, authorizeCommit);
    } catch {
      // An ambiguous response is never retried automatically and raw SDK errors are not persisted.
      await this.finish(scope, id, token, { state: 'unknown', message: 'Inspection completion could not be confirmed. Do not automatically replay this execution.' });
    }
  }
  private async claimIsCurrent(scope: Scope, id: string, token: string): Promise<boolean> {
    return this.store.transact(async tx => {
      const execution = await tx.get<StoredExecution>(cloudRecordKey(scope, 'execution', id));
      if (!execution || execution.state !== 'running' || execution.claim?.tokenDigest !== cloudDigest(token) || Date.parse(execution.claim.expiresAt) <= this.now()) return false;
      const plan = await this.readPlan(tx, scope, execution.planId);
      return Date.parse(plan.payload.expiresAt) > this.now();
    });
  }
  private async finish(scope: Scope, id: string, token: string, result: { state: 'succeeded' | 'failed' | 'unknown'; message: string; evidence?: CloudEvidence }, authorizeCommit?: (tx: CloudTransaction) => Promise<void>) {
    await this.store.transact(async tx => {
      if (result.evidence && authorizeCommit) await authorizeCommit(tx);
      const key = cloudRecordKey(scope, 'execution', id), execution = await tx.get<StoredExecution>(key);
      if (!execution || execution.state !== 'running' || execution.claim?.tokenDigest !== cloudDigest(token)) return;
      const plan = await this.readPlan(tx, scope, execution.planId);
      const intentKey = cloudRecordKey(scope, 'dispatch-intent', id), intent = await tx.get<CloudIntent>(intentKey);
      const resultKey = result.evidence ? cloudRecordKey(scope, 'evidence', result.evidence.id) : undefined;
      const existing = resultKey ? await tx.get<CloudEvidence>(resultKey) : undefined;
      const now = this.now(), at = new Date(now).toISOString();
      if (Date.parse(execution.claim.expiresAt) <= now || Date.parse(plan.payload.expiresAt) <= now) {
        execution.state = 'unknown'; execution.message = 'The worker or plan deadline expired. No automatic replay is allowed.';
      } else {
        if (result.evidence) {
          const observed = Date.parse(result.evidence.observedAt);
          if (observed < Date.parse(execution.startedAt!) || observed > now || (existing && cloudDigest(existing) !== cloudDigest(result.evidence))) throw conflict('invalid_result');
          tx.put(resultKey!, result.evidence);
          execution.result = { evidenceId: result.evidence.id, digest: cloudDigest(result.evidence), coverage: result.evidence.observations.every(item => item.quality === 'complete') ? 'complete' : 'partial', serviceAssessment: 'unknown' };
        }
        execution.state = result.state; execution.message = result.message;
      }
      execution.updatedAt = at; execution.finishedAt = at; delete execution.claim;
      if (intent) { intent.state = 'closed'; tx.put(intentKey, intent); }
      tx.put(key, execution);
    });
  }
  /** Recovery records uncertainty only. It never acquires a second claim or dispatches. */
  async expireClaim(scope: Scope, id: string): Promise<void> {
    await this.store.transact(async tx => {
      const key = cloudRecordKey(scope, 'execution', id), execution = await tx.get<StoredExecution>(key);
      if (!execution || execution.state !== 'running' || !execution.claim) return;
      const plan = await this.readPlan(tx, scope, execution.planId);
      const intentKey = cloudRecordKey(scope, 'dispatch-intent', id), intent = await tx.get<CloudIntent>(intentKey);
      const now = this.now();
      if (Date.parse(execution.claim.expiresAt) > now && Date.parse(plan.payload.expiresAt) > now) return;
      execution.state = 'unknown'; execution.updatedAt = new Date(now).toISOString(); execution.finishedAt = execution.updatedAt;
      execution.message = 'The worker or plan deadline expired. Reconciliation is required; no automatic replay.'; delete execution.claim;
      if (intent) { intent.state = 'closed'; tx.put(intentKey, intent); } tx.put(key, execution);
    });
  }
}
