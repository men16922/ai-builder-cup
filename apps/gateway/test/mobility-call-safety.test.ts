import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SqliteCloudStore } from '../src/store/sqlite-store';
import { GcpWebAccess } from '../src/auth/web-access';
import { GcpMobility, type VehicleReasoner, type MobilityPlaces } from '../src/mobility/service';
import { MobilityClient } from '../../web/src/mobility/mobility-client';
import { createGcpApiServer } from '../src/http/api';
import { syntheticVehicleReasoner, vertexVehicleReasoner, MobilityCallOutputError } from '../src/mobility/google-ports';
import { callDigestSchema, type CallDigest } from '@contracts/gcp/mobility';
import { once } from 'node:events';
import { GcpObservations } from '../src/workflow/observations';
import type { MobilityState, CallStep } from '@contracts/gcp/mobility';

async function setup(t: TestContext, step: NonNullable<VehicleReasoner['call']>, places?: MobilityPlaces, startAt = Date.parse('2026-10-15T11:00:00Z')) {
  let clock = startAt;
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
  const create = () => new GcpMobility(store, access, () => true, reasoner, places, () => clock);
  const api = create();
  const send = (state: MobilityState, command: Record<string, unknown>, key = randomUUID()) => api.command(session, { ...command, expectedVersion: state.vehicle!.version }, key);
  const initial = await api.command(session, { operation: 'initialize' }, randomUUID());
  const ringing = await send(initial, { operation: 'call_incoming', scenario: 'meeting_reschedule', language: 'en' });
  return { api, session, access, store, reasoner, ringing, send, create, calls: () => calls, advance(ms: number) { clock += ms; } };
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


const nearby: MobilityPlaces = { async nearby(location, kind) { return [{ id: 'synthetic-latency-destination', name: 'Synthetic nearby destination', address: '', kind, source: 'google-places', fetchedAt: '2026-10-15T11:00:00Z', location: { latitude: location.latitude + .002, longitude: location.longitude + .002 } }]; } };
async function moving(s: Awaited<ReturnType<typeof setup>>) {
  let state = await s.send(s.ringing, { operation: 'trip_request', instruction: 'Synthetic nearby destination', kind: 'poi', language: 'en' });
  state = await s.send(state, { operation: 'select_destination', journeyId: state.journey!.id, placeId: state.journey!.candidates[0].id, remember: false });
  return state;
}

test('a delayed call step preserves concurrent movement and an explicit journey stop', async t => {
  let entered!: () => void, release!: () => void;
  const start = new Promise<void>(resolve => { entered = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
  const s = await setup(t, async () => { entered(); await barrier; return greeting; }, nearby);
  const drive = await moving(s);
  const pending = s.send(drive, { operation: 'call_answer', callId: drive.call!.id, handledBy: 'aide' });
  await start;
  const advanced = await s.send(drive, { operation: 'advance', journeyId: drive.journey!.id });
  const stopped = await s.send(advanced, { operation: 'stop', journeyId: drive.journey!.id });
  release();
  const answered = await pending;
  assert.equal(answered.call?.state, 'active');
  assert.equal(answered.vehicle?.parked, true); assert.equal(answered.journey?.state, 'cancelled');
  assert.equal(answered.vehicle?.version, stopped.vehicle?.version, 'A call-only reply must not rewind or mutate vehicle progress');
  assert.equal(s.calls(), 1);
});

test('the client advances and cancels the simulation while a model answer is pending', async t => {
  let entered!: () => void, release!: () => void;
  const start = new Promise<void>(resolve => { entered = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
  const s = await setup(t, async () => { entered(); await barrier; return greeting; }, nearby);
  const drive = await moving(s), operations: string[] = [];
  const client = new MobilityClient(async (_path, input) => {
    if (!input) return s.api.read(s.session);
    const body = input.body as Record<string, unknown>; operations.push(String(body.operation));
    return s.api.command(s.session, body, input.key);
  });
  await client.load();
  // Explicit Continue arms only the already selected simulated journey.
  await client.command({ operation: 'advance', journeyId: drive.journey!.id });
  const pending = client.command({ operation: 'call_answer', callId: drive.call!.id, handledBy: 'aide' });
  await start;
  await client.command({ operation: 'advance', journeyId: drive.journey!.id }, true);
  await client.command({ operation: 'stop', journeyId: drive.journey!.id });
  release(); await pending;
  assert.equal(operations.filter(op => op === 'advance').length, 2, 'The AI wait must not suspend simulated movement');
  assert.equal(operations.filter(op => op === 'stop').length, 1, 'The explicit stop must remain usable during model latency');
  assert.equal(client.getSnapshot().state?.journey?.state, 'cancelled');
  assert.equal(client.getSnapshot().journeyRunning, false); assert.equal(s.calls(), 1);
});


test('a delayed older vehicle reply cannot erase the newer confirmed call revision', async t => {
  let entered!: () => void, release!: () => void, deliver!: () => void;
  const start = new Promise<void>(resolve => { entered = resolve; }), model = new Promise<void>(resolve => { release = resolve; });
  const transport = new Promise<void>(resolve => { deliver = resolve; });
  const s = await setup(t, async () => { entered(); await model; return greeting; }, nearby);
  const drive = await moving(s);
  let delayAdvance = false;
  const client = new MobilityClient(async (_path, input) => {
    if (!input) return s.api.read(s.session);
    const body = input.body as Record<string, unknown>;
    const result = await s.api.command(s.session, body, input.key);
    if (delayAdvance && body.operation === 'advance') await transport;
    return result;
  });
  await client.load(); await client.command({ operation: 'advance', journeyId: drive.journey!.id });
  const call = client.command({ operation: 'call_answer', handledBy: 'aide', callId: drive.call!.id }); await start;
  delayAdvance = true;
  const advance = client.command({ operation: 'advance', journeyId: drive.journey!.id }, true);
  // Wait for the stored progress, not for a fixed sleep or the intentionally delayed HTTP response.
  for (let attempt = 0; attempt < 20 && (await s.api.read(s.session)).journey!.progress < .2; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.ok((await s.api.read(s.session)).journey!.progress >= .2);
  release(); await call; deliver(); await advance;
  assert.equal(client.getSnapshot().state?.call?.state, 'active');
  assert.equal(client.getSnapshot().state?.journey?.autopilot, true);
  assert.ok((client.getSnapshot().state?.callRevision ?? 0) >= 2);
  assert.equal(client.getSnapshot().state?.journey?.progress, .2);
});

test('permission loss while a call waits prevents either request lane restoring private data', async t => {
  let entered!: () => void, release!: () => void;
  const start = new Promise<void>(resolve => { entered = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
  const s = await setup(t, async () => { entered(); await barrier; return greeting; });
  let deny = false;
  const client = new MobilityClient(async (_path, input) => {
    if (deny) throw Object.assign(Error('mobility_not_entitled'), { status: 403 });
    return input ? s.api.command(s.session, input.body, input.key) : s.api.read(s.session);
  });
  await client.load(); const pending = client.command({ operation: 'call_answer', handledBy: 'aide', callId: s.ringing.call!.id });
  await start; deny = true; await client.load(); release(); await pending;
  assert.equal(client.getSnapshot().state, undefined); assert.equal(client.getSnapshot().callBusy, false);
});

test('a read during a delayed call never rearms the selected journey', async t => {
  let entered!: () => void, release!: () => void;
  const start = new Promise<void>(resolve => { entered = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
  const s = await setup(t, async () => { entered(); await barrier; return greeting; }, nearby);
  const drive = await moving(s);
  const client = new MobilityClient(async (_path, input) => input ? s.api.command(s.session, input.body, input.key) : s.api.read(s.session));
  await client.load(); await client.command({ operation: 'advance', journeyId: drive.journey!.id });
  const pending = client.command({ operation: 'call_answer', handledBy: 'aide', callId: drive.call!.id });
  await start; await client.load(); release(); await pending;
  assert.equal(client.getSnapshot().state?.call?.state, 'active');
  assert.equal(client.getSnapshot().journeyRunning, false);
});

test('invalid generated call summaries are outcome-unknown, not invalid user requests, and never resend', async t => {
  const s = await setup(t, async () => greeting);
  const active = await s.send(s.ringing, { operation: 'call_answer', callId: s.ringing.call!.id, handledBy: 'aide' });
  const before = structuredClone(active.call!.turns);
  let summaries = 0;
  s.reasoner.summarizeCall = async () => {
    summaries++;
    // A valid client request can receive invalid model output. No output is repaired into an action.
    return callDigestSchema.parse({ text: 'Synthetic summary', actionItems: [], followups: [{ kind: 'calendar', title: 'Synthetic meeting', minutesFromNow: -1 }] });
  };
  const services = { access: s.access, observations: new GcpObservations(s.store, s.access, []), mobility: s.api, publicOrigin: 'http://127.0.0.1' };
  const server = createGcpApiServer(services);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`; services.publicOrigin = origin;
  const response = await fetch(`${origin}/api/organizations/v1/synthetic-org/workspaces/synthetic-workspace/gcp/mobility`, {
    method: 'POST', headers: { Origin: origin, Authorization: 'Bearer driver-a', 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ operation: 'call_end', callId: active.call!.id, expectedVersion: active.vehicle!.version }),
  });
  assert.equal(summaries, 1, 'The valid client command reached the summary provider');
  assert.equal((await s.api.read(s.session)).call!.state, 'unknown', 'The server has already classified the dispatched step as uncertain');
  assert.equal(response.status, 502, 'A provider-result validation error is not a bad user request');
  assert.equal((await response.json() as { code: string }).code, 'mobility_outcome_unknown');
  const latest = await s.api.read(s.session);
  assert.equal(latest.call!.state, 'unknown'); assert.deepEqual(latest.call!.turns, before);
  assert.equal(latest.call!.summary, undefined);
  await assert.rejects(s.send(latest, { operation: 'call_end', callId: latest.call!.id }));
  assert.equal(summaries, 1, 'A fresh request key must not repeat an uncertain summary');
  const malformed = await fetch(`${origin}/api/organizations/v1/synthetic-org/workspaces/synthetic-workspace/gcp/mobility`, {
    method: 'POST', headers: { Origin: origin, Authorization: 'Bearer driver-a', 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ operation: 'call_end', callId: active.call!.id, expectedVersion: 'invalid-user-version' }),
  });
  assert.equal(malformed.status, 400); assert.equal(summaries, 1);
});

test('Vertex call validation exposes only fixed diagnostic labels and keeps live transports out of offline tests', async () => {
  const options = { projectId: 'synthetic-project', location: 'global', modelId: 'gemini-2.5-flash', principal: 'synthetic-runtime', sessionId: 'synthetic-session', credentials: { async current() { return { accessToken: 'synthetic-token', principal: 'synthetic-runtime', sessionId: 'synthetic-session' }; } } };
  const input = { scenario: 'meeting_reschedule' as const, language: 'en' as const, caller: { name: 'Synthetic caller', relation: 'Fixture' }, goal: 'Synthetic meeting', driverContext: 'Parked; synthetic context', handledBy: 'aide' as const, step: 'summary' as const, turns: [] };
  let calls = 0;
  const reasoner = syntheticVehicleReasoner(options, async () => {
    calls++;
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ text: 'Synthetic summary', actionItems: [], followups: [{ kind: 'calendar', title: 'DO_NOT_LOG_PROVIDER_TEXT', minutesFromNow: -1 }] }) }] } }] }));
  });
  await assert.rejects(reasoner.summarizeCall!(input, AbortSignal.timeout(1000)), error => {
    assert.ok(error instanceof MobilityCallOutputError);
    assert.equal(error.phase, 'summary'); assert.deepEqual(error.fields, ['followup_time']); assert.deepEqual(error.constraints, ['too_small']);
    assert.doesNotMatch(JSON.stringify(error), /DO_NOT_LOG|synthetic-token|Synthetic summary/);
    return true;
  });
  assert.equal(calls, 1);
  assert.throws(() => vertexVehicleReasoner(options), /live_mobility_disabled/);
  assert.throws(() => syntheticVehicleReasoner(options, globalThis.fetch), /synthetic_mobility_disabled/);
});


test('incomplete legacy follow-ups cannot be completed, but a deliberate dismiss remains available', async t => {
  const drafts: CallDigest['followups'] = [
    { kind: 'message', title: 'Synthetic reply', to: 'Synthetic caller' },
    { kind: 'message', title: 'Synthetic reply', to: 'Synthetic caller', body: '   ' },
    { kind: 'message', title: 'Synthetic reply', body: 'A complete synthetic reply' },
    { kind: 'calendar', title: 'Synthetic meeting' },
    { kind: 'reminder', title: 'Synthetic reminder' },
  ];
  for (const draft of drafts) await t.test('incomplete draft', async t => {
    const s = await setup(t, async () => greeting);
    let summaries = 0;
    s.reasoner.summarizeCall = async () => { summaries++; return { text: 'Synthetic summary', actionItems: [], followups: [draft] }; };
    let state = await s.send(s.ringing, { operation: 'call_answer', callId: s.ringing.call!.id, handledBy: 'aide' });
    state = await s.send(state, { operation: 'call_end', callId: state.call!.id });
    state = await s.send(state, { operation: 'call_save', callId: state.call!.id });
    const callId = state.call!.id, followupId = state.call!.summary!.followups[0].id;
    await assert.rejects(s.send(state, { operation: 'followup', callId, followupId, action: 'done' }), error => error instanceof Error && 'code' in error && error.code === 'followup_not_ready');
    const latest = await s.api.read(s.session);
    assert.equal(latest.call!.summary!.followups[0].status, 'draft');
    assert.equal(latest.calls[0].summary!.followups[0].status, 'draft');
    const dismissed = await s.send(latest, { operation: 'followup', callId, followupId, action: 'dismiss' });
    assert.equal(dismissed.call!.summary!.followups[0].status, 'dismissed');
    assert.equal(dismissed.calls[0].summary!.followups[0].status, 'dismissed');
    assert.equal(s.calls(), 1); assert.equal(summaries, 1);
  });
});

test('a scheduled draft is checked again at completion and expiry cannot become a completed action', async t => {
  const s = await setup(t, async () => greeting);
  s.reasoner.summarizeCall = async () => ({ text: 'Synthetic summary', actionItems: [], followups: [{ kind: 'calendar', title: 'Synthetic meeting', minutesFromNow: 1 }] });
  let state = await s.send(s.ringing, { operation: 'call_answer', callId: s.ringing.call!.id, handledBy: 'aide' });
  state = await s.send(state, { operation: 'call_end', callId: state.call!.id });
  const callId = state.call!.id, followupId = state.call!.summary!.followups[0].id;
  s.advance(120000);
  await assert.rejects(s.send(state, { operation: 'followup', callId, followupId, action: 'done' }), error => error instanceof Error && 'code' in error && error.code === 'followup_not_ready');
  assert.equal((await s.api.read(s.session)).call!.summary!.followups[0].status, 'draft');
});


test('an agreed local day is anchored before model work even when the summary finishes after KST midnight', async t => {
  const s = await setup(t, async () => greeting, undefined, Date.parse('2026-10-15T14:59:55Z'));
  let state = await s.send(s.ringing, { operation: 'call_answer', callId: s.ringing.call!.id, handledBy: 'aide' });
  s.reasoner.summarizeCall = async () => {
    s.advance(20000); // Model finishes on Fri 00:00:15; "tomorrow" still referred to Friday.
    return { text: 'Synthetic tomorrow 16:30 agreement', actionItems: [], followups: [{ kind: 'calendar', title: 'Synthetic meeting', dayOffset: 1, localTime: '16:30' }] };
  };
  state = await s.send(state, { operation: 'call_end', callId: state.call!.id });
  assert.equal(state.call!.summary!.followups[0].when, '2026-10-16T07:30:00.000Z');
});

test('a complete future calendar remains an explicit, one-time simulated completion', async t => {
  const s = await setup(t, async () => greeting);
  s.reasoner.summarizeCall = async () => ({ text: 'Synthetic summary', actionItems: [], followups: [{ kind: 'calendar', title: 'Synthetic meeting', dayOffset: 1, localTime: '16:30' }] });
  let state = await s.send(s.ringing, { operation: 'call_answer', callId: s.ringing.call!.id, handledBy: 'aide' });
  state = await s.send(state, { operation: 'call_end', callId: state.call!.id });
  const callId = state.call!.id, followupId = state.call!.summary!.followups[0].id;
  assert.equal(state.call!.summary!.followups[0].status, 'draft');
  state = await s.send(state, { operation: 'followup', callId, followupId, action: 'done' });
  assert.equal(state.call!.summary!.followups[0].status, 'done');
  await assert.rejects(s.send(state, { operation: 'followup', callId, followupId, action: 'done' }));
  assert.equal(s.calls(), 1);
});

test('Vertex 429 refusals get at most two short retries; other failures are never retried', async () => {
  const options = { projectId: 'synthetic-project', location: 'global', modelId: 'gemini-2.5-flash', principal: 'synthetic-runtime', sessionId: 'synthetic-session', credentials: { async current() { return { accessToken: 'synthetic-token', principal: 'synthetic-runtime', sessionId: 'synthetic-session' }; } } };
  const ok = () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ reply: 'Ready.', proposals: [] }) }] } }] }));
  const run = async (statuses: number[]) => { let calls = 0;
    const reasoner = syntheticVehicleReasoner(options as never, async () => { const status = statuses[calls++]; return status === 200 ? ok() : new Response('{}', { status }); });
    const result = await reasoner.assist!({ text: 'Synthetic request', language: 'en', context: 'Synthetic context' } as never, AbortSignal.timeout(10_000)).then(() => 'ok', (error: Error) => error.message);
    return { result, calls }; };
  assert.deepEqual(await run([429, 200]), { result: 'ok', calls: 2 });
  assert.deepEqual(await run([429, 429, 429]), { result: 'google_mobility_busy', calls: 3 });
  assert.deepEqual(await run([500, 200]), { result: 'google_mobility_unavailable', calls: 1 });
});
