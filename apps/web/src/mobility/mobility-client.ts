import { mobilityStateSchema, type MobilityState } from '@contracts/gcp/mobility';
import type { GcpObservationClient } from '../console/observation-client';
import { mergeMobilityState } from './merge-mobility-state';

export type MobilityBoard = { state?: MobilityState; busy: boolean; callBusy?: boolean; error?: string; journeyRunning: boolean };
const callSteps = new Set(['call_answer', 'call_say', 'call_delegate', 'call_end']);
/** Session-local presentation store. Vehicle and conversation replies have separate fences. */
export class MobilityClient {
  private value: MobilityBoard = { busy: false, callBusy: false, journeyRunning: false };
  private listeners = new Set<() => void>();
  private closed = false;
  private generation = 0;
  private sequence = 0;
  private callSequence = 0;
  private journeyEpoch = 0;
  private readonly call: GcpObservationClient['agentCall'];
  constructor(call: GcpObservationClient['agentCall']) { this.call = call; }
  getSnapshot = () => this.value;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  open() { this.closed = false; }
  dismissError() { if (this.value.error) this.set({ ...this.value, error: undefined }); }
  close() {
    this.generation++; this.sequence++; this.callSequence++; this.journeyEpoch++;
    this.value = { busy: false, callBusy: false, journeyRunning: false }; this.closed = true;
    this.listeners.forEach(fn => fn());
  }
  private set(value: MobilityBoard) { if (this.closed) return; this.value = value; this.listeners.forEach(fn => fn()); }
  async load() {
    if (this.closed || this.value.busy) return;
    const generation = this.generation, sequence = ++this.sequence;
    this.journeyEpoch++;
    this.set({ ...this.value, busy: true, error: undefined, journeyRunning: false });
    try {
      const state = mobilityStateSchema.parse(await this.call('/mobility'));
      if (generation !== this.generation || sequence !== this.sequence) return;
      const replaced = this.value.state?.vehicle && this.value.state.vehicle.id !== state.vehicle?.id;
      if (replaced) this.callSequence++;
      this.set({ ...this.value, state: mergeMobilityState(this.value.state, state), busy: false,
        callBusy: replaced ? false : this.value.callBusy, journeyRunning: false });
    } catch (error) { if (generation === this.generation && sequence === this.sequence) this.fail(error); }
  }
  async command(input: Record<string, unknown>, automatic = false) {
    if (callSteps.has(String(input.operation))) return this.callCommand(input);
    if (automatic && !this.value.journeyRunning) return;
    if (this.value.busy || this.closed) return;
    const running = this.value.journeyRunning;
    const body = input.operation === 'initialize' ? input : { ...input, expectedVersion: this.value.state?.vehicle?.version };
    const generation = this.generation, sequence = ++this.sequence;
    if (input.operation === 'stop') this.journeyEpoch++;
    const journeyEpoch = this.journeyEpoch;
    this.set({ ...this.value, busy: true, error: undefined, ...(input.operation === 'stop' ? { journeyRunning: false } : {}) });
    try {
      const incoming = mobilityStateSchema.parse(await this.call('/mobility', { key: crypto.randomUUID(), body }));
      if (generation !== this.generation || sequence !== this.sequence) return;
      const state = mergeMobilityState(this.value.state, incoming);
      const explicitStart = journeyEpoch === this.journeyEpoch && !automatic && ['trip_request', 'select_destination', 'advance'].includes(String(input.operation));
      this.set({ ...this.value, state, busy: false,
        journeyRunning: state.journey?.state === 'moving' && (explicitStart || running && this.value.journeyRunning) });
    } catch (error) { if (generation === this.generation && sequence === this.sequence) this.fail(error); }
  }
  private async callCommand(input: Record<string, unknown>) {
    if (this.closed || this.value.busy || this.value.callBusy) return;
    const generation = this.generation, sequence = ++this.callSequence;
    const body = { ...input, expectedVersion: this.value.state?.vehicle?.version };
    this.set({ ...this.value, callBusy: true, error: undefined });
    try {
      const incoming = mobilityStateSchema.parse(await this.call('/mobility', { key: crypto.randomUUID(), body }));
      if (generation !== this.generation || sequence !== this.callSequence) return;
      const state = mergeMobilityState(this.value.state, incoming);
      // A conversation reply never arms a journey paused by a read, stop or uncertain operation.
      this.set({ ...this.value, state, callBusy: false,
        journeyRunning: this.value.journeyRunning && state.journey?.state === 'moving' });
    } catch (error) { if (generation === this.generation && sequence === this.callSequence) this.fail(error, true); }
  }
  private fail(error: unknown, conversation = false) {
    const code = error instanceof Error && /^[a-z_]{1,64}$/.test(error.message) ? error.message : 'mobility_request_failed';
    const denied = error instanceof Error && 'status' in error && [401, 403].includes(Number(error.status));
    this.journeyEpoch++;
    if (denied) { this.generation++; this.sequence++; this.callSequence++; }
    this.set({ ...(denied ? { busy: false, callBusy: false } : this.value),
      ...(conversation ? { callBusy: false } : { busy: false }), error: code, journeyRunning: false });
  }
}
