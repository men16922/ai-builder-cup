import { test } from 'node:test';
import { request as rawRequest } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { hostedEnvironment, hostedConfiguration, loadHostedAssets, startGcpHosted } from './modules/gcp/hosted';
import { hostedFixture } from './fixtures/gcp-hosted';

async function web(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'mobileops-hosted-unit-')); t.after(() => rm(root, { recursive: true, force: true }));
  const files = [['index.html', '<!doctype html><title>Aide</title>'], ['mobileops-mark.svg', '<svg/>']];
  for (const [path, value] of files) await writeFile(join(root, path), value);
  await writeFile(join(root, 'web-manifest.json'), JSON.stringify({ version: 1, files: files.map(([path, bytes]) => ({ path: '/' + path, sha256: createHash('sha256').update(bytes).digest('hex') })) }));
  return root;
}
async function running(t: { after(fn: () => Promise<void>): void }, graceMs?: number) {
  const fixture = await hostedFixture(), root = await web(t), runtime = await startGcpHosted(fixture, root, { port: 0, host: '127.0.0.1', synthetic: true, graceMs });
  const address = runtime.server.address(); assert.ok(address && typeof address !== 'string'); fixture.services.publicOrigin = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await runtime.close(); });
  const http = (path: string, body?: unknown, headers: Record<string, string> = {}, key: string = randomUUID()) => fetch(fixture.services.publicOrigin + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: fixture.services.publicOrigin, Authorization: 'Bearer synthetic-member', 'Content-Type': 'application/json', 'Idempotency-Key': key, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { ...fixture, runtime, root, http };
}

test('hosted flags, port, explicit path, HTTPS and runtime identity fail before live SDK initialization', async () => {
  const env = { MOBILEOPS_GCP_HOSTED_ENABLED: '1', MOBILEOPS_GCP_ENABLED: '1', MOBILEOPS_GCP_CONFIG: '/private/synthetic.json' };
  assert.equal(hostedEnvironment(env).port, 8080);
  for (const patch of [{ MOBILEOPS_OFFLINE_TEST: '1' }, { MOBILEOPS_GCP_ENABLED: '0' }, { MOBILEOPS_GCP_HOSTED_ENABLED: '0' }, { MOBILEOPS_GCP_CONFIG: 'relative' }, ...['', '0', '65536', ' 8080', '1e3', '3.5'].map(PORT => ({ PORT }))]) assert.throws(() => hostedEnvironment({ ...env, ...patch }));
  const config = JSON.parse(await readFile('deploy/gcp-server.example.json', 'utf8')); assert.equal(hostedConfiguration(config).publicOrigin, config.publicOrigin);
  assert.throws(() => hostedConfiguration({ ...config, publicOrigin: 'http://127.0.0.1:8080' }));
  assert.throws(() => hostedConfiguration({ ...config, credentials: { method: 'impersonated_user', serviceAccountEmail: config.credentials.serviceAccountEmail, sourceFile: '/synthetic-file' } }));
});

test('hashed static assets reject changed bytes, symlinks, unknown types and path traversal', async t => {
  const root = await web(t); assert.equal((await loadHostedAssets(root)).size, 2);
  await writeFile(join(root, 'index.html'), 'changed'); await assert.rejects(loadHostedAssets(root), /integrity/);
  const other = await web(t); await rm(join(other, 'index.html')); await symlink(join(root, 'index.html'), join(other, 'index.html')); await assert.rejects(loadHostedAssets(other));
  for (const path of ['/../.env', '/assets/../../secret.js', '/module-inputs.json', '/assets/source.map']) {
    const bad = await web(t); await writeFile(join(bad, 'web-manifest.json'), JSON.stringify({ version: 1, files: [{ path, sha256: 'a'.repeat(64) }] })); await assert.rejects(loadHostedAssets(bad));
  }
});

test('hosted web/API separates static files, health and authenticated GCP routes from local AWS, demo, Docker and worker APIs', async t => {
  const s = await running(t);
  assert.match(await (await s.http('/')).text(), /Aide/); assert.equal((await s.http('/healthz')).status, 200);
  for (const path of ['/api/aws/status', '/api/state', '/api/organizations/config', '/api/onprem/status', '/api/worker', '/.env', '/package.json', '/web-manifest.json', '/module-inputs.json', '/assets/missing.js', '/?file=.env']) assert.equal((await s.http(path)).status, 404, path);
  assert.equal((await s.http('/', {})).status, 405); const badHost = await new Promise<number | undefined>((done, reject) => { const request = rawRequest(s.services.publicOrigin, { headers: { Host: 'other.invalid' } }, response => { response.resume(); done(response.statusCode); }); request.on('error', reject); request.end(); }); assert.equal(badHost, 403);
  assert.equal((await s.http(s.base + '/resources', undefined, { Origin: 'https://other.invalid' })).status, 403);
  assert.equal((await s.http(s.base + '/resources', undefined, { Authorization: '' })).status, 401);
  assert.equal((await s.http(s.base + '/resources')).status, 200); assert.deepEqual(s.counts(), { closed: 0, reads: 0, models: 0 });
});

