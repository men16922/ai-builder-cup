import { cloudRunSnapshotSchema, serviceSource, revisionSource } from './domain/cloud-run';
/** Explicit visual example only. Never sent to a collector, planner or execution route. */
export function gcpPreview() {
  const resourceName = 'projects/example-mobileops-demo/locations/asia-northeast3/services/checkout-demo', at = '2026-10-10T01:00:00.000Z';
  const value = { name: resourceName, uid: 'synthetic-service-uid', generation: '3', observedGeneration: '2', updateTime: at, reconciling: false, readiness: 'failed', missingFields: ['generationNotObserved'],
    latestCreatedRevision: 'checkout-demo-00003', latestReadyRevision: 'checkout-demo-00002', traffic: [{ revision: 'checkout-demo-00002', percent: 100 }] };
  const service = { status: 'collected', source: serviceSource, resourceName, observedAt: at, value };
  return cloudRunSnapshotSchema.parse({ schemaVersion: 1, id: '00000000-0000-4000-8000-000000000001', dataMode: 'synthetic', startedAt: at, observedAt: at,
    binding: { owner: { kind: 'organization', organizationId: 'synthetic-example' }, workspaceId: 'synthetic-preview', environmentId: 'synthetic-demo', target: { provider: 'gcp', projectId: 'example-mobileops-demo', location: 'asia-northeast3', resourceId: 'example', resourceName, resourceUid: 'synthetic-service-uid', revision: 'checkout-demo-00003' } },
    service, recheck: service, revision: { status: 'denied', source: revisionSource, resourceName: `${resourceName}/revisions/checkout-demo-00003`, observedAt: at, code: 'access_denied' }, consistency: 'stable', serviceAssessment: 'unknown' });
}
