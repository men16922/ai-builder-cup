import { randomUUID } from 'node:crypto';
import { gcpServerConfiguration } from './configuration';
import { composeGcpServices } from './composition';
import { createCloudRunRestTransport } from '../cloud-run/transport';
import { createCloudRunTelemetryTransport } from '../cloud-run/telemetry-transport';
import { createGeminiModel, GeminiError, type GcpAnalysisModel } from '../google/gemini';
import { createGoogleCredentials } from '../google/credentials';
import { createFirebaseIdentityVerifier } from '../auth/firebase-identity';
import { createFirestoreCloudStore } from '../store/firestore-store';
import { createFirebaseNotificationPorts } from '../notifications/firebase-push';
import { httpChiefPort, metadataIdToken } from '../crew/chief-a2a';
/** Explicit startup configuration, no membership bootstrap or discovery of host gcloud credentials. */
export async function createFirebaseGcpServices(input: unknown, enabled: boolean) {
  const config = gcpServerConfiguration.parse(input);
  const credentials = await createGoogleCredentials(config.credentials, enabled);
  let store: Awaited<ReturnType<typeof createFirestoreCloudStore>> | undefined;
  let identity: Awaited<ReturnType<typeof createFirebaseIdentityVerifier>> | undefined;
  let notifications: Awaited<ReturnType<typeof createFirebaseNotificationPorts>> | undefined;
  const current = async (signal: AbortSignal) => ({ principal: credentials.principal, sessionId: credentials.sessionId, accessToken: (await credentials.token(signal)).accessToken });
  try {
    identity = await createFirebaseIdentityVerifier({ projectId: config.firebase.projectId, ...(config.firebase.tenantId ? { tenantId: config.firebase.tenantId } : {}) }, { credentials, instance: randomUUID() });
    store = await createFirestoreCloudStore(config.store, credentials);
    if (config.notifications?.enabled) notifications = await createFirebaseNotificationPorts({ projectId: config.firebase.projectId, ...(config.firebase.tenantId ? { tenantId: config.firebase.tenantId } : {}), androidPackage: config.notifications.androidPackage }, { credentials, instance: randomUUID() });
    const model: GcpAnalysisModel = config.model.enabled
      ? createGeminiModel({ enabled: true, projectId: config.projectId, location: config.model.location, modelId: config.model.modelId, principal: credentials.principal, sessionId: credentials.sessionId, credentials: { current } })
      : { enabled: false, engine: 'gemini', modelId: config.model.modelId, configurationId: 'disabled', async analyze() { throw new GeminiError('model_disabled'); } };
    const approvalKey = Buffer.from(process.env.AGENT_APPROVAL_KEY ?? '', 'utf8');
    if (config.agents?.enabled && approvalKey.length < 32) throw Error('AGENT_APPROVAL_KEY is required when the agent gateway is enabled.');
    const agents = config.agents?.enabled ? { chief: httpChiefPort(config.agents.chiefUrl, metadataIdToken()), approvalKey, overview: { token: async (signal: AbortSignal) => (await credentials.token(signal)).accessToken } } : undefined;
    const services = composeGcpServices(config, { identity, store, agents, mode: credentials.mode, principal: credentials.principal, sessionId: credentials.sessionId, model, notifications: notifications?.ports,
      telemetry: binding => createCloudRunTelemetryTransport({ binding, enabled: true, principal: credentials.principal, sessionId: credentials.sessionId, credentials: { current } }),
      transport: binding => createCloudRunRestTransport({ binding, enabled: true, offline: false, principal: credentials.principal, sessionId: credentials.sessionId, credentials: { current } }) });
    return { services, async close() { credentials.close(); await Promise.all([store?.close(), identity?.close?.(), notifications?.close()]); } };
  } catch { credentials.close(); await Promise.allSettled([store?.close(), identity?.close?.(), notifications?.close()]); throw Error('GCP services could not be initialized. Check the explicit server configuration.'); }
}
