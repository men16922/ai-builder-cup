import { z } from 'zod';
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
export const webScopeSchema = z.object({ organizationId: id, workspaceId: id, label: z.string().min(1).max(128) }).strict();
export const firebaseBrowserConfigSchema = z.object({
  apiKey: z.string().regex(/^[A-Za-z0-9_-]{20,128}$/),
  projectId: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/),
  authDomain: z.string().regex(/^[a-z0-9][a-z0-9.-]{2,252}$/),
  appId: z.string().regex(/^[A-Za-z0-9:_-]{1,200}$/), tenantId: id.optional(),
}).strict();
export const webConfigurationSchema = z.discriminatedUnion('configured', [
  z.object({ configured: z.literal(false) }).strict(),
  z.object({ configured: z.literal(true), scope: webScopeSchema, identity: z.discriminatedUnion('method', [
    z.object({ method: z.literal('firebase-google'), firebase: firebaseBrowserConfigSchema }).strict(),
    z.object({ method: z.literal('company') }).strict(),
  ]) }).strict(),
]);
export type WebConfiguration = z.infer<typeof webConfigurationSchema>;
export type WebScope = z.infer<typeof webScopeSchema>;
