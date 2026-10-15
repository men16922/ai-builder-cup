import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SqliteCloudStore } from '../src/store/sqlite-store';
import { GcpWebAccess } from '../src/auth/web-access';
import { GcpMobility, type VehicleReasoner, type MobilityPlaces } from '../src/mobility/service';
import { mobilityStateSchema, type MobilityState } from '@contracts/gcp/mobility';

async function setup(t: TestContext, custom: Partial<VehicleReasoner> = {}) {
  let clock = Date.parse('2026-10-15T06:00:00Z'), modelCalls = 0;
  const store = new SqliteCloudStore(':memory:', () => clock); t.after(() => store.close());
  const access = new GcpWebAccess({ async verify(token) { return { actorId: token, expiresAt: clock + 3600000 }; } }, store, () => clock);
  const scope = { edition: 'organization' as const, organizationId: 'synthetic-org', workspaceId: 'synthetic-workspace', label: 'Synthetic' };
  await access.organization.provision({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, actorId: 'driver-a', version: 1, active: true, roles: ['operator', 'reviewer'], updatedAt: new Date(clock).toISOString() });
  const session = await access.authenticate('Bearer driver-a', scope);
  const reasoner: VehicleReasoner = { engine: 'offline-fixture',
    async diagnose() { modelCalls++; return { summary: 'Synthetic fixture finding.', evidenceIds: ['fault', 'signal'], unknowns: [], runbook: 'none' }; },
    async call(input) { modelCalls++; if (custom.call) return custom.call(input, AbortSignal.timeout(1000));
      return input.step === 'open' ? { ...(input.handledBy === 'aide' ? { aide: 'Hello, the driver is driving, so My Aide is answering.' } : {}), caller: 'Can we move the review to 4:30?', callerEnds: false }
        : input.step === 'delegate' ? { aide: '4:30 works; the driver will send the deck on arrival.', caller: 'Great, see you then.', callerEnds: true } : { caller: 'Thanks, noted.', callerEnds: false }; },
    async summarizeCall() { modelCalls++; return { text: 'The review moved to 4:30 pm; the deck follows on arrival.', actionItems: ['Send the deck'], followups: [
      { kind: 'calendar', title: 'Design review', minutesFromNow: 90 }, { kind: 'message', title: 'Confirm the new time', body: '4:30 works for me.', to: 'Jordan Kim' }] }; } };
  const places: MobilityPlaces = { async nearby(location, kind) { return [{ id: 'synthetic-charger', name: 'Synthetic charger', address: 'Fixture only', location: { latitude: location.latitude + .01, longitude: location.longitude }, kind, source: 'google-places', fetchedAt: new Date(clock).toISOString() }]; } };
  const api = new GcpMobility(store, access, () => true, reasoner, places, () => clock);
  const send = (state: MobilityState, command: Record<string, unknown>, key = randomUUID()) => api.command(session, { ...command, expectedVersion: state.vehicle!.version }, key);
  const initial = await api.command(session, { operation: 'initialize' }, randomUUID());
  return { api, session, initial, send, modelCalls: () => modelCalls, advance(ms: number) { clock += ms; } };
}

test('older stored twins parse with control, climate and call defaults', () => {
  const legacy = mobilityStateSchema.parse({ vehicle: { id: randomUUID(), version: 3, source: 'simulation', model: 'Aide EV', observedAt: '2026-10-14T00:00:00.000Z', batteryPercent: 50, targetPercent: 80, batteryCelsius: 28, rangeKm: 260, parked: true,
    charging: 'idle', powerKw: 0, fault: 'none', diagnosticSignal: 'none', episode: randomUUID(), attempts: 0, location: { latitude: 37.5, longitude: 127 } }, reports: [], journey: null, favorites: [],
    policy: { enabled: false, expiresAt: null, runbook: 'charge-reconnect-v1' }, mapsAvailable: false });
  assert.equal(legacy.vehicle?.locked, true); assert.deepEqual(legacy.vehicle?.tiresBar, [2.5, 2.5, 2.5, 2.5]); assert.equal(legacy.call, null); assert.deepEqual(legacy.calls, []);
});

