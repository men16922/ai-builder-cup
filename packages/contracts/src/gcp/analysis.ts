import { z } from 'zod';
import { planPayloadSchema } from '../core/operations';
export const gcpMetadataSourceIds = ['gcp-run-service', 'gcp-run-revision', 'gcp-run-recheck', 'gcp-run-consistency', 'gcp-run-missing-signals'] as const;
export const gcpTelemetrySourceIds = [...gcpMetadataSourceIds, 'gcp-run-logs', 'gcp-run-requests', 'gcp-run-latency'] as const;

export const prepareGcpAnalysisSchema = z.object({ observationId: z.uuid(), language: z.enum(['ko', 'en']) }).strict();
/** Model output is interpretation only; no executable fields, target, credentials or action inputs. */
export const gcpModelAnalysisSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  findings: z.array(z.object({
    statement: z.string().trim().min(1).max(1000),
    evidenceIds: z.array(z.string().regex(/^gcp-run-[a-z-]+$/)).min(1).max(5),
    kind: z.enum(['observation', 'hypothesis']),
  }).strict()).min(1).max(8),
  missingInformation: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
  serviceAssessment: z.literal('unknown'),
}).strict();
export type GcpModelAnalysis = z.infer<typeof gcpModelAnalysisSchema>;
/** Structural and citation-existence checks only. A valid citation does not prove a claim. */
export function checkGcpModelAnalysis(raw: unknown, sourceIds: readonly string[]):
  { ok: true; analysis: GcpModelAnalysis } | { ok: false; code: 'model_response_invalid' | 'model_citation_invalid' } {
  const parsed = gcpModelAnalysisSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'model_response_invalid' };
  const ids = new Set(sourceIds);
  if (parsed.data.findings.some(value => new Set(value.evidenceIds).size !== value.evidenceIds.length || value.evidenceIds.some(id => !ids.has(id)))) return { ok: false, code: 'model_citation_invalid' };
  return { ok: true, analysis: parsed.data };
}
export const gcpAnalysisSchema = z.object({
  id: z.uuid(), resourceId: z.string().min(1).max(128), observationId: z.uuid(),
  configurationDigest: z.string().regex(/^[a-f0-9]{64}$/), language: z.enum(['ko', 'en']),
  plan: planPayloadSchema, planDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((value, ctx) => {
  const sources: readonly string[] = value.plan.evidence.sourceIds.length === gcpMetadataSourceIds.length ? gcpMetadataSourceIds : gcpTelemetrySourceIds;
  if (value.id !== value.plan.planId || value.observationId !== value.plan.evidence.snapshotId
    || value.plan.target.provider !== 'gcp' || !['gcp.cloudrun.metadata.inspect.v1', 'gcp.cloudrun.inspect.v1'].includes(value.plan.action.id)
    || (value.plan.action.id === 'gcp.cloudrun.inspect.v1' && (value.plan.action.inputs.windowMinutes !== 15 || value.plan.action.inputs.maxLogEntries !== 50 || sources.length !== gcpTelemetrySourceIds.length))
    || !['gemini', 'synthetic-fixture'].includes(value.plan.analysis.engine)
    || value.plan.analysis.serviceAssessment !== 'unknown' || value.plan.evidence.sourceIds.length !== sources.length
    || value.plan.evidence.sourceIds.some(id => !sources.includes(id))) ctx.addIssue({ code: 'custom', message: 'Invalid GCP analysis binding.' });
});
export type GcpAnalysis = z.infer<typeof gcpAnalysisSchema>;
