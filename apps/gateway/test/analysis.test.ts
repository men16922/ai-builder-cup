import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { revisionSource } from '@contracts/gcp/cloud-run';
import { gcpPreview } from '../../../tests/support/sample-observation';
import { SqliteCloudStore } from '../src/store/sqlite-store';
import { CloudWorkflow, cloudRecordKey } from '../src/workflow/workflow';
import { cloudDigest } from '../src/store/integrity';
import { GcpWebAccess } from '../src/auth/web-access';
import { GcpObservations, type GcpRegistration } from '../src/workflow/observations';
import { GcpAnalyses } from '../src/workflow/analyses';
import { GcpOperations } from '../src/workflow/operations';
import { createCloudRunMetadataAdapter } from '../src/cloud-run/metadata-adapter';
import { createGcpApiServer, type GcpApiServices } from '../src/http/api';
import { createGeminiModel, createSyntheticGeminiProtocol, type GcpAnalysisModel } from '../src/google/gemini';
import { cloudRunEvidence } from '../src/cloud-run/collector';
import type { CloudStore, CloudTransaction } from '../src/store/store';
import { gcpAnalysisSchema } from '@contracts/gcp/analysis';
import { gcpWorkflowViewSchema } from '@contracts/gcp/workflow';
const output = () => ({ summary: 'The new deployment needs follow-up. Application health is unknown.', findings: [
  { statement: 'Service readiness failed while an older revision is ready.', evidenceIds: ['gcp-run-service'], kind: 'observation' },
  { statement: 'Revision access is denied, limiting further investigation.', evidenceIds: ['gcp-run-revision'], kind: 'observation' },
], missingInformation: ['Logs and request metrics are missing.'], serviceAssessment: 'unknown' });
const code = (expected: string) => (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === expected;
async function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'gcp-analysis-')), path = join(root, 'test.sqlite'), db = new SqliteCloudStore(path);
  let now = Date.parse(gcpPreview().observedAt), calls = 0, reads = 0, revoke = false, failCommit = false, complete = false;
  let readHook: (() => Promise<void>) | undefined, lastSnapshotId = '';
  const store: CloudStore = { transact: body => db.transact(tx => body({ get: key => tx.get(key), put(key, value) { if (failCommit && key.startsWith('gcp-analysis:')) throw Error('injected storage failure'); tx.put(key, value); } } as CloudTransaction)) };
  const access = new GcpWebAccess({ async verify(token) { if (revoke || !['user-a', 'user-b'].includes(token)) throw Error(); return { actorId: token, expiresAt: now + 3600000 }; } }, store, () => now);
  const binding = gcpPreview().binding, scope = { edition: 'organization' as const, organizationId: 'synthetic-example', workspaceId: binding.workspaceId, label: 'Synthetic' };
  const provision = (actorId: string, version = 1, active = true, roles: ('operator' | 'reviewer' | 'viewer')[] = ['operator', 'reviewer']) => access.organization.provision({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, actorId, version, active, roles, updatedAt: new Date(now).toISOString() });
  await provision('user-a'); await provision('user-b');
  const registration: GcpRegistration = { id: 'checkout', label: 'Synthetic checkout', binding, dataMode: 'synthetic', collector: { async collect(context, options) {
    reads++; await options?.revalidate?.(); const snapshot = gcpPreview(), at = new Date(now).toISOString();
    snapshot.id = randomUUID(); snapshot.startedAt = at; snapshot.observedAt = at; for (const key of ['service', 'revision', 'recheck'] as const) snapshot[key].observedAt = at;
    if (complete && snapshot.service.status === 'collected' && snapshot.recheck.status === 'collected' && binding.target.provider === 'gcp') {
      for (const key of ['service', 'recheck'] as const) { const read = snapshot[key]; if (read.status === 'collected') { read.value.readiness = 'succeeded'; read.value.missingFields = []; read.value.observedGeneration = read.value.generation; } }
      const name = `${binding.target.resourceName}/revisions/${binding.target.revision}`;
      snapshot.revision = { status: 'collected', source: revisionSource, resourceName: name, observedAt: at, value: { name, uid: 'synthetic-revision', service: binding.target.resourceName, generation: '1', observedGeneration: '1', updateTime: at, reconciling: false, readiness: 'succeeded', missingFields: [] } };
    }
    assert.equal(context.workspaceId, binding.workspaceId); lastSnapshotId = snapshot.id; await readHook?.(); return snapshot;
  } } };
  const session = () => access.authenticate('Bearer user-a', scope), observations = new GcpObservations(store, access, [registration], () => now);
  const adapter = createCloudRunMetadataAdapter([registration], 'synthetic', async () => (await session()).context), workflow = new CloudWorkflow(store, [adapter], () => now);
  let hook: (() => Promise<unknown>) | undefined;
  const model: GcpAnalysisModel = { engine: 'synthetic-fixture', modelId: 'synthetic-gemini-contract', configurationId: 'fixture-v1', async analyze() { calls++; return hook ? hook() : output(); } };
  const analyses = new GcpAnalyses(store, access, observations, workflow, model, () => now);
  const observation = await observations.collect(await session(), { resourceId: registration.id }, randomUUID());
  const input = { observationId: observation.snapshot.id, language: 'en' as const };
  const operations = new GcpOperations(store, access, analyses, [registration], () => now);
  const services: GcpApiServices = { access, observations, analyses, operations, publicOrigin: 'http://127.0.0.1' };
  const server = createGcpApiServer(services); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw Error(); services.publicOrigin = `http://127.0.0.1:${address.port}`;
  const base = `/api/organizations/v1/${scope.organizationId}/workspaces/${scope.workspaceId}/gcp`;
  const http = async (path: string, body?: unknown, token = 'user-a', key = randomUUID()) => { const response = await fetch(services.publicOrigin + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: services.publicOrigin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, body: await response.json() }; };
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); rmSync(root, { recursive: true, force: true }); });
  return { store, db, path, session, observations, observation, input, analyses, workflow, model, access, scope, provision, http, base, operations, services, registration,
    setReadHook(fn: () => Promise<void>) { readHook = fn; }, lastSnapshotId: () => lastSnapshotId,
    complete() { complete = true; }, calls: () => calls, reads: () => reads, advance(ms: number) { now += ms; }, now: () => now, setHook(fn: () => Promise<unknown>) { hook = fn; }, revoke() { revoke = true; }, failCommit() { failCommit = true; } };
}

