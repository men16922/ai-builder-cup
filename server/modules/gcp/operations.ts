import { z } from 'zod';
import { assertCloudAccess, cloudExecutionSchema } from '../../../src/domain/cloud-operations';
import { CloudOperationError } from '../../../src/domain/cloud-workflow';
import { gcpPlanListSchema, gcpWorkflowViewSchema, gcpStoredPlanSchema, gcpExecutionSchema, type GcpPlanItem, type GcpWorkflowView } from '../../../src/modules/gcp/domain/workflow';
import { gcpInboxQuerySchema, gcpInboxSchema, type GcpInbox } from '../../../src/modules/gcp/domain/mobile';
import { cloudDigest } from '../../cloud-integrity';
import type { CloudStore } from '../../cloud-store';
import { CloudWorkflow, cloudRecordKey } from '../../cloud-workflow';
import type { GcpAnalyses } from './analyses';
import type { GcpRegistration } from './observations';
import { createCloudRunAdapters } from './inspection-adapter';
import type { GcpWebAccess, GcpWebSession } from './web-access';
import { withGcpNotificationIntents } from './notification-store';
const fail = (code = 'workflow_scope_mismatch') => new CloudOperationError(409, code, 'Refresh the stored plan or execution before continuing.');

/** Authenticated web facade. The only dispatch is an explicit first execution request. */
export class GcpOperations {
  private readonly store: CloudStore; private readonly access: GcpWebAccess; private readonly analyses: GcpAnalyses;
  private readonly registrations: readonly GcpRegistration[]; private readonly now: () => number;
  constructor(store: CloudStore, access: GcpWebAccess, analyses: GcpAnalyses, registrations: readonly GcpRegistration[], now = Date.now) {
    this.store = withGcpNotificationIntents(store, now); this.access = access; this.analyses = analyses; this.registrations = registrations.map(x => ({ ...x, binding: structuredClone(x.binding) })); this.now = now;
  }
  private workflow(session: GcpWebSession, worker = false) {
    const guarded: CloudStore = { transact: body => this.store.transact(async tx => { await this.access.assertCurrentIn(tx, session); return body(tx); }) };
    return new CloudWorkflow(worker ? this.store : guarded, ['synthetic', 'live'].flatMap(mode => createCloudRunAdapters(this.registrations, mode as 'synthetic' | 'live', async () => {
      await this.access.current(session); return session.context;
    })), this.now);
  }
  async list(session: GcpWebSession) {
    await this.access.current(session);
    return this.store.transact(async tx => { await this.access.assertCurrentIn(tx, session); return gcpPlanListSchema.parse({ owner: session.context.owner, workspaceId: session.context.workspaceId, items: await tx.get<GcpPlanItem[]>(cloudRecordKey(session.context, 'gcp-plans', 'recent')) ?? [] }); });
  }
  /** Bounded current-state summaries. A cursor is only a position, never an authorization token. */
  async inbox(session: GcpWebSession, raw: unknown): Promise<GcpInbox> {
    const query = gcpInboxQuerySchema.parse(raw); await this.access.current(session);
    return this.store.transact(async tx => {
      await this.access.assertCurrentIn(tx, session);
      const index = gcpPlanListSchema.parse({ owner: session.context.owner, workspaceId: session.context.workspaceId, items: await tx.get<GcpPlanItem[]>(cloudRecordKey(session.context, 'gcp-plans', 'recent')) ?? [] }).items;
      const position = query.cursor ? index.findIndex(item => item.id === query.cursor) : -1;
      if (query.cursor && position < 0) throw fail('inbox_changed');
      if (query.cursor) {
        const cursor = gcpStoredPlanSchema.safeParse(await tx.get(cloudRecordKey(session.context, 'plan', query.cursor)));
        if (!cursor.success || cursor.data.payload.target.provider !== 'gcp') throw fail('inbox_changed');
        assertCloudAccess(session.context, cursor.data.payload);
        if (cursor.data.payload.planId !== query.cursor || cursor.data.digest !== cloudDigest(cursor.data.payload)) throw fail('integrity_mismatch');
      }
      const items: GcpInbox['items'] = []; let nextCursor: string | undefined;
      const now = this.now();
      for (let i = position + 1; i < index.length; i++) {
        const entry = index[i], rawPlan = await tx.get(cloudRecordKey(session.context, 'plan', entry.id));
        if (!rawPlan) continue;
        const plan = gcpStoredPlanSchema.parse(rawPlan), payload = plan.payload;
        // A contaminated recent index cannot expose another provider's records to mobile.
        if (payload.target.provider !== 'gcp' || !['gcp.cloudrun.metadata.inspect.v1', 'gcp.cloudrun.inspect.v1'].includes(payload.action.id)) continue;
        assertCloudAccess(session.context, payload);
        if (payload.planId !== entry.id || plan.digest !== cloudDigest(payload)) throw fail('integrity_mismatch');
        const binding = { owner: payload.owner, workspaceId: payload.workspaceId, environmentId: payload.environmentId, target: payload.target };
        const registration = this.registrations.find(item => item.id === entry.resourceId && item.dataMode === payload.dataMode && cloudDigest(item.binding) === cloudDigest(binding));
        if (!registration) continue;
        const stored = plan.executionId ? await tx.get<Record<string, unknown>>(cloudRecordKey(session.context, 'execution', plan.executionId)) : undefined;
        let execution;
        if (stored) { const { claim: _claim, ...publicValue } = stored; execution = gcpExecutionSchema.parse(publicValue); }
        if (!!plan.executionId !== !!execution || execution && (execution.id !== plan.executionId || execution.planId !== entry.id || execution.planDigest !== plan.digest || execution.actionId !== payload.action.id || execution.dataMode !== payload.dataMode || cloudDigest(execution.binding) !== cloudDigest(binding))) throw fail('integrity_mismatch');
        const expired = Date.parse(payload.expiresAt) <= now;
        if (query.status === 'pending' && (plan.review.status !== 'pending' || plan.lifecycle !== 'prepared' || expired) || query.status === 'results' && !execution) continue;
        if (items.length === query.limit) { nextCursor = items.at(-1)!.id; break; }
        items.push({ id: entry.id, resourceId: entry.resourceId, label: registration.label, binding, dataMode: payload.dataMode,
          createdAt: payload.createdAt, expiresAt: payload.expiresAt, evidenceObservedAt: payload.evidence.observedAt,
          lifecycle: plan.lifecycle, reviewStatus: plan.review.status, executionState: execution?.state, expired });
      }
      await this.access.assertCurrentIn(tx, session);
      return gcpInboxSchema.parse({ owner: session.context.owner, workspaceId: session.context.workspaceId, serverTime: new Date(now).toISOString(), status: query.status, recentPlanLimit: 50, items, nextCursor });
    });
  }
  async get(session: GcpWebSession, id: string): Promise<GcpWorkflowView> {
    z.uuid().parse(id); const analysis = await this.analyses.get(session, id), workflow = this.workflow(session);
    const plan = await workflow.getPlan(session.context, id);
    if (analysis.planDigest !== plan.digest || cloudDigest(plan.payload) !== plan.digest) throw fail('integrity_mismatch');
    let execution = plan.executionId ? await workflow.getExecution(session.context, plan.executionId) : undefined;
    if (execution?.state === 'running') { await workflow.expireClaim(session.context, execution.id); execution = await workflow.getExecution(session.context, execution.id); }
    const evidence = execution?.result ? await workflow.getEvidence(session.context, execution.result.evidenceId) : undefined;
    if (evidence && cloudDigest(evidence) !== execution?.result?.digest) throw fail('integrity_mismatch');
    const fresh = plan.lifecycle === 'prepared' && Date.parse(plan.payload.expiresAt) > this.now(), operator = session.context.roles.includes('operator'), reviewer = session.context.roles.includes('reviewer');
    await this.access.current(session);
    return gcpWorkflowViewSchema.parse({ plan, execution, evidence, serverTime: new Date(this.now()).toISOString(), capabilities: {
      requestReview: fresh && operator && plan.review.status === 'not_requested', decide: fresh && reviewer && plan.review.status === 'pending',
      execute: fresh && operator && plan.review.status === 'approved', handoff: operator && !!execution && ['succeeded', 'failed', 'unknown', 'cancelled'].includes(execution.state), cancel: operator && execution?.state === 'queued',
    } });
  }
  async review(session: GcpWebSession, id: string, body: unknown, key: string) {
    await this.get(session, id); await this.workflow(session).requestReview(session.context, id, body, key); return this.get(session, id);
  }
  async decide(session: GcpWebSession, id: string, body: unknown, key: string) {
    await this.get(session, id); await this.workflow(session).decide(session.context, id, body, key); return this.get(session, id);
  }
  async execute(session: GcpWebSession, id: string, body: unknown, key: string) {
    const view = await this.get(session, id); const input = cloudExecutionSchema.parse(body);
    if (input.planId !== id) throw fail(); assertCloudAccess(session.context, view.plan.payload, 'execute');
    const receipt = await this.workflow(session).requestExecutionReceipt(session.context, input, key);
    // No dispatch after a retry/restart: the persisted result/queue state is returned instead.
    if (receipt.created) await this.workflow(session, true).runExecution(session.context, receipt.execution.id, tx => this.access.assertCurrentIn(tx, session));
    return this.get(session, id);
  }
  private async execution(session: GcpWebSession, id: string) {
    z.uuid().parse(id); await this.access.current(session); const execution = await this.workflow(session).getExecution(session.context, id);
    const view = await this.get(session, execution.planId); if (view.execution?.id !== id) throw fail(); return view;
  }
  async getExecution(session: GcpWebSession, id: string) { return this.execution(session, id); }
  async handoff(session: GcpWebSession, id: string, body: unknown, key: string) {
    const view = await this.execution(session, id);
    if (!view.execution || !['succeeded', 'failed', 'unknown', 'cancelled'].includes(view.execution.state)) throw fail('execution_not_terminal');
    await this.workflow(session).handoff(session.context, id, body, key); return this.get(session, view.plan.payload.planId);
  }
  async cancel(session: GcpWebSession, id: string, body: unknown, key: string) {
    z.object({}).strict().parse(body); const view = await this.execution(session, id);
    await this.workflow(session).cancelQueued(session.context, id, key); return this.get(session, view.plan.payload.planId);
  }
}
