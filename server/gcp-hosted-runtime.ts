// Trusted composition exports for independent artifact verification and platform adapters.
// They are not HTTP endpoints and do not initialize credentials or provision membership.
export { startGcpHosted, loadHostedAssets, hostedEnvironment, hostedConfiguration } from './modules/gcp/hosted';
export { composeGcpServices } from './modules/gcp/composition';
export { startGcpNotificationWorker } from './modules/gcp/notification-worker';
export { FirestoreCloudStore } from './platform/firebase/cloud-firestore-store';
export { principalKey } from './modules/gcp/cloud-run-transport';
