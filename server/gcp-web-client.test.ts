import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import type { WebIdentity, WebIdentityClient } from '../src/platform/web-identity';
import { GcpObservationClient } from '../src/modules/gcp/observation-client';
import { gcpPreview } from '../src/modules/gcp/preview';
import { gcpMetadataSourceIds } from '../src/modules/gcp/domain/analysis';
const snapshot = gcpPreview(), binding = snapshot.binding;
const row = { id: 'resource-demo', label: 'Synthetic', binding, dataMode: 'synthetic', configurationDigest: 'a'.repeat(64) };
const result = { resourceId: row.id, configurationDigest: row.configurationDigest, snapshot, evidenceDigest: 'b'.repeat(64) };
const list = { owner: binding.owner, workspaceId: binding.workspaceId, items: [row] };
const scope = { edition: 'organization', organizationId: 'synthetic-example', workspaceId: 'synthetic-preview', label: 'Synthetic' } as const;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function fixture(fetcher: typeof fetch) {
  let identity: WebIdentity | null = null; const listeners = new Set<(identity: WebIdentity | null) => void>();
  const emit = (key: string | null) => { identity = key ? { key, label: key } : null; listeners.forEach(fn => fn(identity)); };
  const auth: WebIdentityClient = { subscribe(fn) { listeners.add(fn); fn(identity); return () => { listeners.delete(fn); }; }, async signIn() { emit('user-a'); }, async signOut() { emit(null); }, async tokenFor(key) { if (key !== identity?.key) throw Error(); return `synthetic-${key}`; }, async close() { listeners.clear(); } };
  const client = new GcpObservationClient(auth, scope, fetcher); return { emit, auth, client };
}
test('GCP browser client retries the same read request after a lost response and sends only a server resource ID', async t => {
  const writes: { key: string | null; body: unknown }[] = [];
  const s = fixture(async (_url, init) => { if (init?.method !== 'POST') return json(list); writes.push({ key: new Headers(init.headers).get('Idempotency-Key'), body: JSON.parse(String(init.body)) }); if (writes.length === 1) throw Error('lost'); return json(result); });
  t.after(() => s.client.close()); s.emit('user-a'); await nextTurn(); await s.client.collect(); assert.equal(s.client.getSnapshot().retryable, true);
  await s.client.retry(); assert.equal(s.client.getSnapshot().observation?.snapshot.id, snapshot.id); assert.deepEqual(writes[0], writes[1]); assert.deepEqual(writes[0].body, { resourceId: row.id });
});
test('GCP browser client clears results on access loss, changed config, secret fields and mismatched scope', async t => {
  let response: unknown = result, status = 200;
  const s = fixture(async (_url, init) => init?.method === 'POST' ? json(response, status) : json(list));
  t.after(() => s.client.close()); s.emit('user-a'); await nextTurn(); await s.client.collect(); assert.ok(s.client.getSnapshot().observation);
  for (const invalid of [{ ...result, accessToken: 'secret' }, { ...result, configurationDigest: 'c'.repeat(64) }, { ...result, snapshot: { ...snapshot, binding: { ...binding, workspaceId: 'different' } } }]) {
    response = invalid; await s.client.collect(); assert.equal(s.client.getSnapshot().observation, undefined);
  }
  response = { code: 'organization_access_denied' }; status = 403; await s.client.collect(); assert.deepEqual(s.client.getSnapshot().items, []); assert.equal(s.client.getSnapshot().retryable, false);
});
test('late GCP responses cannot cross user switch, logout or client close', async t => {
  let resolve: (value: Response) => void = () => {};
  const delayed = new Promise<Response>(done => { resolve = done; });
  const s = fixture(async (_url, init) => init?.method === 'POST' ? delayed : json(list));
  t.after(() => s.client.close()); s.emit('user-a'); await nextTurn(); const reading = s.client.collect(); await nextTurn(); s.emit('user-b'); await nextTurn(); resolve(json(result)); await reading;
  assert.equal(s.client.getSnapshot().identity?.key, 'user-b'); assert.equal(s.client.getSnapshot().observation, undefined);
  s.auth.signOut = async () => s.emit('user-b'); await s.client.signOut(); assert.equal(s.client.getSnapshot().identity, null);
  s.client.close(); s.emit('user-a'); assert.equal(s.client.getSnapshot().identity, null);
});
test('GCP browser client rejects cross-workspace or mixed-owner resource lists before collection', async t => {
  let posts = 0;
  const s = fixture(async (_url, init) => { if (init?.method === 'POST') posts++; return json({ ...list, items: [{ ...row, binding: { ...binding, owner: { kind: 'personal', userId: 'other' } } }] }); });
  t.after(() => s.client.close()); s.emit('user-a'); await nextTurn(); await s.client.collect(); assert.deepEqual(s.client.getSnapshot().items, []); assert.equal(posts, 0);
});

