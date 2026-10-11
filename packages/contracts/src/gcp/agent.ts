import { z } from 'zod';

/** What a person sees of an agent task. Server-private fields (A2A ids, signed approvals, call ids) never appear here. */
const name = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/);
export const agentActionSchema = z.object({ action: z.literal('rollback_traffic'), service: name, revision: name }).strict();
export type AgentAction = z.infer<typeof agentActionSchema>;
export const agentStepSchema = z.object({ at: z.iso.datetime(), agent: z.string().min(1).max(40), kind: z.enum(['call', 'result', 'note']), name: z.string().min(1).max(60), summary: z.string().max(240) }).strict();
export type AgentStep = z.infer<typeof agentStepSchema>;
export const agentApprovalSchema = z.object({ action: agentActionSchema, risk: z.enum(['low', 'medium', 'high']), reason: z.string().max(500), requestedAt: z.iso.datetime(), expiresAt: z.iso.datetime() }).strict();
export type AgentApproval = z.infer<typeof agentApprovalSchema>;
export const agentTaskStateSchema = z.enum(['working', 'awaiting_approval', 'deciding', 'completed', 'rejected', 'failed', 'unknown']);
export type AgentTaskState = z.infer<typeof agentTaskStateSchema>;
export const agentTaskSchema = z.object({
  id: z.uuid(), state: agentTaskStateSchema, instruction: z.string().min(1).max(1000), language: z.enum(['ko', 'en']),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), steps: z.array(agentStepSchema).max(60),
  approval: agentApprovalSchema.optional(), result: z.string().max(4000).optional(),
  decision: z.object({ value: z.enum(['approve', 'reject']), at: z.iso.datetime(), byYou: z.boolean() }).strict().optional(),
  note: z.string().max(240).optional(),
}).strict();
export type AgentTask = z.infer<typeof agentTaskSchema>;
export const agentTaskListSchema = z.object({ items: z.array(agentTaskSchema).max(20) }).strict();
export const agentCreateSchema = z.object({ instruction: z.string().trim().min(1).max(1000), language: z.enum(['ko', 'en']).default('ko') }).strict();
export const agentDecisionSchema = z.object({ decision: z.enum(['approve', 'reject']) }).strict();
export const isTerminal = (state: AgentTaskState) => ['completed', 'rejected', 'failed', 'unknown'].includes(state);
