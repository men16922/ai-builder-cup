import { cloudDigest } from '../store/integrity';
import type { GcpNotifications } from './notifications';

type DeliveryState = Awaited<ReturnType<GcpNotifications['deliver']>>;
export type GcpNotificationTick = { attempted: number; states: Partial<Record<DeliveryState, number>>; complete: boolean; failed: boolean };
const settledStates: ReadonlySet<DeliveryState> = new Set(['accepted', 'rejected', 'suppressed', 'unknown']);

/** Trusted in-process delivery worker. Scopes, events and installations come only from server-maintained
 * bounded records; there is no HTTP trigger, cursor or caller-selected target. Every attempt reuses the
 * durable reservation in deliver(), so overlap, restart or a lost response never sends again. */
export class GcpNotificationWorker {
  private readonly notifications: GcpNotifications;
  private readonly budget: number;
  // Process-local skip list only; the durable delivery record remains authoritative after restart.
  private settled = new Set<string>();
  constructor(notifications: GcpNotifications, budget = 200) {
    if (!Number.isInteger(budget) || budget < 1 || budget > 1000) throw Error('Invalid notification worker budget.');
    this.notifications = notifications; this.budget = budget;
  }
  async tick(signal?: AbortSignal): Promise<GcpNotificationTick> {
    const states: GcpNotificationTick['states'] = {}, seen = new Set<string>();
    let attempted = 0, complete = false, failed = false;
    try {
      scan: for (const scope of await this.notifications.recipientScopes()) {
        const work = await this.notifications.pending(scope);
        for (const event of work.events) for (const installation of work.installations) {
          const key = cloudDigest([scope, event, installation]); seen.add(key);
          if (this.settled.has(key)) continue;
          if (attempted >= this.budget || signal?.aborted) break scan;
          attempted++;
          const state = await this.notifications.deliver(scope, event, installation);
          states[state] = (states[state] ?? 0) + 1;
          if (settledStates.has(state)) this.settled.add(key);
        }
      }
      complete = attempted < this.budget && !signal?.aborted;
    } catch { failed = true; }
    // Prune only after a full pass so budget-limited passes keep making progress.
    if (complete) this.settled = new Set([...this.settled].filter(key => seen.has(key)));
    return { attempted, states, complete, failed };
  }
}

/** Explicitly started by the hosted entry when notifications are configured. Ticks never overlap.
 * stop() prevents new attempts and waits a bounded time; an interrupted reservation becomes unknown, never resent. */
export function startGcpNotificationWorker(notifications: GcpNotifications, options: { intervalMs?: number; budget?: number; stopWaitMs?: number } = {}) {
  const intervalMs = options.intervalMs ?? 15000, stopWaitMs = options.stopWaitMs ?? 3000;
  if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 300000 || !Number.isInteger(stopWaitMs) || stopWaitMs < 0 || stopWaitMs > 8000) throw Error('Invalid notification worker schedule.');
  if (!notifications.available) throw Error('Notification delivery is not configured.');
  const worker = new GcpNotificationWorker(notifications, options.budget), abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined, running: Promise<void> = Promise.resolve(), stopping: Promise<void> | undefined;
  const schedule = () => { if (abort.signal.aborted) return; timer = setTimeout(() => { running = worker.tick(abort.signal).then(schedule); }, intervalMs); timer.unref?.(); };
  running = worker.tick(abort.signal).then(schedule);
  return { stop() {
    return stopping ??= (async () => {
      abort.abort(); if (timer) clearTimeout(timer);
      let wait: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([running, new Promise<void>(done => { wait = setTimeout(done, stopWaitMs); })]); clearTimeout(wait);
    })();
  } };
}
