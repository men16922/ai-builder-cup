import { z } from 'zod';
import { CloudOperationError } from '@contracts/core/workflow';
import { identityActor, type WebIdentityVerifier } from './organization-access';
import type { GoogleCredentials } from '../google/credentials';

const configurationSchema = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/), tenantId: z.string().min(1).max(128).optional() }).strict();
const claimsSchema = z.object({ iss: z.string(), aud: z.string(), sub: z.string().min(1).max(128), uid: z.string().min(1).max(128),
  exp: z.number().int(), iat: z.number().int(), auth_time: z.number().int(), firebase: z.object({ tenant: z.string().optional() }).optional() });
type FirebaseTokenVerifier = (token: string, checkRevoked: true) => Promise<unknown>;

/** SDK invocation is injectable for offline tests; a decoded browser payload is never accepted. */
export function firebaseIdentityVerifier(configuration: unknown, verifyToken: FirebaseTokenVerifier, now = Date.now): WebIdentityVerifier {
  const config = configurationSchema.parse(configuration), issuer = `https://securetoken.google.com/${config.projectId}`;
  return { async verify(token) {
    try {
      const value = claimsSchema.parse(await verifyToken(token, true)), seconds = now() / 1000;
      if (value.iss !== issuer || value.aud !== config.projectId || value.uid !== value.sub || value.exp <= seconds
        || value.iat > seconds + 30 || value.auth_time > seconds + 30 || value.auth_time > value.iat || value.iat >= value.exp
        || value.firebase?.tenant !== config.tenantId) throw new Error('Invalid identity scope');
      const recipient = Object.freeze({ issuer, ...(config.tenantId ? { tenantId: config.tenantId } : {}), subject: value.sub, authTime: value.auth_time * 1000 });
      return Object.freeze({ actorId: identityActor(issuer, value.sub, config.tenantId), expiresAt: value.exp * 1000, recipient });
    } catch { throw new CloudOperationError(401, 'web_sign_in_required', 'Sign in to the web application again.'); }
  } };
}

/** No default project, emulator downgrade, token logging or credential JSON supplied by the browser. */
export async function createFirebaseIdentityVerifier(configuration: unknown, explicit?: { credentials: GoogleCredentials; instance: string }): Promise<WebIdentityVerifier & { close?(): Promise<void> }> {
  const config = configurationSchema.parse(configuration);
  const guard = () => {
    if (process.env.MOBILEOPS_OFFLINE_TEST === '1' || process.env.FIREBASE_AUTH_EMULATOR_HOST || explicit && explicit.credentials.mode !== 'live') throw new CloudOperationError(503, 'live_identity_disabled', 'Live identity verification is disabled in this environment.');
  };
  guard();
  const [{ initializeApp, getApps, applicationDefault, deleteApp }, { getAuth }] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/auth')]);
  const credential = explicit ? { async getAccessToken() { guard(); const token = await explicit.credentials.token(AbortSignal.timeout(5000)); return { access_token: token.accessToken, expires_in: Math.floor((token.expiresAt - Date.now()) / 1000) }; } } : applicationDefault();
  const name = explicit ? `mobileops-gcp-web-${explicit.instance}` : `mobileops-web-${config.projectId}`, app = getApps().find(value => value.name === name) ?? initializeApp({ projectId: config.projectId, credential }, name);
  const auth = config.tenantId ? getAuth(app).tenantManager().authForTenant(config.tenantId) : getAuth(app);
  const verifier = firebaseIdentityVerifier(config, async (token, checkRevoked) => { guard(); if (explicit) await explicit.credentials.token(AbortSignal.timeout(5000)); return auth.verifyIdToken(token, checkRevoked); });
  return { ...verifier, ...(explicit ? { close: () => deleteApp(app) } : {}) };
}
