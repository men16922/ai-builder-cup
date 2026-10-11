import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CloudBinding } from '@contracts/core/operations';
import { gcpWorkflowViewSchema } from '@contracts/gcp/workflow';
import { inspectionReceipt } from '@contracts/gcp/inspection';
import { CloudRunCollector } from '../src/cloud-run/collector';
import { CloudRunError } from '../src/cloud-run/transport';
import { createCloudRunAdapters, createCloudRunInspectionAdapter } from '../src/cloud-run/inspection-adapter';
import { GcpObservations, type GcpRegistration } from '../src/workflow/observations';
import { GcpAnalyses } from '../src/workflow/analyses';
import { GcpOperations } from '../src/workflow/operations';
import { GcpWebAccess } from '../src/auth/web-access';
import { SqliteCloudStore } from '../src/store/sqlite-store';
import { CloudWorkflow } from '../src/workflow/workflow';
import { syntheticTelemetry } from '../../../tests/support/gcp-telemetry';

type Scenario = 'complete' | 'empty' | 'partial' | 'logs-denied' | 'requests-denied' | 'latency-denied' | 'latency-unavailable' | 'revision-denied' | 'changed' | 'revoke';
const code = (expected: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === expected;
async function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'gcp-inspection-')), store = new SqliteCloudStore(join(root, 'test.sqlite'));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  let clock = Date.parse('2026-10-10T01:00:30.000Z'), scenario: Scenario = 'complete', revoked = false, reads = 0, queries = 0, models = 0;
  const now = () => clock, access = new GcpWebAccess({ async verify(token) { if (revoked || token !== 'synthetic-user') throw Error(); return { actorId: token, expiresAt: clock + 3600000 }; } }, store, now);
  const scope = { edition: 'personal' as const, workspaceId: 'synthetic-workspace', label: 'Synthetic inspection' };
  const session = await access.authenticate('Bearer synthetic-user', scope), context = session.context;
  const target = { provider: 'gcp' as const, projectId: 'example-mobileops-demo', location: 'asia-northeast3', resourceId: 'checkout', resourceName: 'projects/example-mobileops-demo/locations/asia-northeast3/services/checkout', resourceUid: 'synthetic-uid', revision: 'checkout-00001' };
  const binding: CloudBinding = { owner: context.owner, workspaceId: scope.workspaceId, environmentId: 'synthetic-env', target };
  const collector = new CloudRunCollector({ binding, expectedIdentity: 'synthetic-principal', now, transport: {
    dataMode: 'synthetic', async identity() { return 'synthetic-principal'; }, async read(operation) {
      reads++; const metadata = { generation: '1', observedGeneration: '1', updateTime: '2026-10-10T00:00:00.000Z', reconciling: false };
      if (operation === 'revision') {
        if (scenario === 'revision-denied') throw new CloudRunError('access_denied');
        return { ...metadata, name: `${target.resourceName}/revisions/${target.revision}`, uid: 'synthetic-revision', service: target.resourceName, conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }] };
      }
      return { ...metadata, name: target.resourceName, uid: target.resourceUid, etag: scenario === 'changed' ? `version-${reads}` : 'stable', terminalCondition: { state: 'CONDITION_SUCCEEDED' }, latestCreatedRevision: target.revision, latestReadyRevision: target.revision, trafficStatuses: [{ revision: target.revision, percent: 100 }] };
    },
  }, telemetry: { dataMode: 'synthetic', async identity() { return 'synthetic-principal'; }, async read(operation, window) {
    queries++;
    if (scenario === 'revoke') revoked = true;
    if (scenario === `${operation}-denied`) throw new CloudRunError('access_denied');
    if (operation === 'latency' && scenario === 'latency-unavailable') throw new CloudRunError('unavailable');
    if (scenario === 'empty') return {};
    const value = syntheticTelemetry(binding, operation, window);
    if (scenario !== 'partial') delete value.nextPageToken;
    return value;
  } } });
  const registration: GcpRegistration = { id: 'checkout', label: 'Synthetic checkout', binding, dataMode: 'synthetic', telemetryEnabled: true, collector };
  const authorize = async () => { await access.current(session); return context; };
  const workflow = new CloudWorkflow(store, createCloudRunAdapters([registration], 'synthetic', authorize), now);
  const observations = new GcpObservations(store, access, [registration], now);
  const model = { engine: 'synthetic-fixture' as const, modelId: 'synthetic-inspection', configurationId: 'synthetic-v1', async analyze() { models++; return { summary: 'Synthetic bounded inspection.', findings: [{ statement: 'The sample has request evidence.', evidenceIds: ['gcp-run-requests'], kind: 'observation' }], missingInformation: ['Request probes and log payloads are absent.'], serviceAssessment: 'unknown' }; } };
  const analyses = new GcpAnalyses(store, access, observations, workflow, model, now), operations = new GcpOperations(store, access, analyses, [registration], now);
  const observation = await observations.collect(session, { resourceId: registration.id }, randomUUID());
  const analysis = await analyses.prepare(session, { observationId: observation.snapshot.id, language: 'en' }, randomUUID());
  const expected = { expectedVersion: analysis.plan.version, expectedDigest: analysis.planDigest }, input = { ...expected, planId: analysis.id };
  const approve = async () => { await operations.review(session, analysis.id, expected, randomUUID()); await operations.decide(session, analysis.id, { ...expected, decision: 'approve', note: '' }, randomUUID()); };
  return { now, advance() { clock += 60000; }, analysis, analyses, operations, workflow, session, context, registration, authorize, input, approve,
    counts: () => ({ reads, queries, models }), scenario(value: Scenario) { scenario = value; }, restoreAccess() { revoked = false; } };
}

