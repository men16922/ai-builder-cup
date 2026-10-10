import { z } from 'zod';
import { cloudRunBindingSchema } from '../../../src/modules/gcp/domain/cloud-run';
import type { CloudBinding } from '../../../src/domain/cloud-operations';

export class CloudRunError extends Error {
  readonly code: 'disabled' | 'identity_changed' | 'scope_changed' | 'cancelled' | 'busy' | 'access_denied' | 'not_found' | 'throttled' | 'unavailable' | 'invalid_response';
  constructor(code: CloudRunError['code']) {
    super(`Cloud Run collection: ${code}`); this.code = code;
  }
}
export type CloudRunOperation = 'service' | 'revision';
/** Trusted auth adapter proves the effective principal. A browser-supplied label/token is never sufficient. */
export type CloudRunCredential = { principal: string; sessionId: string; accessToken: string };
export interface CloudRunCredentials { current(signal: AbortSignal): Promise<CloudRunCredential> }
export interface CloudRunTransport {
  readonly dataMode: 'synthetic' | 'live';
  /** Auth adapter's effective identity/session fingerprint; excludes access tokens. */
  identity(signal: AbortSignal): Promise<string>;
  read(operation: CloudRunOperation, signal: AbortSignal): Promise<unknown>;
}
export const serviceFields = 'name,uid,generation,observedGeneration,updateTime,reconciling,etag,terminalCondition(state),latestCreatedRevision,latestReadyRevision,trafficStatuses(revision,percent)';
export const revisionFields = 'name,uid,service,generation,observedGeneration,updateTime,reconciling,conditions(type,state)';
const credentialSchema = z.object({ principal: z.string().min(1).max(512), sessionId: z.string().min(1).max(128), accessToken: z.string().min(1).max(16384).regex(/^[\x21-\x7E]+$/) }).strict();
export const principalKey = (credential: Pick<CloudRunCredential, 'principal' | 'sessionId'>) => JSON.stringify([credential.principal, credential.sessionId]);

/** Fixed GET-only transport. Composition must explicitly enable it and provide a verified credential adapter. */
export function createCloudRunRestTransport(options: {
  binding: CloudBinding; principal: string; sessionId: string; credentials: CloudRunCredentials;
  enabled: boolean; offline: boolean;
}): CloudRunTransport {
  if (!options.enabled || options.offline || process.env.MOBILEOPS_OFFLINE_TEST === '1') throw new CloudRunError('disabled');
  return restTransport(options, globalThis.fetch.bind(globalThis), 'live');
}
/** Explicit test injection; there is no default network/auth client and all results are labeled synthetic. */
export function createSyntheticCloudRunRestTransport(options: {
  binding: CloudBinding; principal: string; sessionId: string; credentials: CloudRunCredentials; fetcher: typeof fetch;
}): CloudRunTransport { return restTransport(options, options.fetcher, 'synthetic'); }

function restTransport(options: { binding: CloudBinding; principal: string; sessionId: string; credentials: CloudRunCredentials }, fetcher: typeof fetch, dataMode: 'synthetic' | 'live'): CloudRunTransport {
  const binding = cloudRunBindingSchema.parse(options.binding), target = binding.target;
  if (target.provider !== 'gcp') throw new CloudRunError('scope_changed');
  const expected = principalKey(options), credentials = options.credentials;
  const names = { service: target.resourceName, revision: `${target.resourceName}/revisions/${target.revision}` };
  const current = async (signal: AbortSignal) => {
    signal.throwIfAborted();
    let parsed: CloudRunCredential;
    try { parsed = credentialSchema.parse(await credentials.current(signal)); }
    catch { if (signal.aborted) throw new CloudRunError('cancelled'); throw new CloudRunError('identity_changed'); }
    signal.throwIfAborted();
    if (principalKey(parsed) !== expected) throw new CloudRunError('identity_changed');
    return parsed;
  };
  return {
    dataMode,
    async identity(signal) { return principalKey(await current(signal)); },
    async read(operation, signal) {
      if (operation !== 'service' && operation !== 'revision') throw new CloudRunError('scope_changed');
      const credential = await current(signal);
      const url = new URL(`https://run.googleapis.com/v2/${names[operation]}`);
      url.searchParams.set('fields', operation === 'service' ? serviceFields : revisionFields);
      let response: Response;
      try { response = await fetcher(url, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', signal,
        headers: { Authorization: `Bearer ${credential.accessToken}`, Accept: 'application/json' } }); }
      catch { if (signal.aborted) throw new CloudRunError('cancelled'); throw new CloudRunError('unavailable'); }
      signal.throwIfAborted();
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        if (response.status === 401) throw new CloudRunError('identity_changed');
        throw new CloudRunError(response.status === 403 ? 'access_denied' : response.status === 404 ? 'not_found' : response.status === 429 ? 'throttled' : 'unavailable');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new CloudRunError('invalid_response');
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        while (true) {
          signal.throwIfAborted(); const { done, value } = await reader.read(); if (done) break;
          bytes += value.length; if (bytes > 131072) throw new CloudRunError('invalid_response'); chunks.push(value);
        }
        signal.throwIfAborted();
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch { throw new CloudRunError(signal.aborted ? 'cancelled' : 'invalid_response'); }
      finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    },
  };
}
