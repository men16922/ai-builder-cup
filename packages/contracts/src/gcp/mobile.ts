import { z } from 'zod';
import { ownerSchema } from '../core/operations';
import { cloudRunBindingSchema } from './cloud-run';
import { gcpStoredPlanSchema, gcpExecutionSchema } from './workflow';

export const gcpInboxQuerySchema = z.object({
  status: z.enum(['all', 'pending', 'results']).default('pending'),
  limit: z.number().int().min(1).max(20).default(20), cursor: z.uuid().optional(),
}).strict();
export const gcpInboxItemSchema = z.object({
  id: z.uuid(), resourceId: z.string().min(1).max(128), label: z.string().min(1).max(128), binding: cloudRunBindingSchema,
  dataMode: z.enum(['synthetic', 'live']), createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(), evidenceObservedAt: z.iso.datetime(),
  lifecycle: gcpStoredPlanSchema.shape.lifecycle, reviewStatus: gcpStoredPlanSchema.shape.review.shape.status,
  executionState: gcpExecutionSchema.shape.state.optional(), expired: z.boolean(),
}).strict();
export const gcpInboxSchema = z.object({
  owner: ownerSchema, workspaceId: z.string().min(1).max(128), serverTime: z.iso.datetime(),
  status: gcpInboxQuerySchema.shape.status, recentPlanLimit: z.literal(50), items: z.array(gcpInboxItemSchema).max(20), nextCursor: z.uuid().optional(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.items.map(item => item.id)).size !== value.items.length || value.items.some(item => item.binding.workspaceId !== value.workspaceId || JSON.stringify(item.binding.owner) !== JSON.stringify(value.owner))) ctx.addIssue({ code: 'custom', message: 'Inbox scope does not match.' });
});
export type GcpInbox = z.infer<typeof gcpInboxSchema>;
