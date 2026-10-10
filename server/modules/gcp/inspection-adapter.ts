import { assertCloudAccess, evidenceSchema, type CloudBinding, type CloudPlanPayload, type VerifiedCloudContext } from '../../../src/domain/cloud-operations';
import { CloudOperationError } from '../../../src/domain/cloud-workflow';
import { cloudRunSnapshotSchema, serviceSource, revisionSource } from '../../../src/modules/gcp/domain/cloud-run';
import { telemetryOperations } from '../../../src/modules/gcp/domain/telemetry';
import { inspectionReceiptSchema, telemetryCompletionSource } from '../../../src/modules/gcp/domain/inspection';
import { cloudDigest } from '../../cloud-integrity';
import type { CloudReadAdapter } from '../../cloud-workflow';
import { cloudRunEvidence } from './cloud-run-collector';
import type { GcpRegistration } from './observations';
import { createCloudRunMetadataAdapter } from './metadata-adapter';

/** Completion of fixed queries is separate from sampled evidence coverage and application health. */
export function cloudRunInspectionEvidence(input: unknown) {
  const snapshot = cloudRunSnapshotSchema.parse(input);
  if (!snapshot.telemetry) throw new CloudOperationError(409, 'telemetry_not_configured', 'The fixed inspection requires configured telemetry.');
  const evidence = cloudRunEvidence(snapshot);
  const outcomes = telemetryOperations.map(id => ({ id: `gcp-run-${id}`, status: snapshot.telemetry![id].status,
    truncated: snapshot.telemetry![id].status === 'collected' ? snapshot.telemetry![id].truncated : null }));
  // A bounded, completed query can have no data or more pages. Neither means complete coverage or health.
  const complete = outcomes.every(item => item.status === 'collected' || item.status === 'no_data');
  return evidenceSchema.parse({ ...evidence, observations: [...evidence.observations, {
    id: 'gcp-run-query-completion', source: telemetryCompletionSource, observedAt: snapshot.observedAt,
    quality: complete ? 'complete' : 'partial', value: inspectionReceiptSchema.parse({ window: snapshot.telemetry.window, maxLogEntries: 50, maxPointsPerMetric: 120, outcomes }),
    limitation: 'Server-derived receipt for three bounded queries, not complete signal coverage or service health. Each query is checked separately; partial pages and empty data remain in the evidence.',
  }] });
}

export function createCloudRunInspectionAdapter(registrations: readonly GcpRegistration[], dataMode: 'live' | 'synthetic', authorize: (binding: CloudBinding) => Promise<VerifiedCloudContext>): CloudReadAdapter {
  const items = registrations.filter(item => item.dataMode === dataMode && item.telemetryEnabled).map(item => ({ ...item, binding: structuredClone(item.binding) }));
  const resolve = (plan: CloudPlanPayload) => {
    const binding = { owner: plan.owner, workspaceId: plan.workspaceId, environmentId: plan.environmentId, target: plan.target };
    const item = items.find(item => cloudDigest(item.binding) === cloudDigest(binding));
    if (!item || plan.dataMode !== dataMode || plan.action.id !== 'gcp.cloudrun.inspect.v1' || plan.action.inputs.windowMinutes !== 15 || plan.action.inputs.maxLogEntries !== 50) throw new CloudOperationError(409, 'target_changed', 'The fixed telemetry inspection is no longer available.');
    return item;
  };
  return { actionId: 'gcp.cloudrun.inspect.v1', dataMode,
    requiredSources: [serviceSource, revisionSource, 'mobileops:collection-consistency', telemetryCompletionSource],
    async currentTarget(plan) { const item = resolve(plan); assertCloudAccess(await authorize(item.binding), item.binding, 'execute'); return structuredClone(item.binding.target); },
    async inspect(plan) {
      const item = resolve(plan), context = await authorize(item.binding); assertCloudAccess(context, item.binding, 'execute');
      const snapshot = await item.collector.collect(context, { revalidate: async () => { const fresh = await authorize(item.binding); assertCloudAccess(fresh, item.binding, 'execute'); return fresh; } });
      if (cloudDigest(snapshot.binding) !== cloudDigest(item.binding) || snapshot.dataMode !== dataMode) throw new CloudOperationError(409, 'result_scope_mismatch', 'The inspection scope changed.');
      return cloudRunInspectionEvidence(snapshot);
    },
  };
}
export function createCloudRunAdapters(registrations: readonly GcpRegistration[], dataMode: 'live' | 'synthetic', authorize: (binding: CloudBinding) => Promise<VerifiedCloudContext>) {
  return [createCloudRunMetadataAdapter(registrations, dataMode, authorize), createCloudRunInspectionAdapter(registrations, dataMode, authorize)];
}
