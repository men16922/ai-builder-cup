import type { MobilityState } from '@contracts/gcp/mobility';

/** Parallel read replies carry separate vehicle/call versions. Neither stream may rewind the other. */
export function mergeMobilityState(current: MobilityState | undefined, incoming: MobilityState): MobilityState {
  if (!current?.vehicle || !incoming.vehicle || current.vehicle.id !== incoming.vehicle.id) return incoming;
  const base = incoming.vehicle.version < current.vehicle.version ? current : incoming;
  const conversation = (incoming.callRevision ?? 0) < (current.callRevision ?? 0) ? current : incoming;
  const journey = base.journey && conversation.journey?.id === base.journey.id
    ? { ...base.journey, autopilot: base.journey.state === 'moving' && conversation.journey.autopilot }
    : base.journey;
  return { ...base, journey, call: conversation.call, calls: conversation.calls, callRevision: conversation.callRevision };
}
