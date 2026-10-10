import { z } from 'zod';
import type { CloudEvidence } from '../../../domain/cloud-operations';
import { telemetryWindowSchema } from './telemetry';

export const telemetryCompletionSource = 'mobileops:bounded-telemetry-read-completion';
const outcome = <T extends string>(id: T) => z.object({ id: z.literal(id),
  status: z.enum(['collected', 'no_data', 'denied', 'unavailable', 'skipped']), truncated: z.boolean().nullable(),
}).strict().refine(value => value.status === 'collected' ? value.truncated !== null : value.truncated === null);
export const inspectionReceiptSchema = z.object({
  window: telemetryWindowSchema, maxLogEntries: z.literal(50), maxPointsPerMetric: z.literal(120),
  outcomes: z.tuple([outcome('gcp-run-logs'), outcome('gcp-run-requests'), outcome('gcp-run-latency')]),
}).strict();
export function inspectionReceipt(evidence: CloudEvidence) {
  const items = evidence.observations.filter(item => item.id === 'gcp-run-query-completion' && item.source === telemetryCompletionSource);
  const parsed = items.length === 1 ? inspectionReceiptSchema.safeParse(items[0].value) : undefined;
  return parsed?.success ? parsed.data : undefined;
}
