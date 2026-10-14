import { chargingEvidenceSchema, type MobilityCase, type MobilityReport, type SimulatedVehicle } from '@contracts/gcp/mobility';
import { safeChargeConditions } from './runbooks';

/** A learned pattern retrieves an existing remedy. Every execution still checks current policy and safety. */
export function verifiedCase(value: MobilityCase): boolean {
  const { before, after } = value.verification;
  const duration=Date.parse(value.expiresAt)-Date.parse(value.createdAt);
  return duration>0&&duration<=7*24*3600000&&before.fault === 'unknown' && before.diagnosticSignal === value.signal && before.charging === 'interrupted' && before.parked
    && before.batteryCelsius >= 0 && before.batteryCelsius <= 40 && before.batteryPercent < before.targetPercent && before.attempts === 0
    && after.fault === 'none' && after.diagnosticSignal === 'none' && after.charging === 'charging' && after.attempts === 1
    && after.parked && after.batteryCelsius === before.batteryCelsius && after.batteryPercent === before.batteryPercent && after.targetPercent === before.targetPercent;
}
export function matchingCases(vehicle: SimulatedVehicle, cases: readonly MobilityCase[], now: number): MobilityCase[] {
  if (vehicle.fault !== 'unknown' || vehicle.diagnosticSignal !== 'charge_link_timeout' || !safeChargeConditions(vehicle)) return [];
  return cases.filter(item => item.vehicleId === vehicle.id && item.status === 'active' && item.signal === vehicle.diagnosticSignal
    && Date.parse(item.createdAt) <= now && Date.parse(item.expiresAt) > now && item.activatedAt!==undefined
    && Date.parse(item.activatedAt)>=Date.parse(item.createdAt)&&Date.parse(item.activatedAt)<=now&&verifiedCase(item));
}
export function recoveryGuidance(vehicle: SimulatedVehicle, now: number): NonNullable<MobilityReport['guidance']> {
  const checks: NonNullable<MobilityReport['guidance']>['checks'] = [
    { id:'signal',passed:vehicle.fault==='unknown'&&vehicle.diagnosticSignal==='charge_link_timeout' },
    { id:'parked',passed:vehicle.parked }, { id:'temperature',passed:vehicle.batteryCelsius>=0&&vehicle.batteryCelsius<=40 },
    { id:'battery',passed:vehicle.batteryPercent<vehicle.targetPercent }, { id:'attempts',passed:vehicle.attempts===0 },
  ];
  return {id:'review-charge-link-v1',expiresAt:new Date(now+10*60000).toISOString(),canResolve:checks.every(check=>check.passed)&&safeChargeConditions(vehicle),checks};
}
export function chargingEvidence(vehicle: SimulatedVehicle) {
  const {fault,diagnosticSignal,charging,parked,batteryCelsius,batteryPercent,targetPercent,attempts}=vehicle;
  return chargingEvidenceSchema.parse({fault,diagnosticSignal,charging,parked,batteryCelsius,batteryPercent,targetPercent,attempts});
}
