import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { OrganizationWebAccess, membershipKey, membershipSchema } from '../server/cloud-auth';
import { readGcpConfiguration } from '../server/platform/firebase/load-gcp';
import { createFirestoreCloudStore } from '../server/platform/firebase/cloud-firestore-store';

/** Trusted operator bootstrap for one organization membership. Not an HTTP route.
 * The operator's short-lived access token is read from stdin only; it is never an argument, env value or log line. */
const usage = 'Usage: provision-gcp-membership.ts --config /abs/gcp-server.json --organization ID --workspace ID --actor ACTOR_ID --roles operator,reviewer [--inactive] < access-token';
const args = process.argv.slice(2), flag = (name: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };
if (process.env.MOBILEOPS_OFFLINE_TEST === '1') throw Error('Membership provisioning writes the configured live store; it is disabled offline.');
const configPath = flag('config'), organizationId = flag('organization'), workspaceId = flag('workspace'), actorId = flag('actor'), roles = flag('roles')?.split(',');
if (!configPath || !organizationId || !workspaceId || !actorId || !roles) throw Error(usage);
const config = await readGcpConfiguration(configPath);
if (!config.scopes.some(scope => scope.edition === 'organization' && scope.organizationId === organizationId && scope.workspaceId === workspaceId)) throw Error('The organization workspace is not configured.');
const token = z.string().regex(/^[A-Za-z0-9._~+/=-]{20,4096}$/).parse(readFileSync(0, 'utf8').trim());
const store = await createFirestoreCloudStore(config.store, { principal: 'operator-bootstrap', sessionId: randomUUID(), mode: 'live', close() {},
  async token() { return { accessToken: token, expiresAt: Date.now() + 300000 }; } });
try {
  const key = membershipKey(organizationId, workspaceId, actorId);
  const previous = membershipSchema.optional().parse(await store.transact(tx => tx.get(key)));
  const access = new OrganizationWebAccess({ async verify() { throw Error('No identity verification during bootstrap.'); } }, store);
  await access.provision({ organizationId, workspaceId, actorId, active: !args.includes('--inactive'), roles, version: (previous?.version ?? 0) + 1, updatedAt: new Date().toISOString() });
  console.log(`Membership version ${(previous?.version ?? 0) + 1} provisioned for the configured workspace.`);
} finally { await store.close(); }
