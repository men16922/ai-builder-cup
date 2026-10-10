import { z } from 'zod';
import { ownerSchema } from '../../../src/domain/cloud-operations';
import { gcpStoredPlanSchema, gcpExecutionSchema } from '../../../src/modules/gcp/domain/workflow';
import { cloudDigest } from '../../cloud-integrity';
import type { CloudStore, CloudTransaction } from '../../cloud-store';
import { cloudRecordKey } from '../../cloud-workflow';

export const notificationScopeSchema = z.object({ owner: ownerSchema, workspaceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/) }).strict();
export type NotificationScope = z.infer<typeof notificationScopeSchema>;
export const notificationEventSchema = notificationScopeSchema.extend({
  id: z.string().regex(/^[a-f0-9]{64}$/), planId: z.uuid(), planVersion: z.number().int().positive().max(999999999),
  kind: z.enum(['review', 'decision', 'result', 'handoff']), createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  dataMode: z.enum(['synthetic', 'live']),
}).strict();
export type NotificationEvent = z.infer<typeof notificationEventSchema>;
export const notificationIndexKey = (scope: NotificationScope) => cloudRecordKey(scope, 'gcp-notifications', 'recent');
export const notificationEventKey = (scope: NotificationScope, id: string) => cloudRecordKey(scope, 'gcp-notification', id);
export const notificationIndexSchema = z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(100);

/** A GCP-only transactional outbox. Delay physical puts until event reads complete;
 * preserve the caller's read-before-write contract and let the underlying store retry atomically.
 * No provider, identity or delivery I/O runs in the callback. */
export function withGcpNotificationIntents(store: CloudStore, now = Date.now): CloudStore {
  return { transact: body => store.transact(async tx => {
    const reads = new Map<string, unknown>(), writes = new Map<string, unknown>(); let writing = false;
    const staged: CloudTransaction = {
      async get<T>(key: string) {
        if (writing) throw Error('Complete transaction reads before writes.');
        if (!reads.has(key)) reads.set(key, await tx.get(key));
        return structuredClone(reads.get(key)) as T | undefined;
      },
      put(key, value) {
        if (!reads.has(key)) throw Error('Read a record before writing it.');
        writing = true; writes.set(key, structuredClone(value));
      },
    };
    const result = await body(staged), events: NotificationEvent[] = [], at = now();
    for (const [key, value] of writes) {
      let kind: NotificationEvent['kind'] | undefined, plan;
      if (key.startsWith('plan:')) {
        const next = gcpStoredPlanSchema.safeParse(value), previous = gcpStoredPlanSchema.safeParse(reads.get(key));
        if (!next.success || !previous.success || next.data.payload.target.provider !== 'gcp' || next.data.digest !== previous.data.digest) continue;
        if (previous.data.review.status !== next.data.review.status) {
          if (next.data.review.status === 'pending') kind = 'review';
          else if (['approved', 'rejected', 'changes_requested'].includes(next.data.review.status)) kind = 'decision';
        }
        plan = next.data;
      } else if (key.startsWith('execution:')) {
        const { claim: _claim, ...publicValue } = value as Record<string, unknown>;
        const next = gcpExecutionSchema.safeParse(publicValue);
        if (!next.success || next.data.binding.target.provider !== 'gcp') continue;
        const previous = reads.get(key) as { state?: string; handoffs?: unknown[] } | undefined;
        if (['succeeded', 'failed', 'unknown', 'cancelled'].includes(next.data.state)) {
          if (previous?.state !== next.data.state) kind = 'result';
          else if (previous?.handoffs?.length !== next.data.handoffs.length) kind = 'handoff';
        }
        if (!kind) continue;
        const planKey = cloudRecordKey(next.data.binding, 'plan', next.data.planId);
        plan = gcpStoredPlanSchema.parse(writes.get(planKey) ?? await tx.get(planKey));
        const binding = { owner: plan.payload.owner, workspaceId: plan.payload.workspaceId, environmentId: plan.payload.environmentId, target: plan.payload.target };
        if (plan.executionId !== next.data.id || plan.digest !== next.data.planDigest || cloudDigest(binding) !== cloudDigest(next.data.binding)
          || key !== cloudRecordKey(binding, 'execution', next.data.id)) throw Error('Notification execution binding mismatch.');
      }
      if (!kind || !plan) continue;
      const scope = notificationScopeSchema.parse({ owner: plan.payload.owner, workspaceId: plan.payload.workspaceId });
      if (plan.digest !== cloudDigest(plan.payload) || key.startsWith('plan:') && key !== cloudRecordKey(scope, 'plan', plan.payload.planId)) throw Error('Notification plan integrity mismatch.');
      const id = cloudDigest([key, kind, value]);
      events.push(notificationEventSchema.parse({ ...scope, id, planId: plan.payload.planId, planVersion: plan.payload.version, kind, dataMode: plan.payload.dataMode,
        createdAt: new Date(at).toISOString(), expiresAt: new Date(at + 3600000).toISOString() }));
    }
    const indexes = new Map<string, string[]>();
    for (const event of events) {
      const eventKey = notificationEventKey(event, event.id), existing = await tx.get<NotificationEvent>(eventKey);
      if (existing) continue;
      const indexKey = notificationIndexKey(event);
      const index = indexes.get(indexKey) ?? notificationIndexSchema.parse(await tx.get(indexKey) ?? []);
      indexes.set(indexKey, [event.id, ...index.filter(id => id !== event.id)].slice(0, 100));
      writes.set(eventKey, event);
    }
    for (const [key, value] of indexes) writes.set(key, value);
    for (const [key, value] of writes) tx.put(key, value);
    return result;
  }) };
}
