import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CloudOperationError } from '../../../src/domain/cloud-workflow';
import type { CloudStore, CloudTransaction } from '../../cloud-store';
import type { GoogleCredentials } from '../google/credentials';

type Envelope = { schemaVersion: 1; key: string; payload: string };
type RecordTransaction = { get(id: string): Promise<unknown | undefined>; set(id: string, envelope: Envelope): void };
/** Small SDK port permits deterministic offline transaction-contract tests. */
export interface FirestoreRecordPort { runTransaction<T>(body: (tx: RecordTransaction) => Promise<T>): Promise<T>; close?(): Promise<void> }
const envelopeSchema = z.object({ schemaVersion: z.literal(1), key: z.string().min(1).max(1024), payload: z.string() }).strict();
const recordId = (key: string) => createHash('sha256').update(z.string().min(1).max(1024).parse(key)).digest('hex');
const invalid = () => new CloudOperationError(500, 'invalid_stored_record', 'The stored record could not be verified.');

export class FirestoreCloudStore implements CloudStore {
  private readonly records: FirestoreRecordPort;
  constructor(records: FirestoreRecordPort) { this.records = records; }
  async close() { await this.records.close?.(); }
  transact<T>(body: (transaction: CloudTransaction) => Promise<T>): Promise<T> {
    return this.records.runTransaction(async remote => {
      const reads = new Map<string, unknown>(); let writing = false;
      return body({
        get: async <V>(key: string) => {
          if (writing) throw new Error('Complete transaction reads before writes.');
          if (!reads.has(key)) {
            const raw = await remote.get(recordId(key)); let value: unknown;
            if (raw !== undefined) {
              const envelope = envelopeSchema.safeParse(raw);
              if (!envelope.success || envelope.data.key !== key || Buffer.byteLength(envelope.data.payload) > 750_000) throw invalid();
              try { value = JSON.parse(envelope.data.payload); } catch { throw invalid(); }
            }
            reads.set(key, value);
          }
          return structuredClone(reads.get(key)) as V | undefined;
        },
        put: (key, value) => {
          if (!reads.has(key)) throw new Error('Read a record before writing it.');
          const payload = JSON.stringify(value);
          if (!payload || Buffer.byteLength(payload) > 750_000) throw new CloudOperationError(413, 'record_too_large', 'The record exceeds the storage limit.');
          writing = true; remote.set(recordId(key), { schemaVersion: 1, key, payload });
        },
      });
    });
  }
}

export async function createFirestoreCloudStore(configuration: unknown, credentials?: GoogleCredentials): Promise<FirestoreCloudStore> {
  const config = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/), databaseId: z.string().regex(/^(\(default\)|[a-z][a-z0-9-]{2,62})$/).default('(default)'), collection: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/).default('mobileops_v1') }).strict().parse(configuration);
  const guard = () => {
    if (process.env.MOBILEOPS_OFFLINE_TEST === '1' || process.env.FIRESTORE_EMULATOR_HOST || credentials && credentials.mode !== 'live') throw new CloudOperationError(503, 'live_store_disabled', 'Live cloud storage is disabled in this environment.');
  };
  guard();
  let db: import('@google-cloud/firestore').Firestore;
  if (credentials) {
    const [{ Firestore }, { pinnedGoogleAuth }] = await Promise.all([import('@google-cloud/firestore'), import('../google/sdk-auth')]);
    db = new Firestore({ projectId: config.projectId, databaseId: config.databaseId, auth: pinnedGoogleAuth(config.projectId, credentials) });
  } else {
    const [{ initializeApp, getApps, applicationDefault }, { getFirestore }] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/firestore')]);
    const name = `mobileops-store-${config.projectId}`, app = getApps().find(value => value.name === name) ?? initializeApp({ projectId: config.projectId, credential: applicationDefault() }, name);
    db = getFirestore(app, config.databaseId);
  }
  return new FirestoreCloudStore({ close: credentials ? () => db.terminate() : undefined, runTransaction: async body => {
    guard(); if (credentials) await credentials.token(AbortSignal.timeout(5000)); return db.runTransaction(async tx => body({
      get: async id => { guard(); const value = await tx.get(db.collection(config.collection).doc(id)); return value.exists ? value.data() : undefined; },
      set: (id, envelope) => { guard(); tx.set(db.collection(config.collection).doc(id), envelope); },
    }), { maxAttempts: 5 });
  } });
}