test('hosted same-origin synthetic workflow preserves explicit dispatch, same-key replay, stored restore and handoff', async t => {
  const s = await running(t), request = async (path: string, body?: unknown, key?: string) => { const result = await s.http(s.base + path, body, {}, key); assert.equal(result.status, 200); return result.json(); };
  const observation = await request('/observations', { resourceId: s.resourceId }), analysis = await request('/analyses', { observationId: observation.snapshot.id, language: 'en' });
  const expected = { expectedVersion: analysis.plan.version, expectedDigest: analysis.planDigest }, path = `/plans/${analysis.id}`;
  await request(path + '/review', expected); await request(path + '/decision', { ...expected, decision: 'approve', note: 'Synthetic review' }); assert.deepEqual(s.counts(), { closed: 0, reads: 3, models: 1 });
  const key = randomUUID(), input = { ...expected, planId: analysis.id }, done = await request(path + '/execute', input, key);
  assert.equal(done.execution.state, 'succeeded'); assert.equal(done.execution.result.serviceAssessment, 'unknown'); assert.equal(s.counts().reads, 6);
  const replay = await request(path + '/execute', input, key); assert.deepEqual(replay.execution, done.execution); assert.deepEqual(replay.evidence, done.evidence); await request(`/executions/${done.execution.id}/handoff`, { note: 'Application health needs follow-up.' });
  const saved = await request(path); assert.equal(saved.execution.handoffs.length, 1); assert.equal(s.counts().reads, 6); assert.equal(s.counts().models, 1);
});

test('shutdown waits for in-flight authorization/read responses and closes resources exactly once', async t => {
  const s = await running(t, 1000); let release!: () => void, entered!: () => void;
  const enteredPromise = new Promise<void>(done => { entered = done; }), original = s.services.observations.list.bind(s.services.observations);
  s.services.observations.list = async session => { entered(); await new Promise<void>(done => { release = done; }); return original(session); };
  const request = s.http(s.base + '/resources'); await enteredPromise;
  const close = s.runtime.close(); assert.equal(s.runtime.close(), close); assert.equal(s.counts().closed, 0);
  release(); const response = await request; assert.equal(response.status, 200); await response.text();
  assert.equal(await close, 'drained'); assert.equal(s.counts().closed, 1);
});

test('shutdown deadline does not claim completion and still tracks work after a disconnected caller', async t => {
  const s = await running(t, 30); let release!: () => void, entered!: () => void;
  const started = new Promise<void>(done => { entered = done; }), original = s.services.observations.list.bind(s.services.observations);
  s.services.observations.list = async session => { entered(); await new Promise<void>(done => { release = done; }); return original(session); };
  const controller = new AbortController(), pending = fetch(s.services.publicOrigin + s.base + '/resources', { signal: controller.signal, headers: { Origin: s.services.publicOrigin, Authorization: 'Bearer synthetic-member' } }).catch(() => undefined);
  await started; controller.abort(); await pending;
  assert.equal(await s.runtime.close(), 'deadline'); assert.equal(s.counts().closed, 0);
  release(); for (let i = 0; i < 30 && s.counts().closed === 0; i++) await new Promise(done => setTimeout(done, 10)); assert.equal(s.counts().closed, 1);
});

test('failed cleanup is not drained, and startup failures release owned service composition', async t => {
  const root = await web(t), fixture = await hostedFixture(); let calls = 0;
  const runtime = await startGcpHosted({ services: fixture.services, async close() { calls++; throw Error('synthetic close error'); } }, root, { port: 0, host: '127.0.0.1', synthetic: true });
  assert.equal(await runtime.close(), 'failed'); assert.equal(calls, 1);
  const absent = await hostedFixture(); await assert.rejects(startGcpHosted(absent, join(root, 'missing'), { port: 0, host: '127.0.0.1', synthetic: true })); assert.equal(absent.counts().closed, 1);
  const live = await hostedFixture(); await assert.rejects(startGcpHosted(live, root, { port: 8080, host: '0.0.0.0' })); assert.equal(live.counts().closed, 1);
});
