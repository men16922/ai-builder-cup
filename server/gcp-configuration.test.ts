import { syntheticTelemetry } from '../tests/fixtures/gcp-telemetry';
import { createSyntheticTelemetryTransport } from './modules/gcp/telemetry-transport';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { gcpServerConfiguration } from './modules/gcp/configuration';
import { composeGcpServices } from './modules/gcp/composition';
import type { GcpPushPorts } from './modules/gcp/notifications';
import { createSyntheticCloudRunRestTransport } from './modules/gcp/cloud-run-transport';
import { FirestoreCloudStore, type FirestoreRecordPort } from './platform/firebase/cloud-firestore-store';
import { createGcpApiServer } from './modules/gcp/api';
import { readGcpConfiguration, loadFirebaseGcp } from './platform/firebase/load-gcp';
import { createFirebaseGcpServices } from './platform/firebase/gcp';
import type { GcpAnalysisModel } from './modules/gcp/gemini';
const example = async () => JSON.parse(await readFile('deploy/gcp-server.example.json', 'utf8'));
function records() {
  const data = new Map<string, unknown>(); let retryPlan = true, retries = 0;
  const port: FirestoreRecordPort = { async runTransaction(body) {
    for (;;) {
      const writes = new Map<string, unknown>(); let planWrite = false;
      const result = await body({ get: async id => structuredClone(data.get(id)), set(id, value) { writes.set(id, structuredClone(value)); if (value.key.startsWith('plan:')) planWrite = true; } });
      if (retryPlan && planWrite) { retryPlan = false; retries++; continue; }
      for (const [key, value] of writes) data.set(key, value); return result;
    }
  } };
  return { store: new FirestoreCloudStore(port), data, retries: () => retries };
}

test('GCP startup schema fixes one project, unique edition scopes/resources and excludes credentials/commands/endpoints from JSON', async () => {
  const input = await example(); assert.equal(gcpServerConfiguration.safeParse(input).success, true);
  const invalid = [
    { ...input, publicOrigin: 'https://example.invalid/path' }, { ...input, publicOrigin: 'http://public.example.invalid' },
    { ...input, scopes: [...input.scopes, ...input.scopes] }, { ...input, resources: [...input.resources, ...input.resources] },
    { ...input, projectId: 'other-project' }, { ...input, scopes: [{ ...input.scopes[0], workspaceId: 'another-workspace' }] },
    { ...input, credentials: { ...input.credentials, accessToken: 'synthetic-secret' } }, { ...input, model: { ...input.model, endpoint: 'https://attacker.invalid' } },
    { ...input, resources: [{ ...input.resources[0], command: 'gcloud' }] }, { ...input, resources: [{ ...input.resources[0], binding: { ...input.resources[0].binding, owner: { kind: 'personal', userId: 'unknown' } } }] },
  ];
  for (const value of invalid) assert.equal(gcpServerConfiguration.safeParse(value).success, false);
});

test('configuration file reader bounds content, rejects symlinks/relative paths and redacts invalid source data', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gcp-config-')); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'server.json'), input = await example(); await writeFile(path, JSON.stringify(input)); assert.deepEqual(await readGcpConfiguration(path), input);
  await symlink(path, `${path}.link`); await assert.rejects(readGcpConfiguration(`${path}.link`)); await assert.rejects(readGcpConfiguration('relative.json'));
  await writeFile(path, '{ "private_key": "synthetic-secret"'); await assert.rejects(readGcpConfiguration(path), error => { assert.doesNotMatch(String(error), /synthetic-secret|private_key/); return true; });
  await writeFile(path, 'x'.repeat(65537)); await assert.rejects(readGcpConfiguration(path));
});

