import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CloudOperationError } from '@contracts/core/workflow';
import { gcpDeviceRequestSchema, gcpDeviceRevokeSchema, gcpDeviceRetireSchema, gcpDeviceReceiptSchema, gcpNotificationSchema, type GcpNotification } from '@contracts/gcp/notifications';
import { cloudDigest } from '../store/integrity';
import { identityActor, membershipKey, membershipSchema, type VerifiedRecipientSubject } from '../auth/organization-access';
import type { CloudStore, CloudTransaction } from '../store/store';
import { cloudRecordKey } from '../workflow/workflow';
import type { GcpWebAccess, GcpWebSession } from '../auth/web-access';
import { notificationScopeSchema, notificationEventSchema, notificationIndexSchema, notificationIndexKey, notificationEventKey, type NotificationEvent, type NotificationScope } from './notification-store';

const id = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const deviceSchema = notificationScopeSchema.extend({
  installationId: id, generation: id, actorId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/),
  active: z.boolean(), registeredAt: z.iso.datetime(), expiresAt: z.iso.datetime(), tokenHash: hash,
  membershipVersion: z.number().int().positive().optional(),
}).strict();
type Device = z.infer<typeof deviceSchema>;
type Delivery = { state: 'reserved' | 'accepted' | 'rejected' | 'suppressed' | 'unknown'; claim: string; expiresAt: string };
const deliverySchema = z.object({ state: z.enum(['reserved', 'accepted', 'rejected', 'suppressed', 'unknown']), claim: id, expiresAt: z.iso.datetime() }).strict();
const subjectSchema = z.object({ issuer: z.url().max(256), tenantId: z.string().min(1).max(128).optional(), subject: z.string().min(1).max(128), authTime: z.number().int().nonnegative() }).strict();
const recipientRecordSchema = subjectSchema.extend({ generation: id, actorId: deviceSchema.shape.actorId }).strict();
const scopeIndexSchema = z.array(notificationScopeSchema).max(100);
const deviceKey = (installation: string) => `gcp-device:${cloudDigest(installation)}`;
const addressKey = (tokenHash: string) => `gcp-push-address:${tokenHash}`;
// Private generation-bound provider subject; same exclusions as the push address.
const recipientKey = (generation: string) => `gcp-push-recipient:${cloudDigest(generation)}`;
const scopesKey = 'gcp-notification-recipient-scopes';
const verifiedSubject = (actorId: string, value: unknown): VerifiedRecipientSubject | undefined => {
  const parsed = subjectSchema.safeParse(value);
  return parsed.success && identityActor(parsed.data.issuer, parsed.data.subject, parsed.data.tenantId) === actorId ? Object.freeze(parsed.data) : undefined;
};
const devicesKey = (scope: NotificationScope) => cloudRecordKey(scope, 'gcp-devices', 'active');
const sameScope = (a: NotificationScope, b: NotificationScope) => cloudDigest([a.owner, a.workspaceId]) === cloudDigest([b.owner, b.workspaceId]);
const unavailable = (code = 'notification_unavailable', status = 409) => new CloudOperationError(status, code, 'Refresh the GCP inbox or enable notifications again.');
const receipt = (device: Device) => gcpDeviceReceiptSchema.parse({ installationId: device.installationId, generation: device.generation, active: device.active, expiresAt: device.expiresAt });
/** Reads first, then returns the writes that deactivate one generation and drop its private address and subject. */
async function deactivation(tx: CloudTransaction, key: string, device: Device) {
  const tokenKey = addressKey(device.tokenHash), subjectKey = recipientKey(device.generation);
  const address = await tx.get<{ generation: string }>(tokenKey), subject = await tx.get(subjectKey);
  return () => {
    device.active = false;
    if (address?.generation === device.generation) tx.put(tokenKey, { generation: device.generation, revoked: true });
    if (subject) tx.put(subjectKey, { generation: device.generation, revoked: true });
    tx.put(key, device);
  };
}
/** subject is the verified provider identity captured at registration; absent for synthetic verifiers. */
export type NotificationRecipient = Pick<Device, 'actorId' | 'owner' | 'workspaceId' | 'registeredAt' | 'expiresAt'> & { subject?: VerifiedRecipientSubject };
/** Trusted worker-only ports; not an HTTP request, model tool or client-selected endpoint.
 * Authority must check identity revocation/disabled user since registeredAt. Membership is also checked in storage.
 * Accepted means transport acceptance, never delivery to a phone. Unregistered is a definite rejection of a stale address. */