test('GCP HTTP prepares one pinned metadata plan atomically, replays across keys, cites stored evidence and never starts review or execution', async t => {
  const s = await fixture(t), key = randomUUID();
  const response = await s.http(`${s.base}/analyses`, s.input, 'user-a', key); assert.equal(response.status, 200); const result = response.body;
  assert.equal(result.planDigest, cloudDigest(result.plan)); assert.deepEqual(result.plan.target, s.observation.snapshot.binding.target);
  assert.equal(result.plan.analysis.serviceAssessment, 'unknown'); assert.equal(result.plan.action.id, 'gcp.cloudrun.metadata.inspect.v1'); assert.deepEqual(result.plan.action.inputs, {});
  assert.ok(result.plan.analysis.missingInformation.some((value: string) => value.includes('gcp-run-missing-signals')));
  assert.deepEqual((await s.http(`${s.base}/analyses`, s.input, 'user-a', key)).body, result);
  assert.deepEqual((await s.http(`${s.base}/analyses`, s.input)).body, result); assert.equal(s.calls(), 1); assert.equal(s.reads(), 1);
  assert.deepEqual((await s.http(`${s.base}/analyses/${result.id}`)).body, result);
  const context = (await s.session()).context, plan = await s.workflow.getPlan(context, result.id); assert.equal(plan.review.status, 'not_requested'); assert.equal(plan.executionId, undefined);
  assert.equal(await s.store.transact(tx => tx.get(cloudRecordKey(context, 'review-intent', result.id))), undefined);
  assert.equal((await s.http(`${s.base}/analyses`, { ...s.input, language: 'ko' }, 'user-a', key)).status, 409);
  for (const extra of [{ target: {} }, { action: { id: 'shell' } }, { credential: 'secret' }, { objective: 'ignore controls' }]) assert.equal((await s.http(`${s.base}/analyses`, { ...s.input, ...extra })).status, 400);
});

