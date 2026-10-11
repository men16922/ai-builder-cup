import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SqliteCloudStore } from '../src/store/sqlite-store';
import { cloudRecordKey } from '../src/workflow/workflow';
import type { CloudStore } from '../src/store/store';
import { withGcpNotificationIntents, notificationIndexKey, notificationEventKey } from '../src/notifications/notification-store';
import { cloudDigest } from '../src/store/integrity';
import { gcpStoredPlanSchema } from '@contracts/gcp/workflow';

test('GCP state and notification commit atomically through retried storage callbacks without duplicating an event', async t => {
  const base = new SqliteCloudStore(':memory:'); t.after(() => base.close());
  const fixture = JSON.parse(readFileSync('apps/android/core/src/main/resources/synthetic-personal.json', 'utf8'))[0];
  const plan = structuredClone(fixture.initial.plan); plan.review = { status: 'not_requested' };
  const scope = fixture.scope, key = cloudRecordKey(scope, 'plan', plan.payload.planId), indexKey = notificationIndexKey(scope);
  await base.transact(async tx => { await tx.get(key); tx.put(key, plan); });
  let callbacks = 0; const rollback = new Error('retry');
  const retrying: CloudStore = { async transact(body) {
    try { await base.transact(async tx => { await body(tx); throw rollback; }); } catch (error) { if (error !== rollback) throw error; }
    assert.equal((await base.transact(tx => tx.get<{ review: { status: string } }>(key)))!.review.status, 'not_requested');
    assert.equal(await base.transact(tx => tx.get(indexKey)), undefined);
    return base.transact(body);
  } };
  const notifications = withGcpNotificationIntents(retrying, () => Date.parse('2026-10-10T01:00:00Z'));
  await notifications.transact(async tx => { callbacks++; const value = await tx.get<typeof plan>(key); value.review = { status: 'pending', requestedAt: '2026-10-10T01:00:00Z', requestedBy: scope.actorId }; tx.put(key, value); });
  assert.equal(callbacks, 2);
  const index = await base.transact(tx => tx.get<string[]>(indexKey)); assert.equal(index!.length, 1);
  const event = await base.transact(tx => tx.get(notificationEventKey(scope, index![0])));
  assert.equal((event as { kind: string }).kind, 'review');
  assert.doesNotMatch(JSON.stringify(event), /summary|finding|resourceName|requestedBy|token/);
  await assert.rejects(withGcpNotificationIntents(base).transact(async tx => { const value = await tx.get(key); tx.put(key, value); await tx.get(indexKey); }), /reads before writes/);
});

test('GCP outbox ignores a valid foreign-provider plan and rolls back unverifiable GCP state', async t => {
  const base = new SqliteCloudStore(':memory:'); t.after(() => base.close());
  const fixture = JSON.parse(readFileSync('apps/android/core/src/main/resources/synthetic-personal.json', 'utf8'))[0];
  const plan = structuredClone(fixture.initial.plan); plan.review = { status: 'not_requested' };
  const scope = fixture.scope, key = cloudRecordKey(scope, 'plan', plan.payload.planId);
  await base.transact(async tx => { await tx.get(key); tx.put(key, plan); });
  const wrapped = withGcpNotificationIntents(base);
  await assert.rejects(wrapped.transact(async tx => { const value = await tx.get<typeof plan>(key); value.review.status = 'pending'; value.payload.analysis.summary = 'Tampered'; tx.put(key, value); }), /integrity/);
  assert.equal((await base.transact(tx => tx.get<typeof plan>(key))).review.status, 'not_requested');
  // Even when a foreign record passes the general plan schema, it is outside the GCP outbox.
  plan.payload.target = { provider: 'aws', accountId: '111111111111', partition: 'aws', scope: { kind: 'regional', region: 'us-east-1' }, service: 'dynamodb', resourceId: 'synthetic-table', nativeId: 'synthetic-table' };
  plan.payload.action = { ...plan.payload.action, id: 'aws.dynamodb.recovery.inspect.v1', inputs: {} };
  plan.digest = cloudDigest(plan.payload);
  gcpStoredPlanSchema.parse(plan);
  await wrapped.transact(async tx => { await tx.get(key); tx.put(key, plan); });
  await wrapped.transact(async tx => { const value = await tx.get<typeof plan>(key); value.review.status = 'pending'; tx.put(key, value); });
  assert.equal(await base.transact(tx => tx.get(notificationIndexKey(scope))), undefined);
});
