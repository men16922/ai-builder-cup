import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { prepareEvaluation, blankRuns } from './modules/gcp/evaluation/pack';
import { assessRecordedRun, reviewTemplate } from './modules/gcp/evaluation/review';
import { injectionMarker } from './modules/gcp/evaluation/scenarios';
import { cloudRunEvidence } from './modules/gcp/cloud-run-collector';
import { createSyntheticGeminiProtocol } from './modules/gcp/gemini';
import { cloudDigest } from './cloud-integrity';

const correct = { summary: 'Both metadata reads report ready. Application health remains unknown.', findings: [{ statement: 'Service and pinned revision readiness succeeded; this does not establish request success.', evidenceIds: ['gcp-run-service', 'gcp-run-revision'], kind: 'observation' }], missingInformation: ['Logs, metrics, request probes and change history were not collected.'], serviceAssessment: 'unknown' };
const wrong = { ...correct, summary: 'The service is healthy and every request succeeded.', findings: [{ statement: 'All requests succeeded.', evidenceIds: ['gcp-run-service'], kind: 'observation' }] };
async function recorded(output: unknown = correct) {
  const pack = await prepareEvaluation(), template = blankRuns(pack).find(item => item.caseId === 'metadata-ready' && item.language === 'en')!;
  const run = { ...template, provenance: 'synthetic-control', modelId: 'synthetic-control', location: 'synthetic-local', configurationDigest: cloudDigest('synthetic-control'), outcome: 'returned', startedAt: '2026-10-10T02:00:00.000Z', finishedAt: '2026-10-10T02:00:01.000Z', rawResponse: JSON.stringify(output) };
  return { pack, run };
}
function simulatedReview(pack: Awaited<ReturnType<typeof prepareEvaluation>>, run: unknown) {
  const template = reviewTemplate(pack, run), scenario = pack.scenarios.find(item => item.id === 'metadata-ready')!;
  return { ...template, reviewer: 'synthetic-review-control', reviewedAt: '2026-10-10T03:00:00.000Z', criteria: template.criteria.map(item => ({ ...item, verdict: 'pass', note: 'Synthetic reviewer control: compare this statement with the cited metadata and explicit missing-signal record.', sourceIds: scenario.criteria.find(r => r.id === item.id)!.sourceIds })) };
}

test('evaluation preparation is reproducible, offline, source-linked and keeps reviewer expectations outside 16 model requests', async () => {
  const fetcher = globalThis.fetch; globalThis.fetch = async () => { throw Error('Network forbidden'); };
  try {
    const first = await prepareEvaluation(), second = await prepareEvaluation(); assert.deepEqual(first, second);
    assert.equal(first.scenarios.length, 8); assert.equal(first.requests.length, 16);
    for (const scenario of first.scenarios) {
      assert.deepEqual(cloudRunEvidence(scenario.snapshot), scenario.evidence); assert.equal(scenario.evidence.dataMode, 'synthetic');
      const sources = new Set(scenario.evidence.observations.map(item => item.id));
      for (const criterion of scenario.criteria) assert.ok(criterion.sourceIds.every(id => sources.has(id)));
    }
    for (const request of first.requests) {
      const input = JSON.parse(request.body.contents[0].parts[0].text);
      assert.deepEqual(Object.keys(input), ['language', 'snapshotId', 'observedAt', 'observations']);
      assert.equal(input.language, request.language); assert.equal(request.digest, cloudDigest(request.body));
      assert.equal(assessRecordedRun(first, blankRuns(first).find(item => item.caseId === request.caseId && item.language === request.language)).semantics, 'not_run');
    }
  } finally { globalThis.fetch = fetcher; }
});

test('empty, denied and explicit zero samples stay distinct; recovery control changes observations without claiming service health', async () => {
  const { scenarios } = await prepareEvaluation(), get = (id: string) => scenarios.find(item => item.id === id)!.snapshot;
  const empty = get('empty-samples').telemetry!, denied = get('denied-signals').telemetry!, before = get('recovery-before'), after = get('recovery-after');
  assert.equal(empty.requests.status, 'no_data'); assert.equal(empty.logs.status, 'no_data'); assert.equal(empty.latency.status, 'no_data');
  assert.equal(denied.logs.status, 'denied'); assert.equal(denied.latency.status, 'denied'); assert.equal(denied.requests.status, 'no_data');
  assert.deepEqual(before.binding, after.binding); assert.ok(Date.parse(before.observedAt) < Date.parse(after.observedAt));
  assert.ok(before.service.status === 'collected' && after.service.status === 'collected');
  assert.equal(before.service.value.readiness, 'failed'); assert.equal(after.service.value.readiness, 'succeeded');
  const requests = after.telemetry!.requests; assert.ok(requests.status === 'collected');
  assert.equal(requests.value.find(series => series.responseCode === '503')!.points[0].count, 0);
  assert.equal(after.serviceAssessment, 'unknown'); assert.equal(before.serviceAssessment, 'unknown');
  assert.ok(Date.parse(before.telemetry!.window.end) < Date.parse(after.telemetry!.window.start));
});

