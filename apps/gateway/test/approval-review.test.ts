import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { approvalReviewPort, type ApprovalTarget } from '../src/crew/approval-review';
import { GcpWebAccess } from '../src/auth/web-access';
import { SqliteCloudStore } from '../src/store/sqlite-store';
import { gcpServerConfiguration } from '../src/config/configuration';
import { composeGcpServices } from '../src/config/composition';
import type { CloudRunTransport } from '../src/cloud-run/transport';

const clock = Date.parse('2026-10-15T01:00:00Z');
const action = { action: 'rollback_traffic', service: 'checkout-demo', revision: 'checkout-demo-good' } as const;
const example = async () => gcpServerConfiguration.parse(JSON.parse(await readFile('deploy/gateway.config.example.json', 'utf8')));
const response = (target: ApprovalTarget) => ({ name: target.binding.target.resourceName, uid: target.binding.target.resourceUid,
  etag: 'synthetic-reviewed-etag', updateTime: '2026-10-15T00:59:00Z',
  trafficStatuses: [{ revision: 'checkout-demo-00001', percent: 100 }],
});
const transport = (read: CloudRunTransport['read']): CloudRunTransport => ({ dataMode: 'synthetic', async identity() { return 'synthetic'; }, read });

test('only an explicit owner/workspace/UID/destination binding permits a proposal, including a different observed revision', async t => {
  const input = await example(), store = new SqliteCloudStore(':memory:'); t.after(() => store.close());
  const scope = input.scopes[0]; if (scope.edition !== 'organization') throw Error();
  const access = new GcpWebAccess({ async verify() { return { actorId: 'reviewer', expiresAt: clock + 3600000 }; } }, store, () => clock);
  await access.organization.provision({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, actorId: 'reviewer', version: 1, active: true, roles: ['operator', 'reviewer'], updatedAt: new Date(clock).toISOString() });
  const session = await access.authenticate('Bearer synthetic-user', scope);
  const target = { binding: input.resources[0].binding, rollbackRevisions: [action.revision] };
  let reads = 0;
  const port = approvalReviewPort([target], () => transport(async operation => { assert.equal(operation, 'service'); reads++; return { ...response(target), secret: 'never-public' }; }), () => clock);
  const review = await port.read(session, action, new AbortController().signal);
  assert.deepEqual(review.display, { observedAt: new Date(clock).toISOString(), traffic: [{ revision: 'checkout-demo-00001', percent: 100 }] });
  assert.doesNotMatch(JSON.stringify(review.display), /uid|etag|never-public/);
  assert.equal(port.allows(session.context.owner, scope.workspaceId, action, target.binding.target.resourceUid), true);
  const refused = [
    { owner: { kind: 'personal', userId: 'reviewer' } as const, workspace: scope.workspaceId, action, uid: target.binding.target.resourceUid },
    { owner: session.context.owner, workspace: 'other-workspace', action, uid: target.binding.target.resourceUid },
    { owner: session.context.owner, workspace: scope.workspaceId, action: { ...action, revision: 'checkout-demo-unregistered' }, uid: target.binding.target.resourceUid },
    { owner: session.context.owner, workspace: scope.workspaceId, action, uid: 'replacement-uid' },
  ];
  for (const value of refused) assert.equal(port.allows(value.owner, value.workspace, value.action, value.uid), false);
  assert.equal(approvalReviewPort([], () => { throw Error('no reads'); }).allows(session.context.owner, scope.workspaceId, action, target.binding.target.resourceUid), false);
  const duplicate = approvalReviewPort([target, target], () => { throw Error('no reads'); });
  assert.equal(duplicate.allows(session.context.owner, scope.workspaceId, action, target.binding.target.resourceUid), false);
  await assert.rejects(duplicate.read(session, action, new AbortController().signal), /not_registered/);
  await assert.rejects(port.read(session, { ...action, revision: 'checkout-demo-unregistered' }, new AbortController().signal), /not_registered/);
  assert.equal(reads, 1);
});

test('incomplete, replaced, future or malformed service evidence never becomes a reviewed state', async t => {
  const input = await example(), store = new SqliteCloudStore(':memory:'); t.after(() => store.close());
  const scope = input.scopes[0]; if (scope.edition !== 'organization') throw Error();
  const access = new GcpWebAccess({ async verify() { return { actorId: 'reviewer', expiresAt: clock + 3600000 }; } }, store, () => clock);
  await access.organization.provision({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, actorId: 'reviewer', version: 1, active: true, roles: ['reviewer'], updatedAt: new Date(clock).toISOString() });
  const session = await access.authenticate('Bearer synthetic-user', scope), target = { binding: input.resources[0].binding, rollbackRevisions: [action.revision] }, raw = response(target);
  for (const patch of [{ uid: 'replacement-uid' }, { name: raw.name + '-other' }, { etag: undefined }, { etag: 'bad\nheader' }, { updateTime: undefined },
    { updateTime: '2026-10-15T01:01:00Z' }, { trafficStatuses: [] }, { trafficStatuses: [{ revision: 'checkout-demo-00001', percent: 90 }] },
    { trafficStatuses: [{ revision: 'not a revision', percent: 100 }] }]) {
    const port = approvalReviewPort([target], () => transport(async () => ({ ...raw, ...patch })), () => clock);
    await assert.rejects(port.read(session, action, new AbortController().signal));
  }
  const abort = new AbortController();
  const port = approvalReviewPort([target], () => transport(async () => { abort.abort(); return raw; }), () => clock);
  await assert.rejects(port.read(session, action, abort.signal));
});