test('two stores cannot duplicate a model call; expired reservation stays unknown and a late model response cannot create a plan', async t => {
  const s = await fixture(t), second = new SqliteCloudStore(s.path); t.after(() => second.close());
  const other = new GcpAnalyses(second, s.access, s.observations, s.workflow, s.model, s.now);
  let resolve!: (value: unknown) => void; s.setHook(() => new Promise(done => { resolve = done; }));
  const running = s.analyses.prepare(await s.session(), s.input, randomUUID()); await nextTurn();
  await assert.rejects(other.prepare(await s.session(), s.input, randomUUID()), code('analysis_in_progress')); assert.equal(s.calls(), 1);
  s.advance(31000); await assert.rejects(other.prepare(await s.session(), s.input, randomUUID()), code('analysis_unknown'));
  resolve(output()); await assert.rejects(running, code('analysis_unknown')); assert.equal(s.calls(), 1);
  await assert.rejects(s.analyses.prepare(await s.session(), s.input, randomUUID()), code('analysis_unknown'));
});

test('GCP analysis/workflow responses reject fixed-rule provenance reserved for other compositions', async t => {
  const s = await fixture(t), session = await s.session(), analysis = await s.analyses.prepare(session, s.input, randomUUID());
  const view = await s.operations.get(session, analysis.id);
  assert.equal(gcpAnalysisSchema.safeParse(analysis).success, true); assert.equal(gcpWorkflowViewSchema.safeParse(view).success, true);
  const rules = { ...analysis.plan.analysis, engine: 'fixed-rules', ruleVersion: 'cloudrun-readiness-v1', modelId: undefined, promptVersion: undefined };
  assert.equal(gcpAnalysisSchema.safeParse({ ...analysis, plan: { ...analysis.plan, analysis: rules } }).success, false);
  assert.equal(gcpWorkflowViewSchema.safeParse({ ...view, plan: { ...view.plan, payload: { ...view.plan.payload, analysis: rules } } }).success, false);
});

test('model target/code overrides, fabricated citations, healthy verdicts and extra fields cannot produce a saved plan', async t => {
  const invalid = [{ ...output(), target: { projectId: 'other' } }, { ...output(), command: 'curl secret' }, { ...output(), serviceAssessment: 'healthy' }, { ...output(), findings: [{ statement: 'fabricated', evidenceIds: ['gcp-run-invented'], kind: 'observation' }] }];
  for (const body of invalid) await t.test('invalid model response', async child => {
    const s = await fixture(child); s.setHook(async () => body); const key = randomUUID();
    const first = await s.http(`${s.base}/analyses`, s.input, 'user-a', key); assert.equal(first.status, 502); assert.ok(['model_response_invalid', 'model_citation_invalid'].includes(first.body.code));
    assert.equal((await s.http(`${s.base}/analyses`, s.input, 'user-a', key)).status, 409); assert.equal(s.calls(), 1);
  });
});

test('stale evidence, cross-owner IDs, viewer role and membership revoked during inference are denied', async t => {
  const s = await fixture(t), personal = `/api/personal/v1/workspaces/${s.scope.workspaceId}/gcp`;
  assert.equal((await s.http(`${personal}/analyses`, s.input)).status, 404); assert.equal(s.calls(), 0);
  await s.provision('user-a', 2, true, ['viewer']); assert.equal((await s.http(`${s.base}/analyses`, s.input)).status, 403); assert.equal(s.calls(), 0);
  await s.provision('user-a', 3); s.advance(900001); assert.equal((await s.http(`${s.base}/analyses`, s.input)).body.code, 'evidence_expired'); assert.equal(s.calls(), 0);
  s.advance(-900001); s.setHook(async () => { await s.provision('user-a', 4, false); return output(); });
  assert.equal((await s.http(`${s.base}/analyses`, s.input)).status, 403); assert.equal(s.calls(), 1);
});

