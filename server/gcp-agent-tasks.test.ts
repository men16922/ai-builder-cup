import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SqliteCloudStore } from './cloud-sqlite-store';
import { GcpWebAccess } from './modules/gcp/web-access';
import { GcpAgentTasks, applyEvent, type ChiefPort } from './modules/gcp/agent-tasks';
import { actionDigest, signApproval } from './modules/gcp/agent-approval';
import { agentTaskSchema } from '../src/modules/gcp/domain/agent';

const KEY = Buffer.from('gateway-approval-key-for-tests-0123456789');
const action = { action: 'rollback_traffic', service: 'shop-api', revision: 'shop-api-good' } as const;
const ids = { task: 'a2a-task-synthetic-1', context: 'a2a-context-synthetic-1', call: 'adk-confirm-synthetic-1' };

const call = (name: string, args: unknown) => ({ kind: 'status-update', taskId: ids.task, contextId: ids.context, final: false, status: { state: 'working', message: { kind: 'message', role: 'agent', parts: [{ kind: 'data', data: { id: `c-${name}`, name, args }, metadata: { adk_type: 'function_call' } }] } } });
const result = (name: string, response: unknown) => ({ kind: 'status-update', taskId: ids.task, contextId: ids.context, final: false, status: { state: 'working', message: { kind: 'message', role: 'agent', parts: [{ kind: 'data', data: { id: `c-${name}`, name, response }, metadata: { adk_type: 'function_response' } }] } } });
const pause = (payload: unknown = { action, risk: 'medium', reason: 'shop-api-bad fails 55% of requests while shop-api-good was healthy.' }) => ({ kind: 'status-update', taskId: ids.task, contextId: ids.context, final: true,
  status: { state: 'input-required', message: { kind: 'message', role: 'agent', parts: [{ kind: 'data', data: { id: ids.call, name: 'adk_request_confirmation', args: { toolConfirmation: { hint: 'x', confirmed: false, payload }, originalFunctionCall: { name: 'propose_rollback' } } }, metadata: { adk_type: 'function_call', adk_is_long_running: true } }] } } });
const finish = (text: string) => [{ kind: 'artifact-update', taskId: ids.task, contextId: ids.context, artifact: { parts: [{ kind: 'text', text }] } }, { kind: 'status-update', taskId: ids.task, contextId: ids.context, final: true, status: { state: 'completed' } }];
const first = () => [{ kind: 'task', id: ids.task, contextId: ids.context, status: { state: 'submitted' } }, call('ops', { request: 'Read shop-api' }), result('ops', { result: 'Revision shop-api-bad: 55% 5xx, p95 1300 ms.' }), call('guardian', { request: 'rollback_traffic' }), result('guardian', { result: 'Needs a person.' }), pause()];

class FakeChief implements ChiefPort {
  messages: Record<string, unknown>[] = [];
  private readonly script: (message: Record<string, unknown>, index: number) => Record<string, unknown>[] | Error;
  constructor(script: (message: Record<string, unknown>, index: number) => Record<string, unknown>[] | Error) { this.script = script; }
  async *stream(message: Record<string, unknown>) {
    const outcome = this.script(message, this.messages.length); this.messages.push(message);
    if (outcome instanceof Error) throw outcome;
    for (const event of outcome) yield event;
  }
}

async function setup(t: TestContext, script: ConstructorParameters<typeof FakeChief>[0], options: { roles?: ('viewer' | 'operator' | 'reviewer')[] } = {}) {
  let clock = Date.parse('2026-10-10T01:00:00.000Z'); const now = () => clock;
  const store = new SqliteCloudStore(':memory:'); t.after(() => store.close());
  const access = new GcpWebAccess({ async verify(token) { if (!['user-a', 'user-b', 'user-c'].includes(token)) throw Error(); return { actorId: token, expiresAt: clock + 3600000 }; } }, store, now);
  const chief = new FakeChief(script), tasks = new GcpAgentTasks(store, access, chief, KEY, now);
  const org = { edition: 'organization' as const, organizationId: 'synthetic-org', workspaceId: 'synthetic-workspace', label: 'Synthetic' };
  const provision = (actorId: string, roles: ('viewer' | 'operator' | 'reviewer')[]) => access.organization.provision({ organizationId: org.organizationId, workspaceId: org.workspaceId, actorId, version: 1, active: true, roles, updatedAt: new Date(clock).toISOString() });
  await provision('user-a', options.roles ?? ['operator', 'reviewer']); await provision('user-b', ['operator']); await provision('user-c', ['viewer']);
  const session = (token: string) => access.authenticate(`Bearer ${token}`, org, 'mobile');
  return { tasks, chief, session, advance: (ms: number) => { clock += ms; }, store };
}

