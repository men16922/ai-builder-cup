/** Transaction callbacks can retry. Only storage reads/writes belong inside them. */
export interface CloudTransaction {
  get<T>(key: string): Promise<T | undefined>;
  /** Read the key first, and complete all reads before staging any writes. */
  /** Optional bounded retention. Expired records are unreadable before asynchronous deletion. */
  put<T>(key: string, value: T, expiresAt?: Date): void;
}
export interface CloudStore {
  transact<T>(body: (transaction: CloudTransaction) => Promise<T>): Promise<T>;
}
