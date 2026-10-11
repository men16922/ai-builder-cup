import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { SqliteCloudStore } from '../src/store/sqlite-store';
import { GcpWebAccess } from '../src/auth/web-access';
import { GcpObservations, type GcpRegistration } from '../src/workflow/observations';
import { createGcpApiServer } from '../src/http/api';
import { CloudRunCollector } from '../src/cloud-run/collector';
import { CloudRunError } from '../src/cloud-run/transport';
import { cloudRunEvidence } from '../src/cloud-run/collector';
import { cloudDigest } from '../src/store/integrity';
import { CloudWorkflow } from '../src/workflow/workflow';
import type { CloudBinding } from '@contracts/core/operations';
import type { GcpObservation } from '@contracts/gcp/observations';
const at = '2026-10-10T01:00:00.000Z', name = 'projects/example-mobileops-demo/locations/asia-northeast3/services/checkout-demo';
const target = { provider: 'gcp', projectId: 'example-mobileops-demo', location: 'asia-northeast3', resourceId: 'checkout', resourceName: name, resourceUid: 'uid-demo', revision: 'checkout-demo-00001' } as const;
const scope = { edition: 'organization', organizationId: 'org-demo', workspaceId: 'workspace-demo', label: 'Demo' } as const;
const base = '/api/organizations/v1/org-demo/workspaces/workspace-demo/gcp';
const code = (expected: string) => (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === expected;
async function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'mobileops-gcp-api-')), store = new SqliteCloudStore(join(dir, 'test.sqlite'));
  let now = Date.parse(at), count = 0, revokedToken = false;
  const access = new GcpWebAccess({ async verify(token) { if (revokedToken || !['user-a', 'user-b'].includes(token)) throw Error(); return { actorId: token, expiresAt: now + 60000 }; } }, store, () => now);
  const provision = (actorId: string, version = 1, active = true, roles: ('operator' | 'viewer')[] = ['operator']) => access.organization.provision({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, actorId, version, active, roles, updatedAt: at });
  await provision('user-a'); await provision('user-b');
  const bindings: CloudBinding[] = [
    { owner: { kind: 'organization', organizationId: 'org-demo' }, workspaceId: scope.workspaceId, environmentId: 'env-demo', target },
    { owner: { kind: 'personal', userId: 'user-a' }, workspaceId: scope.workspaceId, environmentId: 'env-demo', target },
    { owner: { kind: 'personal', userId: 'user-b' }, workspaceId: scope.workspaceId, environmentId: 'env-demo', target },
  ];
  let readHook: (() => Promise<void>) | undefined;
  const registrations: GcpRegistration[] = bindings.map((binding, index) => ({ id: `resource-${index}`, label: `Synthetic service ${index}`, binding, dataMode: 'synthetic', collector: new CloudRunCollector({ binding, expectedIdentity: 'synthetic-principal', now: () => Date.parse(at), transport: {
    dataMode: 'synthetic', async identity() { return 'synthetic-principal'; }, async read(operation) {
      count++; await readHook?.();
      const shared = { generation: '1', observedGeneration: '1', updateTime: at, reconciling: false };
      return operation === 'service' ? { ...shared, name, uid: 'uid-demo', terminalCondition: { state: 'CONDITION_SUCCEEDED' }, latestCreatedRevision: target.revision, latestReadyRevision: target.revision, trafficStatuses: [{ revision: target.revision, percent: 100 }] }
        : { ...shared, name: `${name}/revisions/${target.revision}`, service: name, uid: 'revision-uid', conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }] };
    },
  } }) }));
  const observations = new GcpObservations(store, access, registrations, () => now);
  const services = { access, observations, publicOrigin: 'http://127.0.0.1' };
  const server = createGcpApiServer(services); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw Error();
  const origin = `http://127.0.0.1:${address.port}`; services.publicOrigin = origin;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = async (path: string, input?: unknown, token = 'user-a', key = randomUUID(), extra: Record<string, string> = {}) => {
    const res = await fetch(origin + path, { method: input === undefined ? 'GET' : 'POST', headers: { Origin: origin, Authorization: `Bearer ${token}`, ...(input !== undefined ? { 'Content-Type': 'application/json', 'Idempotency-Key': key } : {}), ...extra }, ...(input !== undefined ? { body: JSON.stringify(input) } : {}) });
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  return { store, access, observations, registrations, provision, call, count: () => count, session: () => access.authenticate('Bearer user-a', scope),
    setHook(fn?: () => Promise<void>) { readHook = fn; }, advance(ms: number) { now += ms; }, revokeToken() { revokedToken = true; }, now: () => now };
}

test('GCP HTTP authenticates scoped reads and commits observation/evidence atomically; replay returns the same snapshot without a new provider call', async t => {
  const s = await fixture(t); const list = await s.call(`${base}/resources`); assert.equal(list.status, 200); assert.deepEqual(list.body.items.map((x: { id: string }) => x.id), ['resource-0']);
  const key = randomUUID(), first = await s.call(`${base}/observations`, { resourceId: 'resource-0' }, 'user-a', key);
  assert.equal(first.status, 200); assert.equal(s.count(), 3); const observation = first.body as GcpObservation;
  const replay = await s.call(`${base}/observations`, { resourceId: 'resource-0' }, 'user-a', key); assert.deepEqual(replay.body, first.body); assert.equal(s.count(), 3);
  const get = await s.call(`${base}/observations/${observation.snapshot.id}`); assert.deepEqual(get.body, observation); assert.equal(get.headers.get('cache-control'), 'no-store');
  const evidence = await new CloudWorkflow(s.store).getEvidence((await s.session()).context, observation.snapshot.id);
  assert.equal(cloudDigest(evidence), observation.evidenceDigest); assert.equal(cloudDigest(cloudRunEvidence(observation.snapshot)), observation.evidenceDigest);
  assert.ok(!JSON.stringify(observation).includes('Bearer'));
});

