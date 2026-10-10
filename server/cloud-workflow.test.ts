import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evidenceSchema, planPayloadSchema, type CloudTarget, type VerifiedCloudContext } from '../src/domain/cloud-operations';
import type { CloudIntent } from '../src/domain/cloud-workflow';
import { cloudDigest } from './cloud-integrity';
import { SqliteCloudStore } from './cloud-sqlite-store';
import { CloudWorkflow, cloudRecordKey, type CloudReadAdapter } from './cloud-workflow';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../reference/examples/${name}.json`, import.meta.url), 'utf8'));
const status = (expected: number) => (error: unknown) => !!error && typeof error === 'object' && 'status' in error && error.status === expected;
async function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'mobileops-workflow-')), path = join(dir, 'cloud.sqlite');
  const stores: SqliteCloudStore[] = [], open = () => { const store = new SqliteCloudStore(path); stores.push(store); return store; };
  t.after(() => { for (const store of stores) store.close(); rmSync(dir, { recursive: true, force: true }); });
  let now = Date.parse('2026-10-09T10:01:00Z'), lookups = 0, inspections = 0;
  const evidence = evidenceSchema.parse(fixture('evidence-snapshot')), payload = planPayloadSchema.parse(fixture('operation-plan').payload);
  const context: VerifiedCloudContext = { owner: payload.owner, workspaceId: payload.workspaceId, actorId: 'operator-demo', channel: 'web', roles: ['operator', 'reviewer'] };
  let current: CloudTarget = structuredClone(payload.target);
  let inspect: CloudReadAdapter['inspect'] = async () => ({ ...structuredClone(evidence), id: randomUUID(), observedAt: new Date(now).toISOString() });
  const adapter: CloudReadAdapter = {
    actionId: payload.action.id, dataMode: 'synthetic', requiredSources: ['synthetic-cloud-run-service'],
    async currentTarget() { lookups++; return structuredClone(current); },
    async inspect(plan) { inspections++; return inspect(plan); },
  };
  const store = open(), workflow = new CloudWorkflow(store, [adapter], () => now);
  await workflow.saveEvidence(context, evidence);
  const plan = await workflow.registerPlan(context, payload);
  const version = { expectedVersion: payload.version, expectedDigest: plan.digest };
  const request = { ...version, planId: payload.planId };
  const approve = async () => {
    await workflow.requestReview(context, payload.planId, version, randomUUID());
    await workflow.decide(context, payload.planId, { ...version, decision: 'approve', note: 'Reviewed synthetic evidence.' }, randomUUID());
  };
  return { path, open, store, workflow, context, payload, evidence, adapter, version, request, approve,
    now: () => now, advance: (ms: number) => { now += ms; }, changeTarget: (value: CloudTarget) => { current = value; },
    setInspect: (fn: CloudReadAdapter['inspect']) => { inspect = fn; }, counts: () => ({ lookups, inspections }) };
}

test('durable review decisions race across two connections; approval never executes', async t => {
  const s = await setup(t), other = new CloudWorkflow(s.open(), [s.adapter], s.now);
  await s.workflow.requestReview(s.context, s.payload.planId, s.version, randomUUID());
  const decisions = await Promise.allSettled([
    s.workflow.decide(s.context, s.payload.planId, { ...s.version, decision: 'approve', note: '' }, randomUUID()),
    other.decide({ ...s.context, actorId: 'reviewer-two' }, s.payload.planId, { ...s.version, decision: 'reject', note: '' }, randomUUID()),
  ]);
  assert.equal(decisions.filter(item => item.status === 'fulfilled').length, 1);
  const rejected = decisions.find(item => item.status === 'rejected'); assert.ok(rejected?.status === 'rejected' && status(409)(rejected.reason));
  const record = await other.getPlan(s.context, s.payload.planId);
  assert.ok(['approved', 'rejected'].includes(record.review.status)); assert.equal(record.lifecycle, 'prepared'); assert.equal(record.executionId, undefined);
  assert.deepEqual(s.counts(), { lookups: 0, inspections: 0 }); assert.equal(statSync(s.path).mode & 0o777, 0o600);
});

test('concurrent execution requests consume once, atomically persist intent, and duplicate workers read only once', async t => {
  const s = await setup(t); await s.approve(); const key = randomUUID();
  const [first, retry] = await Promise.all([
    s.workflow.requestExecution(s.context, s.request, key),
    s.workflow.requestExecution({ ...s.context, channel: 'mobile' }, s.request, key),
  ]);
  assert.equal(first.id, retry.id); assert.equal(first.state, 'queued'); assert.equal(s.counts().inspections, 0);
  const intent = await s.store.transact(tx => tx.get<CloudIntent>(cloudRecordKey(s.context, 'dispatch-intent', first.id)));
  assert.equal(intent?.state, 'pending');
  await assert.rejects(s.workflow.requestExecution(s.context, s.request, randomUUID()), status(409));
  await Promise.all([s.workflow.runExecution(s.context, first.id), s.workflow.runExecution(s.context, first.id)]);
  const result = await s.workflow.getExecution(s.context, first.id);
  assert.equal(result.state, 'succeeded'); assert.equal(result.result?.coverage, 'partial'); assert.equal(result.result?.serviceAssessment, 'unknown');
  assert.equal(s.counts().inspections, 1); assert.ok(!JSON.stringify(result).includes('tokenDigest'));
  const before = structuredClone(result);
  const handed = await s.workflow.handoff(s.context, first.id, { note: 'Follow up the missing metrics.' }, randomUUID());
  assert.equal(handed.state, before.state); assert.equal(handed.finishedAt, before.finishedAt); assert.deepEqual(handed.result, before.result);
});

test('idempotent response survives expiry but current authorization and changed content are checked first', async t => {
  const s = await setup(t); await s.approve(); const key = randomUUID();
  const first = await s.workflow.requestExecution(s.context, s.request, key); s.advance(600_000);
  assert.deepEqual(await s.workflow.requestExecution(s.context, s.request, key), first);
  await assert.rejects(s.workflow.requestExecution(s.context, { ...s.request, expectedVersion: 2 }, key), status(409));
  await assert.rejects(s.workflow.requestExecution({ ...s.context, roles: ['viewer'] }, s.request, key), status(403));
  for (const owner of [{ kind: 'organization', organizationId: 'other' }, { kind: 'personal', userId: s.context.actorId }] as const) {
    await assert.rejects(s.workflow.getPlan({ ...s.context, owner }, s.payload.planId), status(404));
    await assert.rejects(s.workflow.requestExecution({ ...s.context, owner }, s.request, key), status(404));
  }
  await s.workflow.runExecution(s.context, first.id);
  assert.equal((await s.workflow.getExecution(s.context, first.id)).state, 'cancelled'); assert.equal(s.counts().inspections, 0);
});

test('new revisions supersede old plans without editing evidence, payloads, or review history', async t => {
  const s = await setup(t); await s.approve();
  await assert.rejects(s.workflow.saveEvidence(s.context, { ...s.evidence, notice: 'mutated' }), status(409));
  await assert.rejects(s.workflow.registerPlan(s.context, { ...s.payload, analysis: { ...s.payload.analysis, summary: 'Changed same version.' } }), status(409));
  const next = await s.workflow.registerPlan(s.context, { ...s.payload, planId: 'next-version', version: 2 }, s.payload.planId);
  assert.equal(next.review.status, 'not_requested');
  const old = await s.workflow.getPlan(s.context, s.payload.planId);
  assert.equal(old.lifecycle, 'superseded'); assert.equal(old.review.status, 'approved'); assert.deepEqual(old.payload, s.payload);
  await assert.rejects(s.workflow.requestExecution(s.context, s.request, randomUUID()), status(409));
});

test('stale evidence, expired plans and changed targets cannot enqueue an inspection', async t => {
  const s = await setup(t); await s.approve();
  assert.equal(s.payload.target.provider, 'gcp');
  if (s.payload.target.provider === 'gcp') s.changeTarget({ ...s.payload.target, revision: 'changed-revision' });
  await assert.rejects(s.workflow.requestExecution(s.context, s.request, randomUUID()), status(409));
  assert.equal((await s.workflow.getPlan(s.context, s.payload.planId)).lifecycle, 'prepared');
  s.advance(600_000);
  await assert.rejects(s.workflow.requestExecution(s.context, s.request, randomUUID()), status(410));
  assert.equal(s.counts().inspections, 0);
});

test('worker revalidates a target after queueing; cancellation does not roll back or reuse a consumed plan', async t => {
  const s = await setup(t); await s.approve();
  const run = await s.workflow.requestExecution(s.context, s.request, randomUUID());
  if (s.payload.target.provider === 'gcp') s.changeTarget({ ...s.payload.target, revision: 'changed-after-queue' });
  await s.workflow.runExecution(s.context, run.id);
  assert.equal((await s.workflow.getExecution(s.context, run.id)).state, 'failed'); assert.equal(s.counts().inspections, 0);
  await assert.rejects(s.workflow.cancelQueued(s.context, run.id, randomUUID()), status(409));
});

test('ambiguous provider failure remains unknown and handoff cannot declare success', async t => {
  const s = await setup(t); await s.approve();
  s.setInspect(async () => { throw new Error('Private SDK credential and raw log must never be stored'); });
  const run = await s.workflow.requestExecution(s.context, s.request, randomUUID()); await s.workflow.runExecution(s.context, run.id);
  const result = await s.workflow.handoff(s.context, run.id, { note: 'Investigate manually.' }, randomUUID());
  assert.equal(result.state, 'unknown'); assert.ok(!JSON.stringify(result).includes('Private SDK'));
  await s.workflow.runExecution(s.context, run.id); assert.equal(s.counts().inspections, 1);
});

test('lost worker is reconciled through reopened storage, never reclaimed or promoted by a late result', async t => {
  const s = await setup(t); await s.approve();
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  s.setInspect(async () => { entered(); await blocked; return { ...s.evidence, id: 'late-evidence', observedAt: new Date(s.now()).toISOString() }; });
  const run = await s.workflow.requestExecution(s.context, s.request, randomUUID());
  const working = s.workflow.runExecution(s.context, run.id); await started;
  const restarted = new CloudWorkflow(s.open(), [s.adapter], s.now); s.advance(121_000);
  await restarted.expireClaim(s.context, run.id); await restarted.runExecution(s.context, run.id);
  release(); await working;
  assert.equal((await restarted.getExecution(s.context, run.id)).state, 'unknown'); assert.equal(s.counts().inspections, 1);
  await assert.rejects(restarted.getEvidence(s.context, 'late-evidence'), status(404));
});

test('mobile rejects stored AWS records including cached decisions, execution and handoff', async t => {
  const s = await setup(t);
  const target = { provider: 'aws', accountId: '123456789012', partition: 'aws', scope: { kind: 'regional', region: 'us-east-1' }, service: 'dynamodb', resourceId: 'table-demo', nativeId: 'table-demo' } as const;
  const evidence = { ...s.evidence, id: 'aws-evidence', target };
  const payload = planPayloadSchema.parse({ ...s.payload, planId: 'aws-plan', target, evidence: { ...s.payload.evidence, snapshotId: evidence.id, digest: cloudDigest(evidence) }, action: { id: 'aws.dynamodb.recovery.inspect.v1', version: 1, effect: 'read', inputs: {}, completionCriteria: ['Read the fixed recovery settings.'] } });
  const workflow = new CloudWorkflow(s.store, [{ ...s.adapter, actionId: payload.action.id, currentTarget: async () => target }], s.now);
  await workflow.saveEvidence(s.context, evidence); const plan = await workflow.registerPlan(s.context, payload);
  const version = { expectedVersion: 1, expectedDigest: plan.digest }, mobile = { ...s.context, channel: 'mobile' } as const;
  await workflow.requestReview(s.context, payload.planId, version, randomUUID()); const key = randomUUID();
  const decision = { ...version, decision: 'approve', note: '' };
  await workflow.decide(s.context, payload.planId, decision, key);
  await assert.rejects(workflow.decide(mobile, payload.planId, decision, key), status(403));
  const input = { ...version, planId: payload.planId }, executionKey = randomUUID();
  const run = await workflow.requestExecution(s.context, input, executionKey);
  await assert.rejects(workflow.requestExecution(mobile, input, executionKey), status(403));
  await assert.rejects(workflow.getExecution(mobile, run.id), status(403));
  await assert.rejects(workflow.handoff(mobile, run.id, { note: 'No mobile AWS.' }, randomUUID()), status(403));
});

test('transaction rollback leaves no partial record and live plans cannot use synthetic adapters', async t => {
  const s = await setup(t);
  await assert.rejects(s.store.transact(async tx => { await tx.get('rollback-test'); tx.put('rollback-test', { changed: true }); throw new Error('Abort'); }));
  assert.equal(await s.store.transact(tx => tx.get('rollback-test')), undefined);
  const liveEvidence = { ...s.evidence, id: 'live-evidence', dataMode: 'live' as const }; await s.workflow.saveEvidence(s.context, liveEvidence);
  const live = { ...s.payload, planId: 'live-plan', dataMode: 'live', evidence: { ...s.payload.evidence, snapshotId: liveEvidence.id, digest: cloudDigest(liveEvidence) } };
  await assert.rejects(s.workflow.registerPlan(s.context, live), status(503)); assert.equal(s.counts().inspections, 0);
});
