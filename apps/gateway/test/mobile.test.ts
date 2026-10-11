import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import type { CloudBinding, CloudPlanPayload, CloudTarget } from '@contracts/core/operations';
import { gcpInboxSchema } from '@contracts/gcp/mobile';
import { SqliteCloudStore } from '../src/store/sqlite-store';
import { CloudWorkflow, cloudRecordKey } from '../src/workflow/workflow';
import { cloudDigest } from '../src/store/integrity';
import { createGcpApiServer } from '../src/http/api';
import { GcpWebAccess } from '../src/auth/web-access';
import { GcpObservations, type GcpRegistration } from '../src/workflow/observations';
import { GcpAnalyses } from '../src/workflow/analyses';
import { GcpOperations } from '../src/workflow/operations';
import { CloudRunCollector } from '../src/cloud-run/collector';
import { createCloudRunAdapters } from '../src/cloud-run/inspection-adapter';
import type { GcpApiServices } from '../src/http/api';
import { syntheticTelemetry } from '../../../tests/support/gcp-telemetry';
import { GcpNotifications, type GcpPushPorts } from '../src/notifications/notifications';
import type { GcpNotification } from '@contracts/gcp/notifications';

async function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'gcp-mobile-')), path = join(dir, 'test.sqlite'), stores: SqliteCloudStore[] = [];
  const open = () => { const store = new SqliteCloudStore(path); stores.push(store); return store; }, store = open();
  let clock = Date.parse('2026-10-10T01:00:00.000Z'), reads = 0, queries = 0, models = 0, revoked = false;
  const now = () => clock, channels: string[] = [];
  const sent: GcpNotification[] = []; let sender: GcpPushPorts['send'] = async (_token, data) => { sent.push(data); return 'accepted'; };
  const scope = { edition: 'organization' as const, organizationId: 'synthetic-org', workspaceId: 'synthetic-workspace', label: 'Synthetic mobile' };
  const target = { provider: 'gcp' as const, projectId: 'example-mobileops-demo', location: 'asia-northeast3', resourceId: 'checkout', resourceName: 'projects/example-mobileops-demo/locations/asia-northeast3/services/checkout', resourceUid: 'synthetic-uid', revision: 'checkout-00001' };
  const owners = [{ kind: 'organization' as const, organizationId: scope.organizationId }, { kind: 'personal' as const, userId: 'user-a' }, { kind: 'personal' as const, userId: 'user-b' }];
  const registrations: GcpRegistration[] = owners.map((owner, index) => {
    const binding: CloudBinding = { owner, workspaceId: scope.workspaceId, environmentId: 'synthetic-env', target };
    const collector = new CloudRunCollector({ binding, now, expectedIdentity: 'synthetic-principal', transport: { dataMode: 'synthetic', async identity() { return 'synthetic-principal'; }, async read(operation) {
      reads++; const metadata = { generation: '1', observedGeneration: '1', updateTime: '2026-10-10T00:00:00.000Z', reconciling: false };
      return operation === 'revision' ? { ...metadata, name: `${target.resourceName}/revisions/${target.revision}`, uid: 'synthetic-revision', service: target.resourceName, conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }] }
        : { ...metadata, name: target.resourceName, uid: target.resourceUid, etag: 'stable', terminalCondition: { state: 'CONDITION_SUCCEEDED' }, latestCreatedRevision: target.revision, latestReadyRevision: target.revision, trafficStatuses: [{ revision: target.revision, percent: 100 }] };
    } }, telemetry: { dataMode: 'synthetic', async identity() { return 'synthetic-principal'; }, async read(operation, window) { queries++; return syntheticTelemetry(binding, operation, window); } } });
    return { id: `service-${index}`, label: `Synthetic service ${index}`, binding, dataMode: 'synthetic', telemetryEnabled: true, collector: { async collect(context, options) { channels.push(context.channel); return collector.collect(context, options); } } };
  });
  const compose = (store: SqliteCloudStore): GcpApiServices => {
    const access = new GcpWebAccess({ async verify(token) { if (revoked || !['user-a', 'user-b', 'expired'].includes(token)) throw Error(); return { actorId: token, expiresAt: token === 'expired' ? clock - 1 : clock + 3600000 }; } }, store, now);
    const observations = new GcpObservations(store, access, registrations, now), workflow = new CloudWorkflow(store, createCloudRunAdapters(registrations, 'synthetic', async () => { throw Error('Preparation must not dispatch'); }), now);
    const analyses = new GcpAnalyses(store, access, observations, workflow, { engine: 'synthetic-fixture', modelId: 'synthetic-mobile', configurationId: 'mobile-v1', async analyze() { models++; return { summary: 'Synthetic evidence for mobile review.', findings: [{ kind: 'observation', statement: 'Request samples are bounded.', evidenceIds: ['gcp-run-requests'] }], missingInformation: ['Service health remains unknown.'], serviceAssessment: 'unknown' }; } }, now);
    const notifications = new GcpNotifications(store, access, { dataMode: 'synthetic', async current() { return !revoked; }, send: (...args) => sender(...args) }, now);
    return { access, observations, analyses, notifications, operations: new GcpOperations(store, access, analyses, registrations, now), publicOrigin: 'http://127.0.0.1' };
  };
  const services = compose(store);
  const server = createGcpApiServer(services); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw Error();
  const origin = `http://127.0.0.1:${address.port}`; services.publicOrigin = origin;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); stores.reverse().forEach(store => store.close()); rmSync(dir, { recursive: true, force: true }); });
  const provision = (actorId: string, version = 1, roles: ('operator' | 'reviewer' | 'viewer')[] = ['operator', 'reviewer'], active = true) => services.access.organization.provision({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, actorId, version, active, roles, updatedAt: new Date(clock).toISOString() });
  await provision('user-a'); await provision('user-b');
  const web = `/api/organizations/v1/${scope.organizationId}/workspaces/${scope.workspaceId}/gcp`, mobile = `/api/mobile/v1/organizations/${scope.organizationId}/workspaces/${scope.workspaceId}/gcp`;
  const personalWeb = `/api/personal/v1/workspaces/${scope.workspaceId}/gcp`, personalMobile = `/api/mobile/v1/personal/workspaces/${scope.workspaceId}/gcp`;
  const http = async (path: string, body?: unknown, options: { token?: string; key?: string; headers?: Record<string, string>; noToken?: boolean } = {}) => {
    const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: {
      ...(path.startsWith('/api/mobile/') ? {} : { Origin: origin }), ...(options.noToken ? {} : { Authorization: `Bearer ${options.token ?? 'user-a'}` }),
      'Content-Type': 'application/json', 'Idempotency-Key': options.key ?? randomUUID(), ...options.headers,
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const prepare = async (base = web, resourceId = 'service-0') => {
    const observation = await http(`${base}/observations`, { resourceId }); assert.equal(observation.status, 200);
    const analysis = await http(`${base}/analyses`, { observationId: observation.body.snapshot.id, language: 'en' }); assert.equal(analysis.status, 200);
    const expected = { expectedVersion: analysis.body.plan.version, expectedDigest: analysis.body.planDigest }, id = analysis.body.id;
    assert.equal((await http(`${base}/plans/${id}/review`, expected)).status, 200);
    return { id, analysis: analysis.body, expected, input: { ...expected, planId: id }, observationId: observation.body.snapshot.id };
  };
  return { store, services: () => services, http, prepare, provision, web, mobile, personalWeb, personalMobile, scope, registrations, origin, channels, sent,
    sender(next: GcpPushPorts['send']) { sender = next; },
    counts: () => ({ reads, queries, models }), revoke() { revoked = true; }, advance(ms: number) { clock += ms; },
    reopen() { Object.assign(services, compose(open())); services.publicOrigin = origin; } };
}

test('native GCP inbox continues web review, explicit execution and handoff, restores after reopening and never repeats a read', async t => {
  const s = await setup(t), p = await s.prepare();
  const inbox = await s.http(`${s.mobile}/inbox`); assert.equal(inbox.status, 200); const parsed = gcpInboxSchema.parse(inbox.body); assert.deepEqual(parsed.items.map(item => item.id), [p.id]);
  assert.equal(inbox.headers.get('cache-control'), 'no-store'); assert.equal(parsed.items[0].binding.target.provider, 'gcp');
  for (const [part, id] of [['plans', p.id], ['analyses', p.id], ['observations', p.observationId]]) assert.equal((await s.http(`${s.mobile}/${part}/${id}`)).status, 200);
  const decide = { ...p.expected, decision: 'approve', note: 'Synthetic mobile review.' }, key = randomUUID();
  const approved = await s.http(`${s.mobile}/plans/${p.id}/decision`, decide, { key }); assert.equal(approved.status, 200); assert.equal(approved.body.execution, undefined);
  assert.equal((await s.http(`${s.web}/plans/${p.id}`)).body.plan.review.status, 'approved'); assert.deepEqual(s.counts(), { reads: 3, queries: 3, models: 1 });
  assert.equal((await s.http(`${s.mobile}/plans/${p.id}/decision`, decide, { key })).status, 200);
  assert.deepEqual((await s.http(`${s.mobile}/inbox`)).body.items, []);
  const executionKey = randomUUID(), result = await s.http(`${s.mobile}/plans/${p.id}/execute`, p.input, { key: executionKey });
  assert.equal(result.status, 200); assert.equal(result.body.execution.state, 'succeeded'); assert.equal(result.body.execution.result.serviceAssessment, 'unknown'); assert.equal(result.body.execution.result.coverage, 'partial');
  assert.deepEqual(s.channels, ['web', 'mobile']); const executionId = result.body.execution.id;
  const noteKey = randomUUID(), note = { note: 'Synthetic mobile handoff; no health verdict.' };
  assert.equal((await s.http(`${s.mobile}/executions/${executionId}/handoff`, note, { key: noteKey })).status, 200);
  s.reopen();
  assert.equal((await s.http(`${s.mobile}/plans/${p.id}/execute`, p.input, { key: executionKey })).body.execution.id, executionId);
  assert.equal((await s.http(`${s.mobile}/executions/${executionId}/handoff`, note, { key: noteKey })).body.execution.handoffs.length, 1);
  const restored = await s.http(`${s.mobile}/executions/${executionId}`); assert.equal(restored.body.execution.handoffs[0].note, note.note);
  assert.equal((await s.http(`${s.mobile}/inbox?status=results`)).body.items[0].executionState, 'succeeded');
  assert.deepEqual(s.counts(), { reads: 6, queries: 6, models: 1 });
  assert.doesNotMatch(JSON.stringify(restored.body), /Bearer|authorization|membershipVersion|tokenDigest|NEVER_EXPORT/);
});

test('native exception stays confined to authenticated mobile routes and refuses browser cross-origin and unknown fields', async t => {
  const s = await setup(t), p = await s.prepare(), counts = s.counts();
  for (const options of [{ noToken: true }, { token: 'invalid' }, { token: 'expired' }]) assert.equal((await s.http(`${s.mobile}/inbox`, undefined, options)).status, 401);
  for (const headers of [{ Origin: 'https://other.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }] as Record<string, string>[]) assert.equal((await s.http(`${s.mobile}/inbox`, undefined, { headers })).status, 403, Object.keys(headers).join(','));
  // Fetch normalizes Host; send the hostile authority on the wire with native HTTP.
  const wrongHost = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(s.origin + s.mobile + '/inbox', { headers: { Host: 'other.example', Authorization: 'Bearer user-a' } }, response => { response.resume(); resolve(response.statusCode!); });
    request.on('error', reject); request.end();
  });
  assert.equal(wrongHost, 403);
  assert.equal((await s.http(`${s.web}/plans/${p.id}`, undefined, { headers: { Origin: '' } })).status, 403);
  for (const suffix of ['?role=reviewer', '?limit=21', '?limit=0', '?status=pending&status=all', '?cursor=bad']) assert.equal((await s.http(`${s.mobile}/inbox${suffix}`)).status, 400);
  assert.equal((await s.http(`${s.mobile}/inbox?cursor=${randomUUID()}`)).status, 409);
  for (const part of ['observations', 'analyses', 'resources', 'plans']) assert.equal((await s.http(`${s.mobile}/${part}`, {})).status, 404);
  for (const extra of [{ channel: 'web' }, { role: 'reviewer' }, { target: {} }, { inputs: { windowMinutes: 60 } }]) assert.equal((await s.http(`${s.mobile}/plans/${p.id}/decision`, { ...p.expected, decision: 'approve', note: '', ...extra })).status, 400);
  assert.deepEqual(s.counts(), counts);
});

test('owner, organization membership and roles are rechecked before detail, decisions and replay', async t => {
  const s = await setup(t), p = await s.prepare(), personal = await s.prepare(s.personalWeb, 'service-1'), counts = s.counts();
  assert.equal((await s.http(`${s.personalMobile}/plans/${p.id}`)).status, 404);
  assert.equal((await s.http(`${s.mobile}/plans/${personal.id}`)).status, 404);
  assert.equal((await s.http(`${s.personalMobile}/plans/${personal.id}`, undefined, { token: 'user-b' })).status, 404);
  assert.equal((await s.http(s.mobile.replace(s.scope.organizationId, 'other-org') + '/inbox')).status, 403);
  assert.deepEqual((await s.http(`${s.personalMobile}/inbox`, undefined, { token: 'user-b' })).body.items, []);
  await s.provision('user-a', 2, ['operator']);
  assert.equal((await s.http(`${s.mobile}/plans/${p.id}/decision`, { ...p.expected, decision: 'approve', note: '' })).status, 403);
  await s.provision('user-b', 2, ['reviewer']);
  const key = randomUUID(), input = { ...p.expected, decision: 'approve', note: '' };
  assert.equal((await s.http(`${s.mobile}/plans/${p.id}/decision`, input, { key, token: 'user-b' })).status, 200);
  assert.equal((await s.http(`${s.mobile}/plans/${p.id}/execute`, p.input, { token: 'user-b' })).status, 403);
  await s.provision('user-b', 3, ['reviewer'], false);
  assert.equal((await s.http(`${s.mobile}/plans/${p.id}/decision`, input, { key, token: 'user-b' })).status, 403);
  s.revoke(); assert.equal((await s.http(`${s.mobile}/inbox`)).status, 401); assert.deepEqual(s.counts(), counts);
});

test('mobile inbox paginates current pending plans, handles expiry and never executes stale decisions', async t => {
  const s = await setup(t), plans = [];
  for (let i = 0; i < 4; i++) plans.push(await s.prepare());
  const counts = s.counts(), first = await s.http(`${s.mobile}/inbox?limit=2`);
  assert.deepEqual(first.body.items.map((x: { id: string }) => x.id), [plans[3].id, plans[2].id]); assert.equal(first.body.nextCursor, plans[2].id);
  const second = await s.http(`${s.mobile}/inbox?limit=2&cursor=${first.body.nextCursor}`);
  assert.deepEqual(second.body.items.map((x: { id: string }) => x.id), [plans[1].id, plans[0].id]); assert.equal(second.body.nextCursor, undefined);
  const p = plans[0], key = randomUUID();
  const race = await Promise.all(['user-a', 'user-b'].map(token => s.http(`${s.mobile}/plans/${p.id}/decision`, { ...p.expected, decision: 'approve', note: '' }, { token, key })));
  assert.deepEqual(race.map(x => x.status).sort(), [200, 409]);
  s.advance(300001); assert.deepEqual((await s.http(`${s.mobile}/inbox`)).body.items, []);
  const all = await s.http(`${s.mobile}/inbox?status=all`); assert.ok(all.body.items.every((x: { expired: boolean }) => x.expired));
  assert.equal((await s.http(`${s.mobile}/plans/${plans[1].id}/decision`, { ...plans[1].expected, decision: 'approve', note: '' })).status, 410);
  assert.equal((await s.http(`${s.mobile}/plans/${p.id}/execute`, p.input)).status, 410); assert.deepEqual(s.counts(), counts);
});

test('non-GCP records cannot enter mobile inbox, detail, decisions, execution or handoff even through contaminated indexes', async t => {
  const s = await setup(t), p = await s.prepare(), counts = s.counts();
  const context = (await s.services().access.authenticate('Bearer user-a', s.scope)).context;
  const cases: { target: CloudTarget; action: CloudPlanPayload['action'] }[] = [
    { target: { provider: 'aws', accountId: '111111111111', partition: 'aws', scope: { kind: 'regional', region: 'us-east-1' }, service: 's3', resourceId: 'checkout', nativeId: 'synthetic-bucket' }, action: { id: 'aws.s3.versioning.inspect.v1', version: 1, effect: 'read', inputs: {}, completionCriteria: ['Synthetic read.'] } },
    { target: { provider: 'onprem', siteId: 'local', connectorId: 'synthetic', platform: 'docker', engineId: 'synthetic', containerId: 'a'.repeat(64), name: 'checkout', resourceId: 'checkout' }, action: { id: 'onprem.docker.inspect.v1', version: 1, effect: 'read', inputs: {}, completionCriteria: ['Synthetic read.'] } },
    { target: { provider: 'azure', tenantId: randomUUID(), subscriptionId: '11111111-1111-4111-8111-111111111111', resourceGroup: 'synthetic', resourceId: 'checkout', armResourceId: '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/synthetic/providers/Microsoft.Compute/virtualMachines/example' }, action: { id: 'azure.vm.inspect.v1', version: 1, effect: 'read', inputs: { windowMinutes: 15 }, completionCriteria: ['Reserved contract only.'] } },
  ];
  for (const item of cases) {
    const id = randomUUID(), executionId = randomUUID(), payload = { ...p.analysis.plan, planId: id, target: item.target, action: item.action }, digest = cloudDigest(payload);
    await s.store.transact(async tx => {
      const indexKey = cloudRecordKey(context, 'gcp-plans', 'recent'), index = await tx.get<unknown[]>(indexKey) ?? [];
      await tx.get(cloudRecordKey(context, 'plan', id)); await tx.get(cloudRecordKey(context, 'execution', executionId));
      tx.put(indexKey, [{ id, resourceId: 'service-0', createdAt: payload.createdAt }, ...index]);
      tx.put(cloudRecordKey(context, 'plan', id), { payload, digest, lifecycle: 'consumed', review: { status: 'approved' }, executionId });
      tx.put(cloudRecordKey(context, 'execution', executionId), { id: executionId, binding: { owner: context.owner, workspaceId: context.workspaceId, environmentId: payload.environmentId, target: item.target }, planId: id });
    });
    for (const [path, body] of [[`plans/${id}`, undefined], [`plans/${id}/decision`, { ...p.expected, decision: 'approve', note: '' }], [`plans/${id}/execute`, { ...p.input, planId: id }], [`executions/${executionId}`, undefined], [`executions/${executionId}/handoff`, { note: 'Must not save' }]] as const) {
      const result = await s.http(`${s.mobile}/${path}`, body); assert.ok([403, 404].includes(result.status)); assert.doesNotMatch(JSON.stringify(result.body), /synthetic-bucket|Microsoft.Compute|containerId/);
    }
    assert.equal((await s.http(s.mobile.replace('/gcp', `/${item.target.provider}`) + '/inbox')).status, 404);
    assert.equal((await s.http(`${s.mobile}/inbox?cursor=${id}`)).status, 409);
  }
  const inbox = await s.http(`${s.mobile}/inbox?status=all&limit=1`); assert.equal(inbox.status, 200); assert.deepEqual(inbox.body.items.map((x: { id: string }) => x.id), [p.id]); assert.equal(inbox.body.nextCursor, undefined);
  assert.deepEqual(s.counts(), counts);
});

const syntheticToken = 'synthetic-fcm-token-never-export-123456789';
const orgNotificationScope = { owner: { kind: 'organization' as const, organizationId: 'synthetic-org' }, workspaceId: 'synthetic-workspace' };
async function notificationDevice(s: Awaited<ReturnType<typeof setup>>, base = s.mobile, token = syntheticToken) {
  const input = { installationId: randomUUID(), expectedGeneration: null, token }, key = randomUUID();
  const response = await s.http(`${base}/devices`, input, { key }); assert.equal(response.status, 200);
  assert.doesNotMatch(JSON.stringify(response.body), /synthetic-fcm|tokenHash|actorId|membershipVersion/);
  return { input, key, receipt: response.body };
}

test('GCP review outbox, bounded recipient discovery, delivery and native open restore the latest state without running a read', async t => {
  const s = await setup(t), device = await notificationDevice(s), p = await s.prepare(), notifications = s.services().notifications!;
  const work = await notifications.pending(orgNotificationScope); assert.equal(work.events.length, 1); assert.deepEqual(work.installations, [device.input.installationId]);
  assert.equal(s.sent.length, 0); const counts = s.counts();
  assert.equal(await notifications.deliver(orgNotificationScope, work.events[0], device.input.installationId), 'accepted');
  const payload = s.sent[0]; assert.equal(payload.planId, p.id);
  assert.deepEqual(Object.keys(payload).sort(), ['schemaVersion', 'provider', 'notificationId', 'installationId', 'generation', 'planId', 'planVersion', 'expiresAt'].sort());
  assert.doesNotMatch(JSON.stringify(payload), /synthetic-org|synthetic-workspace|checkout|summary|token|approved/);
  await s.http(`${s.mobile}/plans/${p.id}/decision`, { ...p.expected, decision: 'approve', note: 'Private review note' });
  const opened = await s.http(`${s.mobile}/notifications`, payload); assert.equal(opened.status, 200); assert.equal(opened.body.plan.review.status, 'approved'); assert.equal(opened.body.execution, undefined);
  s.reopen();
  assert.equal(await s.services().notifications!.deliver(orgNotificationScope, work.events[0], device.input.installationId), 'accepted'); assert.equal(s.sent.length, 1);
  assert.equal((await s.http(`${s.mobile}/notifications`, payload)).body.plan.review.status, 'approved');
  assert.deepEqual(s.counts(), counts);
});

test('notification HTTP is native bearer-only, configured explicitly, strict and owner scoped', async t => {
  const s = await setup(t), device = await notificationDevice(s), p = await s.prepare();
  const work = await s.services().notifications!.pending(orgNotificationScope);
  await s.services().notifications!.deliver(orgNotificationScope, work.events[0], device.input.installationId); const payload = s.sent[0];
  assert.equal((await s.http(`${s.web}/devices`, device.input)).status, 404);
  assert.equal((await s.http(`${s.mobile}/devices`, device.input, { noToken: true })).status, 401);
  assert.equal((await s.http(`${s.mobile}/devices`, device.input, { headers: { Origin: 'https://other.example' } })).status, 403);
  assert.equal((await s.http(`${s.mobile}/devices`, { ...device.input, role: 'reviewer' })).status, 400);
  assert.equal((await s.http(`${s.mobile}/notifications`, { ...payload, command: 'execute' })).status, 400);
  assert.equal((await s.http(`${s.mobile}/notifications`, { ...payload, provider: 'aws' })).status, 400);
  assert.equal((await s.http(`${s.mobile}/notifications`, { ...payload, planId: randomUUID() })).status, 409);
  assert.equal((await s.http(`${s.mobile}/notifications`, payload, { token: 'user-b' })).status, 409);
  assert.equal((await s.http(`${s.personalMobile}/notifications`, payload)).status, 409);
  assert.equal((await s.http(`${s.mobile}/devices/${device.input.installationId}/revoke`, { expectedGeneration: device.receipt.generation }, { token: 'user-b' })).status, 403);
  s.services().notifications = new GcpNotifications(s.store, s.services().access);
  assert.deepEqual((await s.http(`${s.mobile}/devices`)).body, { configured: false });
  assert.equal((await s.http(`${s.mobile}/devices`, device.input)).status, 503);
  assert.equal((await s.http(`${s.mobile}/plans/${p.id}`)).status, 200);
});

test('device CAS, replay, replacement, explicit revoke and token takeover fence old deliveries and payloads', async t => {
  const s = await setup(t), device = await notificationDevice(s), p = await s.prepare();
  const notifications = s.services().notifications!, event = (await notifications.pending(orgNotificationScope)).events[0];
  await notifications.deliver(orgNotificationScope, event, device.input.installationId); const old = s.sent[0];
  assert.deepEqual((await s.http(`${s.mobile}/devices`, device.input, { key: device.key })).body, device.receipt);
  assert.equal((await s.http(`${s.mobile}/devices`, { ...device.input, token: syntheticToken + 'changed' }, { key: device.key })).status, 409);
  const next = await s.http(`${s.mobile}/devices`, { ...device.input, expectedGeneration: device.receipt.generation, token: syntheticToken + 'new' }); assert.equal(next.status, 200);
  assert.notEqual(next.body.generation, device.receipt.generation);
  assert.equal((await s.http(`${s.mobile}/devices`, device.input, { key: device.key })).status, 409);
  assert.equal((await s.http(`${s.mobile}/notifications`, old)).status, 409);
  assert.equal((await s.http(`${s.mobile}/devices/${device.input.installationId}/revoke`, { expectedGeneration: device.receipt.generation })).status, 409);
  assert.equal((await s.http(`${s.mobile}/devices/${device.input.installationId}/revoke`, { expectedGeneration: next.body.generation })).body.active, false);
  assert.equal((await s.http(`${s.mobile}/devices/${device.input.installationId}/revoke`, { expectedGeneration: next.body.generation })).body.active, false);
  assert.equal((await s.http(`${s.mobile}/devices`, { ...device.input, expectedGeneration: device.receipt.generation })).status, 409);
  // A new login/installation receiving the same SDK token invalidates the older private address claim.
  const a = await notificationDevice(s), b = await notificationDevice(s);
  const decision = await s.http(`${s.mobile}/plans/${p.id}/decision`, { ...p.expected, decision: 'approve', note: '' }); assert.equal(decision.status, 200);
  const latest = (await notifications.pending(orgNotificationScope)).events[0];
  assert.equal(await notifications.deliver(orgNotificationScope, latest, a.input.installationId), 'suppressed');
  assert.equal(await notifications.deliver(orgNotificationScope, latest, b.input.installationId), 'accepted');
});

test('recipient membership, role, identity revocation and expiry are rechecked before sending or resolving', async t => {
  const s = await setup(t), device = await notificationDevice(s); await s.prepare();
  const n = s.services().notifications!, event = (await n.pending(orgNotificationScope)).events[0];
  await s.provision('user-a', 2, ['operator']);
  assert.equal(await n.deliver(orgNotificationScope, event, device.input.installationId), 'suppressed'); assert.equal(s.sent.length, 0);
  assert.equal((await s.http(`${s.mobile}/devices`, device.input, { key: device.key })).status, 409);
  await s.provision('user-a', 3);
  const updated = await s.http(`${s.mobile}/devices`, { ...device.input, expectedGeneration: device.receipt.generation }); assert.equal(updated.status, 200);
  assert.equal(await n.deliver(orgNotificationScope, event, device.input.installationId), 'accepted'); const payload = s.sent[0];
  await s.provision('user-a', 4, ['operator', 'reviewer'], false);
  assert.equal((await s.http(`${s.mobile}/notifications`, payload)).status, 403);
  assert.equal((await s.http(`${s.mobile}/inbox`)).status, 403);
  // A transport acceptance receipt does not authorize an old notification.
  s.advance(3600001); assert.equal(await n.deliver(orgNotificationScope, event, device.input.installationId), 'accepted'); assert.equal(s.sent.length, 1);
});

test('lost, expired and late delivery responses remain unknown across restart and never resend', async t => {
  const s = await setup(t), device = await notificationDevice(s); await s.prepare(); const n = s.services().notifications!;
  const event = (await n.pending(orgNotificationScope)).events[0]; let calls = 0, release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  s.sender(async () => { calls++; entered(); await gate; return 'accepted'; });
  const attempt = n.deliver(orgNotificationScope, event, device.input.installationId); await started;
  assert.equal(await n.deliver(orgNotificationScope, event, device.input.installationId), 'reserved');
  s.advance(30001); s.reopen();
  assert.equal(await s.services().notifications!.deliver(orgNotificationScope, event, device.input.installationId), 'unknown');
  release(); assert.equal(await attempt, 'unknown');
  assert.equal(await s.services().notifications!.deliver(orgNotificationScope, event, device.input.installationId), 'unknown'); assert.equal(calls, 1);
});

test('revocation during send and during latest-state lookup discards late success', async t => {
  const s = await setup(t), device = await notificationDevice(s); await s.prepare(); const n = s.services().notifications!;
  const event = (await n.pending(orgNotificationScope)).events[0];
  s.sender(async (_token, data) => { s.sent.push(data); await s.http(`${s.mobile}/devices/${device.input.installationId}/revoke`, { expectedGeneration: device.receipt.generation }); return 'accepted'; });
  assert.equal(await n.deliver(orgNotificationScope, event, device.input.installationId), 'unknown');
  assert.equal((await s.http(`${s.mobile}/notifications`, s.sent[0])).status, 409);
  const next = await notificationDevice(s); s.sender(async (_token, data) => { s.sent.push(data); return 'accepted'; });
  await n.deliver(orgNotificationScope, event, next.input.installationId);
  const session = await s.services().access.authenticate('Bearer user-a', s.scope, 'mobile');
  await assert.rejects(n.open(session, s.sent.at(-1), async () => { await n.revoke(session, { installationId: next.input.installationId, expectedGeneration: next.receipt.generation }); return 'must not return'; }));
});

test('result and handoff events are atomic with workflow, bounded, replay-stable and GCP-only', async t => {
  const s = await setup(t), p = await s.prepare(); const n = s.services().notifications!;
  const decisionKey = randomUUID(), decision = { ...p.expected, decision: 'approve', note: '' };
  await s.http(`${s.web}/plans/${p.id}/decision`, decision, { key: decisionKey });
  await s.http(`${s.web}/plans/${p.id}/decision`, decision, { key: decisionKey });
  assert.equal((await n.pending(orgNotificationScope)).events.length, 2);
  const key = randomUUID(), executed = await s.http(`${s.mobile}/plans/${p.id}/execute`, p.input, { key });
  assert.equal(executed.status, 200); assert.equal((await n.pending(orgNotificationScope)).events.length, 3);
  await s.http(`${s.mobile}/plans/${p.id}/execute`, p.input, { key }); assert.equal((await n.pending(orgNotificationScope)).events.length, 3);
  const handoffKey = randomUUID(), path = `${s.mobile}/executions/${executed.body.execution.id}/handoff`, note = { note: 'Private note never sent' };
  await s.http(path, note, { key: handoffKey }); await s.http(path, note, { key: handoffKey });
  assert.equal((await n.pending(orgNotificationScope)).events.length, 4);
  const oldest = (await n.pending(orgNotificationScope)).events.at(-1);
  for (let i = 0; i < 99; i++) assert.equal((await s.http(path, { note: `Synthetic bounded handoff ${i}` })).status, 200);
  const bounded = await n.pending(orgNotificationScope); assert.equal(bounded.events.length, 100); assert.equal(new Set(bounded.events).size, 100); assert.equal(bounded.events.includes(oldest!), false);
  const counts = s.counts(); assert.equal((await s.http(`${s.mobile}/inbox?status=results`)).status, 200); assert.deepEqual(s.counts(), counts);
});

test('identity revocation before dispatch, definite rejection and thrown transport errors never cause another send', async t => {
  const revoked = await setup(t), device = await notificationDevice(revoked); await revoked.prepare();
  const n = revoked.services().notifications!, event = (await n.pending(orgNotificationScope)).events[0]; revoked.revoke();
  assert.equal(await n.deliver(orgNotificationScope, event, device.input.installationId), 'suppressed'); assert.equal(revoked.sent.length, 0);
  const s = await setup(t), active = await notificationDevice(s); await s.prepare(); const notifications = s.services().notifications!;
  const notification = (await notifications.pending(orgNotificationScope)).events[0]; let sends = 0;
  s.sender(async () => { sends++; throw Error('Private transport exception must not escape'); });
  assert.equal(await notifications.deliver(orgNotificationScope, notification, active.input.installationId), 'unknown');
  assert.equal(await notifications.deliver(orgNotificationScope, notification, active.input.installationId), 'unknown'); assert.equal(sends, 1);
  const other = await notificationDevice(s, s.mobile, syntheticToken + 'other');
  s.sender(async () => { sends++; return 'rejected'; });
  assert.equal(await notifications.deliver(orgNotificationScope, notification, other.input.installationId), 'rejected');
  assert.equal(await notifications.deliver(orgNotificationScope, notification, other.input.installationId), 'rejected'); assert.equal(sends, 2);
});

test('workspace switch, personal ownership, registration expiry and finite recipient slots fail closed', async t => {
  const s = await setup(t), device = await notificationDevice(s); await s.prepare();
  const n = s.services().notifications!, event = (await n.pending(orgNotificationScope)).events[0];
  const moved = await s.http(`${s.personalMobile}/devices`, { ...device.input, expectedGeneration: device.receipt.generation }); assert.equal(moved.status, 200);
  assert.equal(await n.deliver(orgNotificationScope, event, device.input.installationId), 'suppressed');
  assert.equal((await s.http(`${s.personalMobile}/devices`, { ...device.input, expectedGeneration: moved.body.generation }, { token: 'user-b' })).status, 403);
  await s.prepare(s.personalWeb, 'service-1'); const personal = { owner: { kind: 'personal' as const, userId: 'user-a' }, workspaceId: s.scope.workspaceId };
  const personalEvent = (await n.pending(personal)).events[0];
  assert.equal(await n.deliver(personal, personalEvent, device.input.installationId), 'accepted'); const payload = s.sent[0];
  assert.equal((await s.http(`${s.personalMobile}/notifications`, payload)).status, 200);
  assert.equal((await s.http(`${s.personalMobile}/notifications`, payload, { token: 'user-b' })).status, 409);
  for (let i = 0; i < 20; i++) await notificationDevice(s, s.mobile, syntheticToken + i);
  assert.equal((await s.http(`${s.mobile}/devices`, { installationId: randomUUID(), expectedGeneration: null, token: syntheticToken + 'overflow' })).status, 409);
  s.advance(3600001);
  assert.equal((await s.http(`${s.personalMobile}/notifications`, payload)).status, 409);
  await notificationDevice(s, s.mobile, syntheticToken + 'renew-after-expiry');
});

test('retiring a registration request before arrival fences its late POST and survives server restart', async t => {
  const s = await setup(t), input = { installationId: randomUUID(), expectedGeneration: null, token: syntheticToken }, key = randomUUID();
  const path = `${s.mobile}/devices/${input.installationId}/retire`;
  assert.deepEqual((await s.http(path, { registrationKey: key })).body, { retired: true });
  s.reopen();
  assert.equal((await s.http(`${s.mobile}/devices`, input, { key })).status, 409);
  assert.deepEqual((await s.http(path, { registrationKey: key })).body, { retired: true });
  assert.equal((await s.http(`${s.web}/devices/${input.installationId}/retire`, { registrationKey: key })).status, 404);
  assert.equal((await s.http(path, { registrationKey: key, owner: 'client-supplied' })).status, 400);
  const other = await s.http(`${s.mobile}/devices`, input, { key: randomUUID() }); assert.equal(other.status, 200);
  assert.equal((await s.http(path, { registrationKey: key }, { token: 'user-b' })).status, 403);
});

test('retirement clears a lost-response registration but cannot revoke a newer generation and works with sending disabled', async t => {
  const s = await setup(t), first = await notificationDevice(s); await s.prepare();
  const secondKey = randomUUID(), updated = await s.http(`${s.mobile}/devices`, { ...first.input, expectedGeneration: first.receipt.generation, token: syntheticToken + 'rotated' }, { key: secondKey });
  assert.equal(updated.status, 200);
  const retired = `${s.mobile}/devices/${first.input.installationId}/retire`;
  assert.deepEqual((await s.http(retired, { registrationKey: first.key })).body, { retired: true });
  const n = s.services().notifications!, event = (await n.pending(orgNotificationScope)).events[0];
  assert.equal(await n.deliver(orgNotificationScope, event, first.input.installationId), 'accepted');
  s.services().notifications = new GcpNotifications(s.store, s.services().access);
  assert.deepEqual((await s.http(retired, { registrationKey: secondKey })).body, { retired: true });
  assert.equal((await s.http(`${s.mobile}/devices/${randomUUID()}/retire`, { registrationKey: secondKey })).status, 409);
  s.reopen(); assert.equal((await s.http(`${s.mobile}/notifications`, s.sent[0])).status, 409);
  assert.equal((await s.http(`${s.mobile}/devices`, first.input, { key: first.key })).status, 409);
});

test('registration transaction racing retirement retries against the tombstone rather than committing a late device', async t => {
  const s = await setup(t), session = await s.services().access.authenticate('Bearer user-a', s.scope, 'mobile');
  const input = { installationId: randomUUID(), expectedGeneration: null, token: syntheticToken }, key = randomUUID();
  let release!: () => void, entered!: () => void, once = true, retiredReads = 0;
  const gate = new Promise<void>(done => { release = done; }), started = new Promise<void>(done => { entered = done; });
  const slow = new GcpNotifications({ transact: body => s.store.transact(tx => body({
    async get<T>(record: string) { const value = await tx.get<T>(record); if (record.endsWith(':retired')) { retiredReads++; if (once) { once = false; entered(); await gate; } } return value; },
    put: (record, value) => tx.put(record, value),
  })) }, s.services().access, { dataMode: 'synthetic', async current() { return true; }, async send() { throw Error('Must not send'); } }, () => Date.parse('2026-10-10T01:00:00.000Z'));
  const registration = slow.register(session, input, key); await started;
  await s.services().notifications!.retire(session, { installationId: input.installationId, registrationKey: key });
  release(); await assert.rejects(registration, (error: unknown) => error instanceof Error && 'code' in error && error.code === 'registration_retired');
  assert.equal(retiredReads, 2);
  assert.equal((await s.services().notifications!.pending(orgNotificationScope)).installations.length, 0);
});