test('remote controls change only the simulated twin and charging/climate progress without reads mutating it', async t => {
  const s = await setup(t);
  let state = await s.send(s.initial, { operation: 'control', action: 'unlock' }); assert.equal(state.vehicle?.locked, false);
  state = await s.send(state, { operation: 'control', action: 'set_temperature', value: 19 }); assert.equal(state.vehicle?.climate.targetCelsius, 19);
  await assert.rejects(s.send(state, { operation: 'control', action: 'set_temperature', value: 40 }), /mobility request/);
  await assert.rejects(s.send(state, { operation: 'control', action: 'set_charge_limit', value: 30 }), /mobility request/);
  state = await s.send(state, { operation: 'control', action: 'climate_on' }); s.advance(8000);
  const warm = await s.api.read(s.session); assert.ok(warm.vehicle!.climate.cabinCelsius < 24 && warm.vehicle!.climate.cabinCelsius >= 19); assert.equal(warm.vehicle?.version, state.vehicle?.version);
  state = await s.send(state, { operation: 'control', action: 'start_charging' }); assert.equal(state.vehicle?.powerKw, 11); assert.equal(state.vehicle?.charging, 'charging');
  s.advance(60_000);
  const charged = await s.api.read(s.session); assert.ok(charged.vehicle!.batteryPercent > 68 && charged.vehicle!.batteryPercent <= 80);
  s.advance(5 * 60_000);
  const full = await s.api.read(s.session); assert.equal(full.vehicle?.batteryPercent, 80); assert.equal(full.vehicle?.charging, 'idle');
  await assert.rejects(s.send(state, { operation: 'control', action: 'start_charging' }), /mobility request/);
  assert.equal(s.modelCalls(), 0);
});

test('a charging journey drains straight-line energy and a DC session starts only at the arrived charger', async t => {
  const s = await setup(t);
  let state = await s.send(s.initial, { operation: 'trip_request', kind: 'charging', instruction: 'nearest charger', language: 'en' });
  state = await s.send(state, { operation: 'select_destination', journeyId: state.journey!.id, placeId: 'synthetic-charger', remember: false });
  await assert.rejects(s.send(state, { operation: 'control', action: 'start_charging' }), /mobility request/);
  for (let i = 0; i < 10; i++) state = await s.send(state, { operation: 'advance', journeyId: state.journey!.id });
  assert.equal(state.journey?.state, 'arrived'); assert.equal(state.vehicle?.batteryPercent, 67); assert.equal(state.vehicle?.odometerKm, 12841);
  state = await s.send(state, { operation: 'control', action: 'start_charging' }); assert.equal(state.vehicle?.powerKw, 150);
});

test('a low tire is located, investigated read-only and never remedied', async t => {
  const s = await setup(t);
  const state = await s.send(s.initial, { operation: 'telemetry', batteryPercent: 60, fault: 'tire_low', language: 'en' });
  assert.deepEqual(state.vehicle?.tiresBar, [2.5, 2.5, 1.6, 2.5]); assert.equal(state.vehicle?.diagnosticSignal, 'tire_pressure_low');
  assert.equal(state.reports[0].state, 'escalated'); assert.equal(state.reports[0].remedy, undefined); assert.equal(state.vehicle?.attempts, 0);
});

