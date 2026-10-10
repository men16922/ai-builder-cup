import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { CloudAccessError, type CloudBinding, type VerifiedCloudContext } from '../src/domain/cloud-operations';
import { cloudRunBindingSchema, cloudRunSnapshotSchema, serviceSource, revisionSource } from '../src/modules/gcp/domain/cloud-run';
import { CloudRunCollector, cloudRunEvidence } from './modules/gcp/cloud-run-collector';
import { CloudRunError, createCloudRunRestTransport, createSyntheticCloudRunRestTransport, principalKey,
  serviceFields, revisionFields, type CloudRunTransport } from './modules/gcp/cloud-run-transport';
import { cloudDigest } from './cloud-integrity';
import { CloudWorkflow } from './cloud-workflow';
import { SqliteCloudStore } from './cloud-sqlite-store';

const owner = { kind: 'organization', organizationId: 'org-synthetic' } as const;
const serviceName = 'projects/example-mobileops-demo/locations/asia-northeast3/services/checkout-demo';
const revisionName = `${serviceName}/revisions/checkout-demo-00002`;
const binding: CloudBinding = { owner, workspaceId: 'workspace-demo', environmentId: 'env-gcp', target: {
  provider: 'gcp', projectId: 'example-mobileops-demo', location: 'asia-northeast3', resourceId: 'service-demo', resourceName: serviceName, resourceUid: 'service-uid-synthetic', revision: 'checkout-demo-00002',
} };
const context: VerifiedCloudContext = { actorId: 'user-demo', owner, workspaceId: 'workspace-demo', channel: 'web', roles: ['operator'] };
const time = '2026-10-10T01:00:00.000Z';
const credential = { principal: 'synthetic-reader@example.invalid', sessionId: 'session-demo', accessToken: 'synthetic-token-never-persist' };
const expectedIdentity = principalKey(credential);
const fail = (code: CloudRunError['code']) => (error: unknown) => error instanceof CloudRunError && error.code === code;
const service = () => ({ name: serviceName, uid: 'service-uid-synthetic', generation: '2', observedGeneration: '2', updateTime: time, reconciling: false,
  etag: 'etag-demo', terminalCondition: { state: 'CONDITION_SUCCEEDED', message: 'DO-NOT-EXPORT-CONDITION' },
  latestCreatedRevision: revisionName, latestReadyRevision: revisionName, trafficStatuses: [{ revision: 'checkout-demo-00002', percent: 100 }],
  template: { containers: [{ env: [{ name: 'SECRET', value: 'DO-NOT-EXPORT-ENV' }] }] }, annotations: { secret: 'DO-NOT-EXPORT-ANNOTATION' } });
