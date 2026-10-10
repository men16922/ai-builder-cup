import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { SqliteCloudStore } from './cloud-sqlite-store';
import { cloudRecordKey } from './cloud-workflow';
import { cloudDigest } from './cloud-integrity';
import { identityActor } from './cloud-auth';
import { GcpWebAccess } from './modules/gcp/web-access';
import { GcpNotifications, type GcpPushPorts, type NotificationRecipient } from './modules/gcp/notifications';
import { withGcpNotificationIntents } from './modules/gcp/notification-store';
import { GcpNotificationWorker, startGcpNotificationWorker } from './modules/gcp/notification-worker';
import { firebaseIdentityVerifier } from './platform/firebase/cloud-firebase-auth';
import { firebaseNotificationAuthority, fcmNotificationTransport, createFirebaseNotificationPorts } from './platform/firebase/notifications';
import type { GoogleCredentials } from './platform/google/credentials';
import { gcpNotificationSchema, type GcpNotification } from '../src/modules/gcp/domain/notifications';

const at = Date.parse('2026-10-10T01:00:00.000Z'), project = 'example-mobileops-demo', issuer = `https://securetoken.google.com/${project}`;
const uid = 'synthetic-firebase-subject', actor = identityActor(issuer, uid), address = 'synthetic-fcm-address-never-export-0123456789';
const androidPackage = 'app.mobileops.agent';

async function setup(t: TestContext, options: { live?: boolean } = {}) {
  let clock = at; const now = () => clock;
  const store = new SqliteCloudStore(':memory:'); t.after(() => store.close());
  const firebase = firebaseIdentityVerifier({ projectId: project }, async value => {
    if (value !== 'synthetic-firebase-token') throw Error();
    return { iss: issuer, aud: project, uid, sub: uid, exp: at / 1000 + 3600, iat: at / 1000 - 30, auth_time: at / 1000 - 60 };
  }, now);
  // A plain verifier proves the same actor without a provider subject.
  const access = new GcpWebAccess({ verify: value => value === 'synthetic-plain-token' ? Promise.resolve({ actorId: actor, expiresAt: at + 3600000 }) : firebase.verify(value) }, store, now);
  const recipients: NotificationRecipient[] = [], sent: { token: string; data: GcpNotification }[] = [];
  let send: GcpPushPorts['send'] = async (token, data) => { sent.push({ token, data }); return 'accepted'; };
  const ports: GcpPushPorts = { dataMode: options.live ? 'live' : 'synthetic', async current(recipient) { recipients.push(recipient); return true; }, send: (...args) => send(...args) };
  // Test-only: exercises live recipient rules with fake ports; the offline guard and live adapters stay untouched.
  class OfflineNotifications extends GcpNotifications { override get available() { return true; } }
  const notifications = new OfflineNotifications(store, access, ports, now);
  const workspace = { edition: 'personal' as const, workspaceId: 'synthetic-workspace', label: 'Synthetic' };
  const session = (bearer = 'synthetic-firebase-token') => access.authenticate(`Bearer ${bearer}`, workspace, 'mobile');
  const fixture = JSON.parse(readFileSync('mobile/android/core/src/main/resources/synthetic-personal.json', 'utf8'))[0];
  const plan = structuredClone(fixture.initial.plan); plan.review = { status: 'not_requested' };
  plan.payload.owner = { kind: 'personal', userId: actor }; plan.payload.workspaceId = workspace.workspaceId; plan.payload.dataMode = ports.dataMode; plan.digest = cloudDigest(plan.payload);
  const scope = { owner: plan.payload.owner, workspaceId: workspace.workspaceId }, planKey = cloudRecordKey(scope, 'plan', plan.payload.planId);
  await store.transact(async tx => { await tx.get(planKey); tx.put(planKey, plan); });
  const request = (status: 'pending' | 'not_requested' = 'pending') => withGcpNotificationIntents(store, now).transact(async tx => {
    const value = await tx.get<typeof plan>(planKey);
    value.review = status === 'pending' ? { status, requestedAt: new Date(clock).toISOString(), requestedBy: actor } : { status }; tx.put(planKey, value);
  });
  const register = async (bearer?: string, token = address) => notifications.register(await session(bearer), { installationId: randomUUID(), expectedGeneration: null, token }, randomUUID());
  const records = () => (store as unknown as { db: DatabaseSync }).db.prepare('SELECT key, payload FROM cloud_records').all() as { key: string; payload: string }[];
  return { store, notifications, session, register, request, records, recipients, sent, scope, sender(next: GcpPushPorts['send']) { send = next; }, advance(ms: number) { clock += ms; } };
}

