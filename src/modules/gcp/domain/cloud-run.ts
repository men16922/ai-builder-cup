import { z } from 'zod';
import { bindingSchema } from '../../../domain/cloud-operations';
import { cloudRunTelemetrySchema, telemetryOperations } from './telemetry';

export const cloudRunServiceName = z.string().regex(/^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/[a-z][a-z0-9-]{1,62}\/services\/[a-z](?:[a-z0-9-]{0,47}[a-z0-9])?$/);
export const cloudRunRevisionId = z.string().regex(/^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
export const cloudRunBindingSchema = bindingSchema.refine(binding => binding.target.provider === 'gcp'
  && cloudRunServiceName.safeParse(binding.target.resourceName).success && cloudRunRevisionId.safeParse(binding.target.revision).success,
'An exact Cloud Run service and revision must be configured.');
export const readinessSchema = z.enum(['succeeded', 'failed', 'pending', 'reconciling', 'unknown']);
const generation = z.string().regex(/^\d{1,19}$/).nullable();
const time = z.iso.datetime();
const metadata = {
  name: z.string().min(1).max(512), uid: z.string().min(1).max(128), generation, observedGeneration: generation,
  updateTime: time.nullable(), reconciling: z.boolean().nullable(), readiness: readinessSchema,
  missingFields: z.array(z.string().min(1).max(100)).max(20),
};
export const cloudRunServiceSchema = z.object({ ...metadata,
  latestCreatedRevision: cloudRunRevisionId.nullable(), latestReadyRevision: cloudRunRevisionId.nullable(),
  traffic: z.array(z.object({ revision: cloudRunRevisionId.nullable(), percent: z.number().int().min(0).max(100).nullable() }).strict()).max(100).nullable(),
}).strict();
export const cloudRunRevisionSchema = z.object({ ...metadata, service: cloudRunServiceName }).strict();
export const readCode = z.enum(['access_denied', 'not_found', 'throttled', 'unavailable', 'invalid_response', 'service_unverified']);
const read = <T extends z.ZodType>(value: T, source: string) => z.discriminatedUnion('status', [
  z.object({ status: z.literal('collected'), source: z.literal(source), resourceName: z.string().max(512), observedAt: time, value }).strict(),
  z.object({ status: z.enum(['denied', 'missing', 'unavailable', 'skipped']), source: z.literal(source), resourceName: z.string().max(512), observedAt: time, code: readCode }).strict(),
]);
export const serviceSource = 'run.googleapis.com/v2/projects.locations.services.get';
export const revisionSource = 'run.googleapis.com/v2/projects.locations.services.revisions.get';
export const cloudRunSnapshotSchema = z.object({
  schemaVersion: z.literal(1), id: z.uuid(), dataMode: z.enum(['synthetic', 'live']), binding: cloudRunBindingSchema,
  startedAt: time, observedAt: time,
  service: read(cloudRunServiceSchema, serviceSource), revision: read(cloudRunRevisionSchema, revisionSource), recheck: read(cloudRunServiceSchema, serviceSource),
  consistency: z.enum(['stable', 'changed', 'unverified']), serviceAssessment: z.literal('unknown'),
  telemetry: cloudRunTelemetrySchema.optional(),
}).strict().superRefine((snapshot, ctx) => {
  const target = snapshot.binding.target;
  if (target.provider !== 'gcp') return;
  const check = (valid: boolean) => { if (!valid) ctx.addIssue({ code: 'custom', message: 'Cloud Run observation does not match its fixed scope or time.' }); };
  const start = Date.parse(snapshot.startedAt), end = Date.parse(snapshot.observedAt);
  check(start <= end && end - start <= 15000);
  if (snapshot.telemetry) {
    const windowEnd = Date.parse(snapshot.telemetry.window.end);
    check(start - windowEnd >= 120000 && start - windowEnd < 180000);
    for (const key of telemetryOperations) check(Date.parse(snapshot.telemetry[key].observedAt) >= start && Date.parse(snapshot.telemetry[key].observedAt) <= end);
  }
  for (const key of ['service', 'revision', 'recheck'] as const) {
    const item = snapshot[key], name = key === 'revision' ? `${target.resourceName}/revisions/${target.revision}` : target.resourceName;
    check(item.resourceName === name && Date.parse(item.observedAt) >= start && Date.parse(item.observedAt) <= end);
    if (item.status === 'collected') check(item.value.name === name && (key === 'revision' ? 'service' in item.value && item.value.service === target.resourceName : item.value.uid === target.resourceUid));
  }
  if (snapshot.consistency !== 'unverified') check(snapshot.service.status === 'collected' && snapshot.recheck.status === 'collected');
});
export type CloudRunSnapshot = z.infer<typeof cloudRunSnapshotSchema>;
export type CloudRunService = z.infer<typeof cloudRunServiceSchema>;
export type CloudRunRevision = z.infer<typeof cloudRunRevisionSchema>;
