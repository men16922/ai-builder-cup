import assert from 'node:assert/strict';
import test from 'node:test';
import { agentTaskListSchema, agentTaskSchema } from '@contracts/gcp/agent.ts';
import { overviewSchema } from '@contracts/gcp/overview.ts';
import { createRehearsal } from '../../web/src/console/rehearsal.ts';

const send = (rehearsal: ReturnType<typeof createRehearsal>, instruction = 'Checkout is failing. Handle it.', language = 'en') => rehearsal.agentCall('/agent-tasks', { key: crypto.randomUUID(), body: { instruction, language } }).then(value => agentTaskSchema.parse(value));
const read = async (rehearsal: ReturnType<typeof createRehearsal>, id: string) => agentTaskSchema.parse(await rehearsal.agentCall(`/agent-tasks/${id}`));
const decide = (rehearsal: ReturnType<typeof createRehearsal>, id: string, decision: string) => rehearsal.agentCall(`/agent-tasks/${id}/decision`, { key: crypto.randomUUID(), body: { decision } });
const serving = async (rehearsal: ReturnType<typeof createRehearsal>) => overviewSchema.parse(await rehearsal.agentCall('/overview')).services[0].revisions.filter(item => item.percent > 0).map(item => item.name);

test('the rehearsal walks from working to a decision and only a person\'s approval changes the traffic', async () => {
  const rehearsal = createRehearsal(); assert.deepEqual(await serving(rehearsal), ['shop-api-bad']);
  const first = await send(rehearsal); assert.equal(first.state, 'working'); assert.equal(first.approval, undefined);
  let task = first; for (let index = 0; index < 6; index++) task = await read(rehearsal, first.id);
  assert.equal(task.state, 'awaiting_approval'); assert.deepEqual(task.approval?.action, { action: 'rollback_traffic', service: 'shop-api', revision: 'shop-api-good' });
  assert.deepEqual(await serving(rehearsal), ['shop-api-bad'], 'asking for approval changes nothing');
  assert.equal(agentTaskSchema.parse(await decide(rehearsal, first.id, 'approve')).state, 'deciding'); assert.deepEqual(await serving(rehearsal), ['shop-api-bad']);
  for (let index = 0; index < 3; index++) task = await read(rehearsal, first.id);
  assert.equal(task.state, 'completed'); assert.match(task.result ?? '', /Still unknown/); assert.deepEqual(await serving(rehearsal), ['shop-api-good']);
  assert.equal(agentTaskListSchema.parse(await rehearsal.agentCall('/agent-tasks')).items.length, 1);
});

test('a rejection changes nothing and a task cannot be decided twice, early or after the window', async () => {
  let clock = Date.parse('2026-10-10T01:00:00Z'); const rehearsal = createRehearsal(() => clock);
  const early = await send(rehearsal); await assert.rejects(decide(rehearsal, early.id, 'approve'), { message: 'not_awaiting_approval' });
  for (let index = 0; index < 6; index++) await read(rehearsal, early.id);
  assert.equal(agentTaskSchema.parse(await decide(rehearsal, early.id, 'reject')).state, 'rejected'); assert.deepEqual(await serving(rehearsal), ['shop-api-bad']);
  await assert.rejects(decide(rehearsal, early.id, 'approve'), { message: 'not_awaiting_approval' }); assert.deepEqual(await serving(rehearsal), ['shop-api-bad']);
  const late = await send(rehearsal, 'Fix it', 'ko'); for (let index = 0; index < 6; index++) await read(rehearsal, late.id);
  clock += 9 * 60_000; await assert.rejects(decide(rehearsal, late.id, 'approve'), { message: 'approval_expired' }); assert.deepEqual(await serving(rehearsal), ['shop-api-bad']);
});

test('invalid input, unknown tasks and unknown paths are refused with codes the console already explains', async () => {
  const rehearsal = createRehearsal();
  await assert.rejects(send(rehearsal, '   '), { message: 'invalid_request' }); await assert.rejects(send(rehearsal, 'x'.repeat(1001)), { message: 'invalid_request' });
  await assert.rejects(rehearsal.agentCall('/agent-tasks', { key: crypto.randomUUID(), body: { instruction: 'ok', language: 'fr' } }), { message: 'invalid_request' });
  await assert.rejects(rehearsal.agentCall('/agent-tasks/4d1ff454-d70d-484f-b506-fbf5230b0626'), { message: 'agent_task_not_found' });
  await assert.rejects(rehearsal.agentCall('/secrets'), { message: 'agent_task_not_found' });
  const task = await send(rehearsal); for (let index = 0; index < 6; index++) await read(rehearsal, task.id);
  await assert.rejects(decide(rehearsal, task.id, 'delete-everything'), { message: 'invalid_request' });
});