const revision = () => ({ name: revisionName, service: serviceName, uid: 'revision-uid-synthetic', generation: '1', observedGeneration: '1', updateTime: time, reconciling: false,
  conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED', message: 'DO-NOT-EXPORT-REVISION' }], containers: [{ env: [{ value: 'DO-NOT-EXPORT-SECRET' }] }] });
function fixture() {
  const calls: string[] = []; let identity = expectedIdentity;
  let read: CloudRunTransport['read'] = async op => op === 'service' ? service() : revision();
  const transport: CloudRunTransport = { dataMode: 'synthetic', async identity() { calls.push('identity'); return identity; }, async read(op, signal) { calls.push(op); return read(op, signal); } };
  const collector = new CloudRunCollector({ binding, transport, expectedIdentity, now: () => Date.parse(time) });
  return { calls, collector, setRead(fn: CloudRunTransport['read']) { read = fn; }, changeIdentity() { identity = 'changed'; } };
}

test('Cloud Run collector pins one service/revision and stores only metadata, provenance and unknown health', async () => {
  const s = fixture(), snapshot = await s.collector.collect(context);
  assert.deepEqual(s.calls, ['identity', 'service', 'revision', 'service', 'identity']);
  assert.equal(snapshot.consistency, 'stable'); assert.equal(snapshot.serviceAssessment, 'unknown');
  assert.equal(snapshot.service.status, 'collected'); assert.equal(snapshot.revision.status, 'collected');
  if (snapshot.service.status !== 'collected') assert.fail();
  assert.deepEqual(snapshot.service.value.traffic, [{ revision: 'checkout-demo-00002', percent: 100 }]);
  assert.deepEqual(snapshot.service.value.missingFields, []);
  const evidence = cloudRunEvidence(snapshot);
  assert.equal(evidence.target.provider, 'gcp'); assert.equal(evidence.observations[0].quality, 'complete');
  assert.equal(evidence.observations[1].source, revisionSource); assert.equal(evidence.observations[4].quality, 'missing');
  assert.ok(!JSON.stringify([snapshot, evidence]).includes('DO-NOT-EXPORT')); assert.ok(!JSON.stringify(snapshot).includes('synthetic-token'));
  assert.equal(cloudRunSnapshotSchema.safeParse({ ...snapshot, token: 'secret' }).success, false);
  assert.equal(cloudRunSnapshotSchema.safeParse({ ...snapshot, service: { ...snapshot.service, resourceName: serviceName + '-other' } }).success, false);
  assert.equal(cloudRunSnapshotSchema.safeParse({ ...snapshot, observedAt: '2026-10-10T00:00:00.000Z' }).success, false);
});

test('fixed REST transport uses exact GET paths and partial fields; no redirect, endpoint or command is accepted', async () => {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const transport = createSyntheticCloudRunRestTransport({ binding, ...credential, credentials: { async current() { return credential; } },
    fetcher: async (input, init) => { calls.push({ url: new URL(String(input)), init }); return new Response(JSON.stringify(String(input).includes('/revisions/') ? revision() : service())); } });
  const collector = new CloudRunCollector({ binding, transport, expectedIdentity, now: () => Date.parse(time) });
  assert.equal((await collector.collect(context)).dataMode, 'synthetic');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(x => x.url.pathname), [`/v2/${serviceName}`, `/v2/${revisionName}`, `/v2/${serviceName}`]);
  assert.deepEqual(calls.map(x => x.url.searchParams.get('fields')), [serviceFields, revisionFields, serviceFields]);
  for (const call of calls) {
    assert.equal(call.url.origin, 'https://run.googleapis.com'); assert.equal(call.init?.method, 'GET'); assert.equal(call.init?.redirect, 'error');
    assert.equal(call.init?.credentials, 'omit'); assert.equal(call.init?.body, undefined);
  }
  assert.equal(cloudRunBindingSchema.safeParse({ ...binding, endpoint: 'https://invalid.example' }).success, false);
  for (const suffix of ['/revisions/injected', '?alt=media', '/../other', '%2fother']) {
    assert.equal(cloudRunBindingSchema.safeParse({ ...binding, target: { ...binding.target, resourceName: serviceName + suffix } }).success, false);
  }
  assert.throws(() => createCloudRunRestTransport({ binding, ...credential, credentials: { async current() { throw Error('must not call'); } }, enabled: true, offline: false }), fail('disabled'));
});

test('service denial/not-found/throttle preserve missing evidence and never query a revision without a verified service', async () => {
  for (const [code, status] of [['access_denied', 'denied'], ['not_found', 'missing'], ['throttled', 'unavailable']] as const) {
    const s = fixture(); s.setRead(async () => { throw new CloudRunError(code); });
    const result = await s.collector.collect(context);
    assert.equal(result.service.status, status); assert.equal(result.revision.status, 'skipped'); assert.equal(result.consistency, 'unverified');
    assert.deepEqual(s.calls, ['identity', 'service', 'identity']);
    const evidence = cloudRunEvidence(result); assert.equal(evidence.observations[0].value, null); assert.equal(evidence.observations[1].source, 'mobileops:collection-scope');
  }
});

test('revision denial preserves collected service; failed final verification makes all collected evidence partial', async () => {
  const denied = fixture(); denied.setRead(async op => { if (op === 'revision') throw new CloudRunError('access_denied'); return service(); });
  const snapshot = await denied.collector.collect(context);
  assert.equal(snapshot.service.status, 'collected'); assert.equal(snapshot.revision.status, 'denied'); assert.equal(snapshot.consistency, 'stable');
  const missingRecheck = fixture(); let count = 0;
  missingRecheck.setRead(async op => { if (op === 'revision') return revision(); if (++count === 2) throw new CloudRunError('access_denied'); return service(); });
  const evidence = cloudRunEvidence(await missingRecheck.collector.collect(context));
  assert.equal(evidence.observations[0].quality, 'partial'); assert.equal(evidence.observations[2].quality, 'denied');
});

test('unknown or missing condition/generation/traffic never imply ready, zero traffic, or complete evidence', async () => {
  const s = fixture(); s.setRead(async op => op === 'service'
    ? { name: serviceName, uid: 'service-uid-synthetic', terminalCondition: { state: 'FUTURE_STATE' } }
    : { ...revision(), conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }, { type: 'Ready', state: 'CONDITION_FAILED' }] });
  const snapshot = await s.collector.collect(context);
  if (snapshot.service.status !== 'collected' || snapshot.revision.status !== 'collected') assert.fail();
  assert.equal(snapshot.service.value.readiness, 'unknown'); assert.equal(snapshot.service.value.traffic, null);
  assert.equal(snapshot.service.value.reconciling, null); assert.equal(snapshot.revision.value.readiness, 'unknown');
  assert.equal(cloudRunEvidence(snapshot).observations[0].quality, 'partial');
  s.setRead(async op => op === 'service' ? { ...service(), observedGeneration: '1', trafficStatuses: [{ revision: 'checkout-demo-00002' }] } : revision());
  const partial = await s.collector.collect(context); if (partial.service.status !== 'collected') assert.fail();
  assert.ok(partial.service.value.missingFields.includes('generationNotObserved')); assert.ok(partial.service.value.missingFields.includes('trafficAllocationIncomplete'));
});

