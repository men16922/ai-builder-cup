import { assertCloudAccess, type CloudBinding, type CloudPlanPayload, type VerifiedCloudContext } from '../../../src/domain/cloud-operations';
import { CloudOperationError } from '../../../src/domain/cloud-workflow';
import { cloudDigest } from '../../cloud-integrity';
import type { CloudReadAdapter } from '../../cloud-workflow';
import { cloudRunEvidence } from './cloud-run-collector';
import type { GcpRegistration } from './observations';
import { serviceSource, revisionSource } from '../../../src/modules/gcp/domain/cloud-run';

/** Worker composition supplies fresh authority; browser/demo context is never reconstructed here. */
export function createCloudRunMetadataAdapter(registrations: readonly GcpRegistration[], dataMode: 'live' | 'synthetic', authorize: (binding: CloudBinding) => Promise<VerifiedCloudContext>): CloudReadAdapter {
  const items = registrations.filter(item => item.dataMode === dataMode).map(item => ({ ...item, binding: structuredClone(item.binding) }));
  const resolve = (plan: CloudPlanPayload) => {
    const binding = { owner: plan.owner, workspaceId: plan.workspaceId, environmentId: plan.environmentId, target: plan.target };
    const item = items.find(value => cloudDigest(value.binding) === cloudDigest(binding));
    if (!item || plan.dataMode !== dataMode || plan.action.id !== 'gcp.cloudrun.metadata.inspect.v1') throw new CloudOperationError(409, 'target_changed', 'The metadata target is no longer registered.');
    return item;
  };
  return { actionId: 'gcp.cloudrun.metadata.inspect.v1', dataMode,
    requiredSources: [serviceSource, revisionSource, 'mobileops:collection-consistency'],
    async currentTarget(plan) { const item = resolve(plan); assertCloudAccess(await authorize(item.binding), item.binding, 'execute'); return structuredClone(item.binding.target); },
    async inspect(plan) {
      const item = resolve(plan), context = await authorize(item.binding); assertCloudAccess(context, item.binding, 'execute');
      return cloudRunEvidence(await item.collector.collect(context, { metadataOnly: true, revalidate: async () => { const fresh = await authorize(item.binding); assertCloudAccess(fresh, item.binding, 'execute'); return fresh; } }));
    },
  };
}