test('default and offline startup cannot initialize GCP credentials, Firebase or Firestore', async () => {
  const old = { enabled: process.env.MOBILEOPS_GCP_ENABLED, config: process.env.MOBILEOPS_GCP_CONFIG };
  try {
    process.env.MOBILEOPS_GCP_ENABLED = '0'; process.env.MOBILEOPS_GCP_CONFIG = '/missing/not-read.json'; assert.equal(await loadFirebaseGcp(), undefined);
    process.env.MOBILEOPS_GCP_ENABLED = '1'; assert.equal(await loadFirebaseGcp(), undefined);
    await assert.rejects(createFirebaseGcpServices(await example(), true), error => !!error && typeof error === 'object' && 'code' in error && error.code === 'credential_disabled');
  } finally {
    for (const [key, value] of [['MOBILEOPS_GCP_ENABLED', old.enabled], ['MOBILEOPS_GCP_CONFIG', old.config]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; }
  }
});

test('configured GCP-only hosted composition completes authenticated review/read/handoff with Firestore transaction rules and no provider calls inside retries', async t => {
  const input = { ...await example(), telemetry: { enabled: true } }; input.model.enabled = true;
  const scope = input.scopes[0], binding = input.resources[0].binding, target = binding.target, r = records();
  let reads = 0, telemetryReads = 0, modelCalls = 0;
  // This is the resource's update time, not the collection clock. Stable reads must preserve it.
  const resourceUpdatedAt = new Date().toISOString();
  const credential = { principal: input.credentials.serviceAccountEmail, sessionId: 'synthetic-configured-session', accessToken: 'synthetic-service-token' };
  const model: GcpAnalysisModel = { enabled: true, engine: 'synthetic-fixture', modelId: input.model.modelId, configurationId: 'configured-test', async analyze(evidence) { assert.ok(evidence.observations.some(item => item.id === 'gcp-run-requests')); modelCalls++; return { summary: 'Bounded metadata and telemetry.', findings: [{ kind: 'observation', statement: 'Metadata collected.', evidenceIds: ['gcp-run-service'] }], missingInformation: ['Request probes and log payloads were not collected.'], serviceAssessment: 'unknown' }; } };
  const ports = { store: r.store, mode: 'synthetic' as const, ...credential, model, identity: { async verify(token: string) { if (!['user-a','user-b'].includes(token)) throw Error(); return { actorId: token, expiresAt: Date.now() + 3600000 }; } },
    telemetry: () => createSyntheticTelemetryTransport({ binding, ...credential, credentials: { async current() { return credential; } } }, async (url, init) => {
      telemetryReads++; const parsed = new URL(String(url)), body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const window = body ? { start: body.filter.match(/timestamp>="([^"]+)"/)[1], end: body.filter.match(/timestamp<"([^"]+)"/)[1] }
        : { start: parsed.searchParams.get('interval.startTime')!, end: parsed.searchParams.get('interval.endTime')! };
      return Response.json(syntheticTelemetry(binding, body ? 'logs' : parsed.searchParams.get('filter')!.includes('request_count') ? 'requests' : 'latency', window));
    }),
    transport: () => createSyntheticCloudRunRestTransport({ binding, ...credential, credentials: { async current() { return credential; } }, fetcher: async (url) => {
      reads++; const meta = { generation: '1', observedGeneration: '1', updateTime: resourceUpdatedAt, reconciling: false };
      return new Response(JSON.stringify(String(url).includes('/revisions/') ? { ...meta, name: `${target.resourceName}/revisions/${target.revision}`, uid: 'synthetic-revision-uid', service: target.resourceName, conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }] }
        : { ...meta, name: target.resourceName, uid: target.resourceUid, etag: 'synthetic-stable', terminalCondition: { state: 'CONDITION_SUCCEEDED' }, latestCreatedRevision: target.revision, latestReadyRevision: target.revision, trafficStatuses: [{ revision: target.revision, percent: 100 }] }));
    } }),
  };
  const services = composeGcpServices(input, ports);
  assert.equal(reads, 0); assert.equal(telemetryReads, 0); assert.equal(modelCalls, 0); assert.equal(r.data.size, 0);
  await services.access.organization.provision({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, actorId: 'user-a', version: 1, active: true, roles: ['operator', 'reviewer'], updatedAt: new Date().toISOString() });
  const server = createGcpApiServer(services); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const addr = server.address(); if (!addr || typeof addr === 'string') throw Error();
  services.publicOrigin = `http://127.0.0.1:${addr.port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const base = `/api/organizations/v1/${scope.organizationId}/workspaces/${scope.workspaceId}/gcp`;
  const request = async (path: string, body?: unknown, actor = 'user-a') => { const response = await fetch(services.publicOrigin + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: services.publicOrigin, Authorization: `Bearer ${actor}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, body: await response.json() }; };
  const publicConfig = await request('/api/gcp/config/organization'); assert.equal(publicConfig.status, 200); assert.equal(publicConfig.body.identity.method, 'firebase-google');
  assert.doesNotMatch(JSON.stringify(publicConfig.body), /serviceAccountEmail|sourceFile|runtimeProjectId|synthetic-service-token|resourceUid/);
  assert.equal((await request('/api/gcp/config/personal')).body.configured, false);
  for (const path of ['/api/aws/status', '/api/health', '/api/runbooks']) assert.equal((await request(path)).status, 404);
  assert.equal((await request(`${base}/resources`, undefined, 'user-b')).status, 403);
  const observation = await request(`${base}/observations`, { resourceId: input.resources[0].id }); assert.equal(observation.status, 200); assert.equal(reads, 3);
  const analysis = await request(`${base}/analyses`, { observationId: observation.body.snapshot.id, language: 'en' }); assert.equal(analysis.status, 200); assert.equal(modelCalls, 1); assert.equal(r.retries(), 1);
  const id = analysis.body.id, expected = { expectedVersion: 1, expectedDigest: analysis.body.planDigest };
  assert.equal((await request(`${base}/plans/${id}/review`, expected)).status, 200);
  assert.equal((await request(`${base}/plans/${id}/decision`, { ...expected, decision: 'approve', note: '' })).status, 200); assert.equal(reads, 3);
  const execution = await request(`${base}/plans/${id}/execute`, { ...expected, planId: id }); assert.equal(execution.status, 200); assert.equal(execution.body.execution.state, 'succeeded'); assert.equal(reads, 6); assert.equal(telemetryReads, 6);
  assert.equal((await request(`${base}/executions/${execution.body.execution.id}/handoff`, { note: 'Synthetic follow-up' })).status, 200);
  const disabledModel: GcpAnalysisModel = { ...model, enabled: false, async analyze() { throw Error('must not call'); } };
  const off = composeGcpServices({ ...input, model: { ...input.model, enabled: false } }, { ...ports, model: disabledModel });
  const session = await off.access.authenticate('Bearer user-a', scope); assert.equal(off.analyses!.available('synthetic'), false);
  const restored = await off.operations!.get(session, id); assert.equal(restored.execution?.handoffs[0].note, 'Synthetic follow-up');
  await assert.rejects(off.analyses!.prepare(session, { observationId: observation.body.snapshot.id, language: 'ko' }, randomUUID()), error => !!error && typeof error === 'object' && 'code' in error && error.code === 'analysis_not_configured');
  assert.equal(modelCalls, 1); assert.equal(reads, 6); assert.equal(telemetryReads, 6);
  assert.doesNotMatch(JSON.stringify([...r.data.values()]), /synthetic-service-token|Bearer|refresh_token|sourceFile/);
  assert.throws(() => composeGcpServices(input, { ...ports, principal: 'wrong@example.invalid' }));
  assert.throws(() => composeGcpServices(input, { ...ports, mode: 'live' }));
  // Notification delivery is composed only with explicit configuration and a matching transport mode.
  const push: GcpPushPorts = { dataMode: 'synthetic', async current() { return false; }, async send() { throw Error('must not send'); } };
  const notifying = { ...input, notifications: { enabled: true, androidPackage: 'app.mobileops.agent' } };
  assert.equal(composeGcpServices(notifying, { ...ports, notifications: push }).notifications!.available, true);
  assert.equal(composeGcpServices(input, ports).notifications!.available, false);
  assert.throws(() => composeGcpServices(notifying, ports), /notification/);
  assert.throws(() => composeGcpServices(input, { ...ports, notifications: push }), /notification/);
  assert.throws(() => composeGcpServices({ ...input, notifications: { enabled: false, androidPackage: 'app.mobileops.agent' } }, { ...ports, notifications: push }), /notification/);
  assert.throws(() => composeGcpServices(notifying, { ...ports, notifications: { ...push, dataMode: 'live' } }), /notification/);
  assert.throws(() => composeGcpServices({ ...input, notifications: { enabled: true, androidPackage: 'Not.A.Package' } }, { ...ports, notifications: push }));
  assert.throws(() => composeGcpServices({ ...input, notifications: { enabled: true, androidPackage: 'app.mobileops.agent', target: 'https://example.invalid' } }, { ...ports, notifications: push }));
});

