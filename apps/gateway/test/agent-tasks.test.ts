import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SqliteCloudStore } from '../src/store/sqlite-store';
import { GcpWebAccess } from '../src/auth/web-access';
import { GcpAgentTasks, applyEvent, type ChiefPort } from '../src/crew/agent-tasks';
import { actionDigest, signApproval, type SignedApproval } from '../src/crew/agent-approval';
import { agentTaskSchema } from '@contracts/gcp/agent';
import type { ApprovalReviewPort } from '../src/crew/approval-review';
import { createGcpApiServer, type GcpApiServices } from '../src/http/api';
import { GcpObservations } from '../src/workflow/observations';

const KEY = Buffer.from('gateway-approval-key-for-tests-0123456789');
const action = { action: 'rollback_traffic', service: 'shop-api', revision: 'shop-api-good' } as const;
const ids = { task: 'a2a-task-synthetic-1', context: 'a2a-context-synthetic-1', call: 'adk-confirm-synthetic-1' };
const reviewState={uid:'synthetic-uid',etag:'synthetic-etag',update_time:'2026-10-10T00:59:00.000Z',observed_at:'2026-10-10T01:00:00.000Z'};

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
  const review:ApprovalReviewPort={allows:(_owner,_workspace,action,uid)=>action.service==='shop-api'&&action.revision==='shop-api-good'&&uid===reviewState.uid,
    async read(_session,action){if(!this.allows(_session.context.owner,_session.context.workspaceId,action,reviewState.uid))throw Error('unregistered');
      return {state:{...reviewState,observed_at:new Date(clock).toISOString()},display:{observedAt:new Date(clock).toISOString(),traffic:[{revision:'shop-api-bad',percent:100}]}};}};
  const chief = new FakeChief(script), denied = new Set<string>(), tasks = new GcpAgentTasks(store, access, chief, KEY, session => !denied.has(session.context.actorId), now,review);
  const org = { edition: 'organization' as const, organizationId: 'synthetic-org', workspaceId: 'synthetic-workspace', label: 'Synthetic' };
  const provision = (actorId: string, roles: ('viewer' | 'operator' | 'reviewer')[]) => access.organization.provision({ organizationId: org.organizationId, workspaceId: org.workspaceId, actorId, version: 1, active: true, roles, updatedAt: new Date(clock).toISOString() });
  await provision('user-a', options.roles ?? ['operator', 'reviewer']); await provision('user-b', ['operator']); await provision('user-c', ['viewer']);
  const session = (token: string) => access.authenticate(`Bearer ${token}`, org, 'mobile');
  return { tasks, chief, session, denied, advance: (ms: number) => { clock += ms; }, store,access,review,now,provision };
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
  const s = await setup(t, (_message, index) => index === 0 ? first() : [call('propose_rollback', action), result('propose_rollback', { status: 'applied' }), ...finish('Rolled back shop-api to shop-api-good.')]);
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
  const expected = signApproval(KEY, action, 'user-a', 300, Date.parse('2026-10-10T01:00:00.000Z'),reviewState,task.id);
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

test('a change result is shown as its execution state and reason', () => {
  const working = { actorId: 'a', task: { id: randomUUID(), state: 'working' as const, instruction: 'x', language: 'en' as const, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), steps: [] } };
  const shown = (response: unknown) => applyEvent(working, result('propose_rollback', response), 1000).task.steps.at(-1)?.summary;
  assert.equal(shown({ status: 'pending', error: 'Cloud Run accepted the change and has not finished it yet.' }), 'pending: Cloud Run accepted the change and has not finished it yet.');
  assert.equal(shown({ status: 'unknown', executed: false }), 'unknown');
  assert.equal(shown({ status: 'applied', executed: true, approved_by: 'u1' }), 'applied');
});

test('the TypeScript signer matches the Python verifier byte for byte', () => {
  const reviewed={uid:'synthetic-uid',etag:'synthetic-etag',update_time:'2023-11-14T22:12:00.000Z',observed_at:'2023-11-14T22:13:20.000Z'},grantId='11111111-1111-4111-8111-111111111111';
  const approval = signApproval(Buffer.from('cross-language-test-key-0123456789'), { action: 'rollback_traffic', service: 'shop-api', revision: 'shop-api-good' }, 'actor-hash-1', 300, 1_700_000_000_000,reviewed,grantId);
  assert.equal(approval.digest,'38bada923e26be62e473360da022f96343b842182cf96cf3a8bcd5014eba137c');
  assert.equal(approval.signature,'mzjovoXUVh40S5_l2S271ZqBAkWBh4beNKHlOehxtXk');
  assert.throws(() => signApproval(Buffer.alloc(0), action, 'a', 300, 0,reviewed,grantId));
});