test('readiness failure and reconciliation are observed states, not collector errors or application health', async () => {
  for (const state of ['CONDITION_FAILED', 'CONDITION_PENDING', 'CONDITION_RECONCILING']) {
    const s = fixture(); s.setRead(async op => op === 'service' ? { ...service(), terminalCondition: { state }, reconciling: state !== 'CONDITION_FAILED' } : revision());
    const snapshot = await s.collector.collect(context); if (snapshot.service.status !== 'collected') assert.fail();
    assert.notEqual(snapshot.service.value.readiness, 'succeeded'); assert.equal(snapshot.serviceAssessment, 'unknown');
  }
});

test('cross-owner/workspace access is rejected before identity or API calls and GCP mobile uses the same scope', async () => {
  const s = fixture();
  for (const other of [{ ...context, owner: { kind: 'personal', userId: context.actorId } as const }, { ...context, workspaceId: 'other' }, { ...context, roles: [] }]) await assert.rejects(s.collector.collect(other), CloudAccessError);
  assert.deepEqual(s.calls, []);
  assert.equal((await s.collector.collect({ ...context, channel: 'mobile' })).binding.workspaceId, binding.workspaceId);
  let revalidations = 0;
  await assert.rejects(s.collector.collect(context, { revalidate: async () => ({ ...context, roles: ++revalidations === 1 ? ['operator'] : [] }) }), CloudAccessError);
});

test('resource replacement, other service/revision and cross-project references are rejected without releasing observations', async () => {
  for (const alter of ['name', 'uid', 'revision-name', 'revision-parent', 'revision-short-parent', 'traffic', 'latest'] as const) {
    const s = fixture();
    s.setRead(async op => op === 'service' ? { ...service(), ...(alter === 'name' ? { name: serviceName + '-other' } : alter === 'uid' ? { uid: 'replacement-uid' } : alter === 'traffic' ? { trafficStatuses: [{ revision: 'projects/foreign/locations/else/services/other/revisions/x', percent: 100 }] } : alter === 'latest' ? { latestCreatedRevision: 'https://invalid.example' } : {}) }
      : { ...revision(), ...(alter === 'revision-name' ? { name: revisionName + '-other' } : alter === 'revision-parent' ? { service: serviceName + '-other' } : alter === 'revision-short-parent' ? { service: 'other-service' } : {}) });
    await assert.rejects(s.collector.collect(context), fail('scope_changed'));
  }
  // The live v2 API reports the revision parent as the short service ID; it is normalized to the full name.
  const live = fixture(); live.setRead(async op => op === 'service' ? service() : { ...revision(), service: serviceName.slice(serviceName.lastIndexOf('/') + 1) });
  const snapshot = await live.collector.collect(context);
  assert.equal(snapshot.revision.status, 'collected'); assert.equal(snapshot.revision.status === 'collected' && snapshot.revision.value.service, serviceName);
  const s = fixture(); let count = 0; s.setRead(async op => op === 'revision' ? revision() : { ...service(), uid: ++count === 1 ? 'service-uid-synthetic' : 'replacement' });
  await assert.rejects(s.collector.collect(context), fail('scope_changed'));
});

test('same UID with a deployment/traffic change during collection retains both observations and marks evidence partial', async () => {
  const s = fixture(); let count = 0;
  s.setRead(async op => op === 'revision' ? revision() : ++count === 1 ? service() : { ...service(), etag: 'etag-changed', generation: '3', trafficStatuses: [{ revision: 'checkout-demo-00003', percent: 100 }] });
  const snapshot = await s.collector.collect(context); assert.equal(snapshot.consistency, 'changed');
  const evidence = cloudRunEvidence(snapshot); assert.equal(evidence.observations[0].quality, 'partial'); assert.equal(evidence.observations[1].quality, 'partial');
  assert.notDeepEqual(evidence.observations[0].value, evidence.observations[2].value);
});