test('sequential change and ready metadata with error signals provide distinct conflicting-evidence controls', async () => {
  const pack = await prepareEvaluation(), changed = pack.scenarios.find(s => s.id === 'changed-during-read')!, ready = pack.scenarios.find(s => s.id === 'ready-with-errors')!;
  assert.equal(changed.snapshot.consistency, 'changed'); assert.ok(changed.snapshot.service.status === 'collected' && changed.snapshot.recheck.status === 'collected');
  assert.equal(changed.snapshot.service.value.readiness, 'failed'); assert.equal(changed.snapshot.recheck.value.readiness, 'succeeded');
  assert.ok(changed.evidence.observations.filter(item => ['gcp-run-service', 'gcp-run-recheck', 'gcp-run-consistency'].includes(item.id)).every(item => item.quality === 'partial'));
  assert.ok(ready.snapshot.service.status === 'collected' && ready.snapshot.telemetry!.requests.status === 'collected');
  assert.equal(ready.snapshot.service.value.readiness, 'succeeded'); assert.equal(ready.snapshot.telemetry!.requests.value[1].points[0].count, 12);
});

test('log injection canary is stripped before evidence and actual protocol body; clean and injected projected observations match', async () => {
  const pack = await prepareEvaluation(), dirty = pack.scenarios.find(s => s.id === 'log-injection')!, clean = pack.scenarios.find(s => s.id === 'ready-with-errors')!;
  assert.ok(JSON.stringify(dirty.raw).includes(injectionMarker));
  assert.doesNotMatch(JSON.stringify(dirty.evidence), /SYNTHETIC_INJECTION_CANARY|textPayload|jsonPayload|remoteIp|requestUrl/);
  assert.deepEqual(dirty.evidence.observations, clean.evidence.observations);
  const request = pack.requests.find(item => item.caseId === dirty.id && item.language === 'en')!; let body: unknown;
  const model = createSyntheticGeminiProtocol({ projectId: 'example-mobileops-demo', location: 'global', modelId: 'gemini-2.5-flash', principal: 'synthetic-evaluator', sessionId: 'synthetic-session', credentials: { async current() { return { principal: 'synthetic-evaluator', sessionId: 'synthetic-session', accessToken: 'synthetic-protocol-only' }; } } }, async (_url, init) => {
    body = JSON.parse(String(init!.body)); return Response.json({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(correct) }] } }] });
  });
  await model.analyze(dirty.evidence, 'en', new AbortController().signal); assert.deepEqual(body, request.body);
  assert.doesNotMatch(JSON.stringify(body), /SYNTHETIC_INJECTION_CANARY|synthetic-protocol-only/);
});

test('semantically false claim with existing citation passes only contract, stays unreviewed, and an explicit human failure remains failure', async () => {
  const { pack, run } = await recorded(wrong), automatic = assessRecordedRun(pack, run);
  assert.equal(automatic.contract, 'passed'); assert.equal(automatic.semantics, 'unreviewed'); assert.equal(automatic.liveInvocationVerified, false);
  const review = simulatedReview(pack, run); review.criteria[0] = { ...review.criteria[0], verdict: 'fail', note: 'The summary asserts healthy, but gcp-run-missing-signals lists uncollected request signals. Readiness does not prove success.' };
  const assessed = assessRecordedRun(pack, run, review); assert.equal(assessed.semantics, 'human_fail'); assert.equal(assessed.modelLatencyMs, 1000); assert.equal(assessed.appTaskTimeMs, null);
});

test('limited interpretation can receive an explicit synthetic review without claiming live accuracy; unknown and unreviewed stay separate', async () => {
  const { pack, run } = await recorded(), review = simulatedReview(pack, run);
  const assessed = assessRecordedRun(pack, run, review); assert.equal(assessed.contract, 'passed'); assert.equal(assessed.semantics, 'human_pass'); assert.equal(assessed.provenance, 'synthetic-control'); assert.equal(assessed.liveInvocationVerified, false);
  review.criteria[0].verdict = 'unknown'; assert.equal(assessRecordedRun(pack, run, review).semantics, 'unknown');
  review.criteria[0].verdict = 'unreviewed'; assert.equal(assessRecordedRun(pack, run, review).semantics, 'unreviewed');
});

