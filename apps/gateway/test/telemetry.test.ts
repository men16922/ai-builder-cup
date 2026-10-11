import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CloudBinding, VerifiedCloudContext } from '@contracts/core/operations';
import { telemetryWindow, telemetryOperations, cloudRunTelemetrySchema } from '@contracts/gcp/telemetry';
import { createSyntheticTelemetryTransport, createCloudRunTelemetryTransport, logFields, metricFields } from '../src/cloud-run/telemetry-transport';
import { collectTelemetry } from '../src/cloud-run/telemetry-collector';
import { CloudRunError, principalKey, type CloudRunTransport } from '../src/cloud-run/transport';
import { CloudRunCollector, cloudRunEvidence } from '../src/cloud-run/collector';
import { syntheticTelemetry } from '../../../tests/support/gcp-telemetry';

const now = () => Date.parse('2026-10-10T01:00:30.000Z');
const binding: CloudBinding = { owner: { kind: 'personal', userId: 'synthetic-user' }, workspaceId: 'synthetic-workspace', environmentId: 'synthetic-env', target: {
  provider: 'gcp', projectId: 'example-mobileops-demo', location: 'asia-northeast3', resourceId: 'checkout', resourceName: 'projects/example-mobileops-demo/locations/asia-northeast3/services/checkout', resourceUid: 'synthetic-uid', revision: 'checkout-00001',
} };
const context: VerifiedCloudContext = { actorId: 'synthetic-user', owner: binding.owner, workspaceId: binding.workspaceId, channel: 'web', roles: ['operator'] };
const credential = { principal: 'synthetic-sa', sessionId: 'synthetic-session', accessToken: 'synthetic-access-token' };
const expectedIdentity = principalKey(credential), window = telemetryWindow(now());
const fail = (code: string) => (error: unknown) => error instanceof CloudRunError && error.code === code;
function fixture() {
  const calls: { url: URL; init?: RequestInit }[] = []; let identity = credential;
  let respond: (operation: typeof telemetryOperations[number]) => Response | Promise<Response> = operation => Response.json(syntheticTelemetry(binding, operation, window));
  const options = { binding, ...credential, credentials: { async current() { return identity; } } };
  const transport = createSyntheticTelemetryTransport(options, async (url, init) => {
    const parsed = new URL(String(url)); calls.push({ url: parsed, init });
    return respond(parsed.hostname.startsWith('logging') ? 'logs' : parsed.searchParams.get('filter')!.includes('request_count') ? 'requests' : 'latency');
  });
  return { options, transport, calls, changeIdentity() { identity = { ...credential, principal: 'different' }; }, setRespond(next: typeof respond) { respond = next; },
    collect(signal = new AbortController().signal) { return collectTelemetry({ binding, transport, expectedIdentity, window, now, signal }); } };
}
test('bounded telemetry uses three fixed read queries, projects only safe fields and retains metric meaning', async () => {
  const s = fixture(), result = await s.collect();
  assert.equal(result.logs.status, 'collected'); if (result.logs.status !== 'collected') assert.fail();
  assert.equal(result.logs.value[0].latencyMs, 1250); assert.equal(result.logs.truncated, true);
  assert.equal(result.requests.status, 'collected'); assert.equal(result.latency.status, 'collected');
  assert.doesNotMatch(JSON.stringify(result), /NEVER_EXPORT|Ignore all|textPayload|requestUrl|remoteIp|access-token/);
  assert.deepEqual(window, { start: '2026-10-10T00:43:00.000Z', end: '2026-10-10T00:58:00.000Z' });
  assert.equal(s.calls.length, 3);
  for (const { url, init } of s.calls) {
    assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit'); assert.equal(url.searchParams.has('pageToken'), false);
    if (url.hostname === 'logging.googleapis.com') {
      assert.equal(url.pathname, '/v2/entries:list'); assert.equal(url.searchParams.get('fields'), logFields); assert.equal(init?.method, 'POST');
      const body = JSON.parse(String(init?.body)); assert.equal(body.pageSize, 50); assert.equal(body.orderBy, 'timestamp desc'); assert.deepEqual(body.resourceNames, ['projects/example-mobileops-demo']);
      assert.match(body.filter, /revision_name="checkout-00001"/); assert.match(body.filter, /timestamp</); assert.equal(body.pageToken, undefined);
    } else {
      assert.equal(url.hostname, 'monitoring.googleapis.com'); assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined);
      assert.equal(url.searchParams.get('fields'), metricFields); assert.equal(url.searchParams.get('pageSize'), '120'); assert.equal(url.searchParams.get('interval.endTime'), window.end);
      assert.match(url.searchParams.get('filter')!, /project_id="example-mobileops-demo"/); assert.equal(url.searchParams.get('aggregation.alignmentPeriod'), '60s');
    }
  }
  assert.throws(() => createCloudRunTelemetryTransport({ ...s.options, enabled: true }), fail('disabled'));
});
test('empty, denied, partial pages and partial upstream errors remain distinct and never cause retries', async () => {
  const s = fixture(); s.setRespond(operation => operation === 'logs' ? new Response('', { status: 403 }) : operation === 'requests' ? Response.json({}) : Response.json({ nextPageToken: 'never-export' }));
  const result = await s.collect(); assert.equal(result.logs.status, 'denied'); assert.equal(result.requests.status, 'no_data');
  assert.equal(result.latency.status, 'collected'); if (result.latency.status !== 'collected') assert.fail(); assert.equal(result.latency.truncated, true); assert.deepEqual(result.latency.value, []);
  s.setRespond(() => Response.json({ executionErrors: [{ message: 'NEVER_EXPORT' }] }));
  assert.equal((await s.collect()).requests.status, 'unavailable'); assert.equal(s.calls.length, 6);
});
test('wrong project, revision, source and time window discard the entire observation', async t => {
  for (const field of ['project', 'revision', 'stream', 'time'] as const) await t.test(field, async () => {
    const s = fixture(); s.setRespond(operation => {
      const value = syntheticTelemetry(binding, operation, window);
      if (value.entries) { const entry = value.entries[0];
        if (field === 'project') entry.resource.labels.project_id = 'other-project';
        if (field === 'revision') entry.resource.labels.revision_name = 'other-revision';
        if (field === 'stream') entry.logName = 'projects/example-mobileops-demo/logs/other';
        if (field === 'time') entry.timestamp = window.end;
      }
      return Response.json(value);
    }); await assert.rejects(s.collect(), fail('scope_changed'));
  });
});
test('malformed, overflowing and duplicate metric samples stay unavailable rather than producing a false aggregate', async () => {
  const s = fixture();
  for (const change of ['duplicate', 'overflow', 'valueType', 'negative']) {
    s.setRespond(operation => {
      const value = syntheticTelemetry(binding, operation, window);
      if (value.timeSeries && operation === 'requests') {
        if (change === 'duplicate') value.timeSeries.push(value.timeSeries[0]);
        if (change === 'overflow') value.timeSeries[0].points[0].value = { int64Value: '9999999999999999' };
        if (change === 'valueType') value.timeSeries[0].valueType = 'DOUBLE';
        if (change === 'negative') value.timeSeries[0].points[0].value = { int64Value: '-1' };
      }
      return Response.json(value);
    });
    const result = await s.collect(); assert.equal(result.requests.status, 'unavailable'); assert.equal(result.logs.status, 'collected');
  }
  const valid = await fixture().collect();
  if (valid.requests.status !== 'collected') assert.fail();
  valid.requests.value[0].points[0].end = '2026-10-10T02:00:00.000Z'; assert.equal(cloudRunTelemetrySchema.safeParse(valid).success, false);
});
test('identity changes, cancellation and oversized responses cannot leak credentials or raw errors', async () => {
  const s = fixture(); s.setRespond(() => { s.changeIdentity(); return Response.json({}); }); await assert.rejects(s.collect(), fail('identity_changed'));
  const oversized = fixture(); oversized.setRespond(() => new Response('x'.repeat(131073))); assert.equal((await oversized.collect()).logs.status, 'unavailable');
  const aborted = fixture(), controller = new AbortController(); controller.abort(); await assert.rejects(aborted.collect(controller.signal)); assert.equal(aborted.calls.length, 0);
});
test('metadata plan execution keeps its original three reads even when observations enable telemetry', async () => {
  const s = fixture(), target = binding.target; if (target.provider !== 'gcp') assert.fail(); let metadataReads = 0;
  const transport: CloudRunTransport = { dataMode: 'synthetic', async identity() { return expectedIdentity; }, async read(operation) { metadataReads++;
    return operation === 'service' ? { name: target.resourceName, uid: target.resourceUid } : { name: `${target.resourceName}/revisions/${target.revision}`, uid: 'synthetic-revision', service: target.resourceName };
  } };
  const collector = new CloudRunCollector({ binding, transport, telemetry: s.transport, expectedIdentity, now });
  const snapshot = await collector.collect(context); assert.equal(s.calls.length, 3); assert.equal(snapshot.serviceAssessment, 'unknown');
  const evidence = cloudRunEvidence(snapshot); assert.equal(evidence.observations.find(item => item.id === 'gcp-run-requests')?.quality, 'partial'); assert.doesNotMatch(JSON.stringify(evidence), /NEVER_EXPORT/);
  const metadata = await collector.collect(context, { metadataOnly: true }); assert.equal(metadata.telemetry, undefined); assert.equal(s.calls.length, 3); assert.equal(metadataReads, 6);
});