test('fixed full inspection distinguishes successful bounded queries from evidence coverage and health', async t => {
  for (const scenario of ['complete', 'empty', 'partial'] as const) await t.test(scenario, async t => {
    const s = await setup(t);
    assert.equal(s.analysis.plan.action.id, 'gcp.cloudrun.inspect.v1'); assert.deepEqual(s.analysis.plan.action.inputs, { windowMinutes: 15, maxLogEntries: 50 });
    assert.equal(s.analysis.plan.evidence.sourceIds.length, 8); assert.deepEqual(s.counts(), { reads: 3, queries: 3, models: 1 });
    await assert.rejects(s.operations.execute(s.session, s.analysis.id, s.input, randomUUID()));
    await s.approve(); assert.deepEqual(s.counts(), { reads: 3, queries: 3, models: 1 });
    s.scenario(scenario); s.advance(); const key = randomUUID(), result = await s.operations.execute(s.session, s.analysis.id, s.input, key);
    assert.equal(result.execution?.state, 'succeeded'); assert.equal(result.execution.result?.coverage, 'partial'); assert.equal(result.execution.result?.serviceAssessment, 'unknown');
    assert.ok(result.evidence); const receipt = inspectionReceipt(result.evidence); assert.ok(receipt);
    assert.equal(receipt.window.end, '2026-10-10T00:59:00.000Z');
    assert.equal(receipt.outcomes[0].status, scenario === 'empty' ? 'no_data' : 'collected'); assert.equal(receipt.outcomes[0].truncated, scenario === 'empty' ? null : scenario === 'partial');
    for (const id of ['gcp-run-logs', 'gcp-run-requests', 'gcp-run-latency']) assert.notEqual(result.evidence.observations.find(item => item.id === id)?.quality, 'complete');
    assert.equal((await s.operations.execute(s.session, s.analysis.id, s.input, key)).execution?.id, result.execution.id);
    const handoff = await s.operations.handoff(s.session, result.execution.id, { note: 'Synthetic follow-up: application health remains unknown.' }, randomUUID());
    assert.deepEqual(handoff.execution?.result, result.execution.result); assert.equal(handoff.execution?.state, 'succeeded');
    assert.deepEqual(s.counts(), { reads: 6, queries: 6, models: 1 });
    assert.equal(gcpWorkflowViewSchema.safeParse({ ...result, execution: { ...result.execution, actionId: 'gcp.cloudrun.metadata.inspect.v1' } }).success, false);
    assert.doesNotMatch(JSON.stringify(result), /NEVER_EXPORT|Ignore all|accessToken|textPayload/);
  });
});
test('each query and metadata consistency must complete independently; one successful Monitoring query cannot mask the other', async t => {
  for (const scenario of ['logs-denied', 'requests-denied', 'latency-denied', 'latency-unavailable', 'revision-denied', 'changed'] as const) await t.test(scenario, async t => {
    const s = await setup(t); await s.approve(); s.scenario(scenario);
    const result = await s.operations.execute(s.session, s.analysis.id, s.input, randomUUID());
    assert.equal(result.execution?.state, 'failed'); assert.equal(result.execution.result?.serviceAssessment, 'unknown'); assert.ok(result.evidence);
    const receipt = inspectionReceipt(result.evidence); assert.ok(receipt);
    if (scenario === 'revision-denied') { assert.ok(receipt.outcomes.every(item => item.status === 'skipped')); assert.equal(s.counts().queries, 3); }
    else if (scenario !== 'changed') { const id = `gcp-run-${scenario.split('-')[0]}`; assert.equal(receipt.outcomes.find(item => item.id === id)?.status, scenario.endsWith('denied') ? 'denied' : 'unavailable'); }
    assert.equal(result.evidence.observations.find(item => item.id === 'gcp-run-query-completion')?.quality, scenario === 'changed' ? 'complete' : 'partial');
  });
});
test('full inspection rejects disabled registration, changed binding, data mode and widened inputs without reads', async t => {
  const s = await setup(t), adapter = createCloudRunInspectionAdapter([s.registration], 'synthetic', s.authorize), plan = s.analysis.plan;
  if (plan.action.id !== 'gcp.cloudrun.inspect.v1') assert.fail('Expected the full inspection action.');
  for (const changed of [
    { ...plan, dataMode: 'live' as const }, { ...plan, environmentId: 'other' },
    { ...plan, action: { ...plan.action, inputs: { windowMinutes: 60 as const, maxLogEntries: 50 } } },
    { ...plan, action: { ...plan.action, inputs: { windowMinutes: 15 as const, maxLogEntries: 100 } } },
  ]) await assert.rejects(adapter.currentTarget(changed), code('target_changed'));
  const disabled = createCloudRunInspectionAdapter([{ ...s.registration, telemetryEnabled: false }], 'synthetic', s.authorize);
  await assert.rejects(disabled.inspect(plan), code('target_changed'));
  assert.deepEqual(s.counts(), { reads: 3, queries: 3, models: 1 });
  // Existing metadata plans remain three GETs, even on a telemetry-enabled registration.
  const metadata = createCloudRunAdapters([s.registration], 'synthetic', s.authorize)[0];
  const evidence = await metadata.inspect({ ...plan, action: { ...plan.action, id: 'gcp.cloudrun.metadata.inspect.v1', inputs: {} } });
  assert.equal(evidence.observations.length, 5); assert.deepEqual(s.counts(), { reads: 6, queries: 3, models: 1 });
});
test('authority revoked during telemetry collection leaves unknown with no result, and retry never recollects', async t => {
  const s = await setup(t); await s.approve(); s.scenario('revoke'); const key = randomUUID();
  await assert.rejects(s.operations.execute(s.session, s.analysis.id, s.input, key));
  s.restoreAccess(); const result = await s.operations.get(s.session, s.analysis.id);
  assert.equal(result.execution?.state, 'unknown'); assert.equal(result.evidence, undefined); assert.equal(result.execution.result, undefined);
  const before = s.counts(); assert.equal((await s.operations.execute(s.session, s.analysis.id, s.input, key)).execution?.state, 'unknown'); assert.deepEqual(s.counts(), before);
});