test('personal and organization namespaces cannot cross, and no demo headers/cookies or client target overrides confer access', async t => {
  const s = await fixture(t), personal = `/api/personal/v1/workspaces/${scope.workspaceId}/gcp`;
  assert.deepEqual((await s.call(`${personal}/resources`)).body.items.map((x: { id: string }) => x.id), ['resource-1']);
  assert.deepEqual((await s.call(`${personal}/resources`, undefined, 'user-b')).body.items.map((x: { id: string }) => x.id), ['resource-2']);
  for (const path of [base, personal]) for (const input of [{ resourceId: 'resource-0', projectId: 'other' }, { resourceId: 'resource-0', command: 'gcloud' }, { resourceId: 'resource-0', owner: { kind: 'personal', userId: 'user-a' } }]) assert.equal((await s.call(`${path}/observations`, input)).status, 400);
  assert.equal((await s.call(`${personal}/observations`, { resourceId: 'resource-0' })).status, 404);
  assert.equal((await s.call(`${base}/observations`, { resourceId: 'resource-1' })).status, 404);
  assert.equal((await s.call(`${base}/resources`, undefined, 'invalid', randomUUID(), { 'x-cloudops-demo-persona': 'lead', Cookie: 'cloudops-aws=fake' })).status, 401);
  assert.equal((await s.call(`${base}/observations`, { resourceId: 'resource-0' }, 'user-a', randomUUID(), { Origin: 'https://other.invalid' })).status, 403);
  assert.equal(s.count(), 0);
});

test('viewer cannot collect; token or membership revocation blocks a replay and clears the result path', async t => {
  const s = await fixture(t), key = randomUUID();
  assert.equal((await s.call(`${base}/observations`, { resourceId: 'resource-0' }, 'user-a', key)).status, 200);
  await s.provision('user-a', 2, true, ['viewer']); assert.equal((await s.call(`${base}/resources`)).status, 200);
  assert.equal((await s.call(`${base}/observations`, { resourceId: 'resource-0' }, 'user-a', key)).status, 403);
  await s.provision('user-a', 3, false); assert.equal((await s.call(`${base}/resources`)).status, 403);
  s.revokeToken(); assert.equal((await s.call(`${base}/resources`)).status, 401); assert.equal(s.count(), 3);
});

test('two registries share one durable request reservation; unknown after lost worker is not dispatched again', async t => {
  const s = await fixture(t), session = await s.session(), key = randomUUID(); let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; }); s.setHook(() => held);
  const first = s.observations.collect(session, { resourceId: 'resource-0' }, key);
  while (s.count() === 0) await nextTurn();
  const reopened = new GcpObservations(s.store, s.access, s.registrations, s.now);
  await assert.rejects(reopened.collect(session, { resourceId: 'resource-0' }, key), code('collection_in_progress'));
  s.advance(31000);
  await assert.rejects(reopened.collect(session, { resourceId: 'resource-0' }, key), code('collection_unknown'));
  s.setHook(); release(); await assert.rejects(first, code('collection_unknown'));
  await assert.rejects(reopened.collect(session, { resourceId: 'resource-0' }, key), code('collection_unknown')); assert.equal(s.count(), 3);
});

test('membership revoked during provider I/O prevents evidence commit and the same key never recollects', async t => {
  const s = await fixture(t), key = randomUUID(); let called = false;
  s.setHook(async () => { if (!called) { called = true; await s.provision('user-a', 2, false); } });
  const result = await s.call(`${base}/observations`, { resourceId: 'resource-0' }, 'user-a', key); assert.equal(result.status, 403);
  await s.provision('user-a', 3, true); s.setHook();
  const replay = await s.call(`${base}/observations`, { resourceId: 'resource-0' }, 'user-a', key); assert.equal(replay.status, 409); assert.equal(s.count(), 3);
});

test('configuration changes and forged collector responses cannot enter the fixed evidence namespace', async t => {
  const s = await fixture(t), session = await s.session(), key = randomUUID();
  await s.observations.collect(session, { resourceId: 'resource-0' }, key);
  const changed = new GcpObservations(s.store, s.access, s.registrations.map(x => ({ ...x, label: x.label + '-changed' })), s.now);
  await assert.rejects(changed.collect(session, { resourceId: 'resource-0' }, key), code('idempotency_conflict')); assert.equal(s.count(), 3);
  const source = s.registrations[0], wrong = { ...source, collector: { async collect() { const snapshot = await source.collector.collect(session.context); return { ...snapshot, binding: s.registrations[1].binding }; } } };
  await assert.rejects(new GcpObservations(s.store, s.access, [wrong], s.now).collect(session, { resourceId: 'resource-0' }, randomUUID()), code('configuration_changed'));
});

test('provider denial remains persisted evidence, not an HTTP success claim about service health', async t => {
  const s = await fixture(t); s.setHook(async () => { throw new CloudRunError('access_denied'); });
  const result = await s.call(`${base}/observations`, { resourceId: 'resource-0' }); assert.equal(result.status, 200);
  assert.equal(result.body.snapshot.service.status, 'denied'); assert.equal(result.body.snapshot.serviceAssessment, 'unknown'); assert.equal(s.count(), 1);
});
