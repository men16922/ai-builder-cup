import { z } from 'zod';
import type { AgentAction } from '@contracts/gcp/agent';
import { cloudRunRevisionId } from '@contracts/gcp/cloud-run';
import { sameOwner, type CloudBinding, type CloudOwner } from '@contracts/core/operations';
import type { GcpWebSession } from '../auth/web-access';
import type { CloudRunTransport } from '../cloud-run/transport';

export const reviewedStateSchema = z.object({
  uid: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/),
  etag: z.string().regex(/^[\x21-\x7e]{1,256}$/),
  update_time: z.iso.datetime(), observed_at: z.iso.datetime(),
}).strict().refine(value => Date.parse(value.update_time) <= Date.parse(value.observed_at) + 30000, 'Service update time is in the future.');
export type ReviewedState = z.infer<typeof reviewedStateSchema>;
export const reviewedDisplaySchema = z.object({
  observedAt: z.iso.datetime(),
  traffic: z.array(z.object({ revision: cloudRunRevisionId, percent: z.number().int().min(1).max(100) }).strict()).min(1).max(10),
}).strict().refine(value => value.traffic.reduce((sum, item) => sum + item.percent, 0) === 100, 'Traffic must be complete.');
export interface ApprovalReviewPort {
  read(session: GcpWebSession, action: AgentAction, signal: AbortSignal): Promise<{ state: ReviewedState; display: z.infer<typeof reviewedDisplaySchema> }>;
  allows(owner: CloudOwner, workspaceId: string, action: AgentAction, uid: string): boolean;
}
export type ApprovalTarget = { binding: CloudBinding; rollbackRevisions: readonly string[] };

/** A registered read target grants no mutation rights. Only explicit owner/UID/destination bindings can issue grants. */
export function approvalReviewPort(targets: readonly ApprovalTarget[], transport: (binding: CloudBinding) => CloudRunTransport, now = Date.now): ApprovalReviewPort {
  const matching = (owner: CloudOwner, workspaceId: string, action: AgentAction) => targets.filter(item =>
    sameOwner(item.binding.owner, owner) && item.binding.workspaceId === workspaceId
    && item.binding.target.provider === 'gcp' && item.binding.target.resourceName.split('/').at(-1) === action.service
    && item.rollbackRevisions.includes(action.revision));
  return {
    allows(owner, workspaceId, action, uid) {
      const selected = matching(owner, workspaceId, action);
      // The action has no region selector. Ambiguous bindings must never silently select a region.
      return selected.length === 1 && selected[0].binding.target.resourceUid === uid;
    },
    async read(session, action, signal) {
      signal.throwIfAborted();
      const selected = matching(session.context.owner, session.context.workspaceId, action);
      if (selected.length !== 1) throw Error('approval_target_not_registered');
      const binding = selected[0].binding;
      const raw = z.object({ name: z.string(), uid: z.string(), etag: z.string(), updateTime: z.iso.datetime(),
        trafficStatuses: z.array(z.object({ revision: z.string(), percent: z.number().int().min(0).max(100) })).max(100),
      }).parse(await transport(binding).read('service', signal));
      signal.throwIfAborted();
      if (raw.name !== binding.target.resourceName || raw.uid !== binding.target.resourceUid) throw Error('approval_target_changed');
      const traffic = raw.trafficStatuses.filter(item => item.percent > 0).map(item => ({ revision: item.revision.split('/').at(-1), percent: item.percent }));
      const observed_at = new Date(now()).toISOString();
      return {
        state: reviewedStateSchema.parse({ uid: raw.uid, etag: raw.etag, update_time: raw.updateTime, observed_at }),
        display: reviewedDisplaySchema.parse({ observedAt: observed_at, traffic }),
      };
    },
  };
}
