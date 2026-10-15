import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SqliteCloudStore } from '../src/store/sqlite-store';
import { GcpWebAccess } from '../src/auth/web-access';
import { GcpMobility, type VehicleReasoner } from '../src/mobility/service';
import type { MobilityState, CallStep } from '@contracts/gcp/mobility';

async function setup(t: TestContext, step: NonNullable<VehicleReasoner['call']>) {
  let clock = Date.parse('2026-10-15T11:00:00Z');
  const store = new SqliteCloudStore(':memory:', () => clock); t.after(() => store.close());
  const access = new GcpWebAccess({ async verify(token) { return { actorId: token, expiresAt: clock + 3600000 }; } }, store, () => clock);
  const scope = { edition: 'organization' as const, organizationId: 'synthetic-org', workspaceId: 'synthetic-workspace', label: 'Synthetic' };
  await access.organization.provision({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, actorId: 'driver-a', version: 1, active: true, roles: ['operator', 'reviewer'], updatedAt: new Date(clock).toISOString() });
  const session = await access.authenticate('Bearer driver-a', scope);
  let calls = 0;
  const reasoner: VehicleReasoner = { engine: 'offline-fixture',
    async diagnose() { return { summary: 'Synthetic diagnosis', evidenceIds: ['fault'], unknowns: [], runbook: 'none' }; },
    async call(input, signal) { calls++; return step(input, signal); },
    async summarizeCall() { return { text: 'Synthetic summary', actionItems: [], followups: [] }; },
  };
  const create = () => new GcpMobility(store, access, () => true, reasoner, undefined, () => clock);
  const api = create();
  const send = (state: MobilityState, command: Record<string, unknown>, key = randomUUID()) => api.command(session, { ...command, expectedVersion: state.vehicle!.version }, key);
  const initial = await api.command(session, { operation: 'initialize' }, randomUUID());
  const ringing = await send(initial, { operation: 'call_incoming', scenario: 'meeting_reschedule', language: 'en' });
  return { api, session, ringing, send, create, calls: () => calls, advance(ms: number) { clock += ms; } };
}
const greeting: CallStep = { caller: 'Could we move the fictional meeting?', aide: 'I will check with the driver.', callerEnds: false };

test('an uncertain answer is durable and a fresh request key cannot answer the same call again', async t => {
  const s = await setup(t, async () => { throw Error('synthetic provider response lost'); });
  const command = { operation: 'call_answer', handledBy: 'aide', callId: s.ringing.call!.id, expectedVersion: s.ringing.vehicle!.version }, key = randomUUID();
  await assert.rejects(s.api.command(s.session, command, key));
  const latest = await s.api.read(s.session);
  await assert.rejects(s.api.command(s.session, command, key));
  const recreated = s.create();
  await assert.rejects(recreated.command(s.session, { ...command, expectedVersion: latest.vehicle!.version }, randomUUID()));
  assert.equal(s.calls(), 1, 'A different key or service instance must not repeat the uncertain model step');
  assert.equal(latest.call?.state, 'unknown', 'An unconfirmed call step must not remain answerable after refresh');
  assert.deepEqual(latest.call?.turns, []);
  assert.equal(latest.call?.summary, undefined);
});

test('an uncertain reply retains the confirmed transcript and never creates summary or follow-ups', async t => {
  let first = true;
  const s = await setup(t, async () => { if (first) { first = false; return greeting; } throw Error('synthetic timeout'); });
  const active = await s.send(s.ringing, { operation: 'call_answer', handledBy: 'aide', callId: s.ringing.call!.id });
  const before = structuredClone(active.call!.turns);
  await assert.rejects(s.send(active, { operation: 'call_say', callId: active.call!.id, text: 'A fictional reply' }));
  const latest = await s.api.read(s.session);
  assert.equal(latest.call?.state, 'unknown'); assert.deepEqual(latest.call?.turns, before);
  assert.equal(latest.call?.summary, undefined);
  for (const operation of ['call_say', 'call_delegate', 'call_end']) {
    await assert.rejects(s.send(latest, { operation, callId: active.call!.id, ...(operation === 'call_say' ? { text: 'Do not repeat' } : {}) }));
  }
  assert.equal(s.calls(), 2);
});

