import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CloudOperationError } from '@contracts/core/workflow';
import { agentActionSchema, agentApprovalSchema, agentCreateSchema, agentDecisionSchema, agentTaskSchema, isTerminal,
  type AgentApproval, type AgentStep, type AgentTask, type AgentTaskState } from '@contracts/gcp/agent';
import { cloudDigest } from '../store/integrity';
import type { CloudStore } from '../store/store';
import { cloudRecordKey } from '../workflow/workflow';
import { signApproval } from './agent-approval';
import type { GcpWebAccess, GcpWebSession } from '../auth/web-access';

/** The crew's front door (an A2A server). The gateway only streams from it; it never receives credentials or runs tools. */
/** Who may drive the crew: only people who own at least one registered resource in the scope. A verified Google sign-in alone is not enough. */
export type CrewEntitlement = (session: GcpWebSession) => boolean;
export interface ChiefPort { stream(message: Record<string, unknown>, signal: AbortSignal): AsyncIterable<Record<string, unknown>> }

const scopeOf = (session: GcpWebSession) => ({ owner: session.context.owner, workspaceId: session.context.workspaceId });
const taskKey = (session: GcpWebSession, id: string) => cloudRecordKey(scopeOf(session), 'agent-task', id);
const indexKey = (session: GcpWebSession) => cloudRecordKey(scopeOf(session), 'agent-tasks', 'recent');
const requestKey = (session: GcpWebSession, operation: string, key: string) => cloudRecordKey(scopeOf(session), 'agent-request', cloudDigest([session.context.actorId, operation, key]));
const unavailable = (status: number, code: string) => new CloudOperationError(status, code, 'The agent request is not available.');

// Private record. The A2A ids and the person who asked never leave the server.
type Stored = { task: AgentTask; actorId: string; callId?: string; a2a?: { taskId?: string; contextId: string }; decisionKey?: string; decisionActor?: string };
const A2A_ID = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
const sanitize = (value: unknown, limit: number) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, limit);
const iso = (ms: number) => new Date(ms).toISOString();
export const APPROVAL_WINDOW_MS = 8 * 60_000, STALE_MS = 3 * 60_000, MAX_STEPS = 60;

function summarize(value: unknown): string {
  if (typeof value === 'string') return sanitize(value, 200);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.result === 'string') return sanitize(record.result, 200);
    if (typeof record.request === 'string') return sanitize(record.request, 200);
    return sanitize(Object.entries(record).map(([k, v]) => `${k}=${typeof v === 'object' ? '…' : String(v)}`).join(' '), 200);
  }
  return '';
}

/** Folds one A2A stream event into the stored task. Pure and tolerant: unknown shapes are ignored, never trusted. */
export function applyEvent(stored: Stored, event: Record<string, unknown>, nowMs: number): Stored {
  const next: Stored = structuredClone(stored), task = next.task;
  if (isTerminal(task.state) || task.state === 'awaiting_approval') return next;
  const at = iso(nowMs), kind = event.kind;
  const status = (event.status ?? {}) as { state?: string; message?: { parts?: unknown[] } };
  const contextId = typeof event.contextId === 'string' ? event.contextId : undefined, taskId = typeof event.taskId === 'string' ? event.taskId : typeof event.id === 'string' && kind === 'task' ? event.id : undefined;
  if (contextId && A2A_ID.safeParse(contextId).success) next.a2a = { contextId, taskId: taskId && A2A_ID.safeParse(taskId).success ? taskId : next.a2a?.taskId };
  const push = (step: Omit<AgentStep, 'at'>) => { if (task.steps.length < MAX_STEPS) task.steps.push({ at, ...step }); };
  for (const raw of (kind === 'status-update' ? status.message?.parts : kind === 'message' ? (event.parts as unknown[]) : []) ?? []) {
    const part = raw as { kind?: string; data?: Record<string, unknown> };
    const data = part.data;
    if (part.kind !== 'data' || !data) continue;
    const name = typeof data.name === 'string' ? data.name : '';
    if ('args' in data && name === 'adk_request_confirmation') {
      const args = (data.args ?? {}) as { toolConfirmation?: { payload?: Record<string, unknown> } };
      const payload = args.toolConfirmation?.payload ?? {};
      const parsed = agentApprovalSchema.safeParse({ action: payload.action, risk: payload.risk, reason: sanitize(payload.reason, 500), requestedAt: at, expiresAt: iso(nowMs + APPROVAL_WINDOW_MS) });
      if (parsed.success && A2A_ID.safeParse(data.id).success) { task.approval = parsed.data; next.callId = String(data.id); }
    } else if ('args' in data && name) push({ agent: name === 'propose_rollback' ? 'chief' : name, kind: 'call', name: sanitize(name, 60), summary: summarize(data.args) });
    else if ('response' in data && name && name !== 'adk_request_confirmation') push({ agent: name === 'propose_rollback' ? 'chief' : name, kind: 'result', name: sanitize(name, 60), summary: summarize(data.response) });
  }
  if (kind === 'artifact-update') {
    const parts = ((event.artifact ?? {}) as { parts?: { kind?: string; text?: string }[] }).parts ?? [];
    const text = parts.filter(p => p.kind === 'text' && typeof p.text === 'string').map(p => p.text).join('\n');
    if (text) task.result = text.slice(0, 4000);
  }
  if (kind === 'status-update' || kind === 'task') {
    const state = status.state;
    if (state === 'input-required') {
      if (task.approval && next.callId) task.state = 'awaiting_approval';
      else { task.state = 'failed'; task.note = 'The crew asked for input this app cannot show.'; }
    } else if (state === 'completed') task.state = task.decision?.value === 'reject' ? 'rejected' : 'completed';
    else if (['failed', 'canceled', 'rejected', 'auth-required'].includes(state ?? '')) { task.state = 'failed'; task.note = 'The crew could not finish this task.'; }
    else if (task.state === 'deciding') task.state = 'deciding';
  }
  task.updatedAt = at;
  return next;
}

