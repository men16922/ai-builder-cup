import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AgentAction } from '@contracts/gcp/agent';
import { reviewedStateSchema, type ReviewedState } from './approval-review';

/** Signed human approval. It must produce exactly the bytes that apps/crew/src/mobileops_agents/approval.py verifies. */
export const signedApprovalSchema=z.object({version:z.literal(2),digest:z.string().regex(/^[a-f0-9]{64}$/),actor:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/),
  expires_at:z.number().int().positive(),grant_id:z.uuid(),reviewed_state:reviewedStateSchema,signature:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict();
export type SignedApproval=z.infer<typeof signedApprovalSchema>;
const canonical = (action: AgentAction) => JSON.stringify({ action: action.action, revision: action.revision, service: action.service });
export const actionDigest = (action: AgentAction) => createHash('sha256').update(canonical(action)).digest('hex');
const message=(value:Omit<SignedApproval,'signature'>)=>JSON.stringify(['aide-approval-v2',value.digest,value.actor,value.expires_at,value.grant_id,
  value.reviewed_state.uid,value.reviewed_state.etag,value.reviewed_state.update_time,value.reviewed_state.observed_at]);
export function signApproval(key: Buffer, action: AgentAction, actor: string, ttlSeconds: number, nowMs: number, reviewedState:ReviewedState,grantId:string): SignedApproval {
  if (key.length < 16) throw new Error('Approval signing is not configured.');
  const digest = actionDigest(action), expires_at = Math.floor(nowMs / 1000) + ttlSeconds;
  if(ttlSeconds!==300)throw Error('Invalid approval lease.');
  const value={version:2 as const,digest,actor,expires_at,grant_id:grantId,reviewed_state:reviewedStateSchema.parse(reviewedState)};
  const signature = createHmac('sha256', key).update(message(value)).digest('base64url');
  return signedApprovalSchema.parse({ ...value, signature });
}
export function verifySignedApproval(key:Buffer,raw:unknown,nowMs:number):SignedApproval {
  const value=signedApprovalSchema.parse(raw),expected=createHmac('sha256',key).update(message(value)).digest(),actual=Buffer.from(value.signature,'base64url');
  if(key.length<16||actual.length!==expected.length||!timingSafeEqual(actual,expected)||value.expires_at*1000<=nowMs||value.expires_at*1000-nowMs>330000
    ||Date.parse(value.reviewed_state.observed_at)>nowMs+30000||Date.parse(value.reviewed_state.observed_at)<nowMs-13*60000)throw Error('Invalid approval grant.');
  return value;
}
