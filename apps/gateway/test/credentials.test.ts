import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGoogleCredentials, createSyntheticGoogleCredentials } from '../src/google/credentials';
import { pinnedGoogleAuth } from '../src/google/sdk-auth';
const config = { method: 'metadata', runtimeProjectId: 'example-mobileops-demo', serviceAccountEmail: 'mobileops-runtime@example-mobileops-demo.iam.gserviceaccount.com' };
const time = Date.parse('2026-10-10T03:00:00Z');
const code = (value: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === value;
const signal = () => new AbortController().signal;
const response = (value: unknown, metadata = true, status = 200) => new Response(typeof value === 'string' ? value : JSON.stringify(value), { status, headers: metadata ? { 'Metadata-Flavor': 'Google' } : {} });
function metadataFixture() {
  const calls: { url: string; init?: RequestInit }[] = []; let now = time, email = config.serviceAccountEmail, project = config.runtimeProjectId, flavor = true;
  let body: unknown = { access_token: 'synthetic-metadata-token', token_type: 'Bearer', expires_in: 3600 };
  let hook: ((path: string) => void) | undefined;
  const fetcher: typeof fetch = async (url, init) => { const path = String(url); calls.push({ url: path, init }); hook?.(path); return response(path.endsWith('/email') ? email : path.endsWith('/project-id') ? project : body, flavor); };
  return { calls, fetcher, now: () => now, advance: (ms: number) => { now += ms; }, email: (value: string) => { email = value; }, project: (value: string) => { project = value; },
    flavor: (value: boolean) => { flavor = value; }, body: (value: unknown) => { body = value; }, hook: (value: (path: string) => void) => { hook = value; } };
}
async function userSource(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'gcp-credential-')); t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'user.json'), source = { type: 'authorized_user', client_id: 'synthetic-client', client_secret: 'synthetic-client-secret', refresh_token: 'synthetic-refresh-secret', quota_project_id: config.runtimeProjectId };
  await writeFile(file, JSON.stringify(source), { mode: 0o600 }); return { file, source, config: { method: 'impersonated_user', serviceAccountEmail: config.serviceAccountEmail, sourceFile: file } };
}

test('metadata credentials verify attached principal/project, pin all GETs and cache/refresh only the token', async t => {
  const f = metadataFixture(), credentials = await createSyntheticGoogleCredentials(config, f.fetcher, f.now); t.after(() => credentials.close());
  assert.equal(f.calls.length, 0); const first = await credentials.token(signal()); assert.equal(first.accessToken, 'synthetic-metadata-token');
  assert.equal(credentials.principal, config.serviceAccountEmail); assert.equal(credentials.mode, 'synthetic');
  await credentials.token(signal()); assert.equal(f.calls.filter(x => x.url.endsWith('/token')).length, 1); assert.equal(f.calls.filter(x => x.url.endsWith('/email')).length, 3);
  f.advance(3540001); await credentials.token(signal()); assert.equal(f.calls.filter(x => x.url.endsWith('/token')).length, 2);
  for (const { url, init } of f.calls) { assert.ok(url.startsWith('http://metadata.google.internal/computeMetadata/v1/')); assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'error'); assert.equal(new Headers(init.headers).get('Metadata-Flavor'), 'Google'); assert.equal(new Headers(init.headers).get('Authorization'), null); }
  assert.ok(!JSON.stringify(credentials).includes('synthetic-metadata-token')); credentials.close(); await assert.rejects(credentials.token(signal()), code('credential_disabled'));
});

test('Maps MCP credentials request only their fixed scope and never reuse a cloud token', async t => {
  const f=metadataFixture(),credentials=await createSyntheticGoogleCredentials(config,f.fetcher,f.now);
  t.after(()=>credentials.close());
  await credentials.token(signal()); await credentials.mapsToken!(signal()); await credentials.mapsToken!(signal());
  const tokenCalls=f.calls.filter(call=>new URL(call.url).pathname.endsWith('/token'));
  assert.equal(tokenCalls.length,2);
  assert.equal(new URL(tokenCalls[0].url).search,'');
  assert.equal(new URL(tokenCalls[1].url).searchParams.get('scopes'),'https://www.googleapis.com/auth/maps-platform.mapstools');
  f.email('changed@example.invalid');
  await assert.rejects(credentials.mapsToken!(signal()),code('credential_changed'));
});

test('metadata rejects project/principal/header mismatch before use and changed identity after token issuance', async t => {
  for (const kind of ['email', 'project', 'flavor', 'during'] as const) await t.test(kind, async child => {
    const f = metadataFixture(); if (kind === 'email') f.email('different@example.invalid'); if (kind === 'project') f.project('other-project'); if (kind === 'flavor') f.flavor(false);
    if (kind === 'during') f.hook(path => { if (path.endsWith('/token')) f.email('changed@example.invalid'); });
    const credentials = await createSyntheticGoogleCredentials(config, f.fetcher, f.now); child.after(() => credentials.close());
    await assert.rejects(credentials.token(signal()), code(kind === 'flavor' ? 'credential_unavailable' : 'credential_changed'));
    if (kind !== 'during') assert.equal(f.calls.filter(x => x.url.endsWith('/token')).length, 0);
  });
});