test('crew access follows resource ownership: a member of the owning organization may start a task, a signed-in stranger and a personal sign-in may not', async () => {
  const input = { ...await example(), agents: { enabled: true, chiefUrl: 'https://chief.example.invalid', services: [{ name: 'shop-api', region: 'asia-northeast3' }] } };
  const binding = input.resources[0].binding, r = records();
  const credential = { principal: input.credentials.serviceAccountEmail, sessionId: 'synthetic-entitlement-session', accessToken: 'synthetic-service-token' };
  const model: GcpAnalysisModel = { enabled: input.model.enabled, engine: 'synthetic-fixture', modelId: input.model.modelId, configurationId: 'entitlement-test', async analyze() { throw Error('must not call'); } };
  const ports = { store: r.store, mode: 'synthetic' as const, ...credential, model, identity: { async verify(token: string) { if (!['member', 'stranger'].includes(token)) throw Error(); return { actorId: token, expiresAt: Date.now() + 3600000 }; } },
    transport: () => createSyntheticCloudRunRestTransport({ binding, ...credential, credentials: { async current() { return credential; } }, fetcher: async () => { throw Error('no read expected'); } }),
    agents: { chief: { async *stream() { /* The crew is not needed to test who may ask. */ } }, approvalKey: Buffer.alloc(32, 7) } };
  const services = composeGcpServices(input, ports), scope = input.scopes[0];
  await services.access.organization.provision({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, actorId: 'member', version: 1, active: true, roles: ['operator', 'reviewer'], updatedAt: new Date().toISOString() });
  const asked = { instruction: 'Check shop-api and summarize its health.', language: 'en' as const };
  const member = await services.access.authenticate('Bearer member', scope);
  assert.equal((await services.agents!.create(member, asked, randomUUID())).state, 'working'); await services.agents!.idle();
  // A verified Google sign-in that owns nothing is refused, both in the organization scope's workspace and as a personal sign-in.
  const personal = await services.access.authenticate('Bearer stranger', { edition: 'personal', workspaceId: scope.workspaceId, label: 'Personal' });
  await assert.rejects(services.agents!.create(personal, asked, randomUUID()), { status: 403, code: 'crew_not_entitled' });
});