test('an instruction is accepted at once, the crew streams progress into the record, and the task pauses for a person', async t => {
  const s = await setup(t, () => first()), session = await s.session('user-a'), key = randomUUID();
  const created = await s.tasks.create(session, { instruction: 'Checkout is failing\u0000 on shop-api, handle it.', language: 'en' }, key);
  assert.equal(created.state, 'working'); assert.equal(created.instruction, 'Checkout is failing  on shop-api, handle it.');
  await s.tasks.idle();
  const view = await s.tasks.get(session, created.id);
  assert.equal(view.state, 'awaiting_approval'); assert.deepEqual(view.approval?.action, action); assert.equal(view.approval?.risk, 'medium');
  assert.deepEqual(view.steps.map(step => `${step.kind}:${step.name}`), ['call:ops', 'result:ops', 'call:guardian', 'result:guardian']);
  assert.equal(agentTaskSchema.safeParse(view).success, true);
  // Nothing private reaches the view: no A2A ids, no confirmation call id, no actor.
  assert.doesNotMatch(JSON.stringify(view), new RegExp(`${ids.task}|${ids.context}|${ids.call}|user-a`));
  // The same Idempotency-Key never starts a second crew run.
  const again = await s.tasks.create(session, { instruction: 'Checkout is failing\u0000 on shop-api, handle it.', language: 'en' }, key);
  await s.tasks.idle(); assert.equal(again.id, created.id); assert.equal(s.chief.messages.length, 1);
  await assert.rejects(s.tasks.create(session, { instruction: 'something else', language: 'en' }, key), /not available/);
});

test('only a reviewer decides, an approval is signed over exactly the stored action, and the person never supplies it', async t => {
  const s = await setup(t, (_message, index) => index === 0 ? first() : [call('propose_rollback', action), result('propose_rollback', { status: 'executed' }), ...finish('Rolled back shop-api to shop-api-good.')]);
  const operator = await s.session('user-b'), reviewer = await s.session('user-a'), viewer = await s.session('user-c');
  await assert.rejects(s.tasks.create(viewer, { instruction: 'fix it' }, randomUUID()), /operator_required|not available/);
  const task = await s.tasks.create(operator, { instruction: 'fix it', language: 'en' }, randomUUID()); await s.tasks.idle();
  await assert.rejects(s.tasks.decide(operator, task.id, { decision: 'approve' }, randomUUID()), /reviewer_required|not available/);
  assert.equal(s.chief.messages.length, 1);
  await assert.rejects(s.tasks.decide(reviewer, task.id, { decision: 'approve', approval: { forged: true }, action: { service: 'payments' } }, randomUUID()));
  const key = randomUUID(), deciding = await s.tasks.decide(reviewer, task.id, { decision: 'approve' }, key);
  assert.equal(deciding.state, 'deciding'); assert.equal(deciding.decision?.byYou, true);
  await s.tasks.idle();
  const done = await s.tasks.get(reviewer, task.id);
  assert.equal(done.state, 'completed'); assert.match(done.result ?? '', /Rolled back/);
  const resume = s.chief.messages[1] as { taskId: string; contextId: string; parts: { data: { id: string; name: string; response: { confirmed: boolean; payload: { approval: { digest: string; actor: string; expires_at: number; signature: string } } } } }[] };
  assert.equal(resume.taskId, ids.task); assert.equal(resume.contextId, ids.context);
  const data = resume.parts[0].data; assert.equal(data.id, ids.call); assert.equal(data.name, 'adk_request_confirmation'); assert.equal(data.response.confirmed, true);
  const expected = signApproval(KEY, action, 'user-a', 300, Date.parse('2026-10-10T01:00:00.000Z'));
  assert.deepEqual(data.response.payload.approval, expected); assert.equal(expected.digest, actionDigest(action));
  // Replaying the decision with the same key neither re-signs nor re-sends; a different key is a conflict.
  assert.equal((await s.tasks.decide(reviewer, task.id, { decision: 'approve' }, key)).state, 'completed'); assert.equal(s.chief.messages.length, 2);
  await assert.rejects(s.tasks.decide(reviewer, task.id, { decision: 'reject' }, randomUUID()), /not available/);
  await assert.rejects(s.tasks.decide(reviewer, task.id, { decision: 'approve' }, randomUUID()), /not available/);
  assert.equal(s.chief.messages.length, 2);
});

test('a rejection sends no approval and ends as rejected', async t => {
  const s = await setup(t, (_m, index) => index === 0 ? first() : finish('Understood. I made no change.'));
  const session = await s.session('user-a'), task = await s.tasks.create(session, { instruction: 'fix it' }, randomUUID()); await s.tasks.idle();
  await s.tasks.decide(session, task.id, { decision: 'reject' }, randomUUID()); await s.tasks.idle();
  const view = await s.tasks.get(session, task.id); assert.equal(view.state, 'rejected');
  const answer = (s.chief.messages[1] as { parts: { data: { response: { confirmed: boolean; payload: object } } }[] }).parts[0].data.response;
  assert.equal(answer.confirmed, false); assert.deepEqual(answer.payload, {});
});