test('analysis/plan commit rollback leaves no orphan plan; token revocation blocks completed replay', async t => {
  const s = await fixture(t); s.failCommit(); const key = randomUUID();
  assert.equal((await s.http(`${s.base}/analyses`, s.input, 'user-a', key)).status, 502);
  const fingerprint = cloudDigest([s.input, s.observation.configurationDigest, s.observation.evidenceDigest, cloudDigest([s.model.engine, s.model.modelId, s.model.configurationId, 'cloud-run-observation-v3'])]);
  const context = (await s.session()).context, workKey = cloudRecordKey(context, 'gcp-analysis-work', cloudDigest([context.actorId, fingerprint]));
  const reservation = await s.store.transact(tx => tx.get<{ id: string; state: string }>(workKey)); assert.equal(reservation?.state, 'failed');
  await assert.rejects(s.workflow.getPlan(context, reservation!.id), code('not_found')); assert.equal(s.calls(), 1);
  const good = await fixture(t), result = await good.analyses.prepare(await good.session(), good.input, randomUUID()); good.revoke();
  assert.equal((await good.http(`${good.base}/analyses/${result.id}`)).status, 401);
});

test('metadata adapter checks registered scope and fresh authority; explicit review/execution preserves missing-revision failure', async t => {
  const s = await fixture(t), session = await s.session(), result = await s.analyses.prepare(session, s.input, randomUUID());
  const version = { expectedVersion: 1, expectedDigest: result.planDigest };
  await s.workflow.requestReview(session.context, result.id, version, randomUUID()); assert.equal(s.reads(), 1);
  await s.workflow.decide(session.context, result.id, { ...version, decision: 'approve', note: '' }, randomUUID()); assert.equal(s.reads(), 1);
  const execution = await s.workflow.requestExecution(session.context, { ...version, planId: result.id }, randomUUID());
  await s.workflow.runExecution(session.context, execution.id);
  const finished = await s.workflow.getExecution(session.context, execution.id); assert.equal(finished.state, 'failed'); assert.equal(finished.result?.serviceAssessment, 'unknown'); assert.equal(s.reads(), 2);
});

test('fresh complete metadata is a positive read-completion control while application health and coverage remain unknown/partial', async t => {
  const s = await fixture(t), session = await s.session(), result = await s.analyses.prepare(session, s.input, randomUUID()), version = { expectedVersion: 1, expectedDigest: result.planDigest };
  await s.workflow.requestReview(session.context, result.id, version, randomUUID());
  await s.workflow.decide(session.context, result.id, { ...version, decision: 'approve', note: '' }, randomUUID());
  s.complete(); const execution = await s.workflow.requestExecution(session.context, { ...version, planId: result.id }, randomUUID());
  await s.workflow.runExecution(session.context, execution.id); const done = await s.workflow.getExecution(session.context, execution.id);
  assert.equal(done.state, 'succeeded'); assert.equal(done.result?.serviceAssessment, 'unknown'); assert.equal(done.result?.coverage, 'partial');
  const data = await s.workflow.getEvidence(session.context, done.result!.evidenceId); assert.equal(data.observations.find(x => x.id === 'gcp-run-missing-signals')?.quality, 'missing');
});

