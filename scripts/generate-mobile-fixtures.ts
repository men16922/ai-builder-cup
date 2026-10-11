// Explicit synthetic Android rehearsal assets. Never contacts a provider or modifies runtime data.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gcpPreview } from '../tests/support/sample-observation';
import { demoTelemetry } from '../tests/support/demo-telemetry';
import { cloudRunSnapshotSchema } from '@contracts/gcp/cloud-run';
import { summarizeTelemetry } from '@contracts/gcp/telemetry-summary';
import { gcpObservationSchema } from '@contracts/gcp/observations';
import { gcpWorkflowViewSchema } from '@contracts/gcp/workflow';
import { cloudRunEvidence } from '../apps/gateway/src/cloud-run/collector';
import { cloudRunInspectionEvidence } from '../apps/gateway/src/cloud-run/inspection-adapter';
import { cloudDigest } from '../apps/gateway/src/store/integrity';
import { identityActor } from '../apps/gateway/src/auth/organization-access';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const args = process.argv.slice(2), check = args.length === 1 && args[0] === '--check';
if (args.length && !check) throw Error('Use no arguments to generate, or --check to verify fixtures without writing.');
const output = new URL('../apps/android/core/src/main/resources/', import.meta.url);
const testOutput = new URL('../apps/android/core/src/test/resources/', import.meta.url);
if (!check) { mkdirSync(output, { recursive: true }); mkdirSync(testOutput, { recursive: true }); }
const writeAsset = (file: URL, content: string) => {
  if (check) { if (readFileSync(file, 'utf8') !== content) throw Error(`Android fixture differs from the current server/web contract: ${file.pathname.split('/').at(-1)}`); }
  else writeFileSync(file, content);
};
const projectionVectors: unknown[] = [];
writeAsset(new URL('firebase-actors.json', testOutput), JSON.stringify([
  { projectId: 'example-mobileops-demo', tenantId: null, uid: 'synthetic-user' },
  { projectId: 'example-mobileops-demo', tenantId: 'tenant-a', uid: 'synthetic-user' },
  { projectId: 'example-another-demo', tenantId: null, uid: 'synthetic-user' },
  { projectId: 'example-mobileops-demo', tenantId: 'tenant-a', uid: 'user/한글"\\\n' },
].map(value => ({ ...value, actorId: identityActor(`https://securetoken.google.com/${value.projectId}`, value.uid, value.tenantId ?? '') })), null, 2) + '\n');
for (const edition of ['personal', 'organization'] as const) {
  const owner = edition === 'personal' ? { kind: edition, userId: 'synthetic-operator' } : { kind: edition, organizationId: 'synthetic-example' };
  const scope = { actorId: 'synthetic-operator', owner, workspaceId: 'synthetic-preview' };
  const bundles = ['signals', 'empty', 'denied'].map((scenario, index) => {
    const snapshot = gcpPreview(); snapshot.id = uuid(10 + index); snapshot.binding.owner = owner;
    if (snapshot.service.status !== 'collected') throw Error();
    snapshot.service.value.readiness = 'succeeded'; snapshot.service.value.observedGeneration = '3'; snapshot.service.value.missingFields = [];
    snapshot.recheck = structuredClone(snapshot.service);
    snapshot.revision = { status: 'collected', source: 'run.googleapis.com/v2/projects.locations.services.revisions.get', observedAt: snapshot.observedAt,
      resourceName: `${snapshot.binding.target.provider === 'gcp' ? snapshot.binding.target.resourceName : ''}/revisions/checkout-demo-00003`,
      value: { name: `${snapshot.service.resourceName}/revisions/checkout-demo-00003`, uid: 'synthetic-revision', generation: '1', observedGeneration: '1', updateTime: snapshot.observedAt, reconciling: false, readiness: 'succeeded', missingFields: [], service: snapshot.service.resourceName } };
    snapshot.telemetry = demoTelemetry(scenario as 'signals' | 'empty' | 'denied'); cloudRunSnapshotSchema.parse(snapshot);
    const evidence = cloudRunEvidence(snapshot), evidenceDigest = cloudDigest(evidence);
    const original = gcpObservationSchema.parse({ resourceId: `synthetic-${scenario}`, configurationDigest: 'a'.repeat(64), snapshot, evidenceDigest });
    const payload = { schemaVersion: 1, planId: uuid(20 + index), version: 1, dataMode: 'synthetic', ...snapshot.binding,
      evidence: { snapshotId: snapshot.id, digest: evidenceDigest, sourceIds: evidence.observations.map(item => item.id), observedAt: snapshot.observedAt },
      analysis: { engine: 'synthetic-fixture', summary: scenario === 'empty' ? 'No matching samples. This does not establish zero traffic or healthy service.' : scenario === 'denied' ? 'Latency evidence was denied. Service health remains unknown.' : '503 request samples need follow-up; bounded samples do not establish service health.',
        findings: [{ kind: 'observation', statement: 'Only the configured service and revision are included.', evidenceIds: ['gcp-run-service'] }], missingInformation: ['Historical revision UID and complete signal coverage are unavailable.'], serviceAssessment: 'unknown' },
      action: { id: 'gcp.cloudrun.inspect.v1', version: 1, effect: 'read', inputs: { windowMinutes: 15, maxLogEntries: 50 }, completionCriteria: ['Read service, revision, logs, request count, latency and recheck the service.', 'Report each query outcome independently from service health.'] },
      createdAt: snapshot.observedAt, expiresAt: '2026-10-10T01:05:00.000Z' };
    const initial = gcpWorkflowViewSchema.parse({ plan: { payload, digest: cloudDigest(payload), lifecycle: 'prepared', review: { status: 'pending', requestedAt: snapshot.observedAt, requestedBy: scope.actorId } }, serverTime: snapshot.observedAt,
      capabilities: { requestReview: false, decide: true, execute: false, handoff: false, cancel: false } });
    const resultEvidence = cloudRunInspectionEvidence({ ...snapshot, id: uuid(30 + index) });
    return { scope, scenario, initial, original, resultEvidence, resultDigest: cloudDigest(resultEvidence), resultState: scenario === 'denied' ? 'failed' : 'succeeded' };
  });
  // These test-only vectors use the exact web summary and strict server schema. They are not app assets.
  const variants = bundles.map(bundle => ({ name: bundle.scenario, snapshot: structuredClone(bundle.original.snapshot) }));
  if (edition === 'personal') {
    const zero = structuredClone(bundles[0].original.snapshot);
    if (zero.telemetry?.requests.status !== 'collected' || zero.telemetry.latency.status !== 'collected' || zero.telemetry.logs.status !== 'collected') throw Error();
    zero.telemetry.requests.value = [{ ...zero.telemetry.requests.value[0], points: zero.telemetry.requests.value[0].points.map(point => ({ ...point, count: 0 })) }];
    zero.telemetry.latency.value[0].points = zero.telemetry.latency.value[0].points.map(point => ({ ...point, p95Ms: 0 }));
    zero.telemetry.logs.value[0].latencyMs = 0;
    variants.push({ name: 'explicit-zero-without-5xx', snapshot: zero });
    const partial = structuredClone(bundles[0].original.snapshot);
    for (const key of ['logs', 'requests', 'latency'] as const) {
      const read = partial.telemetry![key]; if (read.status !== 'collected') throw Error();
      read.value = []; read.truncated = true;
    }
    variants.push({ name: 'truncated-empty-page', snapshot: partial });
    const metadata = structuredClone(bundles[0].original.snapshot); delete metadata.telemetry;
    variants.push({ name: 'metadata-only', snapshot: metadata });
    const changed = structuredClone(bundles[0].original.snapshot); changed.consistency = 'changed';
    if (changed.service.status !== 'collected' || changed.revision.status !== 'collected') throw Error();
    changed.service.value.observedGeneration = null; changed.service.value.latestReadyRevision = null;
    changed.service.value.traffic = [{ revision: null, percent: null }]; changed.service.value.missingFields = ['observedGeneration', 'latestReadyRevision', 'trafficAllocationIncomplete'];
    changed.revision.value.readiness = 'unknown'; changed.revision.value.missingFields = ['readiness'];
    variants.push({ name: 'changed-and-incomplete', snapshot: changed });
    const denied = structuredClone(bundles[0].original.snapshot); denied.consistency = 'unverified';
    denied.service = { status: 'denied', source: denied.service.source, resourceName: denied.service.resourceName, observedAt: denied.observedAt, code: 'access_denied' };
    denied.revision = { status: 'skipped', source: denied.revision.source, resourceName: denied.revision.resourceName, observedAt: denied.observedAt, code: 'service_unverified' };
    denied.recheck = { status: 'skipped', source: denied.recheck.source, resourceName: denied.recheck.resourceName, observedAt: denied.observedAt, code: 'service_unverified' };
    for (const key of ['logs', 'requests', 'latency'] as const) denied.telemetry![key] = { status: 'skipped', source: denied.telemetry![key].source, observedAt: denied.observedAt, code: 'service_unverified' };
    variants.push({ name: 'metadata-denied', snapshot: denied });
  }
  for (const variant of variants) {
    variant.snapshot.id = uuid(500 + projectionVectors.length);
    const snapshot = cloudRunSnapshotSchema.parse(variant.snapshot), evidence = cloudRunEvidence(snapshot), evidenceDigest = cloudDigest(evidence);
    const original = gcpObservationSchema.parse({ resourceId: 'synthetic-vector', configurationDigest: 'a'.repeat(64), snapshot, evidenceDigest });
    const initial = structuredClone(bundles[0].initial);
    initial.plan.payload.evidence = { snapshotId: snapshot.id, digest: evidenceDigest, sourceIds: evidence.observations.map(item => item.id), observedAt: snapshot.observedAt };
    if (!snapshot.telemetry) initial.plan.payload.action = { id: 'gcp.cloudrun.metadata.inspect.v1', version: 1, effect: 'read', inputs: {}, completionCriteria: ['Read service, pinned revision, and recheck service metadata.'] };
    initial.plan.digest = cloudDigest(initial.plan.payload); gcpWorkflowViewSchema.parse(initial);
    projectionVectors.push({ name: `${edition}-${variant.name}`, scope, plan: initial.plan.payload, original,
      expected: { consistency: snapshot.consistency, service: snapshot.service.status === 'collected' ? snapshot.service.value : null,
        revision: snapshot.revision.status === 'collected' ? snapshot.revision.value : null,
        summary: snapshot.telemetry ? summarizeTelemetry(snapshot.telemetry) : null,
        statuses: [snapshot.service.status, snapshot.revision.status, snapshot.recheck.status, ...(snapshot.telemetry ? [snapshot.telemetry.logs.status, snapshot.telemetry.requests.status, snapshot.telemetry.latency.status] : [])] } });
  }
  writeAsset(new URL(`synthetic-${edition}.json`, output), JSON.stringify(bundles, null, 2) + '\n');
}
writeAsset(new URL('evidence-projections.json', testOutput), JSON.stringify(projectionVectors, null, 2) + '\n');
console.log(`${check ? 'Verified' : 'Generated'} schema-validated synthetic Android fixtures and web evidence vectors (no network).`);