test('malformed output, invented or duplicate citation, healthy assessment and action fields fail the shared product contract', async () => {
  const { pack, run } = await recorded();
  for (const rawResponse of ['not json', JSON.stringify({ ...correct, serviceAssessment: 'healthy' }), JSON.stringify({ ...correct, command: 'execute' })]) assert.equal(assessRecordedRun(pack, { ...run, rawResponse }).contract, 'model_response_invalid');
  for (const evidenceIds of [['gcp-run-invented'], ['gcp-run-service', 'gcp-run-service']]) {
    const rawResponse = JSON.stringify({ ...correct, findings: [{ ...correct.findings[0], evidenceIds }] });
    assert.equal(assessRecordedRun(pack, { ...run, rawResponse }).contract, 'model_citation_invalid');
    assert.throws(() => assessRecordedRun(pack, { ...run, rawResponse }, simulatedReview(pack, { ...run, rawResponse })));
  }
});

test('changed output, prompt, language, case, pack or incomplete review cannot reuse a previous judgment', async () => {
  const { pack, run } = await recorded(), review = simulatedReview(pack, run);
  for (const mutation of [{ responseDigest: cloudDigest('other') }, { caseDigest: cloudDigest('other') }, { requestDigest: cloudDigest('other') }, { language: 'ko' }, { reviewedAt: '2026-10-10T01:00:00.000Z' }, { criteria: review.criteria.slice(1) }, { criteria: review.criteria.map(() => review.criteria[0]) }, { criteria: review.criteria.map(item => ({ ...item, note: '' })) }, { criteria: review.criteria.map(item => ({ ...item, sourceIds: ['gcp-run-invented'] })) }]) assert.throws(() => assessRecordedRun(pack, run, { ...review, ...mutation }));
  assert.throws(() => assessRecordedRun(pack, { ...run, rawResponse: JSON.stringify(wrong) }, review));
  assert.throws(() => assessRecordedRun(pack, { ...run, requestDigest: cloudDigest('new prompt') }));
  const changed = structuredClone(pack); changed.scenarios[0].criteria[0].requirement = 'tampered'; assert.throws(() => assessRecordedRun(changed, run));
});

test('not run, failed and unknown records never become returned or reviewed and invalid timing/provenance is rejected', async () => {
  const { pack, run } = await recorded();
  for (const outcome of ['failed', 'unknown']) { const result = assessRecordedRun(pack, { ...run, outcome, rawResponse: null }); assert.equal(result.outcome, outcome); assert.equal(result.semantics, 'not_reviewable'); }
  assert.equal(assessRecordedRun(pack, blankRuns(pack)[0]).outcome, 'not_run');
  for (const mutation of [{ outcome: 'failed' }, { outcome: 'not_run' }, { modelId: null }, { finishedAt: '2026-10-09T00:00:00.000Z' }, { provenance: 'gemini-live-verified' }]) assert.throws(() => assessRecordedRun(pack, { ...run, ...mutation }));
});

test('offline CLI prepares private artifacts and imports a recorded response without remote calls or overwriting previous output', async t => {
  const root = mkdtempSync(join(tmpdir(), 'mobileops-evaluation-test-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const { pack, run } = await recorded(); const input = join(root, 'run.json'); writeFileSync(input, JSON.stringify(run), { mode: 0o600 });
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/prepare-gcp-evaluation.ts', '--record', input], { encoding: 'utf8', env: { ...process.env, MOBILEOPS_OFFLINE_TEST: '1' } });
  assert.equal(result.status, 0, result.stderr); const path = /Artifacts: (.+)/.exec(result.stdout)![1]; t.after(() => rmSync(path, { recursive: true, force: true }));
  const saved = JSON.parse(readFileSync(join(path, 'pack.json'), 'utf8')); assert.equal(saved.digest, pack.digest);
  assert.equal(statSync(join(path, 'record.json')).mode & 0o777, 0o600);
  const assessment = JSON.parse(readFileSync(join(path, 'assessment.json'), 'utf8')); assert.equal(assessment.semantics, 'unreviewed');
  assert.equal(JSON.parse(readFileSync(join(path, 'review-template.json'), 'utf8')).criteria[0].verdict, 'unreviewed');
  const disabled = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/prepare-gcp-evaluation.ts'], { encoding: 'utf8', env: { ...process.env, MOBILEOPS_OFFLINE_TEST: '0' } }); assert.notEqual(disabled.status, 0);
});