test('Gemini REST protocol pins endpoint/schema, excludes owner and credentials from content, rejects tools/truncation/oversize and remains offline by default', async () => {
  const snapshot = gcpPreview(), evidence = cloudRunEvidence(snapshot), calls: { url: string; init: RequestInit }[] = [];
  let raw: unknown = { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(output()) }] } }] };
  const options = { projectId: 'example-mobileops-demo', location: 'global', modelId: 'gemini-2.5-flash', principal: 'synthetic-principal', sessionId: 'synthetic-session', credentials: { async current() { return { principal: 'synthetic-principal', sessionId: 'synthetic-session', accessToken: 'synthetic-bearer-only' }; } } };
  const model = createSyntheticGeminiProtocol(options, async (url, init) => { calls.push({ url: String(url), init: init! }); return new Response(JSON.stringify(raw)); });
  assert.deepEqual(await model.analyze(evidence, 'en', new AbortController().signal), output());
  assert.match(calls[0].url, /^https:\/\/aiplatform.googleapis.com\/v1\/projects\/example-mobileops-demo\/locations\/global\/publishers\/google\/models\/gemini-2.5-flash:generateContent$/);
  const body = JSON.parse(String(calls[0].init.body)); assert.equal(body.generationConfig.responseMimeType, 'application/json'); assert.equal(body.tools, undefined); assert.equal(body.generationConfig.candidateCount, 1);
  assert.ok(!String(calls[0].init.body).includes('synthetic-bearer-only')); assert.ok(!body.contents[0].parts[0].text.includes('synthetic-example'));
  for (const invalid of [{ candidates: [{ finishReason: 'MAX_TOKENS', content: { role: 'model', parts: [{ text: '{}' }] } }] }, { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ functionCall: { name: 'execute' } }] } }] }, { value: 'x'.repeat(131073) }]) { raw = invalid; await assert.rejects(model.analyze(evidence, 'ko', new AbortController().signal), code('model_response_invalid')); }
  assert.throws(() => createGeminiModel({ ...options, enabled: false }), code('model_disabled'));
  if (process.env.MOBILEOPS_OFFLINE_TEST === '1') assert.throws(() => createGeminiModel({ ...options, enabled: true }), code('model_disabled'));
});

async function prepared(s: Awaited<ReturnType<typeof fixture>>, reviewed = true) {
  const response = await s.http(`${s.base}/analyses`, s.input); assert.equal(response.status, 200);
  const result = response.body, expected = { expectedVersion: result.plan.version, expectedDigest: result.planDigest }, path = `${s.base}/plans/${result.id}`;
  if (reviewed) {
    assert.equal((await s.http(`${path}/review`, expected)).body.plan.review.status, 'pending');
    assert.equal((await s.http(`${path}/decision`, { ...expected, decision: 'approve', note: 'Read only, pinned service.' })).body.plan.review.status, 'approved');
  }
  return { result, expected, path, input: { ...expected, planId: result.id } };
}

test('GCP workflow HTTP separates review and explicit execution, restores persisted results and idempotent handoff without provider reads', async t => {
  const s = await fixture(t), p = await prepared(s, false), reviewKey = randomUUID(); s.complete();
  assert.equal((await s.http(`${s.base}/resources`)).body.workflowAvailable, true);
  assert.deepEqual((await s.http(`${s.base}/plans`)).body.items.map((x: { id: string }) => x.id), [p.result.id]);
  assert.equal((await s.http(`${p.path}/execute`, p.input)).body.code, 'review_required');
  assert.equal((await s.http(`${p.path}/review`, p.expected, 'user-a', reviewKey)).body.plan.review.status, 'pending');
  assert.equal((await s.http(`${p.path}/review`, p.expected, 'user-a', reviewKey)).status, 200);
  assert.equal((await s.http(`${p.path}/decision`, { ...p.expected, decision: 'approve', note: 'Pinned read only.' }, 'user-b')).body.capabilities.execute, true);
  assert.equal(s.reads(), 1); assert.equal(s.calls(), 1);
  const key = randomUUID(), first = await s.http(`${p.path}/execute`, p.input, 'user-a', key);
  assert.equal(first.status, 200); assert.equal(first.body.execution.state, 'succeeded'); assert.equal(first.body.execution.result.serviceAssessment, 'unknown');
  assert.equal(first.body.execution.result.coverage, 'partial'); assert.equal(first.body.execution.claim, undefined); assert.equal(s.reads(), 2);
  const second = new SqliteCloudStore(s.path); t.after(() => second.close());
  s.services.operations = new GcpOperations(second, s.access, s.analyses, [s.registration], s.now);
  assert.deepEqual((await s.http(`${p.path}/execute`, p.input, 'user-a', key)).body, first.body); assert.equal(s.reads(), 2);
  assert.equal((await s.http(`${p.path}/execute`, { ...p.input, expectedVersion: 2 }, 'user-a', key)).body.code, 'idempotency_conflict');
  assert.equal((await s.http(`${p.path}/execute`, p.input)).status, 409);
  const executionPath = `${s.base}/executions/${first.body.execution.id}`, handoffKey = randomUUID();
  const handoff = await s.http(`${executionPath}/handoff`, { note: 'Synthetic follow-up: request metrics still missing.' }, 'user-b', handoffKey);
  assert.equal(handoff.status, 200); assert.equal(handoff.body.execution.handoffs.length, 1); assert.equal(handoff.body.execution.state, 'succeeded');
  assert.deepEqual((await s.http(`${executionPath}/handoff`, { note: 'Synthetic follow-up: request metrics still missing.' }, 'user-b', handoffKey)).body, handoff.body);
  assert.equal((await s.http(`${executionPath}/handoff`, { note: 'different' }, 'user-b', handoffKey)).status, 409);
  assert.deepEqual((await s.http(executionPath)).body, handoff.body); assert.equal(s.reads(), 2); assert.equal(s.calls(), 1);
});

