import { z } from 'zod';

/** A read-only picture of the registered services for the dashboard. Partial data is labeled, never filled with zero. */
const name = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/);
export const overviewRevisionSchema = z.object({ name, ready: z.enum(['ready', 'not_ready', 'unknown']), createdAt: z.iso.datetime().optional(), percent: z.number().min(0).max(100) }).strict();
export const overviewRequestSchema = z.object({ revision: name, responseClass: z.enum(['2xx', '3xx', '4xx', '5xx', 'other']), count: z.number().int().min(0) }).strict();
export const overviewLatencySchema = z.object({ revision: name, p95Ms: z.number().min(0) }).strict();
export const overviewLogSchema = z.object({ at: z.iso.datetime(), severity: z.string().max(20), revision: z.string().max(63).optional(), status: z.number().int().optional(), message: z.string().max(180) }).strict();
export const overviewCoverageSchema = z.enum(['ok', 'empty', 'error']);
export const overviewServiceSchema = z.object({
  name, region: z.string().max(40), observedAt: z.iso.datetime(), revisions: z.array(overviewRevisionSchema).max(20), requests: z.array(overviewRequestSchema).max(60), latency: z.array(overviewLatencySchema).max(20),
  logs: z.array(overviewLogSchema).max(20), coverage: z.object({ service: overviewCoverageSchema, requests: overviewCoverageSchema, logs: overviewCoverageSchema }).strict(),
}).strict();
export const overviewSchema = z.object({ generatedAt: z.iso.datetime(), windowMinutes: z.number().int(), services: z.array(overviewServiceSchema).max(10) }).strict();
export type Overview = z.infer<typeof overviewSchema>;
export type OverviewService = z.infer<typeof overviewServiceSchema>;
