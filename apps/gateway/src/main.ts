import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostedEnvironment, hostedConfiguration, startGcpHosted, type HostedServices } from './http/server';
import { readGcpConfiguration } from './config/load';
import { createFirebaseGcpServices } from './config/firebase-services';
import { startGcpNotificationWorker } from './notifications/notification-worker';

// GCP-only hosted entry. No local/demo startup, AWS router or credential discovery.
// The notification worker starts only with explicit notification configuration.
let stopRequested = false, runtime: Awaited<ReturnType<typeof startGcpHosted>> | undefined, worker: ReturnType<typeof startGcpNotificationWorker> | undefined;
let composition: HostedServices | undefined, stop: Promise<void> | undefined;
function shutdown() {
  stopRequested = true;
  if (!runtime) return;
  const active = runtime;
  stop ??= (worker?.stop() ?? Promise.resolve()).then(() => active.close()).then(outcome => { console.log(`Aide GCP shutdown: ${outcome}.`); process.exit(outcome === 'drained' ? 0 : 1); });
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw Error('Node.js 24 or newer is required.');
  const env = hostedEnvironment(process.env), config = hostedConfiguration(await readGcpConfiguration(env.configurationPath));
  if (stopRequested) process.exit(0);
  composition = await createFirebaseGcpServices(config, true);
  if (stopRequested) { await composition.close(); process.exit(0); }
  runtime = await startGcpHosted(composition, join(dirname(fileURLToPath(import.meta.url)), 'web'), { port: env.port, host: '0.0.0.0' });
  if (config.notifications?.enabled && !stopRequested) worker = startGcpNotificationWorker(composition.services.notifications!);
  if (stopRequested) shutdown(); else console.log('Aide GCP web/API ready. Provider access requires web identity and explicit requests.');
} catch {
  console.error('Aide GCP hosted startup failed. Check enabled flags, configuration, runtime identity and built assets.');
  process.exitCode = 1;
}