test('startup configuration separates read registrations from explicit mutation targets and rejects ambiguous scopes', async () => {
  const input = await example(), binding = input.resources[0].binding;
  const agents = { enabled: true, services: [{ name: action.service, region: binding.target.location }], chiefUrl: 'https://chief.example.invalid',
    executionTargets: [{ binding, rollbackRevisions: [action.revision] }] };
  assert.equal(gcpServerConfiguration.safeParse({ ...input, agents }).success, true);
  assert.deepEqual(gcpServerConfiguration.parse({ ...input, agents: { ...agents, executionTargets: undefined } }).agents?.executionTargets, []);
  for (const changed of [
    { ...agents, executionTargets: [...agents.executionTargets, ...agents.executionTargets] },
    { ...agents, services: [] }, { ...agents, services: [{ name: action.service, region: 'us-central1' }] },
    { ...agents, executionTargets: [{ binding: { ...binding, workspaceId: 'other-workspace' }, rollbackRevisions: [action.revision] }] },
    { ...agents, executionTargets: [{ binding, rollbackRevisions: [action.revision, action.revision] }] },
    { ...agents, executionTargets: [{ binding, rollbackRevisions: [] }] },
    { ...agents, executionTargets: [{ binding, rollbackRevisions: ['attacker/other'] }] },
  ]) assert.equal(gcpServerConfiguration.safeParse({ ...input, agents: changed }).success, false);
});

test('composed gateway captures reviewed state and redeems one grant for an explicit recovery target separate from the read target', async t => {
  const input = await example(), binding = structuredClone(input.resources[0].binding);
  binding.target = { ...binding.target, resourceId: 'recovery-service', resourceName: binding.target.resourceName.replace('checkout-demo', 'recovery-service'), resourceUid: 'synthetic-recovery-uid', revision: 'recovery-service-bad' };
  const recovery = { ...action, service: 'recovery-service', revision: 'recovery-service-good' };
  input.agents = { enabled: true, services: [{ name: recovery.service, region: binding.target.location }], chiefUrl: 'https://chief.example.invalid', executionTargets: [{ binding, rollbackRevisions: [recovery.revision] }] };
  const store = new SqliteCloudStore(':memory:'); t.after(() => store.close()); let approval: unknown, readCount = 0;
  const services = composeGcpServices(input, { store, mode: 'synthetic', principal: input.credentials.serviceAccountEmail, sessionId: 'synthetic-session',
    identity: { async verify() { return { actorId: 'reviewer', expiresAt: Date.now() + 3600000 }; } },
    model: { enabled: false, engine: 'synthetic-fixture', modelId: input.model.modelId, configurationId: 'synthetic', async analyze() { throw Error('no model'); } },
    transport: selected => transport(async operation => {
      assert.equal(selected.target.resourceUid, binding.target.resourceUid); assert.equal(operation, 'service'); readCount++;
      return { ...response({ binding, rollbackRevisions: [recovery.revision] }), updateTime: new Date(Date.now() - 60000).toISOString(), trafficStatuses: [{ revision: binding.target.revision, percent: 100 }] };
    }),
    agents: { approvalKey: Buffer.from('synthetic-composed-approval-key-0123456789'), chief: { async *stream(message) {
      if (message.taskId) {
        approval = (message.parts as { data: { response: { payload: { approval: unknown } } } }[])[0].data.response.payload.approval;
        yield { kind: 'status-update', taskId: 'synthetic-a2a-task', contextId: 'synthetic-a2a-context', final: true, status: { state: 'completed' } };
      } else {
        yield { kind: 'task', id: 'synthetic-a2a-task', contextId: 'synthetic-a2a-context', status: { state: 'submitted' } };
        yield { kind: 'status-update', taskId: 'synthetic-a2a-task', contextId: 'synthetic-a2a-context', final: true, status: { state: 'input-required', message: { parts: [{ kind: 'data', data: {
          id: 'synthetic-confirm', name: 'adk_request_confirmation', args: { toolConfirmation: { hint: 'rollback', confirmed: false, payload: { action: recovery, risk: 'medium', reason: 'synthetic recovery' } }, originalFunctionCall: { name: 'propose_rollback' } },
        }, metadata: { adk_type: 'function_call', adk_is_long_running: true } }] } } };
      }
    } } },
  });
  const scope = input.scopes[0]; if (scope.edition !== 'organization') throw Error();
  await services.access.organization.provision({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, actorId: 'reviewer', version: 1, active: true, roles: ['operator', 'reviewer'], updatedAt: new Date().toISOString() });
  const session = await services.access.authenticate('Bearer synthetic-user', scope), tasks = services.agents!;
  const task = await tasks.create(session, { instruction: 'Recover the registered service', language: 'en' }, randomUUID()); await tasks.idle();
  assert.equal((await tasks.get(session, task.id)).state, 'awaiting_approval'); assert.equal(readCount, 1);
  await tasks.decide(session, task.id, { decision: 'approve' }, randomUUID()); await tasks.idle();
  assert.ok(approval); await tasks.claimExecution(approval); await assert.rejects(tasks.claimExecution(approval));
  assert.equal(readCount, 1); // Grant redemption never performs an external read inside the transaction.
});