test('concurrent HTTP execution retry observes a running claim and never dispatches twice', async t => {
  const s = await fixture(t), p = await prepared(s), key = randomUUID(); s.complete();
  let release!: () => void, entered!: () => void; const started = new Promise<void>(done => { entered = done; });
  s.setReadHook(() => { entered(); return new Promise(done => { release = done; }); });
  const first = s.http(`${p.path}/execute`, p.input, 'user-a', key); await started;
  const replay = await s.http(`${p.path}/execute`, p.input, 'user-a', key);
  assert.equal(replay.status, 200); assert.equal(replay.body.execution.state, 'running'); assert.equal(s.reads(), 2);
  assert.equal((await s.http(`${s.base}/executions/${replay.body.execution.id}/handoff`, { note: 'Not yet complete' })).body.code, 'execution_not_terminal');
  release(); assert.equal((await first).body.execution.state, 'succeeded'); assert.equal(s.reads(), 2);
});

test('queued execution surviving restart is only read on replay and can be explicitly cancelled', async t => {
  const s = await fixture(t), p = await prepared(s), key = randomUUID(), context = (await s.session()).context;
  const queued = await s.workflow.requestExecution(context, p.input, key);
  const restored = await s.http(`${p.path}/execute`, p.input, 'user-a', key); assert.equal(restored.body.execution.state, 'queued'); assert.equal(s.reads(), 1);
  const path = `${s.base}/executions/${queued.id}/cancel`, cancelKey = randomUUID();
  assert.equal((await s.http(path, {}, 'user-a', cancelKey)).body.execution.state, 'cancelled');
  assert.equal((await s.http(path, {}, 'user-a', cancelKey)).body.execution.state, 'cancelled');
  assert.equal((await s.http(`${p.path}/execute`, p.input, 'user-a', key)).body.execution.state, 'cancelled'); assert.equal(s.reads(), 1);
});

test('GCP HTTP rejects role/scope/field/version/expiry changes before dispatch and separates shared organization from personal plans', async t => {
  const s = await fixture(t), p = await prepared(s, false), personal = `/api/personal/v1/workspaces/${s.scope.workspaceId}/gcp`;
  assert.deepEqual((await s.http(`${personal}/plans`)).body.items, []);
  assert.equal((await s.http(`${personal}/plans/${p.result.id}`)).status, 404);
  await s.provision('user-a', 2, true, ['viewer']); assert.equal((await s.http(p.path)).status, 200);
  assert.equal((await s.http(`${p.path}/review`, p.expected)).status, 403);
  await s.provision('user-a', 3, true, ['operator']); assert.equal((await s.http(`${p.path}/review`, p.expected)).status, 200);
  assert.equal((await s.http(`${p.path}/decision`, { ...p.expected, decision: 'approve', note: '' })).status, 403);
  await s.provision('user-b', 2, true, ['reviewer']); assert.equal((await s.http(`${p.path}/decision`, { ...p.expected, decision: 'approve', note: '' }, 'user-b')).status, 200);
  assert.equal((await s.http(`${p.path}/execute`, p.input, 'user-b')).status, 403);
  for (const extra of [{ target: {} }, { command: 'gcloud run delete' }, { role: 'operator' }]) assert.equal((await s.http(`${p.path}/execute`, { ...p.input, ...extra })).status, 400);
  assert.equal((await s.http(`${p.path}/execute`, { ...p.input, planId: randomUUID() })).status, 409);
  assert.equal((await s.http(`${p.path}/execute`, { ...p.input, expectedVersion: 2 })).status, 409);
  s.advance(300001); const expired = await s.http(p.path); assert.equal(expired.status, 200); assert.equal(expired.body.capabilities.execute, false);
  assert.equal((await s.http(`${p.path}/execute`, p.input)).status, 410); assert.equal(s.reads(), 1);
});

