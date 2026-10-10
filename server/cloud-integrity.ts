import { createHash } from 'node:crypto';
import { evidenceSchema, planPayloadSchema, type CloudEvidence, type CloudPlanPayload } from '../src/domain/cloud-operations';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Unsupported digest value.');
  return encoded;
}
export function cloudDigest(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}
export function validatePinnedCloudPlan(input: unknown, snapshot: unknown, expectedDigest: string, now: number): { plan: CloudPlanPayload; evidence: CloudEvidence } {
  const plan = planPayloadSchema.parse(input), evidence = evidenceSchema.parse(snapshot);
  if (cloudDigest(plan) !== expectedDigest) throw new Error('Plan digest mismatch.');
  if (!Number.isFinite(now) || Date.parse(plan.createdAt) > now || Date.parse(plan.expiresAt) <= now) throw new Error('Plan is expired or not yet valid.');
  if (plan.evidence.digest !== cloudDigest(evidence) || plan.evidence.snapshotId !== evidence.id || plan.evidence.observedAt !== evidence.observedAt) throw new Error('Evidence snapshot mismatch.');
  if (cloudDigest([plan.owner, plan.workspaceId, plan.environmentId, plan.target, plan.dataMode]) !== cloudDigest([evidence.owner, evidence.workspaceId, evidence.environmentId, evidence.target, evidence.dataMode])) throw new Error('Evidence scope mismatch.');
  const ids = new Set(evidence.observations.map(item => item.id));
  if (plan.evidence.sourceIds.some(source => !ids.has(source))) throw new Error('Pinned source is absent from the evidence.');
  return { plan, evidence };
}