test('a late approval, a lost stream and a silent worker are unknown or failed and are never resent', async t => {
  const s = await setup(t, (_m, index) => index === 0 ? first() : new Error('connection reset'));
  const session = await s.session('user-a'), task = await s.tasks.create(session, { instruction: 'fix it' }, randomUUID()); await s.tasks.idle();
  s.advance(9 * 60_000);
  await assert.rejects(s.tasks.decide(session, task.id, { decision: 'approve' }, randomUUID()), /not available/);
  assert.equal((await s.tasks.get(session, task.id)).state, 'failed'); assert.equal(s.chief.messages.length, 1);
  const lost = await setup(t, (_m, index) => index === 0 ? first() : new Error('connection reset')), reviewer = await lost.session('user-a');
  const pending = await lost.tasks.create(reviewer, { instruction: 'fix it' }, randomUUID()); await lost.tasks.idle();
  await lost.tasks.decide(reviewer, pending.id, { decision: 'approve' }, randomUUID()); await lost.tasks.idle();
  const view = await lost.tasks.get(reviewer, pending.id); assert.equal(view.state, 'unknown'); assert.match(view.note ?? '', /not retried/); assert.equal(lost.chief.messages.length, 2);
  const silent = await setup(t, () => [{ kind: 'task', id: ids.task, contextId: ids.context, status: { state: 'submitted' } }]), person = await silent.session('user-a');
  const quiet = await silent.tasks.create(person, { instruction: 'fix it' }, randomUUID()); await silent.tasks.idle();
  assert.equal((await silent.tasks.get(person, quiet.id)).state, 'unknown');
});

test('a malformed or unexpected approval request fails the task instead of asking a person', async t => {
  for (const payload of [{ action: { action: 'delete_service', service: 'shop-api', revision: 'x' }, risk: 'medium', reason: 'r' }, { action: { ...action, service: 'Bad Name!' }, risk: 'medium', reason: 'r' }, { action, risk: 'catastrophic', reason: 'r' }, {}]) {
    const s = await setup(t, () => [{ kind: 'task', id: ids.task, contextId: ids.context, status: { state: 'submitted' } }, pause(payload)]);
    const session = await s.session('user-a'), task = await s.tasks.create(session, { instruction: 'fix it' }, randomUUID()); await s.tasks.idle();
    const view = await s.tasks.get(session, task.id); assert.equal(view.state, 'failed'); assert.equal(view.approval, undefined);
  }
});

test('records are scoped to their workspace and owner, and untrusted step text is cleaned and bounded', async t => {
  const s = await setup(t, () => [{ kind: 'task', id: ids.task, contextId: ids.context, status: { state: 'submitted' } }, call('ops', { request: `read\u0007 ${'x'.repeat(900)}` }), pause()]);
  const owner = await s.session('user-a'), task = await s.tasks.create(owner, { instruction: 'fix it' }, randomUUID()); await s.tasks.idle();
  const view = await s.tasks.get(owner, task.id); assert.ok(view.steps[0].summary.length <= 200); assert.doesNotMatch(view.steps[0].summary, /\u0007/);
  const personal = await s.tasks.get(owner, task.id); assert.equal(personal.id, task.id);
  const other = await s.session('user-b');
  assert.equal((await s.tasks.list(other)).items.length, 1);  // same workspace, same record index
  const elsewhere = await new GcpWebAccess({ async verify() { return { actorId: 'user-a', expiresAt: Date.parse('2026-10-10T01:00:00.000Z') + 3600000 }; } }, s.store, () => Date.parse('2026-10-10T01:00:00.000Z'))
    .authenticate('Bearer user-a', { edition: 'personal', workspaceId: 'synthetic-workspace', label: 'Personal' }, 'mobile');
  await assert.rejects(s.tasks.get(elsewhere, task.id), /not available/);
  assert.deepEqual((await s.tasks.list(elsewhere)).items, []);
});

test('applyEvent ignores events after an approval is pending and never trusts unknown shapes', () => {
  const base = { actorId: 'a', task: { id: randomUUID(), state: 'awaiting_approval' as const, instruction: 'x', language: 'en' as const, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), steps: [] } };
  assert.equal(applyEvent(base, { kind: 'status-update', status: { state: 'completed' } }, 1000).task.state, 'awaiting_approval');
  const working = { ...base, task: { ...base.task, state: 'working' as const } };
  assert.equal(applyEvent(working, { kind: 'surprise', status: 'nonsense', parts: 'nope' }, 1000).task.state, 'working');
});

test('the TypeScript signer matches the Python verifier byte for byte', () => {
  const approval = signApproval(Buffer.from('cross-language-test-key-0123456789'), { action: 'rollback_traffic', service: 'shop-api', revision: 'shop-api-good' }, 'actor-hash-1', 300, 1_700_000_000_000);
  assert.deepEqual(approval, { digest: '38bada923e26be62e473360da022f96343b842182cf96cf3a8bcd5014eba137c', actor: 'actor-hash-1', expires_at: 1700000300, signature: 'mQLTf1wvOG7mVjFaU8z1S_iUS2GmwWeUdML140mRoYI' });
  assert.throws(() => signApproval(Buffer.alloc(0), action, 'a', 300, 0));
});
