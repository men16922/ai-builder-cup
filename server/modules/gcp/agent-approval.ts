import { createHash, createHmac } from 'node:crypto';
import type { AgentAction } from '../../../src/modules/gcp/domain/agent';

/** Signed human approval. It must produce exactly the bytes that agents/src/mobileops_agents/approval.py verifies. */
export type SignedApproval = { digest: string; actor: string; expires_at: number; signature: string };
const canonical = (action: AgentAction) => JSON.stringify({ action: action.action, revision: action.revision, service: action.service });
export const actionDigest = (action: AgentAction) => createHash('sha256').update(canonical(action)).digest('hex');
export function signApproval(key: Buffer, action: AgentAction, actor: string, ttlSeconds: number, nowMs: number): SignedApproval {
  if (key.length < 16) throw new Error('Approval signing is not configured.');
  const digest = actionDigest(action), expires_at = Math.floor(nowMs / 1000) + ttlSeconds;
  const signature = createHmac('sha256', key).update(JSON.stringify([digest, actor, expires_at])).digest('base64url');
  return { digest, actor, expires_at, signature };
}
