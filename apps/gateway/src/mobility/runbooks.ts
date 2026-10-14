import type { SimulatedVehicle } from '@contracts/gcp/mobility';

/** All changes stay in the twin. No URL, command, credential or real vehicle id can be supplied. */
export const chargeReconnectRunbook = {
  id: 'charge-reconnect-v1' as const, version: 1, risk: 'low' as const,
  scope: 'simulated-charge-session', maximumAttempts: 1,
  steps: ['read-current-twin', 'check-parked-and-temperature', 'reconnect-once', 'read-back-and-report'],
};
export function safeChargeConditions(vehicle: SimulatedVehicle): boolean {
  return vehicle.source === 'simulation' && vehicle.parked && vehicle.charging === 'interrupted' && vehicle.batteryCelsius <= 40 &&
    vehicle.batteryCelsius >= 0 && vehicle.batteryPercent < vehicle.targetPercent && vehicle.attempts === 0;
}
export function chargeReconnectVerdict(vehicle: SimulatedVehicle, proposedRunbook: string, qualifiedCase = false): 'allow' | 'escalate' {
  const known = vehicle.fault === 'charge_handshake' && vehicle.diagnosticSignal === 'charge_handshake_timeout';
  const learned = qualifiedCase && vehicle.fault === 'unknown' && vehicle.diagnosticSignal === 'charge_link_timeout';
  return proposedRunbook === chargeReconnectRunbook.id && safeChargeConditions(vehicle) && (known || learned) ? 'allow' : 'escalate';
}