test('late failure cleanup cannot erase a newer confirmed call', async t => {
  let entered!: () => void, reject!: (error: Error) => void;
  const start = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<CallStep>((_resolve, fail) => { reject = fail; });
  let turn = 0;
  const s = await setup(t, async () => { if (++turn === 1) { entered(); return pending; } return greeting; });
  const late = s.send(s.ringing, { operation: 'call_answer', handledBy: 'aide', callId: s.ringing.call!.id });
  await start;
  let state = await s.send(s.ringing, { operation: 'call_decline', callId: s.ringing.call!.id });
  state = await s.send(state, { operation: 'call_incoming', scenario: 'delivery', language: 'en' });
  const confirmed = await s.send(state, { operation: 'call_answer', handledBy: 'aide', callId: state.call!.id });
  reject(Error('synthetic delayed failure')); await assert.rejects(late);
  const latest = await s.api.read(s.session);
  assert.equal(latest.call?.state, 'active');
  assert.deepEqual(latest.call, confirmed.call, 'Cleanup is fenced to the exact call snapshot, not merely the actor');
  assert.equal(latest.vehicle?.version, confirmed.vehicle?.version);
});

test('a second service instance cannot start the same call step while the first provider reply is pending', async t => {
  let entered!: () => void, release!: () => void;
  const start = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let first = true;
  const s = await setup(t, async () => { if (first) { first = false; entered(); await barrier; } return greeting; });
  const body = { operation: 'call_answer', handledBy: 'aide', callId: s.ringing.call!.id, expectedVersion: s.ringing.vehicle!.version };
  const pending = s.api.command(s.session, body, randomUUID());
  await start;
  let second;
  try { second = await s.create().command(s.session, body, randomUUID()); } catch { /* Expected: one in-flight claim. */ }
  release(); await pending.catch(() => undefined);
  assert.equal(second, undefined, 'The second instance must refuse before calling the provider');
  assert.equal(s.calls(), 1, 'Only one model step may enter for the captured call state');
});


test('a vanished step expires to durable unknown and its late result cannot restore the call', async t => {
  let entered!: () => void, release!: () => void;
  const start = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const s = await setup(t, async () => { entered(); await barrier; return greeting; });
  const body = { operation: 'call_answer', handledBy: 'aide', callId: s.ringing.call!.id, expectedVersion: s.ringing.vehicle!.version }, key = randomUUID();
  const pending = s.api.command(s.session, body, key);
  await start; s.advance(30_001);
  const recreated = s.create(), expired = await recreated.read(s.session);
  assert.equal(expired.call?.state, 'unknown'); assert.deepEqual(expired.call?.turns, []);
  await assert.rejects(recreated.command(s.session, body, key), error => !!error && typeof error === 'object' && 'code' in error && error.code === 'mobility_outcome_unknown');
  await assert.rejects(recreated.command(s.session, { ...body, expectedVersion: expired.vehicle!.version }, randomUUID()));
  release(); await assert.rejects(pending);
  const latest = await recreated.read(s.session);
  assert.deepEqual(latest.call, expired.call); assert.equal(latest.vehicle?.version, expired.vehicle?.version);
  assert.equal(s.calls(), 1);
});


test('an empty provider turn is unknown, not a confirmed empty conversation step', async t => {
  const s = await setup(t, async () => ({ callerEnds: false }));
  await assert.rejects(s.send(s.ringing, { operation: 'call_answer', handledBy: 'aide', callId: s.ringing.call!.id }));
  const latest = await s.api.read(s.session);
  assert.equal(latest.call?.state, 'unknown'); assert.deepEqual(latest.call?.turns, []);
  await assert.rejects(s.send(latest, { operation: 'call_answer', handledBy: 'aide', callId: s.ringing.call!.id }));
  assert.equal(s.calls(), 1);
});