export interface GcpPushPorts {
  dataMode: 'synthetic' | 'live';
  current(recipient: NotificationRecipient): Promise<boolean>;
  send(token: string, data: GcpNotification, signal: AbortSignal): Promise<'accepted' | 'rejected' | 'unregistered' | 'unknown'>;
}

export class GcpNotifications {
  private readonly store: CloudStore; private readonly access: GcpWebAccess; private readonly ports?: GcpPushPorts; private readonly now: () => number;
  constructor(store: CloudStore, access: GcpWebAccess, ports?: GcpPushPorts, now = Date.now) { this.store = store; this.access = access; this.ports = ports; this.now = now; }
  get available() { return !!this.ports && !(process.env.MOBILEOPS_OFFLINE_TEST === '1' && this.ports.dataMode !== 'synthetic'); }
  private enabled() { if (!this.available) throw unavailable('notifications_not_configured', 503); }
  private async mobile(session: GcpWebSession, requireEnabled = true) {
    if (requireEnabled) this.enabled(); if (session.context.channel !== 'mobile') throw unavailable('notification_scope_denied', 403);
    await this.access.current(session);
  }
  /** CAS plus replay: an old registration response cannot resurrect a revoked/replaced generation. */
  async register(session: GcpWebSession, raw: unknown, requestKey: string) {
    const input = gcpDeviceRequestSchema.parse(raw); id.parse(requestKey); await this.mobile(session);
    const generation = randomUUID(), fingerprint = cloudDigest(input), tokenHash = cloudDigest(input.token);
    const subject = session.identity.recipient && verifiedSubject(session.context.actorId, session.identity.recipient);
    if (this.ports!.dataMode === 'live' && !subject) throw unavailable('notification_identity_unavailable', 503);
    const replayKey = cloudRecordKey(session.context, 'gcp-device-request', cloudDigest([session.context.actorId, requestKey]));
    return this.store.transact(async tx => {
      await this.access.assertCurrentIn(tx, session);
      if (await tx.get(`${replayKey}:retired`)) throw unavailable('registration_retired');
      const key = deviceKey(input.installationId), previous = deviceSchema.optional().parse(await tx.get(key));
      const replay = await tx.get<{ fingerprint: string; generation: string }>(replayKey);
      if (previous && previous.actorId !== session.context.actorId) throw unavailable('notification_scope_denied', 403);
      if (replay) {
        if (replay.fingerprint !== fingerprint || !previous?.active || !sameScope(previous, session.context) || previous.generation !== replay.generation
          || previous.membershipVersion !== session.organization?.membershipVersion || Date.parse(previous.expiresAt) <= this.now()) throw unavailable();
        const address = await tx.get<{ generation: string }>(addressKey(previous.tokenHash));
        if (address?.generation !== previous.generation) throw unavailable();
        return receipt(previous);
      }
      if ((previous?.generation ?? null) !== input.expectedGeneration) throw unavailable('device_generation_changed');
      const indexKey = devicesKey(session.context), index = z.array(id).max(20).parse(await tx.get(indexKey) ?? []);
      const kept: string[] = [];
      for (const installation of index) {
        const device = deviceSchema.optional().parse(await tx.get(deviceKey(installation)));
        if (device?.active && sameScope(device, session.context) && Date.parse(device.expiresAt) > this.now() && installation !== input.installationId) kept.push(installation);
      }
      if (kept.length >= 20) throw unavailable('device_limit');
      const newAddressKey = addressKey(tokenHash); await tx.get(newAddressKey);
      const oldAddressKey = previous ? addressKey(previous.tokenHash) : undefined;
      const oldAddress = oldAddressKey ? await tx.get<{ generation: string }>(oldAddressKey) : undefined;
      const newRecipientKey = recipientKey(generation), oldRecipientKey = previous ? recipientKey(previous.generation) : undefined;
      await tx.get(newRecipientKey); const oldRecipient = oldRecipientKey ? await tx.get(oldRecipientKey) : undefined;
      const scope = notificationScopeSchema.parse({ owner: session.context.owner, workspaceId: session.context.workspaceId });
      const scopes = scopeIndexSchema.parse(await tx.get(scopesKey) ?? []);
      const at = this.now(); if (session.identity.expiresAt <= at) throw unavailable('web_sign_in_required', 401);
      const device: Device = deviceSchema.parse({ owner: session.context.owner, workspaceId: session.context.workspaceId, actorId: session.context.actorId,
        installationId: input.installationId, generation, active: true, tokenHash, registeredAt: new Date(at).toISOString(),
        expiresAt: new Date(Math.min(at + 3600000, session.identity.expiresAt)).toISOString(), membershipVersion: session.organization?.membershipVersion });
      // Private address record only. No token in device receipts, events, replay, audit or reports.
      if (oldAddressKey && oldAddressKey !== newAddressKey && oldAddress?.generation === previous?.generation) tx.put(oldAddressKey, { generation: previous!.generation, revoked: true });
      tx.put(newAddressKey, { generation, installationId: input.installationId, token: input.token });
      if (oldRecipient) tx.put(oldRecipientKey!, { generation: previous!.generation, revoked: true });
      if (subject) tx.put(newRecipientKey, { ...subject, generation, actorId: session.context.actorId });
      tx.put(scopesKey, [scope, ...scopes.filter(value => !sameScope(value, scope))].slice(0, 100));
      tx.put(key, device); tx.put(indexKey, [...kept, input.installationId]); tx.put(replayKey, { fingerprint, generation, installationId: input.installationId });
      return receipt(device);
    });
  }
  async revoke(session: GcpWebSession, raw: unknown) {
    const input = gcpDeviceRevokeSchema.parse(raw); await this.mobile(session, false);
    return this.store.transact(async tx => {
      await this.access.assertCurrentIn(tx, session);
      const key = deviceKey(input.installationId), device = deviceSchema.optional().parse(await tx.get(key));
      if (!device || device.actorId !== session.context.actorId || !sameScope(device, session.context)) throw unavailable('notification_scope_denied', 403);
      if (device.generation !== input.expectedGeneration) throw unavailable('device_generation_changed');
      (await deactivation(tx, key, device))(); return receipt(device);
    });
  }
  /** Retire one registration request even when its response was lost or it has not arrived.
   * A durable tombstone prevents a delayed request from recreating the device after sign-out.
   * It cannot revoke a generation created by a different registration request. */
  async retire(session: GcpWebSession, raw: unknown) {
    const input = gcpDeviceRetireSchema.parse(raw); await this.mobile(session, false);
    const replayKey = cloudRecordKey(session.context, 'gcp-device-request', cloudDigest([session.context.actorId, input.registrationKey]));
    return this.store.transact(async tx => {
      await this.access.assertCurrentIn(tx, session);
      const retiredKey = `${replayKey}:retired`, retired = await tx.get<{ installationId: string }>(retiredKey);
      const replay = await tx.get<{ generation: string; installationId: string }>(replayKey);
      const key = deviceKey(input.installationId), device = deviceSchema.optional().parse(await tx.get(key));
      if (device && device.actorId !== session.context.actorId) throw unavailable('notification_scope_denied', 403);
      if (retired && retired.installationId !== input.installationId || replay && replay.installationId !== input.installationId) throw unavailable('registration_mismatch');
      const matches = !!device && !!replay && device.generation === replay.generation && sameScope(device, session.context);
      const deactivate = matches ? await deactivation(tx, key, device) : undefined;
      deactivate?.();
      tx.put(retiredKey, { installationId: input.installationId });
      return { retired: true as const };
    });
  }
  private async currentIn(tx: CloudTransaction, device: Device, event: NotificationEvent) {
    const now = this.now();
    if (!device.active || !sameScope(device, event) || Date.parse(device.registeredAt) > now || Date.parse(device.expiresAt) <= now
      || Date.parse(event.createdAt) > now || Date.parse(event.expiresAt) <= now) return false;
    if (device.owner.kind === 'personal') return device.owner.userId === device.actorId;
    const membership = membershipSchema.safeParse(await tx.get(membershipKey(device.owner.organizationId, device.workspaceId, device.actorId)));
    return membership.success && membership.data.active && membership.data.actorId === device.actorId && membership.data.organizationId === device.owner.organizationId
      && membership.data.workspaceId === device.workspaceId && membership.data.version === device.membershipVersion
      && membership.data.roles.includes(event.kind === 'review' ? 'reviewer' : 'operator');
  }
  private async pair(tx: CloudTransaction, scope: NotificationScope, eventId: string, installationId: string) {
    const event = notificationEventSchema.optional().parse(await tx.get(notificationEventKey(scope, eventId)));
    const device = deviceSchema.optional().parse(await tx.get(deviceKey(installationId)));
    const index = notificationIndexSchema.parse(await tx.get(notificationIndexKey(scope)) ?? []);
    if (!event || !device || event.id !== eventId || device.installationId !== installationId || !sameScope(event, scope) || !index.includes(eventId)) return undefined;
    const address = await tx.get<{ generation: string; installationId?: string; token?: string }>(addressKey(device.tokenHash));
    if (!address?.token || address.installationId !== device.installationId || address.generation !== device.generation || cloudDigest(address.token) !== device.tokenHash || !await this.currentIn(tx, device, event)) return undefined;
    const stored = recipientRecordSchema.safeParse(await tx.get(recipientKey(device.generation)));
    const subject = stored.success && stored.data.generation === device.generation && stored.data.actorId === device.actorId
      ? verifiedSubject(device.actorId, { issuer: stored.data.issuer, ...(stored.data.tenantId ? { tenantId: stored.data.tenantId } : {}), subject: stored.data.subject, authTime: stored.data.authTime }) : undefined;
    return { event, device, token: address.token, subject };
  }
  /** A notification is just a locator. Both sides of the fresh detail GET recheck ownership/generation. */
  async open<T>(session: GcpWebSession, raw: unknown, read: (planId: string, version: number) => Promise<T>): Promise<T> {
    const data = gcpNotificationSchema.parse(raw); await this.mobile(session);
    const check = () => this.store.transact(async tx => {
      await this.access.assertCurrentIn(tx, session);
      const pair = await this.pair(tx, session.context, data.notificationId, data.installationId);
      if (!pair || pair.device.actorId !== session.context.actorId || pair.device.generation !== data.generation || pair.event.planId !== data.planId
        || String(pair.event.planVersion) !== data.planVersion || pair.event.expiresAt !== data.expiresAt) throw unavailable();
    });
    await check(); const value = await read(data.planId, Number(data.planVersion)); await this.access.current(session); await check(); return value;
  }
  /** Bounded worker discovery. The worker supplies a server-configured scope, never a public cursor. */
  async pending(scope: NotificationScope) {
    this.enabled(); notificationScopeSchema.parse(scope);
    return this.store.transact(async tx => ({ events: notificationIndexSchema.parse(await tx.get(notificationIndexKey(scope)) ?? []),
      installations: z.array(id).max(20).parse(await tx.get(devicesKey(scope)) ?? []) }));
  }
  /** Bounded scopes with recent registrations, maintained by the server; never a client cursor. */
  async recipientScopes() {
    this.enabled();
    return this.store.transact(async tx => scopeIndexSchema.parse(await tx.get(scopesKey) ?? []));
  }
  async deliver(scope: NotificationScope, eventId: string, installationId: string): Promise<Delivery['state']> {
    this.enabled(); notificationScopeSchema.parse(scope); hash.parse(eventId); id.parse(installationId);
    const claim = randomUUID();
    const key = cloudRecordKey(scope, 'gcp-notification-delivery', cloudDigest([eventId, installationId]));
    // Persist reservation BEFORE external authority/transport calls. Every retry/restart reads it.
    const reserved = await this.store.transact(async tx => {
      const previous = deliverySchema.optional().parse(await tx.get(key));
      if (previous) {
        if (previous.state === 'reserved' && Date.parse(previous.expiresAt) <= this.now()) { previous.state = 'unknown'; tx.put(key, previous); }
        return { state: previous.state };
      }
      const pair = await this.pair(tx, scope, eventId, installationId);
      // Live authority needs the verified provider subject; a synthetic identity never reaches a live port.
      if (!pair || pair.event.dataMode !== this.ports!.dataMode || this.ports!.dataMode === 'live' && !pair.subject) return { state: 'suppressed' as const };
      const expiresAt = new Date(Math.min(this.now() + 30000, Date.parse(pair.event.expiresAt), Date.parse(pair.device.expiresAt))).toISOString();
      tx.put(key, { state: 'reserved', claim, expiresAt }); return { pair, expiresAt };
    });
    if (!('pair' in reserved) || !reserved.pair) return reserved.state!;
    const original = reserved.pair, abort = new AbortController();
    const current = async () => {
      if (!await this.ports!.current({ actorId: original.device.actorId, owner: original.device.owner, workspaceId: original.device.workspaceId,
        registeredAt: original.device.registeredAt, expiresAt: original.device.expiresAt, ...(original.subject ? { subject: original.subject } : {}) })) return false;
      return this.store.transact(async tx => {
        const delivery = deliverySchema.parse(await tx.get(key)), pair = await this.pair(tx, scope, eventId, installationId);
        return delivery.state === 'reserved' && delivery.claim === claim && Date.parse(delivery.expiresAt) > this.now() && !!pair && pair.device.generation === original.device.generation
          && cloudDigest(pair.subject ?? null) === cloudDigest(original.subject ?? null);
      });
    };
    let outcome: Delivery['state'] | 'unregistered' = 'unknown';
    const work = async (): Promise<Delivery['state'] | 'unregistered'> => {
      if (!await current()) return 'suppressed';
      if (abort.signal.aborted) return 'unknown';
      const data = gcpNotificationSchema.parse({ schemaVersion: '1', provider: 'gcp', notificationId: eventId, installationId,
        generation: original.device.generation, planId: original.event.planId, planVersion: String(original.event.planVersion), expiresAt: original.event.expiresAt });
      const sent = await this.ports!.send(original.token, data, abort.signal);
      // A definite stale-address response was not delivered; the address is retired below.
      if (sent === 'unregistered') return sent;
      if (!['accepted', 'rejected', 'unknown'].includes(sent) || !await current()) return 'unknown';
      return sent;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      outcome = await Promise.race([work(), new Promise<'unknown'>(resolve => { timer = setTimeout(() => { abort.abort(); resolve('unknown'); }, Math.max(1, Date.parse(reserved.expiresAt!) - this.now())); })]);
    } catch { outcome = 'unknown'; }
    finally { if (timer) clearTimeout(timer); abort.abort(); }
    return this.store.transact(async tx => {
      const delivery = deliverySchema.parse(await tx.get(key)), pair = await this.pair(tx, scope, eventId, installationId);
      if (delivery.state !== 'reserved' || delivery.claim !== claim) return delivery.state;
      const stale = outcome === 'unregistered' ? deviceSchema.optional().parse(await tx.get(deviceKey(installationId))) : undefined;
      const deactivate = stale?.active && stale.generation === original.device.generation ? await deactivation(tx, deviceKey(installationId), stale) : undefined;
      delivery.state = Date.parse(delivery.expiresAt) <= this.now() || !pair || pair.device.generation !== original.device.generation ? 'unknown' : outcome === 'unregistered' ? 'rejected' : outcome;
      deactivate?.(); tx.put(key, delivery); return delivery.state;
    });
  }
}
