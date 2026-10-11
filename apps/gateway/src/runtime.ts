// Trusted composition exports for independent artifact verification and platform adapters.
// They are not HTTP endpoints and do not initialize credentials or provision membership.
export { startGcpHosted, loadHostedAssets, hostedEnvironment, hostedConfiguration } from './http/server';
export { composeGcpServices } from './config/composition';
export { startGcpNotificationWorker } from './notifications/notification-worker';
export { FirestoreCloudStore } from './store/firestore-store';
export { principalKey } from './cloud-run/transport';
