import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreCloudStore, createFirestoreCloudStore, type FirestoreRecordPort } from './platform/firebase/cloud-firestore-store';
import { CloudOperationError } from '../src/domain/cloud-workflow';

function fixture() {
  const committed = new Map<string, unknown>(); let retry = false, attempts = 0;
  const port: FirestoreRecordPort = { async runTransaction(body) {
    for (;;) {
      attempts++; const writes = new Map<string, unknown>();
      const result = await body({ get: async id => structuredClone(committed.get(id)), set: (id, value) => { writes.set(id, structuredClone(value)); } });
      if (retry) { retry = false; continue; }
      for (const [id, value] of writes) committed.set(id, value);
      return result;
    }
  } };
  return { committed, store: new FirestoreCloudStore(port), retry: () => { retry = true; }, attempts: () => attempts };
}

test('Firestore adapter preserves the shared read-before-write, retry and atomic rollback contract', async () => {
  const s = fixture(); s.retry();
  await s.store.transact(async tx => { assert.equal(await tx.get('organization:a'), undefined); assert.equal(await tx.get('organization:b'), undefined); tx.put('organization:a', { count: 1 }); tx.put('organization:b', { count: 2 }); });
  assert.equal(s.attempts(), 2); assert.equal(s.committed.size, 2);
  await assert.rejects(s.store.transact(async tx => { await tx.get('organization:a'); tx.put('organization:a', { count: 99 }); throw new Error('rollback'); }));
  assert.deepEqual(await s.store.transact(tx => tx.get('organization:a')), { count: 1 });
  await assert.rejects(s.store.transact(async tx => { tx.put('unread', {}); }), /Read a record/);
  await assert.rejects(s.store.transact(async tx => { await tx.get('organization:a'); tx.put('organization:a', {}); await tx.get('organization:b'); }), /Complete transaction reads/);
  assert.deepEqual(await s.store.transact(tx => tx.get('organization:a')), { count: 1 });
});

test('Firestore adapter rejects malformed/oversized records and live storage is disabled in offline gates', async () => {
  const s = fixture();
  await assert.rejects(s.store.transact(async tx => { await tx.get('large'); tx.put('large', { body: 'x'.repeat(750_000) }); }), error => error instanceof CloudOperationError && error.code === 'record_too_large');
  assert.equal(s.committed.size, 0);
  await s.store.transact(async tx => { await tx.get('safe'); tx.put('safe', {}); });
  const id = [...s.committed.keys()][0]; s.committed.set(id, { schemaVersion: 1, key: 'another-owner', payload: '{}' });
  await assert.rejects(s.store.transact(tx => tx.get('safe')), error => error instanceof CloudOperationError && error.code === 'invalid_stored_record');
  await assert.rejects(createFirestoreCloudStore({ projectId: 'synthetic-project' }), error => error instanceof CloudOperationError && error.code === 'live_store_disabled');
});