test('membership revoked during result collection prevents evidence commit and persists unknown outcome', async t => {
  const s = await fixture(t), p = await prepared(s), context = (await s.session()).context; s.complete();
  s.setReadHook(() => s.provision('user-a', 2, false));
  assert.equal((await s.http(`${p.path}/execute`, p.input)).status, 403);
  const plan = await s.workflow.getPlan(context, p.result.id), execution = await s.workflow.getExecution(context, plan.executionId!);
  assert.equal(execution.state, 'unknown'); assert.equal(execution.result, undefined);
  assert.equal(await s.store.transact(tx => tx.get(cloudRecordKey(context, 'evidence', s.lastSnapshotId()))), undefined);
  const view = await s.http(p.path, undefined, 'user-b'); assert.equal(view.body.execution.state, 'unknown'); assert.equal(view.body.evidence, undefined);
  assert.equal((await s.http(`${s.base}/executions/${execution.id}/handoff`, { note: 'Verify the missed read after access is restored.' }, 'user-b')).body.execution.state, 'unknown'); assert.equal(s.reads(), 2);
});

test('plan expiry during the last read cannot become success even before the worker lease ends', async t => {
  const s = await fixture(t), p = await prepared(s), key = randomUUID(); s.complete(); s.advance(299000);
  s.setReadHook(async () => { s.advance(2000); });
  const result = await s.http(`${p.path}/execute`, p.input, 'user-a', key);
  assert.equal(result.status, 200); assert.equal(result.body.execution.state, 'unknown'); assert.equal(result.body.evidence, undefined);
  assert.equal((await s.http(`${p.path}/execute`, p.input, 'user-a', key)).body.execution.state, 'unknown'); assert.equal(s.reads(), 2);
});

test('expired running claim stays unknown after late response; stored plan index is scoped and atomic', async t => {
  const s = await fixture(t), p = await prepared(s); s.complete();
  let release!: () => void, entered!: () => void; const started = new Promise<void>(done => { entered = done; });
  s.setReadHook(() => { entered(); return new Promise(done => { release = done; }); });
  const first = s.http(`${p.path}/execute`, p.input); await started; s.advance(120001);
  assert.equal((await s.http(p.path)).body.execution.state, 'unknown'); release(); assert.equal((await first).body.execution.state, 'unknown'); assert.equal(s.reads(), 2);
  s.setReadHook(async () => {});
  const failed = await fixture(t); failed.failCommit(); assert.equal((await failed.http(`${failed.base}/analyses`, failed.input)).status, 502);
  assert.deepEqual((await failed.http(`${failed.base}/plans`)).body.items, []);
  await s.http(`${s.base}/analyses`, s.input); assert.equal((await s.http(`${s.base}/plans`)).body.items.length, 1);
  const fresh = await s.observations.collect(await s.session(), { resourceId: s.registration.id }, randomUUID());
  const next = await s.http(`${s.base}/analyses`, { observationId: fresh.snapshot.id, language: 'ko' }); assert.equal(next.status, 200);
  assert.deepEqual((await s.http(`${s.base}/plans`)).body.items.map((x: { id: string }) => x.id), [next.body.id, p.result.id]);
});