test('a verified Firebase subject is bound privately to one registration generation and reaches only the trusted authority', async t => {
  const s = await setup(t), receipt = await s.register();
  assert.deepEqual(Object.keys(receipt).sort(), ['active', 'expiresAt', 'generation', 'installationId']);
  await s.request();
  const worker = new GcpNotificationWorker(s.notifications);
  assert.deepEqual(await worker.tick(), { attempted: 1, states: { accepted: 1 }, complete: true, failed: false });
  assert.equal(s.recipients.length, 2); assert.deepEqual(s.recipients[0].subject, { issuer, subject: uid, authTime: at - 60000 });
  assert.equal(s.recipients[0].actorId, actor); assert.equal(s.sent[0].token, address);
  assert.deepEqual(Object.keys(gcpNotificationSchema.parse(s.sent[0].data)).sort(), ['expiresAt', 'generation', 'installationId', 'notificationId', 'planId', 'planVersion', 'provider', 'schemaVersion']);
  // Only the private address and recipient records hold the address or the provider subject.
  for (const record of s.records()) {
    if (record.payload.includes(uid)) assert.match(record.key, /^gcp-push-recipient:[a-f0-9]{64}$/);
    if (record.payload.includes(address)) assert.match(record.key, /^gcp-push-address:[a-f0-9]{64}$/);
  }
  assert.equal(s.records().filter(record => record.payload.includes(uid)).length, 1);
  // Settled pairs are not attempted again by the same process; a fresh worker reads the durable state without resending.
  assert.equal((await worker.tick()).attempted, 0);
  assert.deepEqual((await new GcpNotificationWorker(s.notifications).tick()).states, { accepted: 1 }); assert.equal(s.sent.length, 1);
});

test('revocation, retirement and replacement drop the private subject with the address', async t => {
  const s = await setup(t), session = await s.session();
  const input = { installationId: randomUUID(), expectedGeneration: null, token: address }, key = randomUUID();
  const first = await s.notifications.register(session, input, key);
  const replaced = await s.notifications.register(session, { ...input, expectedGeneration: first.generation, token: address + 'rotated' }, randomUUID());
  const subjects = () => s.records().filter(record => record.payload.includes(uid)).map(record => record.key);
  assert.equal(subjects().length, 1);
  await s.notifications.revoke(session, { installationId: input.installationId, expectedGeneration: replaced.generation });
  assert.equal(subjects().length, 0);
  const retiredKey = randomUUID(), other = await s.notifications.register(session, { installationId: randomUUID(), expectedGeneration: null, token: address + 'other' }, retiredKey);
  assert.equal(subjects().length, 1);
  await s.notifications.retire(session, { installationId: other.installationId, registrationKey: retiredKey });
  assert.equal(subjects().length, 0);
  assert.equal(s.records().filter(record => record.payload.includes(address)).length, 0);
});

test('live delivery requires a verified subject at registration and at dispatch', async t => {
  const s = await setup(t, { live: true });
  await assert.rejects(s.register('synthetic-plain-token'), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'notification_identity_unavailable');
  const receipt = await s.register(); await s.request();
  const subjectKey = `gcp-push-recipient:${cloudDigest(receipt.generation)}`;
  await s.store.transact(async tx => { await tx.get(subjectKey); tx.put(subjectKey, { generation: receipt.generation, revoked: true }); });
  const [event] = (await s.notifications.pending(s.scope)).events;
  assert.equal(await s.notifications.deliver(s.scope, event, receipt.installationId), 'suppressed'); assert.equal(s.sent.length, 0); assert.equal(s.recipients.length, 0);
  // A tampered subject that does not derive the device actor is ignored rather than trusted.
  await s.store.transact(async tx => { await tx.get(subjectKey); tx.put(subjectKey, { issuer, subject: 'synthetic-other-subject', authTime: at - 60000, generation: receipt.generation, actorId: actor }); });
  assert.equal(await s.notifications.deliver(s.scope, event, receipt.installationId), 'suppressed'); assert.equal(s.sent.length, 0);
});