export class GcpAgentTasks {
  private readonly store: CloudStore; private readonly access: GcpWebAccess; private readonly chief: ChiefPort; private readonly approvalKey: Buffer; private readonly now: () => number; private readonly entitled: CrewEntitlement;
  private readonly running = new Set<Promise<void>>();
  constructor(store: CloudStore, access: GcpWebAccess, chief: ChiefPort, approvalKey: Buffer, entitled: CrewEntitlement, now = Date.now) { this.store = store; this.access = access; this.chief = chief; this.approvalKey = approvalKey; this.entitled = entitled; this.now = now; }

  private view(stored: Stored, session: GcpWebSession): AgentTask {
    const task = structuredClone(stored.task), at = this.now();
    // A worker that went silent is reported as unknown. It is never resent automatically.
    if ((task.state === 'working' || task.state === 'deciding') && at - Date.parse(task.updatedAt) > STALE_MS) { task.state = 'unknown'; task.note = 'The crew stopped reporting. Check the service state before asking again.'; }
    if (task.state === 'awaiting_approval' && task.approval && Date.parse(task.approval.expiresAt) <= at) { task.state = 'failed'; task.note = 'The approval window passed. Ask again.'; }
    if (task.decision) task.decision.byYou = stored.decisionActor === session.context.actorId;
    return agentTaskSchema.parse(task);
  }
  private async load(session: GcpWebSession, id: string): Promise<Stored> {
    const stored = await this.store.transact(async tx => { await this.access.assertCurrentIn(tx, session); return tx.get<Stored>(taskKey(session, id)); });
    if (!stored) throw unavailable(404, 'agent_task_not_found');
    return stored;
  }
  private async mutate(session: GcpWebSession, id: string, change: (stored: Stored) => Stored) {
    await this.store.transact(async tx => { const stored = await tx.get<Stored>(taskKey(session, id)); if (!stored) return; tx.put(taskKey(session, id), change(stored)); });
  }
  private require(session: GcpWebSession, role: 'operator' | 'reviewer') {
    if (!session.context.roles.includes(role)) throw unavailable(403, `${role}_required`);
  }
  private admit(session: GcpWebSession) {
    if (!this.entitled(session)) throw unavailable(403, 'crew_not_entitled');
  }
  /** Resolves when background work has settled; only tests and graceful shutdown wait on it. */
  async idle() { await Promise.allSettled([...this.running]); }

  async create(session: GcpWebSession, raw: unknown, key: string): Promise<AgentTask> {
    const input = agentCreateSchema.parse(raw); this.require(session, 'operator'); this.admit(session); z.uuid().parse(key);
    const id = randomUUID(), at = this.now(), replay = requestKey(session, 'create', key);
    const made = await this.store.transact(async tx => {
      await this.access.assertCurrentIn(tx, session);
      const existing = await tx.get<{ id: string; digest: string }>(replay), digest = cloudDigest(input);
      if (existing) { if (existing.digest !== digest) throw unavailable(409, 'idempotency_conflict'); return { id: existing.id, fresh: false as const, stored: undefined }; }
      const recent = z.array(z.uuid()).max(20).parse(await tx.get(indexKey(session)) ?? []);
      const stored: Stored = { actorId: session.context.actorId, task: { id, state: 'working', instruction: sanitize(input.instruction, 1000), language: input.language, createdAt: iso(at), updatedAt: iso(at), steps: [] } };
      await tx.get(taskKey(session, id));
      tx.put(replay, { id, digest }); tx.put(taskKey(session, id), stored); tx.put(indexKey(session), [id, ...recent].slice(0, 20));
      return { id, fresh: true, stored };
    });
    if (made.fresh) {
      const message = { kind: 'message', messageId: randomUUID(), role: 'user', parts: [{ kind: 'text', text: input.language === 'ko' ? `${input.instruction}\n\n(Answer in Korean.)` : input.instruction }] };
      this.launch(session, made.id, message);
    }
    // The response describes the task as accepted; progress is read with get().
    return this.view(made.stored ?? await this.load(session, made.id), session);
  }

