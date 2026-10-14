import { z } from 'zod';
import { ownerSchema } from '../core/operations';
import { firebaseBrowserConfigSchema } from '../../../../apps/web/src/identity/web-config';
import { cloudRunBindingSchema, cloudRunSnapshotSchema } from './cloud-run';
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
export const gcpScopeSchema = z.discriminatedUnion('edition', [
  z.object({ edition: z.literal('personal'), workspaceId: id, label: z.string().min(1).max(128) }).strict(),
  z.object({ edition: z.literal('organization'), organizationId: id, workspaceId: id, label: z.string().min(1).max(128) }).strict(),
]);
export const gcpWebConfigurationSchema = z.discriminatedUnion('configured', [
  z.object({ configured: z.literal(false) }).strict(),
  z.object({ configured: z.literal(true), scope: gcpScopeSchema, identity: z.discriminatedUnion('method', [
    z.object({ method: z.literal('firebase-google'), firebase: firebaseBrowserConfigSchema }).strict(),
    z.object({ method: z.literal('company') }).strict(),
  ]) }).strict(),
]);
export const gcpResourceSchema = z.object({ id, label: z.string().min(1).max(128), binding: cloudRunBindingSchema,
  dataMode: z.enum(['synthetic', 'live']), configurationDigest: z.string().regex(/^[a-f0-9]{64}$/), analysisAvailable: z.boolean().optional(), telemetryEnabled: z.boolean().optional() }).strict();
export const gcpResourceListSchema = z.object({ owner: ownerSchema, workspaceId: id, items: z.array(gcpResourceSchema).max(100), workflowAvailable: z.boolean().optional(), agentsAvailable: z.boolean().optional(), mobilityAvailable: z.boolean().optional() }).strict();
export const collectGcpSchema = z.object({ resourceId: id }).strict();
export const gcpObservationSchema = z.object({ resourceId: id, configurationDigest: z.string().regex(/^[a-f0-9]{64}$/), snapshot: cloudRunSnapshotSchema, evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type GcpScope = z.infer<typeof gcpScopeSchema>;
export type GcpWebConfiguration = z.infer<typeof gcpWebConfigurationSchema>;
export type GcpResource = z.infer<typeof gcpResourceSchema>;
export type GcpResourceList = z.infer<typeof gcpResourceListSchema>;
export type GcpObservation = z.infer<typeof gcpObservationSchema>;
export const gcpApiBase = (scope: GcpScope) => scope.edition === 'personal'
  ? `/api/personal/v1/workspaces/${encodeURIComponent(scope.workspaceId)}/gcp`
  : `/api/organizations/v1/${encodeURIComponent(scope.organizationId)}/workspaces/${encodeURIComponent(scope.workspaceId)}/gcp`;