test('a definite unregistered address is rejected once, deactivates only its generation and is never resent', async t => {
  const s = await setup(t), receipt = await s.register(); await s.request();
  let sends = 0; s.sender(async () => { sends++; return 'unregistered'; });
  const [event] = (await s.notifications.pending(s.scope)).events;
  assert.equal(await s.notifications.deliver(s.scope, event, receipt.installationId), 'rejected');
  assert.equal(await s.notifications.deliver(s.scope, event, receipt.installationId), 'rejected'); assert.equal(sends, 1);
  assert.equal(s.records().filter(record => record.payload.includes(address) || record.payload.includes(uid)).length, 0);
  // The deactivated generation receives no later intent.
  s.advance(1000); await s.request('not_requested'); s.advance(1000); await s.request();
  const [later] = (await s.notifications.pending(s.scope)).events; assert.notEqual(later, event);
  assert.equal(await s.notifications.deliver(s.scope, later, receipt.installationId), 'suppressed'); assert.equal(sends, 1);
  // The same installation can register again with a fresh address.
  const renewed = await s.notifications.register(await s.session(), { installationId: receipt.installationId, expectedGeneration: receipt.generation, token: address + 'renewed' }, randomUUID());
  assert.equal(renewed.active, true);
});

test('the worker is budgeted, makes progress across ticks, survives store failure and stops without starting new attempts', async t => {
  const s = await setup(t);
  for (let i = 0; i < 3; i++) await s.register(undefined, `${address}-${i}`);
  await s.request(); s.advance(1000); await s.request('not_requested'); s.advance(1000); await s.request();
  const events = (await s.notifications.pending(s.scope)).events; assert.equal(events.length, 2);
  const worker = new GcpNotificationWorker(s.notifications, 4);
  const first = await worker.tick(); assert.equal(first.attempted, 4); assert.equal(first.complete, false);
  const second = await worker.tick(); assert.equal(second.attempted, 2); assert.equal(second.complete, true);
  assert.equal(s.sent.length, 6); assert.equal(new Set(s.sent.map(value => `${value.data.notificationId}:${value.data.installationId}`)).size, 6);
  const broken = new GcpNotificationWorker(Object.assign(Object.create(s.notifications), { recipientScopes: async () => { throw Error('Synthetic store outage'); } }));
  assert.deepEqual(await broken.tick(), { attempted: 0, states: {}, complete: false, failed: true });
  const stopped = new AbortController(); stopped.abort();
  assert.equal((await new GcpNotificationWorker(s.notifications).tick(stopped.signal)).attempted, 0);
  assert.throws(() => new GcpNotificationWorker(s.notifications, 0)); assert.throws(() => startGcpNotificationWorker(s.notifications, { intervalMs: 10 }));
  assert.throws(() => startGcpNotificationWorker(new GcpNotifications(s.store, new GcpWebAccess({ async verify() { throw Error(); } }, s.store))), /not configured/);
  const running = startGcpNotificationWorker(s.notifications, { intervalMs: 1000, stopWaitMs: 1000 }); await running.stop(); await running.stop();
  assert.equal(s.sent.length, 6);
});