async function issuedGrant(t:TestContext){
  const s=await setup(t,(_message,index)=>index===0?first():finish('Synthetic completion'));
  const reviewer=await s.session('user-a'),task=await s.tasks.create(reviewer,{instruction:'Review shop-api'},randomUUID());
  await s.tasks.idle();await s.tasks.decide(reviewer,task.id,{decision:'approve'},randomUUID());await s.tasks.idle();
  const message=s.chief.messages[1] as {parts:{data:{response:{payload:{approval:SignedApproval}}}}[]};
  return {...s,grant:message.parts[0].data.response.payload.approval};
}
test('a durable grant can be redeemed once across reconstructed gateway instances without storing bearer sessions',async t=>{
  const s=await issuedGrant(t);
  const second=new GcpAgentTasks(s.store,s.access,s.chief,KEY,()=>true,s.now,s.review);
  const results=await Promise.allSettled([s.tasks.claimExecution(s.grant),second.claimExecution(s.grant)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.filter(result=>result.status==='rejected').length,1);
  await assert.rejects(second.claimExecution(s.grant),/not available/);
  const record=await s.store.transact(tx=>tx.get<Record<string,unknown>>('crew-execution-grant:'+s.grant.grant_id));
  assert.equal(record?.state,'claimed');assert.doesNotMatch(JSON.stringify(record),/authorization|Bearer|recipient|issuer|subject/);
});
test('tampered, unissued, expired and revoked-membership grants cannot be redeemed',async t=>{
  const s=await issuedGrant(t);
  for(const raw of [{...s.grant,actor:'user-b'},{...s.grant,reviewed_state:{...s.grant.reviewed_state,etag:'changed'}},{...s.grant,grant_id:randomUUID()},
    {...s.grant,context:{roles:['reviewer']}}, {...s.grant,version:1}])await assert.rejects(s.tasks.claimExecution(raw));
  await s.access.organization.provision({organizationId:'synthetic-org',workspaceId:'synthetic-workspace',actorId:'user-a',roles:['viewer'],version:2,active:false,updatedAt:new Date(s.now()).toISOString()});
  await assert.rejects(s.tasks.claimExecution(s.grant));
  const expired=await issuedGrant(t);expired.advance(300000);await assert.rejects(expired.tasks.claimExecution(expired.grant));
});

test('the HTTP broker requires Origin and a signed capability, never a client context or native bypass',async t=>{
  const s=await issuedGrant(t),services:GcpApiServices={access:s.access,observations:new GcpObservations(s.store,s.access,[]),agents:s.tasks,publicOrigin:'http://127.0.0.1'};
  const server=createGcpApiServer(services);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const address=server.address();assert.ok(address&&typeof address!=='string');services.publicOrigin=`http://127.0.0.1:${address.port}`;
  const call=(body:unknown,authorization=`Bearer ${s.grant.signature}`,origin:string|undefined=services.publicOrigin)=>fetch(services.publicOrigin+'/api/gcp/crew/execution-claims',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:authorization,...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
  assert.equal((await call({approval:s.grant},'Bearer user-a')).status,403);
  assert.equal((await call({approval:s.grant},`Bearer ${s.grant.signature}`,'https://attacker.invalid')).status,403);
  assert.equal((await call({approval:s.grant},`Bearer ${s.grant.signature}`,'' )).status,403);
  assert.equal((await call({approval:s.grant,context:{roles:['reviewer']}})).status,400);
  const claimed=await call({approval:s.grant});assert.equal(claimed.status,200);assert.deepEqual(await claimed.json(),{claimed:true});
  const replay=await call({approval:s.grant});assert.equal(replay.status,409);assert.doesNotMatch(await replay.text(),new RegExp(s.grant.signature+'|synthetic-uid'));
});

test('a verified person who owns no registered resource cannot start or decide a crew task', async t => {
  const s = await setup(t, () => first()), session = await s.session('user-a');
  const created = await s.tasks.create(session, { instruction: 'Checkout is failing on shop-api, handle it.', language: 'en' }, randomUUID());
  await s.tasks.idle();
  s.denied.add('user-a');
  await assert.rejects(s.tasks.create(session, { instruction: 'Another request for the crew.', language: 'en' }, randomUUID()), { status: 403, code: 'crew_not_entitled' });
  await assert.rejects(s.tasks.decide(session, created.id, { decision: 'approve' }, randomUUID()), { status: 403, code: 'crew_not_entitled' });
  assert.equal(s.chief.messages.length, 1, 'the crew was not contacted again');
  // Reading what the person already owns stays possible; it grants nothing new.
  assert.equal((await s.tasks.list(session)).items.length, 1);
});