test('My Aide handles a simulated call while autopilot keeps the journey moving, then drafts follow-ups that need a tap', async t => {
  const s = await setup(t);
  let state = await s.send(s.initial, { operation: 'trip_request', kind: 'charging', instruction: 'nearest charger', language: 'en' });
  state = await s.send(state, { operation: 'select_destination', journeyId: state.journey!.id, placeId: 'synthetic-charger', remember: false });
  state = await s.send(state, { operation: 'call_incoming', scenario: 'meeting_reschedule', language: 'en' });
  assert.equal(state.call?.state, 'ringing'); assert.equal(state.call?.caller.name, 'Jordan Kim');
  await assert.rejects(s.send(state, { operation: 'call_incoming', scenario: 'delivery', language: 'en' }), /mobility request/);
  await assert.rejects(s.send(state, { operation: 'call_say', callId: state.call!.id, text: 'hello' }), /mobility request/);
  assert.equal(s.modelCalls(), 0);
  const callId = state.call!.id;
  state = await s.send(state, { operation: 'call_answer', callId, handledBy: 'aide' });
  assert.deepEqual(state.call?.turns.map(turn => turn.role), ['aide', 'caller']); assert.equal(state.journey?.autopilot, true);
  state = await s.send(state, { operation: 'advance', journeyId: state.journey!.id }); assert.equal(state.call?.state, 'active');
  state = await s.send(state, { operation: 'call_say', callId, text: 'Yes, 4:30 is fine.' });
  state = await s.send(state, { operation: 'call_delegate', callId });
  assert.deepEqual(state.call?.turns.map(turn => turn.role), ['aide', 'caller', 'driver', 'caller', 'aide', 'caller']);
  state = await s.send(state, { operation: 'call_end', callId });
  assert.equal(state.call?.state, 'ended'); assert.equal(state.journey?.autopilot, false);
  const [calendar, message] = state.call!.summary!.followups;
  assert.equal(calendar.status, 'draft'); assert.equal(calendar.when, new Date(Date.parse('2026-10-15T06:00:00Z') + 90 * 60_000).toISOString()); assert.equal(message.to, 'Jordan Kim');
  state = await s.send(state, { operation: 'call_save', callId }); assert.equal(state.calls.length, 1);
  state = await s.send(state, { operation: 'followup', callId, followupId: message.id, action: 'done' });
  assert.equal(state.calls[0].summary?.followups[1].status, 'done'); assert.equal(state.call?.summary?.followups[1].status, 'done');
  await assert.rejects(s.send(state, { operation: 'followup', callId, followupId: message.id, action: 'done' }), /mobility request/);
  assert.equal(s.modelCalls(), 4);
});

test('an unconfirmed call turn adds no invented line and a replay never calls the model again', async t => {
  const s = await setup(t, { async call() { throw Error('google_mobility_busy'); } });
  let state = await s.send(s.initial, { operation: 'call_incoming', scenario: 'delivery', language: 'ko' });
  const command = { operation: 'call_answer', callId: state.call!.id, handledBy: 'driver', expectedVersion: state.vehicle!.version }, key = randomUUID();
  await assert.rejects(s.api.command(s.session, command, key));
  await assert.rejects(s.api.command(s.session, command, key), /mobility request/);
  assert.equal(s.modelCalls(), 1);
  state = await s.api.read(s.session); assert.equal(state.call?.state, 'unknown'); assert.equal(state.call?.turns.length, 0);
  await assert.rejects(s.send(state, { operation: 'call_decline', callId: state.call!.id }), /mobility request/);
  state = await s.send(state, { operation: 'call_incoming', scenario: 'family_pickup', language: 'ko' }); assert.equal(state.call?.state, 'ringing');
});

test('a long call stops taking turns before the transcript bound', async t => {
  const s = await setup(t);
  let state = await s.send(s.initial, { operation: 'call_incoming', scenario: 'family_pickup', language: 'en' });
  const callId = state.call!.id; state = await s.send(state, { operation: 'call_answer', callId, handledBy: 'driver' });
  while (state.call!.turns.length <= 13) state = await s.send(state, { operation: 'call_say', callId, text: 'Okay.' });
  const before = s.modelCalls();
  await assert.rejects(s.send(state, { operation: 'call_say', callId, text: 'One more.' }), /mobility request/);
  assert.equal(s.modelCalls(), before); assert.ok(state.call!.turns.length <= 16);
});