test('Firebase authority mirrors revocation and disabled users and fails closed on any mismatch', async () => {
  const now = () => at, users = new Map<string, { disabled: boolean; tokensValidAfterTime?: string }>();
  const lookups: string[] = [], current = firebaseNotificationAuthority({ projectId: project, androidPackage }, async value => {
    lookups.push(value); const user = users.get(value); if (!user) throw Object.assign(Error('missing'), { code: 'auth/user-not-found' }); return user;
  }, now);
  const recipient: NotificationRecipient = { actorId: actor, owner: { kind: 'personal', userId: actor }, workspaceId: 'synthetic-workspace',
    registeredAt: new Date(at - 1000).toISOString(), expiresAt: new Date(at + 3600000).toISOString(), subject: { issuer, subject: uid, authTime: at - 60000 } };
  assert.equal(await current(recipient), false);
  users.set(uid, { disabled: false }); assert.equal(await current(recipient), true);
  users.set(uid, { disabled: false, tokensValidAfterTime: new Date(at - 120000).toUTCString() }); assert.equal(await current(recipient), true);
  users.set(uid, { disabled: false, tokensValidAfterTime: new Date(at - 30000).toUTCString() }); assert.equal(await current(recipient), false);
  users.set(uid, { disabled: false, tokensValidAfterTime: 'not a time' }); assert.equal(await current(recipient), false);
  users.set(uid, { disabled: true }); assert.equal(await current(recipient), false);
  users.set(uid, { disabled: false }); const calls = lookups.length;
  for (const changed of [{ subject: undefined }, { actorId: identityActor(issuer, 'synthetic-other') }, { expiresAt: new Date(at).toISOString() },
    { subject: { ...recipient.subject!, issuer: 'https://securetoken.google.com/example-other-demo' } }, { subject: { ...recipient.subject!, tenantId: 'synthetic-tenant' } },
    { subject: { ...recipient.subject!, authTime: at } }]) assert.equal(await current({ ...recipient, ...changed }), false);
  assert.equal(lookups.length, calls);
  const tenant = firebaseNotificationAuthority({ projectId: project, tenantId: 'synthetic-tenant', androidPackage }, async () => ({ disabled: false }), now);
  assert.equal(await tenant(recipient), false);
  assert.equal(await tenant({ ...recipient, actorId: identityActor(issuer, uid, 'synthetic-tenant'), subject: { ...recipient.subject!, tenantId: 'synthetic-tenant' } }), true);
  assert.throws(() => firebaseNotificationAuthority({ projectId: project }, async () => ({ disabled: false })));
});

test('FCM transport sends one data-only message for the fixed package and classifies only definite refusals', async () => {
  const data = gcpNotificationSchema.parse({ schemaVersion: '1', provider: 'gcp', notificationId: 'a'.repeat(64), installationId: randomUUID(), generation: randomUUID(),
    planId: randomUUID(), planVersion: '1', expiresAt: new Date(at + 600000).toISOString() });
  const messages: unknown[] = []; let result: () => Promise<string> = async () => 'projects/example-mobileops-demo/messages/synthetic';
  const send = fcmNotificationTransport({ projectId: project, androidPackage }, async message => { messages.push(message); return result(); }, () => at);
  assert.equal(await send(address, data, new AbortController().signal), 'accepted');
  assert.deepEqual(messages[0], { token: address, data: { ...data }, android: { priority: 'high', ttl: 600000, restrictedPackageName: androidPackage } });
  assert.doesNotMatch(JSON.stringify(messages[0]), /notification"|title|body|resource|owner|https?:/);
  const fail = (code: string) => async () => { throw Object.assign(Error('synthetic'), { code }); };
  for (const [code, state] of [['messaging/registration-token-not-registered', 'unregistered'], ['messaging/invalid-registration-token', 'unregistered'],
    ['messaging/invalid-argument', 'rejected'], ['messaging/mismatched-credential', 'rejected'], ['messaging/invalid-package-name', 'rejected'],
    ['messaging/server-unavailable', 'unknown'], ['messaging/internal-error', 'unknown'], ['messaging/message-rate-exceeded', 'unknown'], ['', 'unknown']] as const) {
    result = fail(code); assert.equal(await send(address, data, new AbortController().signal), state, code);
  }
  result = async () => ''; assert.equal(await send(address, data, new AbortController().signal), 'unknown');
  const abort = new AbortController(); result = () => new Promise(() => {});
  const pending = send(address, data, abort.signal); abort.abort(); assert.equal(await pending, 'unknown');
  const count = messages.length; assert.equal(await send(address, data, abort.signal), 'unknown'); assert.equal(messages.length, count);
  assert.equal(await send(address, { ...data, expiresAt: new Date(at).toISOString() }, new AbortController().signal), 'rejected'); assert.equal(messages.length, count);
});

test('live Firebase notification ports refuse to initialize in the offline gate before any SDK or token use', async () => {
  let tokens = 0;
  const credentials: GoogleCredentials = { principal: 'synthetic@example-mobileops-demo.iam.gserviceaccount.com', sessionId: 'synthetic', mode: 'live', close() {},
    async token() { tokens++; throw Error('must not mint'); } } as GoogleCredentials;
  await assert.rejects(createFirebaseNotificationPorts({ projectId: project, androidPackage }, { credentials, instance: randomUUID() }), /disabled/);
  assert.equal(tokens, 0);
});