  async get(session: GcpWebSession, id: string): Promise<AgentTask> { z.uuid().parse(id); return this.view(await this.load(session, id), session); }
  async list(session: GcpWebSession) {
    const ids = await this.store.transact(async tx => { await this.access.assertCurrentIn(tx, session); return z.array(z.uuid()).max(20).parse(await tx.get(indexKey(session)) ?? []); });
    const items: AgentTask[] = [];
    for (const id of ids) { try { items.push(await this.get(session, id)); } catch { /* A record the person cannot read is skipped. */ } }
    return { items };
  }

  async decide(session: GcpWebSession, id: string, raw: unknown, key: string): Promise<AgentTask> {
    const input = agentDecisionSchema.parse(raw); z.uuid().parse(id); z.uuid().parse(key); this.require(session, 'reviewer'); this.admit(session);
    const replay = requestKey(session, 'decide', key), at = this.now();
    const outcome = await this.store.transact(async tx => {
      await this.access.assertCurrentIn(tx, session);
      const prior = await tx.get<{ id: string; value: string }>(replay);
      if (prior) { if (prior.id !== id || prior.value !== input.decision) throw unavailable(409, 'idempotency_conflict'); return { dispatch: false as const }; }
      const stored = await tx.get<Stored>(taskKey(session, id));
      if (!stored) throw unavailable(404, 'agent_task_not_found');
      const { task } = stored;
      if (task.state !== 'awaiting_approval' || !task.approval || !stored.callId || !stored.a2a) throw unavailable(409, 'not_awaiting_approval');
      if (Date.parse(task.approval.expiresAt) <= at) throw unavailable(410, 'approval_expired');
      stored.task = { ...task, state: 'deciding', updatedAt: iso(at), decision: { value: input.decision, at: iso(at), byYou: true } }; stored.decisionKey = key; stored.decisionActor = session.context.actorId;
      tx.put(taskKey(session, id), stored); tx.put(replay, { id, value: input.decision });
      return { dispatch: true as const, stored };
    });
    if (outcome.dispatch) {
      const { stored } = outcome, approval = stored.task.approval as AgentApproval, a2a = stored.a2a!;
      const response = input.decision === 'approve'
        ? { confirmed: true, payload: { approval: signApproval(this.approvalKey, agentActionSchema.parse(approval.action), session.context.actorId, 300, at) } }
        : { confirmed: false, payload: {} };
      const message = { kind: 'message', messageId: randomUUID(), role: 'user', contextId: a2a.contextId, ...(a2a.taskId ? { taskId: a2a.taskId } : {}),
        parts: [{ kind: 'data', data: { id: stored.callId, name: 'adk_request_confirmation', response }, metadata: { adk_type: 'function_response' } }] };
      this.launch(session, id, message);
      return this.view(stored, session);
    }
    return this.get(session, id);
  }

  /** Streams the crew's progress into the stored record. The request that started it has already returned. */
  private launch(session: GcpWebSession, id: string, message: Record<string, unknown>) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 240_000);
    const job = (async () => {
      try {
        for await (const event of this.chief.stream(message, controller.signal)) await this.mutate(session, id, stored => applyEvent(stored, event, this.now()));
        // A stream that ends without a terminal or input-required state is an unknown outcome, never a silent success.
        await this.mutate(session, id, stored => {
          const state: AgentTaskState = stored.task.state;
          return state === 'working' || state === 'deciding' ? { ...stored, task: { ...stored.task, state: 'unknown', note: 'The crew stopped before finishing.', updatedAt: iso(this.now()) } } : stored;
        });
      } catch {
        await this.mutate(session, id, stored => isTerminal(stored.task.state) || stored.task.state === 'awaiting_approval' ? stored
          : { ...stored, task: { ...stored.task, state: 'unknown', note: 'The connection to the crew was lost. It was not retried.', updatedAt: iso(this.now()) } }).catch(() => undefined);
      } finally { clearTimeout(timer); }
    })();
    this.running.add(job); void job.finally(() => this.running.delete(job));
  }
}
