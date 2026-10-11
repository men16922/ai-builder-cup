import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
const project = z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/);
const serviceAccount = z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/);
export const googleCredentialConfiguration = z.discriminatedUnion('method', [
  z.object({ method: z.literal('metadata'), runtimeProjectId: project, serviceAccountEmail: serviceAccount }).strict(),
  z.object({ method: z.literal('impersonated_user'), serviceAccountEmail: serviceAccount, sourceFile: z.string().min(1).max(4096).refine(isAbsolute) }).strict(),
]);
export type GoogleCredentialConfiguration = z.infer<typeof googleCredentialConfiguration>;
export type GoogleAccessToken = { accessToken: string; expiresAt: number };
export interface GoogleCredentials {
  readonly principal: string; readonly sessionId: string; readonly mode: 'live' | 'synthetic';
  token(signal: AbortSignal): Promise<GoogleAccessToken>;
  close(): void;
}
export class GoogleCredentialError extends Error {
  readonly code: 'credential_disabled' | 'credential_unavailable' | 'credential_changed' | 'credential_cancelled';
  constructor(code: GoogleCredentialError['code']) { super('The configured Google service identity could not be verified.'); this.code = code; }
}
const fail = (code: GoogleCredentialError['code'] = 'credential_unavailable') => new GoogleCredentialError(code);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const accessToken = z.string().min(10).max(16384).regex(/^[A-Za-z0-9._~+/-]+={0,2}$/);
const tokenResponse = z.object({ access_token: accessToken, expires_in: z.number().int().min(61).max(3600), token_type: z.literal('Bearer') });
const sourceSchema = z.object({ type: z.literal('authorized_user'), client_id: z.string().min(1).max(512), client_secret: z.string().min(1).max(4096), refresh_token: z.string().min(1).max(16384), quota_project_id: project.optional(), universe_domain: z.literal('googleapis.com').optional(), account: z.string().max(512).optional() }).strict();
/** Explicit server file only; no well-known ADC search, browser path, private key or URL ingestion. */
async function readSource(path: string) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 32768 || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw fail();
    const data = await file.readFile('utf8'); if (Buffer.byteLength(data) > 32768) throw fail();
    return { value: sourceSchema.parse(JSON.parse(data)), digest: hash(data) };
  } catch { throw fail(); } finally { await file?.close(); }
}
export async function createGoogleCredentials(input: unknown, enabled: boolean): Promise<GoogleCredentials> {
  if (!enabled || process.env.MOBILEOPS_OFFLINE_TEST === '1') throw fail('credential_disabled');
  return create(input, globalThis.fetch.bind(globalThis), false, Date.now);
}
/** Offline protocol seam. Synthetic credentials cannot be composed as a live provider. */
export async function createSyntheticGoogleCredentials(input: unknown, fetcher: typeof fetch, now = Date.now): Promise<GoogleCredentials> {
  if (process.env.MOBILEOPS_OFFLINE_TEST !== '1' || fetcher === globalThis.fetch) throw fail('credential_disabled');
  return create(input, fetcher, true, now);
}
async function create(input: unknown, fetcher: typeof fetch, synthetic: boolean, now: () => number): Promise<GoogleCredentials> {
  const config = googleCredentialConfiguration.parse(input), sourceDigest = config.method === 'impersonated_user' ? (await readSource(config.sourceFile)).digest : '';
  const sessionId = hash(JSON.stringify([config, sourceDigest])); let cached: GoogleAccessToken | undefined, closed = false;
  const guard = () => { if (closed || (!synthetic && process.env.MOBILEOPS_OFFLINE_TEST === '1')) throw fail('credential_disabled'); };
  const read = async (url: string, signal: AbortSignal, init: RequestInit = {}, metadata = false) => {
    guard(); signal.throwIfAborted();
    const response = await fetcher(url, { ...init, redirect: 'error', credentials: 'omit', cache: 'no-store', signal });
    if (!response.ok || metadata && response.headers.get('Metadata-Flavor') !== 'Google') { void response.body?.cancel().catch(() => {}); throw fail(); }
    const reader = response.body?.getReader(); if (!reader) throw fail(); const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) { signal.throwIfAborted(); const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 32768) throw fail(); chunks.push(value); }
      signal.throwIfAborted(); return Buffer.concat(chunks).toString('utf8');
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  };
  const metadata = (path: string, signal: AbortSignal) => read(`http://metadata.google.internal/computeMetadata/v1/${path}`, signal, { method: 'GET', headers: { 'Metadata-Flavor': 'Google' } }, true);
  const identity = async (signal: AbortSignal) => {
    if (config.method !== 'metadata') return;
    const email = (await metadata('instance/service-accounts/default/email', signal)).trim();
    if (email !== config.serviceAccountEmail || (await metadata('project/project-id', signal)).trim() !== config.runtimeProjectId) throw fail('credential_changed');
  };
  return { principal: config.serviceAccountEmail, sessionId, mode: synthetic ? 'synthetic' : 'live', close() { closed = true; cached = undefined; },
    async token(parent) {
      const signal = AbortSignal.any([parent, AbortSignal.timeout(5000)]);
      try {
        guard(); signal.throwIfAborted(); await identity(signal);
        const source = config.method === 'impersonated_user' ? await readSource(config.sourceFile) : undefined;
        if (source && source.digest !== sourceDigest) throw fail('credential_changed');
        guard(); signal.throwIfAborted();
        if (cached && cached.expiresAt - now() > 60000) return { ...cached };
        const started = now(); let fresh: GoogleAccessToken;
        if (config.method === 'metadata') {
          const token = tokenResponse.parse(JSON.parse(await metadata('instance/service-accounts/default/token', signal)));
          fresh = { accessToken: token.access_token, expiresAt: started + token.expires_in * 1000 };
          await identity(signal);
        } else {
          const user = tokenResponse.parse(JSON.parse(await read('https://oauth2.googleapis.com/token', signal, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'refresh_token', client_id: source!.value.client_id, client_secret: source!.value.client_secret, refresh_token: source!.value.refresh_token }).toString(),
          })));
          const value = z.object({ accessToken, expireTime: z.iso.datetime() }).strict().parse(JSON.parse(await read(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(config.serviceAccountEmail)}:generateAccessToken`, signal, {
            method: 'POST', headers: { Authorization: `Bearer ${user.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: ['https://www.googleapis.com/auth/cloud-platform'], lifetime: '600s' }),
          })));
          fresh = { accessToken: value.accessToken, expiresAt: Date.parse(value.expireTime) };
          if (fresh.expiresAt - started > 630000 || (await readSource(config.sourceFile)).digest !== sourceDigest) throw fail('credential_changed');
        }
        guard(); signal.throwIfAborted(); if (fresh.expiresAt - now() <= 60000) throw fail(); cached = fresh; return { ...fresh };
      } catch (error) { cached = undefined; if (signal.aborted) throw fail('credential_cancelled'); if (error instanceof GoogleCredentialError) throw error; throw fail(); }
    },
  };
}
