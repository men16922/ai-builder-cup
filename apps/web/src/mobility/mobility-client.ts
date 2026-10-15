import { mobilityStateSchema, type MobilityState } from '@contracts/gcp/mobility';
import type { GcpObservationClient } from '../console/observation-client';

export type MobilityBoard = { state?: MobilityState; busy: boolean; error?: string; journeyRunning: boolean };
/** Session-local presentation store. Late replies are fenced; changes never retry automatically. */
export class MobilityClient {
  private value: MobilityBoard = { busy: false, journeyRunning: false };
  private listeners = new Set<() => void>();
  private closed = false;
  private generation = 0;
  private sequence = 0;
  private readonly call: GcpObservationClient['agentCall'];
  constructor(call: GcpObservationClient['agentCall']) { this.call = call; }
  getSnapshot = () => this.value;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  open() { this.closed = false; }
  dismissError() { if (this.value.error) this.set({ ...this.value, error: undefined }); }
  close() {
    this.generation++; this.sequence++; this.value={busy:false,journeyRunning:false}; this.closed = true;
    this.listeners.forEach(fn=>fn());
  }
  private set(value: MobilityBoard) { if (this.closed) return; this.value = value; this.listeners.forEach(fn => fn()); }
  async load() {
    if(this.closed||this.value.busy)return;
    const generation = this.generation,sequence=++this.sequence;
    this.set({...this.value,busy:true,error:undefined,journeyRunning:false});
    try { const state = mobilityStateSchema.parse(await this.call('/mobility')); if (generation === this.generation&&sequence===this.sequence) this.set({ state, busy: false, journeyRunning:false }); }
    catch (error) { if (generation === this.generation&&sequence===this.sequence) this.fail(error); }
  }
  async command(input: Record<string, unknown>, automatic = false) {
    if(automatic && !this.value.journeyRunning)return;
    if (this.value.busy || this.closed) return;
    const running = this.value.journeyRunning;
    const body = input.operation === 'initialize' ? input : { ...input, expectedVersion: this.value.state?.vehicle?.version };
    const generation = this.generation,sequence=++this.sequence;
    this.set({ ...this.value, busy: true, error: undefined });
    try { const state = mobilityStateSchema.parse(await this.call('/mobility', { key: crypto.randomUUID(), body })); if (generation === this.generation&&sequence===this.sequence) this.set({ state, busy: false, journeyRunning:state.journey?.state==='moving' && (running || ['trip_request','select_destination','advance'].includes(String(input.operation))) }); }
    catch (error) { if (generation === this.generation&&sequence===this.sequence) this.fail(error); }
  }
  private fail(error: unknown) {
    const code = error instanceof Error && /^[a-z_]{1,64}$/.test(error.message) ? error.message : 'mobility_request_failed';
    const denied = error instanceof Error && 'status' in error && [401,403].includes(Number(error.status));
    this.set({ ...(denied ? {} : this.value), busy: false, error: code, journeyRunning:false });
  }
}
