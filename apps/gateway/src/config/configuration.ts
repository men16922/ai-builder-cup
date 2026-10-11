import { z } from 'zod';
import { cloudRunBindingSchema } from '@contracts/gcp/cloud-run';
import { gcpScopeSchema } from '@contracts/gcp/observations';
import { firebaseBrowserConfigSchema } from '../../../web/src/identity/web-config';
import { googleCredentialConfiguration } from '../google/credentials';
const project = z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/);
export const gcpServerConfiguration = z.object({
  publicOrigin: z.url().refine(value => { const url = new URL(value); return url.origin === value && (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)); }),
  projectId: project, firebase: firebaseBrowserConfigSchema,
  store: z.object({ projectId: project, databaseId: z.string().regex(/^(\(default\)|[a-z][a-z0-9-]{2,62})$/), collection: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/) }).strict(),
  credentials: googleCredentialConfiguration,
  telemetry: z.object({ enabled: z.boolean() }).strict().optional(),
  // Off unless explicit. The fixed Android package restricts FCM delivery; no client-selected target.
  // The crew's front door. The approval signing key is never configured here; it arrives as AGENT_APPROVAL_KEY.
  agents: z.object({ enabled: z.boolean(), services: z.array(z.object({ name: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/), region: z.string().regex(/^[a-z]+-[a-z]+[0-9]$/) }).strict()).max(10).default([]), chiefUrl: z.url().refine(value => new URL(value).protocol === 'https:' || ['localhost', '127.0.0.1'].includes(new URL(value).hostname)) }).strict().optional(),
  notifications: z.object({ enabled: z.boolean(), androidPackage: z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/).max(255) }).strict().optional(),
  scopes: z.array(gcpScopeSchema).min(1).max(2),
  resources: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/), label: z.string().min(1).max(128), binding: cloudRunBindingSchema }).strict()).min(1).max(100),
  model: z.object({ enabled: z.boolean(), location: z.string().regex(/^(?:global|[a-z]+-[a-z]+[0-9])$/), modelId: z.string().regex(/^gemini-[a-z0-9.-]{1,90}$/) }).strict(),
}).strict().superRefine((config, ctx) => {
  const scopes = new Set(config.scopes.map(x => x.edition)), ids = new Set(config.resources.map(x => x.id)), bindings = new Set(config.resources.map(x => JSON.stringify(x.binding)));
  if (scopes.size !== config.scopes.length || ids.size !== config.resources.length || bindings.size !== config.resources.length) ctx.addIssue({ code: 'custom', message: 'Configure unique scopes, resource IDs and bindings.' });
  for (const { binding } of config.resources) {
    if (binding.target.provider !== 'gcp' || binding.target.projectId !== config.projectId || !config.scopes.some(scope => scope.workspaceId === binding.workspaceId && (scope.edition === 'personal' ? binding.owner.kind === 'personal' : binding.owner.kind === 'organization' && binding.owner.organizationId === scope.organizationId))) ctx.addIssue({ code: 'custom', message: 'Every resource must belong to the configured project and workspace.' });
  }
});
export type GcpServerConfiguration = z.infer<typeof gcpServerConfiguration>;
