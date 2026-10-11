import { z } from 'zod';
import { bindingSchema, evidenceSchema, ownerSchema, planPayloadSchema } from '../core/operations';
const id = z.uuid(), date = z.iso.datetime(), digest = z.string().regex(/^[a-f0-9]{64}$/);
const review = z.object({ status: z.enum(['not_requested', 'pending', 'approved', 'rejected', 'changes_requested']), requestedAt: date.optional(), requestedBy: z.string().max(128).optional(), decidedAt: date.optional(), decidedBy: z.string().max(128).optional(), note: z.string().max(2000).optional() }).strict();
export const gcpStoredPlanSchema = z.object({ payload: planPayloadSchema, digest, lifecycle: z.enum(['prepared', 'superseded', 'consumed']), review, executionId: id.optional(), supersededBy: id.optional() }).strict();
export const gcpExecutionSchema = z.object({
  id, binding: bindingSchema, planId: id, planDigest: digest, dataMode: z.enum(['synthetic', 'live']), actionId: z.enum(['gcp.cloudrun.metadata.inspect.v1', 'gcp.cloudrun.inspect.v1']),
  state: z.enum(['queued', 'running', 'succeeded', 'failed', 'unknown', 'cancelled']), createdAt: date, updatedAt: date, createdBy: z.string().max(128), startedAt: date.optional(), finishedAt: date.optional(), message: z.string().max(2000),
  result: z.object({ evidenceId: id, digest, coverage: z.enum(['complete', 'partial']), serviceAssessment: z.literal('unknown') }).strict().optional(),
  handoffs: z.array(z.object({ id, at: date, actorId: z.string().max(128), note: z.string().max(2000) }).strict()).max(100),
}).strict();
export const gcpWorkflowViewSchema = z.object({
  plan: gcpStoredPlanSchema, execution: gcpExecutionSchema.optional(), evidence: evidenceSchema.optional(), serverTime: date,
  capabilities: z.object({ requestReview: z.boolean(), decide: z.boolean(), execute: z.boolean(), handoff: z.boolean(), cancel: z.boolean() }).strict(),
}).strict().superRefine((value, ctx) => {
  const { payload } = value.plan;
  const same = (binding: z.infer<typeof bindingSchema>) => JSON.stringify([binding.owner, binding.workspaceId, binding.environmentId, binding.target]) === JSON.stringify([payload.owner, payload.workspaceId, payload.environmentId, payload.target]);
  if (payload.target.provider !== 'gcp' || !['gemini', 'synthetic-fixture'].includes(payload.analysis.engine) || !['gcp.cloudrun.metadata.inspect.v1', 'gcp.cloudrun.inspect.v1'].includes(payload.action.id)
    || (payload.action.id === 'gcp.cloudrun.inspect.v1' && (payload.action.inputs.windowMinutes !== 15 || payload.action.inputs.maxLogEntries !== 50))
    || !!value.plan.executionId !== !!value.execution || !!value.execution?.result !== !!value.evidence
    || (value.execution && (value.plan.executionId !== value.execution.id || value.execution.planId !== payload.planId || value.execution.actionId !== payload.action.id || value.execution.planDigest !== value.plan.digest || value.execution.dataMode !== payload.dataMode || !same(value.execution.binding)))
    || (value.evidence && (!value.execution?.result || value.evidence.id !== value.execution.result.evidenceId || value.evidence.dataMode !== payload.dataMode || !same(value.evidence)))) ctx.addIssue({ code: 'custom', message: 'Workflow records do not share the pinned GCP scope.' });
});
export type GcpWorkflowView = z.infer<typeof gcpWorkflowViewSchema>;
export const gcpPlanItemSchema = z.object({ id, resourceId: z.string().min(1).max(128), createdAt: date }).strict();
export type GcpPlanItem = z.infer<typeof gcpPlanItemSchema>;
export const gcpPlanListSchema = z.object({ owner: ownerSchema, workspaceId: z.string().min(1).max(128), items: z.array(gcpPlanItemSchema).max(50) }).strict();