const analysis = () => ({ id: '00000000-0000-4000-8000-000000000002', resourceId: row.id, observationId: snapshot.id, configurationDigest: row.configurationDigest, language: 'en', planDigest: 'c'.repeat(64), plan: {
  schemaVersion: 1, planId: '00000000-0000-4000-8000-000000000002', version: 1, dataMode: 'synthetic', ...binding,
  evidence: { snapshotId: snapshot.id, digest: result.evidenceDigest, sourceIds: [...gcpMetadataSourceIds], observedAt: snapshot.observedAt },
  analysis: { engine: 'synthetic-fixture', summary: 'Synthetic interpretation', findings: [{ statement: 'Readiness failed.', evidenceIds: ['gcp-run-service'], kind: 'observation' }], missingInformation: ['Missing logs and metrics'], serviceAssessment: 'unknown' },
  action: { id: 'gcp.cloudrun.metadata.inspect.v1', version: 1, effect: 'read', inputs: {}, completionCriteria: ['Collect metadata'] }, createdAt: snapshot.observedAt, expiresAt: new Date(Date.parse(snapshot.observedAt) + 300000).toISOString(),
} });
test('analysis retry preserves language and request key; a new observation clears its old plan', async t => {
  const requests: { key: string | null; body: unknown }[] = [];
  const s = fixture(async (url, init) => {
    if (String(url).endsWith('/resources')) return json({ ...list, items: [{ ...row, analysisAvailable: true }] });
    if (String(url).endsWith('/observations')) return json(result);
    requests.push({ key: new Headers(init?.headers).get('Idempotency-Key'), body: JSON.parse(String(init?.body)) }); if (requests.length === 1) throw Error('lost response'); return json(analysis());
  });
  t.after(() => s.client.close()); s.emit('user-a'); await nextTurn(); await s.client.collect(); await s.client.analyze('en');
  assert.equal(s.client.getSnapshot().retryable, true); assert.ok(s.client.getSnapshot().observation); await s.client.retry();
  assert.deepEqual(requests[0], requests[1]); assert.deepEqual(requests[0].body, { observationId: snapshot.id, language: 'en' }); assert.ok(s.client.getSnapshot().analysis);
  await s.client.collect(); assert.equal(s.client.getSnapshot().analysis, undefined);
});
test('analysis responses reject mismatched evidence and disappear on identity change or access revocation', async t => {
  let value: unknown = { ...analysis(), plan: { ...analysis().plan, evidence: { ...analysis().plan.evidence, digest: 'd'.repeat(64) } } }, status = 200;
  let delayed: Promise<Response> | undefined;
  const s = fixture(async (url) => String(url).endsWith('/resources') ? json({ ...list, items: [{ ...row, analysisAvailable: true }] }) : String(url).endsWith('/observations') ? json(result) : delayed ?? json(value, status));
  t.after(() => s.client.close()); s.emit('user-a'); await nextTurn(); await s.client.collect(); await s.client.analyze('en'); assert.equal(s.client.getSnapshot().analysis, undefined);
  value = analysis(); await s.client.analyze('en'); assert.ok(s.client.getSnapshot().analysis);
  let resolve!: (value: Response) => void; delayed = new Promise(done => { resolve = done; }); const pending = s.client.analyze('en'); await nextTurn(); s.emit('user-b'); await nextTurn(); resolve(json(analysis())); await pending; assert.equal(s.client.getSnapshot().analysis, undefined);
  delayed = undefined; await s.client.collect(); value = { code: 'scope_denied' }; status = 403; await s.client.analyze('en'); assert.equal(s.client.getSnapshot().observation, undefined); assert.equal(s.client.getSnapshot().analysis, undefined); assert.deepEqual(s.client.getSnapshot().items, []);
});

