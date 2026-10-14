import { z } from 'zod';

/** Only a simulated vehicle. This contract cannot address a real manufacturer's control API. */
export const coordinateSchema = z.object({ latitude: z.number().min(-85).max(85), longitude: z.number().min(-180).max(180) }).strict();
export const vehicleFaultSchema = z.enum(['none', 'charge_handshake', 'battery_hot', 'unknown']);
export const diagnosticSignalSchema = z.enum(['none', 'charge_handshake_timeout', 'charge_link_timeout', 'battery_thermal_limit', 'unclassified']);
export const vehicleSchema = z.object({
  id: z.uuid(), version: z.number().int().positive(), source: z.literal('simulation'), model: z.literal('Aide EV'),
  observedAt: z.iso.datetime(), batteryPercent: z.number().int().min(0).max(100), targetPercent: z.number().int().min(50).max(100),
  batteryCelsius: z.number().min(-20).max(80), rangeKm: z.number().int().nonnegative(), parked: z.boolean(),
  charging: z.enum(['idle', 'charging', 'interrupted']), powerKw: z.number().min(0).max(350),
  fault: vehicleFaultSchema, diagnosticSignal: diagnosticSignalSchema.default('unclassified'), episode: z.uuid(), attempts: z.number().int().min(0).max(1), location: coordinateSchema,
}).strict();
export type SimulatedVehicle = z.infer<typeof vehicleSchema>;
export const placeSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), name: z.string().min(1).max(160), address: z.string().max(240),
  location: coordinateSchema, kind: z.enum(['restaurant', 'charging', 'poi']), rating: z.number().min(0).max(5).optional(),
  chargingPorts: z.number().int().nonnegative().optional(), availablePorts: z.number().int().nonnegative().optional(),
  source: z.enum(['google-places', 'google-maps-mcp']), fetchedAt: z.iso.datetime(),
  mapsUrl: z.url().max(2048).refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && ['maps.google.com', 'www.google.com', 'maps.app.goo.gl'].includes(url.hostname) && !url.username && !url.password && (!url.port || url.port === '443')
      && (url.hostname !== 'www.google.com' || /^\/maps(?:\/|$)/.test(url.pathname));
  }).optional(),
}).strict();
export type MobilityPlace = z.infer<typeof placeSchema>;
/** Keep favorites as allowed place IDs, not extracted/cached provider descriptions. */
export const favoritePlaceSchema = placeSchema.pick({id:true,kind:true});
export const chargingEvidenceSchema = vehicleSchema.pick({fault:true,diagnosticSignal:true,charging:true,parked:true,batteryCelsius:true,batteryPercent:true,targetPercent:true,attempts:true});
/** A server-produced simulator read-back; user prose or model output cannot mint a verified case. */
export const mobilityCaseSchema = z.object({
  id:z.uuid(), vehicleId:z.uuid(), sourceReportId:z.uuid(), signal:z.literal('charge_link_timeout'), runbook:z.literal('charge-reconnect-v1'),
  status:z.enum(['candidate','active','revoked']), createdAt:z.iso.datetime(), expiresAt:z.iso.datetime(), activatedAt:z.iso.datetime().optional(),
  verifiedVersion:z.number().int().positive(), verification:z.object({before:chargingEvidenceSchema,after:chargingEvidenceSchema}).strict(),
}).strict();
export type MobilityCase = z.infer<typeof mobilityCaseSchema>;
export const recoveryGuidanceSchema = z.object({
  id:z.literal('review-charge-link-v1'), expiresAt:z.iso.datetime(), canResolve:z.boolean(),
  checks:z.array(z.object({id:z.enum(['signal','parked','temperature','battery','attempts']),passed:z.boolean()}).strict()).length(5),
}).strict();
export const verifiedChargingRemedySchema = z.object({source:z.literal('simulation'),before:z.literal('interrupted'),after:z.literal('charging'),attempts:z.literal(1),powerKw:z.number().positive().max(350),verifiedAt:z.iso.datetime()}).strict();
export const mobilityReportSchema = z.object({ id: z.uuid(), at: z.iso.datetime(), state: z.enum(['investigating', 'remediated', 'needs_decision', 'escalated', 'unknown']),
  engine: z.enum(['gemini', 'offline-fixture', 'guardian']), summary: z.string().min(1).max(1000),
  evidence: z.array(z.string().max(160)).max(8), unknowns: z.array(z.string().max(240)).max(8),
  runbook: z.enum(['charge-reconnect-v1', 'none']), beforeVersion: z.number().int().positive(), afterVersion: z.number().int().positive().optional(),
  authorization: z.enum(['standing-policy', 'human-decision', 'read-only']), episode: z.uuid(),
  guidance:recoveryGuidanceSchema.optional(), caseId:z.uuid().optional(),
  language:z.enum(['ko','en']).default('en'),
  remedy:verifiedChargingRemedySchema.optional(),
}).strict();
export type MobilityReport = z.infer<typeof mobilityReportSchema>;
export const journeySchema = z.object({ id: z.uuid(), state: z.enum(['choosing', 'moving', 'arrived', 'cancelled']),
  kind: z.enum(['restaurant', 'charging', 'poi']), origin: coordinateSchema, candidates: z.array(placeSchema).max(6),
  destination: placeSchema.optional(), progress: z.number().min(0).max(1), position: coordinateSchema,
  consent: z.enum(['selection-required', 'explicit-selection', 'remembered-context', 'favorite']),
  createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(), source: z.literal('simulation'),
  searchSummary: z.string().max(8000).optional(),
}).strict();
export type SimulatedJourney = z.infer<typeof journeySchema>;
export const mobilityStateSchema = z.object({ vehicle: vehicleSchema.nullable(), reports: z.array(mobilityReportSchema).max(20),
  journey: journeySchema.nullable(), favorites: z.array(favoritePlaceSchema).max(10),
  policy: z.object({ enabled: z.boolean(), expiresAt: z.iso.datetime().nullable(), runbook: z.literal('charge-reconnect-v1') }).strict(),
  cases:z.array(mobilityCaseSchema).max(10).default([]),
  mapsAvailable: z.boolean(), mapsBrowserKey: z.string().regex(/^[A-Za-z0-9_-]{20,128}$/).nullable().optional(),
}).strict();
export type MobilityState = z.infer<typeof mobilityStateSchema>;
const expectedVersion = z.number().int().positive();
export const mobilityCommandSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('initialize') }).strict(),
  z.object({ operation: z.literal('telemetry'), expectedVersion, batteryPercent: z.number().int().min(0).max(100), fault: vehicleFaultSchema,
    signal:z.enum(['charge_link_timeout','unclassified']).optional(),language:z.enum(['ko','en']).default('en'),
  }).strict().refine(value=>value.signal===undefined||value.fault==='unknown','Only unknown simulator faults have a signal selector.'),
  z.object({ operation: z.literal('policy'), expectedVersion, enabled: z.boolean() }).strict(),
  z.object({ operation: z.literal('diagnose'), expectedVersion, language: z.enum(['ko','en']) }).strict(),
  z.object({ operation: z.literal('approve'), expectedVersion, reportId: z.uuid() }).strict(),
  z.object({ operation:z.literal('resolve_unknown'), expectedVersion, reportId:z.uuid(), runbook:z.literal('charge-reconnect-v1'), language:z.enum(['ko','en']) }).strict(),
  z.object({ operation:z.literal('promote_case'), expectedVersion, caseId:z.uuid() }).strict(),
  z.object({ operation:z.literal('revoke_case'), expectedVersion, caseId:z.uuid() }).strict(),
  z.object({ operation: z.literal('trip_request'), expectedVersion, kind: z.enum(['restaurant','charging','poi']), instruction: z.string().trim().min(1).max(300), language: z.enum(['ko','en']).default('en') }).strict(),
  z.object({ operation: z.literal('select_destination'), expectedVersion, journeyId: z.uuid(), placeId: z.string().min(1).max(200), remember: z.boolean() }).strict(),
  z.object({ operation: z.literal('advance'), expectedVersion, journeyId: z.uuid() }).strict(),
  z.object({ operation: z.literal('stop'), expectedVersion, journeyId: z.uuid() }).strict(),
  z.object({ operation: z.literal('favorite'), expectedVersion, journeyId: z.uuid(), placeId: z.string().min(1).max(200) }).strict(),
]);
export type MobilityCommand = z.infer<typeof mobilityCommandSchema>;
/** The model proposes one catalog entry; the Guardian checks actual telemetry and authority. */
export const vehicleDiagnosisSchema = z.object({ summary: z.string().min(1).max(1000),
  evidenceIds: z.array(z.enum(['fault','signal','battery','temperature','charging','parked','attempts'])).min(1).max(7),
  unknowns: z.array(z.string().max(240)).max(8), runbook: z.enum(['charge-reconnect-v1','none']),
}).strict();
export type VehicleDiagnosis = z.infer<typeof vehicleDiagnosisSchema>;

/** A model can formulate a search, but never choose credentials, coordinates or movement authority. */
export const journeySearchSchema = z.object({
  query: z.string().trim().min(1).max(300), kind: z.enum(['restaurant','charging','poi']),
}).strict();
export type JourneySearch = z.infer<typeof journeySearchSchema>;
