import { z } from 'zod';
import { identityActor } from '../auth/organization-access';
import type { GcpPushPorts, NotificationRecipient } from './notifications';
import type { GcpNotification } from '@contracts/gcp/notifications';
import type { GoogleCredentials } from '../google/credentials';

const configurationSchema = z.object({
  projectId: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/), tenantId: z.string().min(1).max(128).optional(),
  androidPackage: z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/).max(255),
}).strict();
type UserPort = (uid: string) => Promise<{ disabled: boolean; tokensValidAfterTime?: string }>;
type TokenMessage = { token: string; data: Record<string, string>; android: { priority: 'high'; ttl: number; restrictedPackageName: string } };
type SendPort = (message: TokenMessage) => Promise<string>;
// Definite refusals: nothing was accepted for this address. Everything else stays unknown.
const unregistered = new Set(['registration-token-not-registered', 'invalid-registration-token']);
const refused = new Set(['invalid-argument', 'invalid-recipient', 'invalid-payload', 'invalid-data-payload-key', 'payload-size-limit-exceeded', 'mismatched-credential', 'invalid-package-name']);
const errorCode = (error: unknown) => typeof error === 'object' && error && 'code' in error && typeof error.code === 'string' ? error.code.replace(/^messaging\//, '') : '';

/** Current-identity authority for a verified generation-bound subject. Mirrors Firebase revocation:
 * the registering sign-in stays current only while auth_time >= tokensValidAfterTime and the user is enabled. */
export function firebaseNotificationAuthority(configuration: unknown, getUser: UserPort, now = Date.now): GcpPushPorts['current'] {
  const config = configurationSchema.parse(configuration), issuer = `https://securetoken.google.com/${config.projectId}`;
  return async (recipient: NotificationRecipient) => {
    const subject = recipient.subject;
    if (!subject || subject.issuer !== issuer || subject.tenantId !== config.tenantId || identityActor(issuer, subject.subject, config.tenantId) !== recipient.actorId
      || Date.parse(recipient.expiresAt) <= now() || subject.authTime > Date.parse(recipient.registeredAt)) return false;
    try {
      const user = await getUser(subject.subject), validAfter = user.tokensValidAfterTime === undefined ? 0 : Date.parse(user.tokensValidAfterTime);
      return user.disabled === false && Number.isFinite(validAfter) && subject.authTime >= validAfter;
    } catch { return false; }
  };
}

/** Data-only FCM transport for the fixed Android package. The data is the strict locator; no notification text,
 * resource, owner or URL. TTL never outlives the intent. Accepted is FCM acceptance, not device arrival. */
export function fcmNotificationTransport(configuration: unknown, send: SendPort, now = Date.now): GcpPushPorts['send'] {
  const config = configurationSchema.parse(configuration);
  return async (token: string, data: GcpNotification, signal: AbortSignal) => {
    const ttl = Date.parse(data.expiresAt) - now();
    if (signal.aborted) return 'unknown';
    if (!(ttl > 0)) return 'rejected';
    let cancel: (() => void) | undefined;
    const aborted = new Promise<'unknown'>(done => { cancel = () => done('unknown'); signal.addEventListener('abort', cancel, { once: true }); });
    try {
      const attempt = send({ token, data: { ...data }, android: { priority: 'high', ttl, restrictedPackageName: config.androidPackage } })
        .then(id => typeof id === 'string' && id.length > 0 ? 'accepted' as const : 'unknown' as const, error => {
          const code = errorCode(error);
          return unregistered.has(code) ? 'unregistered' as const : refused.has(code) ? 'rejected' as const : 'unknown' as const;
        });
      return await Promise.race([attempt, aborted]);
    } finally { if (cancel) signal.removeEventListener('abort', cancel); }
  };
}

/** Live ports only with explicit live credentials. No emulator downgrade, default project or token logging. */
export async function createFirebaseNotificationPorts(configuration: unknown, explicit: { credentials: GoogleCredentials; instance: string }): Promise<{ ports: GcpPushPorts; close(): Promise<void> }> {
  const config = configurationSchema.parse(configuration);
  const guard = () => {
    if (process.env.MOBILEOPS_OFFLINE_TEST === '1' || process.env.FIREBASE_AUTH_EMULATOR_HOST || explicit.credentials.mode !== 'live') throw Error('Live notification delivery is disabled in this environment.');
  };
  guard();
  const [{ initializeApp, deleteApp }, { getAuth }, { getMessaging }] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/auth'), import('firebase-admin/messaging')]);
  const credential = { async getAccessToken() { guard(); const token = await explicit.credentials.token(AbortSignal.timeout(5000)); return { access_token: token.accessToken, expires_in: Math.floor((token.expiresAt - Date.now()) / 1000) }; } };
  const app = initializeApp({ projectId: config.projectId, credential }, `mobileops-gcp-notifications-${explicit.instance}`);
  const auth = config.tenantId ? getAuth(app).tenantManager().authForTenant(config.tenantId) : getAuth(app), messaging = getMessaging(app);
  return { ports: { dataMode: 'live',
    current: firebaseNotificationAuthority(config, async uid => { guard(); return auth.getUser(uid); }),
    send: fcmNotificationTransport(config, async message => { guard(); return messaging.send(message); }),
  }, close: () => deleteApp(app) };
}