function workflowFixture() {
  const saved = analysis();
  const initialView = { plan: { payload: saved.plan, digest: saved.planDigest, lifecycle: 'prepared', review: { status: 'not_requested' } }, serverTime: snapshot.observedAt,
    capabilities: { requestReview: true, decide: false, execute: false, handoff: false, cancel: false } };
  const state = { observation: result as unknown, view: initialView as unknown, resourceStatus: 200, post: undefined as ((url: string, init: RequestInit) => Promise<Response>) | undefined };
  const requests: { path: string; method: string; key: string | null; body: unknown }[] = [];
  const s = fixture(async (url, init) => {
    const path = String(url); requests.push({ path, method: init?.method ?? 'GET', key: new Headers(init?.headers).get('Idempotency-Key'), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (init?.method === 'POST') return state.post ? state.post(path, init) : json(state.view);
    if (path.endsWith('/resources')) return json({ ...list, workflowAvailable: true, items: [{ ...row, analysisAvailable: true }] }, state.resourceStatus);
    if (path.endsWith('/plans')) return json({ owner: list.owner, workspaceId: list.workspaceId, items: [{ id: saved.id, resourceId: saved.resourceId, createdAt: saved.plan.createdAt }] });
    if (path.endsWith(`/analyses/${saved.id}`)) return json(saved);
    if (path.endsWith(`/plans/${saved.id}`)) return json(state.view);
    if (path.includes('/observations/')) return json(state.observation);
    throw Error('Unexpected path');
  });
  return { ...s, saved, initialView, state, requests };
}

test('stored GCP plan restoration makes no provider/model POST; lost review response retries the exact pinned body and key', async t => {
  const s = workflowFixture(); t.after(() => s.client.close()); s.emit('user-a'); await nextTurn();
  await s.client.loadPlan(s.saved.id); assert.ok(s.client.getSnapshot().operation); assert.ok(s.requests.every(x => x.method === 'GET'));
  let calls = 0; s.state.post = async () => { calls++; if (calls === 1) throw Error('lost reply'); return json({ ...s.initialView, plan: { ...s.initialView.plan, review: { status: 'pending' } } }); };
  await s.client.workflowAction('review'); assert.equal(s.client.getSnapshot().retryable, true); assert.ok(s.client.getSnapshot().analysis);
  await s.client.retry(); const posts = s.requests.filter(x => x.method === 'POST'); assert.deepEqual(posts[0], posts[1]);
  assert.deepEqual(posts[0].body, { expectedVersion: 1, expectedDigest: s.saved.planDigest }); assert.ok(posts[0].path.endsWith(`/plans/${s.saved.id}/review`));
  assert.equal(s.client.getSnapshot().operation?.plan.review.status, 'pending');
});

test('restored workflow rejects mismatched observation IDs/times and omitted or foreign execution records', async t => {
  const executionId = '00000000-0000-4000-8000-000000000003';
  const cases = [
    (s: ReturnType<typeof workflowFixture>) => { s.state.observation = { ...result, snapshot: { ...snapshot, id: executionId } }; },
    (s: ReturnType<typeof workflowFixture>) => { s.state.observation = { ...result, snapshot: { ...snapshot, observedAt: new Date(Date.parse(snapshot.observedAt) + 1000).toISOString() } }; },
    (s: ReturnType<typeof workflowFixture>) => { s.state.view = { ...s.initialView, plan: { ...s.initialView.plan, lifecycle: 'consumed', executionId } }; },
    (s: ReturnType<typeof workflowFixture>) => { s.state.view = { ...s.initialView, plan: { ...s.initialView.plan, payload: { ...s.saved.plan, workspaceId: 'foreign' } } }; },
  ];
  for (const [index, change] of cases.entries()) await t.test(`invalid restored response ${index}`, async child => {
    const s = workflowFixture(); child.after(() => s.client.close()); s.emit('user-a'); await nextTurn(); change(s);
    await s.client.loadPlan(s.saved.id); assert.equal(s.client.getSnapshot().operation, undefined); assert.equal(s.client.getSnapshot().analysis, undefined);
  });
});

test('workflow late responses are discarded on user change and access loss clears stored plan choices', async t => {
  const s = workflowFixture(); t.after(() => s.client.close()); s.emit('user-a'); await nextTurn(); await s.client.loadPlan(s.saved.id);
  let resolve!: (value: Response) => void; s.state.post = () => new Promise(done => { resolve = done; });
  const pending = s.client.workflowAction('review'); await nextTurn(); s.emit('user-b'); await nextTurn(); resolve(json(s.initialView)); await pending;
  assert.equal(s.client.getSnapshot().operation, undefined); assert.equal(s.client.getSnapshot().analysis, undefined); assert.equal(s.client.getSnapshot().identity?.key, 'user-b');
  await s.client.loadPlan(s.saved.id); s.state.post = async () => json({ code: 'scope_denied' }, 403); await s.client.workflowAction('review');
  assert.equal(s.client.getSnapshot().operation, undefined); assert.equal(s.client.getSnapshot().observation, undefined); assert.equal(s.client.getSnapshot().planItems, undefined); assert.deepEqual(s.client.getSnapshot().items, []);
});

test('failed service refresh removes obsolete stored plan options as well as old results', async t => {
  const s = workflowFixture(); t.after(() => s.client.close()); s.emit('user-a'); await nextTurn(); await s.client.loadPlan(s.saved.id);
  s.state.resourceStatus = 503; await s.client.refresh(); assert.equal(s.client.getSnapshot().analysis, undefined);
  assert.deepEqual(s.client.getSnapshot().planItems, []); assert.equal(s.client.getSnapshot().workflowAvailable, false);
});
