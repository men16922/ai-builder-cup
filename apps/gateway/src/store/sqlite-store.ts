import { DatabaseSync } from 'node:sqlite';
import { chmodSync, closeSync, openSync } from 'node:fs';
import type { CloudStore, CloudTransaction } from './store';
import { CloudOperationError } from '@contracts/core/workflow';

/** Local durable adapter only. Cloud Run must inject an external persistent store. */
export class SqliteCloudStore implements CloudStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  constructor(path: string, now = Date.now) {
    this.now=now;
    if (path !== ':memory:') { const fd = openSync(path, 'a', 0o600); closeSync(fd); chmodSync(path, 0o600); }
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS cloud_records (key TEXT PRIMARY KEY, version INTEGER NOT NULL, payload TEXT NOT NULL, expires_at INTEGER);`);
    if (!this.db.prepare('PRAGMA table_info(cloud_records)').all().some(row=>row.name==='expires_at')) this.db.exec('ALTER TABLE cloud_records ADD COLUMN expires_at INTEGER');
  }
  close() { this.db.close(); }
  async transact<T>(body: (transaction: CloudTransaction) => Promise<T>): Promise<T> {
    // Optimistic reads keep awaited callbacks outside SQLite's write lock. Validate
    // every read (including absent keys) atomically, then commit all staged writes.
    for (let attempt = 0; attempt < 10; attempt++) {
      const reads = new Map<string, { version: number; value: unknown }>();
      const writes = new Map<string, {payload:string;expiresAt?:number}>();
      let writing = false;
      const result = await body({
        get: async <V>(key: string) => {
          if (writing) throw new Error('Complete transaction reads before writes.');
          if (!reads.has(key)) {
            const row = this.db.prepare('SELECT version, payload, expires_at FROM cloud_records WHERE key=?').get(key);
            reads.set(key, { version: row ? Number(row.version) : 0, value: row && (row.expires_at===null || Number(row.expires_at)>this.now()) ? JSON.parse(String(row.payload)) : undefined });
          }
          return structuredClone(reads.get(key)!.value) as V | undefined;
        },
        put: (key, value, expiresAt) => {
          if (!reads.has(key)) throw new Error('Read a record before writing it.');
          const payload = JSON.stringify(value);
          if (!payload || Buffer.byteLength(payload) > 750_000) throw new CloudOperationError(413, 'record_too_large', 'The record exceeds the storage limit.');
          if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime()<=this.now())) throw new Error('Invalid record retention deadline.');
          writing = true; writes.set(key, {payload,expiresAt:expiresAt?.getTime()});
        },
      });
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const conflicted = [...reads].some(([key, read]) => {
          const row = this.db.prepare('SELECT version FROM cloud_records WHERE key=?').get(key);
          return (row ? Number(row.version) : 0) !== read.version;
        });
        if (conflicted) { this.db.exec('ROLLBACK'); continue; }
        for (const [key, value] of writes) {
          this.db.prepare(`INSERT INTO cloud_records(key, version, payload, expires_at) VALUES (?, 1, ?, ?)
            ON CONFLICT(key) DO UPDATE SET version=version+1, payload=excluded.payload, expires_at=excluded.expires_at`).run(key, value.payload,value.expiresAt??null);
        }
        this.db.exec('COMMIT'); return result;
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    throw new CloudOperationError(409, 'concurrent_change', 'The record changed concurrently. Refresh and retry.');
  }
}