test('principal/session change before or after reads discards evidence and REST auth errors never leak raw bodies', async () => {
  const before = fixture(); before.changeIdentity(); await assert.rejects(before.collector.collect(context), fail('identity_changed')); assert.deepEqual(before.calls, ['identity']);
  const after = fixture(); after.setRead(async op => { if (op === 'revision') after.changeIdentity(); return op === 'service' ? service() : revision(); });
  await assert.rejects(after.collector.collect(context), fail('identity_changed'));
  let fetches = 0, auth = { ...credential };
  const transport = createSyntheticCloudRunRestTransport({ binding, ...credential, credentials: { async current() { return auth; } }, fetcher: async () => { fetches++; return new Response('secret raw failure', { status: 401 }); } });
  await assert.rejects(transport.read('service', new AbortController().signal), fail('identity_changed')); assert.equal(fetches, 1);
  auth = { ...credential, principal: 'other@example.invalid' };
  await assert.rejects(transport.read('service', new AbortController().signal), fail('identity_changed')); assert.equal(fetches, 1);
  auth = { ...credential, sessionId: 'different-session' };
  await assert.rejects(transport.read('service', new AbortController().signal), fail('identity_changed')); assert.equal(fetches, 1);
  auth = { ...credential, accessToken: 'synthetic-refreshed-token' };
  assert.equal(await transport.identity(new AbortController().signal), expectedIdentity);
});

test('cancel and concurrent collection cannot release stale results; malformed responses stay unavailable', async () => {
  const s = fixture(); let release: (value: unknown) => void = () => {};
  s.setRead(async () => new Promise(resolve => { release = resolve; }));
  const controller = new AbortController(), pending = s.collector.collect(context, { signal: controller.signal });
  while (!s.calls.includes('service')) await nextTurn();
  await assert.rejects(s.collector.collect(context), fail('busy'));
  controller.abort(); await assert.rejects(pending, fail('cancelled')); release(service()); await nextTurn();
  assert.deepEqual(s.calls, ['identity', 'service']);
  s.setRead(async () => ({ secret: 'DO-NOT-EXPORT' }));
  const malformed = await s.collector.collect(context); assert.equal(malformed.service.status, 'unavailable'); assert.ok(!JSON.stringify(malformed).includes('DO-NOT-EXPORT'));
});

test('REST reads bound response bytes and mask HTTP failures; no retry or raw provider error output', async () => {
  for (const [status, code] of [[403, 'access_denied'], [404, 'not_found'], [429, 'throttled'], [503, 'unavailable'], [302, 'unavailable']] as const) {
    let count = 0;
    const transport = createSyntheticCloudRunRestTransport({ binding, ...credential, credentials: { async current() { return credential; } }, fetcher: async () => { count++; return new Response('sensitive-provider-error', { status }); } });
    await assert.rejects(transport.read('service', new AbortController().signal), fail(code)); assert.equal(count, 1);
  }
  for (const body of ['not json sensitive-value', JSON.stringify({ huge: 'x'.repeat(131073) })]) {
    const transport = createSyntheticCloudRunRestTransport({ binding, ...credential, credentials: { async current() { return credential; } }, fetcher: async () => new Response(body) });
    await assert.rejects(transport.read('service', new AbortController().signal), fail('invalid_response'));
  }
});

test('collected evidence enters immutable scoped workflow storage with a reproducible digest and no implicit plan/execution', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mobileops-gcp-')), store = new SqliteCloudStore(join(dir, 'evidence.sqlite'));
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const workflow = new CloudWorkflow(store), s = fixture(), evidence = cloudRunEvidence(await s.collector.collect(context));
  await workflow.saveEvidence(context, evidence);
  const restored = await workflow.getEvidence({ ...context, channel: 'mobile' }, evidence.id);
  assert.equal(cloudDigest(restored), cloudDigest(evidence)); assert.equal(restored.observations[0].source, serviceSource);
  await assert.rejects(workflow.saveEvidence(context, { ...evidence, observedAt: '2026-10-10T02:00:00.000Z' }), (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === 'immutable_evidence');
  await assert.rejects(workflow.getEvidence({ ...context, owner: { kind: 'organization', organizationId: 'other' } }, evidence.id));
  assert.equal(s.calls.filter(x => x === 'service').length, 2);
});