test('malformed/oversized/expired token envelopes and cancellation never yield a usable credential', async t => {
  for (const body of [{ access_token: 'secret\ninjected', expires_in: 3600, token_type: 'Bearer' }, { access_token: 'synthetic-token', expires_in: 1, token_type: 'Bearer' }, 'x'.repeat(32769), { access_token: 'synthetic-token', expires_in: 3600, token_type: 'Wrong' }]) {
    const f = metadataFixture(); f.body(body); const credentials = await createSyntheticGoogleCredentials(config, f.fetcher, f.now); t.after(() => credentials.close()); await assert.rejects(credentials.token(signal()), code('credential_unavailable'));
  }
  const f = metadataFixture(), credentials = await createSyntheticGoogleCredentials(config, f.fetcher, f.now); t.after(() => credentials.close());
  const controller = new AbortController(); controller.abort(); await assert.rejects(credentials.token(controller.signal), code('credential_cancelled')); assert.equal(f.calls.length, 0);
  await credentials.token(signal()); const during = new AbortController(); f.hook(() => during.abort());
  await assert.rejects(credentials.token(during.signal), code('credential_cancelled'));
});

test('explicit user source exchanges only at fixed OAuth/IAM endpoints for the pinned service account, never uses the user token on resources', async t => {
  const f = await userSource(t), calls: { url: string; init?: RequestInit }[] = [];
  const credentials = await createSyntheticGoogleCredentials(f.config, async (url, init) => { calls.push({ url: String(url), init }); return response(String(url).includes('oauth2')
    ? { access_token: 'synthetic-source-access', expires_in: 3600, token_type: 'Bearer' } : { accessToken: 'synthetic-impersonated-access', expireTime: new Date(time + 600000).toISOString() }, false); }, () => time);
  t.after(() => credentials.close()); const token = await credentials.token(signal()); assert.equal(token.accessToken, 'synthetic-impersonated-access'); assert.equal(credentials.principal, config.serviceAccountEmail);
  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token'); assert.equal(new URLSearchParams(String(calls[0].init?.body)).get('grant_type'), 'refresh_token');
  assert.equal(calls[1].url, `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(config.serviceAccountEmail)}:generateAccessToken`);
  assert.equal(new Headers(calls[1].init?.headers).get('Authorization'), 'Bearer synthetic-source-access');
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { scope: ['https://www.googleapis.com/auth/cloud-platform'], lifetime: '600s' });
  for (const call of calls) { assert.equal(call.init?.method, 'POST'); assert.equal(call.init?.redirect, 'error'); assert.equal(call.init?.credentials, 'omit'); }
  await credentials.token(signal()); assert.equal(calls.length, 2);
  await writeFile(f.file, JSON.stringify({ ...f.source, refresh_token: 'rotated-source' })); await assert.rejects(credentials.token(signal()), code('credential_changed')); assert.equal(calls.length, 2);
  assert.doesNotMatch(JSON.stringify(credentials), /synthetic-.*(?:access|secret)|sourceFile|user.json/);
});

test('credential files reject permissive modes, symlinks, key files and attacker endpoints before network use', async t => {
  const f = await userSource(t); let calls = 0; const fetcher: typeof fetch = async () => { calls++; throw Error('must not fetch'); };
  await chmod(f.file, 0o644); await assert.rejects(createSyntheticGoogleCredentials(f.config, fetcher), code('credential_unavailable')); await chmod(f.file, 0o600);
  const link = `${f.file}.link`; await symlink(f.file, link); await assert.rejects(createSyntheticGoogleCredentials({ ...f.config, sourceFile: link }, fetcher), code('credential_unavailable'));
  for (const data of [{ ...f.source, token_uri: 'https://attacker.invalid' }, { type: 'service_account', private_key: 'synthetic-key' }]) {
    await writeFile(f.file, JSON.stringify(data)); await assert.rejects(createSyntheticGoogleCredentials(f.config, fetcher), code('credential_unavailable'));
  }
  assert.equal(calls, 0);
});

test('ambiguous authentication failures have no automatic retry and never disclose raw token/source errors', async t => {
  const f = await userSource(t); let calls = 0;
  const credentials = await createSyntheticGoogleCredentials(f.config, async () => { calls++; throw Error('synthetic-refresh-secret synthetic-user-token'); }); t.after(() => credentials.close());
  await assert.rejects(credentials.token(signal()), error => { assert.doesNotMatch(String(error), /synthetic|secret|token/); return code('credential_unavailable')(error); }); assert.equal(calls, 1);
});

test('Firestore SDK auth receives only the explicit token provider and never performs ADC discovery', async () => {
  let calls = 0; const auth = pinnedGoogleAuth('example-mobileops-demo', { principal: config.serviceAccountEmail, sessionId: 'synthetic-session', mode: 'synthetic', close() {}, async token() { calls++; return { accessToken: 'synthetic-sdk-token', expiresAt: Date.now() + 600000 }; } });
  assert.equal(await auth.getProjectId(), 'example-mobileops-demo');
  const client = await auth.getClient(), headers = await client.getRequestHeaders('https://firestore.googleapis.com');
  assert.equal(headers.get('Authorization'), 'Bearer synthetic-sdk-token'); assert.equal(calls, 1);
});

test('offline/default-disabled factories block before metadata or credential-file access', async () => {
  await assert.rejects(createGoogleCredentials(config, false), code('credential_disabled'));
  await assert.rejects(createGoogleCredentials(config, true), code('credential_disabled'));
  await assert.rejects(createGoogleCredentials({ method: 'impersonated_user', sourceFile: '/nonexistent/should-not-read', serviceAccountEmail: config.serviceAccountEmail }, true), code('credential_disabled'));
  await assert.rejects(createSyntheticGoogleCredentials(config, globalThis.fetch), code('credential_disabled'));
});
