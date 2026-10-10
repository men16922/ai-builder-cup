import { readFile } from 'node:fs/promises';
import { composeGcpServices } from '../modules/gcp/composition';
import { FirestoreCloudStore } from '../platform/firebase/cloud-firestore-store';
import { principalKey } from '../modules/gcp/cloud-run-transport';
/** Offline test port only. Never imported by a hosted entry or shipped in the candidate. */
export async function hostedFixture(ports = { composeGcpServices, FirestoreCloudStore, principalKey }) {
  if (process.env.MOBILEOPS_OFFLINE_TEST !== '1') throw Error('Offline fixture only');
  const config = JSON.parse(await readFile('deploy/gcp-server.example.json', 'utf8')); config.publicOrigin = 'http://127.0.0.1'; config.model.enabled = true;
  const data = new Map<string, unknown>(); let closed = 0, reads = 0, models = 0, locked = Promise.resolve();
  const store = new ports.FirestoreCloudStore({ async runTransaction(body) {
    const previous = locked; let release!: () => void; locked = new Promise(done => { release = done; }); await previous;
    try { const writes = new Map<string, unknown>(); const result = await body({ async get(id) { return structuredClone(data.get(id)); }, set(id, value) { writes.set(id, structuredClone(value)); } }); for (const [id, value] of writes) data.set(id, value); return result; } finally { release(); }
  }, async close() { closed++; } });
  const principal = config.credentials.serviceAccountEmail, sessionId = 'synthetic-session';
  const services = ports.composeGcpServices(config, { store, mode: 'synthetic', principal, sessionId,
    identity: { async verify(token) { if (token !== 'synthetic-member') throw Error(); return { actorId: token, expiresAt: Date.now() + 60000 }; } },
    model: { engine: 'synthetic-fixture', modelId: config.model.modelId, configurationId: 'synthetic-hosted-v1', async analyze() { models++; return { summary: 'Synthetic readiness observation; health unknown.', findings: [{ statement: 'Service readiness succeeded.', evidenceIds: ['gcp-run-service'], kind: 'observation' }], missingInformation: ['Logs, metrics, probes and change history were not collected.'], serviceAssessment: 'unknown' }; } },
    transport(binding) { const target = binding.target; if (target.provider !== 'gcp') throw Error(); return { dataMode: 'synthetic', async identity() { return ports.principalKey({ principal, sessionId }); }, async read(kind) {
      reads++; const common = { generation: '1', observedGeneration: '1', reconciling: false, updateTime: '2026-10-10T00:00:00.000Z' };
      return kind === 'service' ? { ...common, name: target.resourceName, uid: target.resourceUid, terminalCondition: { state: 'CONDITION_SUCCEEDED' }, latestCreatedRevision: target.revision, latestReadyRevision: target.revision, trafficStatuses: [{ revision: target.revision, percent: 100 }] }
        : { ...common, name: `${target.resourceName}/revisions/${target.revision}`, uid: 'synthetic-revision-uid', service: target.resourceName, conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }] };
    } }; },
  });
  const scope = config.scopes[0];
  await services.access.organization.provision({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, actorId: 'synthetic-member', active: true, roles: ['operator', 'reviewer'], version: 1, updatedAt: new Date().toISOString() });
  return { services, close: () => store.close(), counts: () => ({ closed, reads, models }), base: `/api/organizations/v1/${scope.organizationId}/workspaces/${scope.workspaceId}/gcp`, resourceId: config.resources[0].id };
}
