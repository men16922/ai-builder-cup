import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { mobilityCommandSchema, mobilityStateSchema, vehicleDiagnosisSchema,
  journeySearchSchema, type JourneySearch, type MobilityCommand, type MobilityPlace, type MobilityReport, type MobilityState, type MobilityCase, type VehicleDiagnosis, type SimulatedVehicle } from '@contracts/gcp/mobility';
import { CloudOperationError } from '@contracts/core/workflow';
import type { GcpWebAccess, GcpWebSession } from '../auth/web-access';
import type { CloudStore, CloudTransaction } from '../store/store';
import { cloudDigest } from '../store/integrity';
import { cloudRecordKey } from '../workflow/workflow';
import { chargeReconnectVerdict, safeChargeConditions } from './runbooks';
import { chargingEvidence, matchingCases, recoveryGuidance, verifiedCase } from './case-learning';

export interface VehicleReasoner {
  readonly engine: 'gemini' | 'offline-fixture';
  diagnose(vehicle: SimulatedVehicle, language: 'ko'|'en', signal: AbortSignal, learnedCases?: readonly MobilityCase[]): Promise<VehicleDiagnosis>;
  planJourney?(instruction: string, kind: JourneySearch['kind'], language: 'ko'|'en', signal: AbortSignal): Promise<JourneySearch>;
}
export type MobilitySearchResult = { places: MobilityPlace[]; summary?: string };
export interface MobilityPlaces {
  nearby(location: SimulatedVehicle['location'], kind: JourneySearch['kind'], signal: AbortSignal,
    request?: { query: string; language: 'ko'|'en' }): Promise<MobilityPlace[] | MobilitySearchResult>;
}
type Consent = { context: string; kind: 'restaurant'|'charging'|'poi'; placeId: string; origin: SimulatedVehicle['location']; expiresAt: string };
type RecordState = { state: MobilityState; consents: Consent[]; mapsExpiresAt?: string };
type Budget = { hour: number; model: number; places: number };
// Receipts contain no Google Maps content. A replay returns the current view without rerunning work.
type Receipt = { digest: string; state: 'working'|'finished'|'unknown' };
const fail = (status: number, code: string) => new CloudOperationError(status, code, 'The mobility request could not be confirmed.');
const distance = (a: SimulatedVehicle['location'], b: SimulatedVehicle['location']) => Math.hypot((a.latitude-b.latitude)*111_000, (a.longitude-b.longitude)*88_000);

/** Actor-private serverless twin with version fences and durable one-request claims. */
export class GcpMobility {
  private readonly store: CloudStore;
  private readonly access: GcpWebAccess;
  private readonly entitled: (session: GcpWebSession) => boolean;
  private readonly reasoner?: VehicleReasoner;
  private readonly places?: MobilityPlaces;
  private readonly now: () => number;
  private readonly mapsBrowserKey: string | null;
  constructor(store: CloudStore, access: GcpWebAccess, entitled: (session: GcpWebSession) => boolean,
    reasoner?: VehicleReasoner, places?: MobilityPlaces, now = Date.now, mapsBrowserKey: string | null = null) {
    this.store=store;this.access=access;this.entitled=entitled;this.reasoner=reasoner;this.places=places;this.now=now;this.mapsBrowserKey=mapsBrowserKey;
  }
  private key(session: GcpWebSession, part: string, id = 'current') {
    return cloudRecordKey({ owner: session.context.owner, workspaceId: session.context.workspaceId },
      `mobility-${part}`, cloudDigest([session.context.actorId, id]));
  }
  private empty(): RecordState { return { state: { vehicle: null, reports: [], journey: null, favorites: [], cases: [],
    policy: { enabled: false, expiresAt: null, runbook: 'charge-reconnect-v1' }, mapsAvailable: !!this.places, mapsBrowserKey:null }, consents: [] }; }
  private view(state: MobilityState): MobilityState {
    return mobilityStateSchema.parse({ ...state, mapsAvailable: !!this.places, mapsBrowserKey: this.mapsBrowserKey });
  }
  private async admit(tx: CloudTransaction, session: GcpWebSession, mutation = false) {
    await this.access.assertCurrentIn(tx, session);
    if (!this.entitled(session)) throw fail(403, 'mobility_not_entitled');
    if (mutation && !session.context.roles.includes('operator')) throw fail(403, 'operator_required');
  }
  private expireInvestigations(record: RecordState): boolean {
    let changed = false;
    for (const report of record.state.reports) if (report.state==='investigating' && this.now()-Date.parse(report.at)>35000) {
      report.state='unknown'; report.summary=report.language==='ko'?'조사가 제시간에 완료되지 않았습니다. 자동 재실행하지 않으며 사람 확인이 필요합니다.':'The investigation did not finish in time. It is not retried; human assistance is required.';
      report.unknowns=['Investigation completion is unconfirmed.'];changed=true;
    }
    return changed;
  }
  async read(session: GcpWebSession): Promise<MobilityState> {
    await this.access.current(session);
    return this.store.transact(async tx => {
      await this.admit(tx,session);const key=this.key(session,'twin'),record=await tx.get<RecordState>(key) ?? this.empty();
      if(this.expireInvestigations(record))tx.put(key,record,record.mapsExpiresAt?new Date(record.mapsExpiresAt):undefined);
      return this.view(record.state);
    });
  }
  async command(session: GcpWebSession, raw: unknown, requestId: string): Promise<MobilityState> {
    z.uuid().parse(requestId);
    const command = mobilityCommandSchema.parse(raw), digest = cloudDigest(command);
    const investigates = command.operation === 'diagnose' || command.operation === 'telemetry' && command.fault !== 'none';
    await this.access.current(session);
    const storageKey = this.key(session,'twin'), receiptKey = this.key(session,'request',requestId);
    // Reserve before external calls. A replay of an uncertain model/Places call never spends again.
    const admitted = await this.store.transact(async tx => {
      await this.admit(tx, session, true);
      const record = await tx.get<RecordState>(storageKey) ?? this.empty();
      this.expireInvestigations(record);
      const receipt = await tx.get<Receipt>(receiptKey);
      const budgetKey = this.key(session, 'budget');
      const storedBudget = investigates || command.operation === 'trip_request' ? await tx.get<Budget>(budgetKey) : undefined;
      if (receipt) {
        if (receipt.digest !== digest) throw fail(409,'mobility_request_changed');
        if (receipt.state === 'finished') return { replay: record.state };
        throw fail(409,receipt.state === 'unknown' ? 'mobility_outcome_unknown' : 'mobility_in_progress');
      }
      if (command.operation !== 'initialize' && (!record.state.vehicle || record.state.vehicle.version !== command.expectedVersion)) throw fail(409,'vehicle_changed');
      if (['policy','approve','resolve_unknown','promote_case','revoke_case'].includes(command.operation) && !session.context.roles.includes('reviewer')) throw fail(403,'reviewer_required');
      // Stage fresh telemetry first; use its new episode/version as the investigation fence.
      // A store retry may recompute this pure simulator state, but never calls a provider.
      const staged = command.operation === 'telemetry' && investigates ? this.apply(structuredClone(record),command) : record;
      staged.state.cases ??= [];
      const diagnosisKey = investigates && staged.state.vehicle ? this.key(session,'diagnosis',staged.state.vehicle.episode) : undefined;
      const diagnosisClaim = diagnosisKey ? await tx.get<Receipt>(diagnosisKey) : undefined;
      if (command.operation === 'diagnose' && diagnosisClaim) {
        if (record.state.reports.some(item => item.episode === record.state.vehicle?.episode && item.state !== 'investigating')) {
          tx.put(receiptKey, { digest, state: 'finished' } satisfies Receipt);
          return { replay: record.state };
        }
        throw fail(409, diagnosisClaim.state === 'working' ? 'mobility_in_progress' : 'mobility_outcome_unknown');
      }
      if (investigates || command.operation === 'trip_request') {
        const hour = Math.floor(this.now()/3600000);
        const budget = storedBudget?.hour === hour ? storedBudget : { hour, model: 0, places: 0 };
        const usesModel = investigates || !!this.reasoner?.planJourney;
        if (usesModel && budget.model >= 30 || command.operation === 'trip_request' && budget.places >= 30) {
          if(command.operation!=='telemetry')throw fail(429,'mobility_budget_exceeded');
          // Preserve fresh incident evidence even when autonomous investigation has exhausted its budget.
          const vehicle=staged.state.vehicle!,language=command.language;
          const report:MobilityReport={id:randomUUID(),at:new Date(this.now()).toISOString(),state:'unknown',engine:'guardian',language,
            summary:language==='ko'?'자동 조사 한도에 도달했습니다. 새 증상을 기록했으며 조치하지 않았습니다. 사람 확인이 필요합니다.':'The automatic investigation limit was reached. The new symptom was recorded; no remedy was performed. Human assistance is required.',
            evidence:Object.entries(this.evidence(vehicle)).map(([id,value])=>`${id}: ${value}`),unknowns:['No model investigation was performed.'],runbook:'none',beforeVersion:vehicle.version,authorization:'read-only',episode:vehicle.episode,
            ...(vehicle.fault==='unknown'?{guidance:recoveryGuidance(vehicle,this.now())}:{})};
          staged.state.reports=[report,...staged.state.reports].slice(0,20);
          tx.put(storageKey,staged,staged.mapsExpiresAt?new Date(staged.mapsExpiresAt):undefined);tx.put(receiptKey,{digest,state:'finished'} satisfies Receipt);
          if(diagnosisKey)tx.put(diagnosisKey,{digest,state:'finished'} satisfies Receipt);
          return {replay:staged.state};
        }
        if (usesModel) budget.model++;
        if (command.operation === 'trip_request') budget.places++;
        tx.put(budgetKey,budget);
      }
      if (diagnosisKey) {
        staged.state.reports = [{id:randomUUID(),at:new Date(this.now()).toISOString(),state:'investigating',engine:'guardian',summary:command.operation !== 'initialize' && 'language' in command && command.language === 'ko' ? '새 증상을 조사 중입니다. 아직 조치하지 않았습니다.' : 'Investigating this new symptom. No remedy has been performed.',evidence:[],unknowns:[],runbook:'none',beforeVersion:staged.state.vehicle!.version,authorization:'read-only',episode:staged.state.vehicle!.episode,language:'language' in command?command.language:'en',...(staged.state.vehicle!.fault==='unknown'?{guidance:recoveryGuidance(staged.state.vehicle!,this.now())}:{})} satisfies MobilityReport,...staged.state.reports.filter(report=>report.episode!==staged.state.vehicle!.episode)].slice(0,20);
        tx.put(storageKey,staged,staged.mapsExpiresAt ? new Date(staged.mapsExpiresAt) : undefined);
        tx.put(diagnosisKey,{ digest, state:'working' } satisfies Receipt);
      }
      tx.put(receiptKey, { digest, state: 'working' } satisfies Receipt);
      return { record: staged };
    });
    if ('replay' in admitted) return this.view(admitted.replay!);
    const record = admitted.record!, before = record.state.vehicle;
    let diagnosis: VehicleDiagnosis | undefined, candidates: MobilityPlace[] | undefined, searchSummary: string | undefined;
    const investigationLanguage = 'language' in command ? command.language : 'en';
    let appliedCommand: MobilityCommand = command.operation === 'telemetry' && investigates ? {operation:'diagnose',expectedVersion:before!.version,language:investigationLanguage} : command;
    try {
      if (investigates) {
        if (!this.reasoner) throw fail(503,'vehicle_ai_not_configured');
        diagnosis = vehicleDiagnosisSchema.parse(await this.reasoner.diagnose(before!,investigationLanguage,AbortSignal.timeout(25_000),matchingCases(before!,record.state.cases ?? [],this.now())));
      }
      if (command.operation === 'trip_request') {
        if (!this.places) throw fail(503,'maps_not_configured');
        // Reject before spending a model/Maps call. A new search cannot interrupt an active journey.
        if (!before!.parked) throw fail(409,'vehicle_moving');
        const signal = AbortSignal.timeout(28_000);
        const plan = this.reasoner?.planJourney
          ? journeySearchSchema.parse(await this.reasoner.planJourney(command.instruction,command.kind,command.language,signal))
          : { query:command.instruction,kind:command.kind };
        appliedCommand = { ...command,kind:plan.kind };
        const result = await this.places.nearby(before!.location,plan.kind,signal,{query:plan.query,language:command.language});
        candidates = Array.isArray(result) ? result : result.places;
        searchSummary = Array.isArray(result) ? undefined : z.string().max(8000).optional().parse(result.summary);
        // Enforce bounds again even for a misbehaving provider adapter.
        if (candidates.length > 6 || candidates.some(place => place.kind !== plan.kind || distance(before!.location,place.location) > 10_000)) throw fail(502,'places_response_invalid');
      }
      // Identity/membership may change while an external call is pending.
      await this.access.current(session);
      const finished = await this.store.transact(async tx => {
        await this.admit(tx,session,true);
        const current = await tx.get<RecordState>(storageKey) ?? this.empty();
        const claim = await tx.get<Receipt>(receiptKey);
        if (investigates) await tx.get<Receipt>(this.key(session,'diagnosis',before!.episode));
        if (claim?.state !== 'working' || claim.digest !== digest) throw fail(409,'mobility_outcome_unknown');
        if (appliedCommand.operation !== 'initialize' && current.state.vehicle?.version !== appliedCommand.expectedVersion) throw fail(409,'vehicle_changed');
        if (investigates && (this.now()-Date.parse(current.state.reports.find(report=>report.episode===before!.episode)?.at ?? '')>35000 || current.state.reports.find(report=>report.episode===before!.episode)?.state!=='investigating')) throw fail(409,'investigation_expired');
        const next = this.apply(structuredClone(current),appliedCommand,diagnosis,candidates,searchSummary);
        const state = mobilityStateSchema.parse(next.state);
        tx.put(storageKey,next,next.mapsExpiresAt ? new Date(next.mapsExpiresAt) : undefined);
        tx.put(receiptKey,{ digest, state:'finished' } satisfies Receipt);
        if (investigates) tx.put(this.key(session,'diagnosis',before!.episode),{digest,state:'finished'} satisfies Receipt);
        return state;
      });
      return this.view(finished);
    } catch (error) {
      const providerBusy = error instanceof Error && error.message === 'google_mobility_busy';
      // Fixed classifications only: no identities, locations, tokens, prompts or provider bodies.
      if (investigates && process.env.MOBILEOPS_OFFLINE_TEST !== '1') console.warn(JSON.stringify({event:'mobility_investigation_unconfirmed',reason:providerBusy?'provider_capacity':error instanceof Error && ['TimeoutError','AbortError'].includes(error.name)?'deadline':'unconfirmed'}));
      // This is only a storage update: never retry the model, Places or a control action here.
      await this.store.transact(async tx => {
        const claim = await tx.get<Receipt>(receiptKey);
        const latest = investigates ? await tx.get<RecordState>(storageKey) : undefined;
        if (investigates && before) await tx.get<Receipt>(this.key(session,'diagnosis',before.episode));
        if (claim?.state !== 'working') return;
        tx.put(receiptKey,{digest,state:'unknown'} satisfies Receipt);
        if (investigates && before) {
          tx.put(this.key(session,'diagnosis',before.episode),{digest,state:'unknown'} satisfies Receipt);
          if (latest && !latest.state.reports.some(report=>report.episode===before.episode && report.state !== 'investigating')) {
            latest.state.reports=[{ id:randomUUID(),at:new Date(this.now()).toISOString(),state:'unknown',engine:'guardian',
              summary:providerBusy ? (investigationLanguage==='ko'?'AI 서비스가 혼잡해 조사를 완료하지 못했습니다. 조치하거나 자동 재실행하지 않았습니다. 복구 가이드를 확인해 주세요.':'The AI service is busy, so this investigation did not complete. No remedy or automatic retry occurred. Review the recovery guide.') : investigationLanguage==='ko'?'조사 결과를 확인하지 못했습니다. 조치하지 않았으며 사람 확인이 필요합니다.':'The investigation could not be confirmed. No remedy was performed; human assistance is needed.',
              evidence:[],unknowns:['Diagnosis outcome unavailable.'],runbook:'none',beforeVersion:before.version,authorization:'read-only',episode:before.episode,language:investigationLanguage,...(before.fault==='unknown'?{guidance:recoveryGuidance(before,this.now())}:{}) } satisfies MobilityReport,...latest.state.reports.filter(report=>report.episode!==before.episode)].slice(0,20);
            tx.put(storageKey,latest,latest.mapsExpiresAt ? new Date(latest.mapsExpiresAt) : undefined);
          }
        }
      });
      // Fresh telemetry remains recorded even when its read-only investigation is uncertain.
      if (command.operation === 'telemetry' && investigates) return this.read(session);
      throw error;
    }
  }
  private apply(record: RecordState, command: MobilityCommand, diagnosis?: VehicleDiagnosis, candidates?: MobilityPlace[], searchSummary?: string): RecordState {
    const state = record.state, now = this.now(), at = new Date(now).toISOString();
    state.cases ??= [];
    if (command.operation === 'initialize') {
      if (!state.vehicle) state.vehicle = { id: randomUUID(), version:1, source:'simulation', model:'Aide EV', observedAt:at,
        batteryPercent:68,targetPercent:80,batteryCelsius:28,rangeKm:354,parked:true,charging:'idle',powerKw:0,fault:'none',diagnosticSignal:'none',episode:randomUUID(),attempts:0,
        location:{latitude:37.5665,longitude:126.978} };
      return record;
    }
    const vehicle = state.vehicle!;
    const reconnect = (report: MobilityReport, authorization: MobilityReport['authorization'], guided = false) => {
      const matched = matchingCases(vehicle,state.cases,now);
      const allowed = guided ? recoveryGuidance(vehicle,now).canResolve : chargeReconnectVerdict(vehicle,report.runbook,matched.length===1) === 'allow';
      if (!allowed || !safeChargeConditions(vehicle) || report.episode !== vehicle.episode) throw fail(409,'runbook_guard_refused');
      vehicle.attempts = 1; vehicle.fault = 'none'; vehicle.diagnosticSignal = 'none'; vehicle.charging = 'charging'; vehicle.powerKw = 72;
      report.state = 'remediated'; report.authorization = authorization; report.afterVersion = vehicle.version + 1;
      report.remedy = {source:'simulation',before:'interrupted',after:'charging',attempts:1,powerKw:vehicle.powerKw,verifiedAt:at};
    };
    switch (command.operation) {
      case 'telemetry':
        if (!vehicle.parked) throw fail(409,'vehicle_moving');
        vehicle.batteryPercent = command.batteryPercent; vehicle.rangeKm = Math.round(command.batteryPercent*5.2);
        vehicle.fault = command.fault; vehicle.batteryCelsius = command.fault === 'battery_hot' ? 52 : 28;
        vehicle.diagnosticSignal = command.fault === 'charge_handshake' ? 'charge_handshake_timeout' : command.fault === 'battery_hot' ? 'battery_thermal_limit' : command.fault === 'unknown' ? command.signal ?? 'unclassified' : 'none';
        vehicle.charging = command.fault === 'charge_handshake' || command.fault === 'unknown' && vehicle.diagnosticSignal === 'charge_link_timeout' ? 'interrupted' : 'idle'; vehicle.powerKw = 0;
        vehicle.episode = randomUUID(); vehicle.attempts = 0; break;
      case 'policy':
        state.policy = { enabled:command.enabled, expiresAt:command.enabled ? new Date(now+24*60*60_000).toISOString() : null, runbook:'charge-reconnect-v1' }; break;
      case 'diagnose': {
        const matched = matchingCases(vehicle,state.cases,now), learned = matched.length === 1 ? matched[0] : undefined;
        const allowed = chargeReconnectVerdict(vehicle,diagnosis!.runbook,!!learned) === 'allow';
        const report: MobilityReport = { id:randomUUID(),at,state:allowed ? 'needs_decision' : 'escalated',engine:this.reasoner!.engine,
          summary:diagnosis!.summary,evidence:diagnosis!.evidenceIds.map(id=>`${id}: ${this.evidence(vehicle)[id]}`),unknowns:diagnosis!.unknowns,
          runbook:diagnosis!.runbook,beforeVersion:vehicle.version,authorization:'read-only',episode:vehicle.episode,language:command.language,
          ...(vehicle.fault==='unknown'&&!allowed?{guidance:recoveryGuidance(vehicle,now)}:{}),...(allowed&&learned?{caseId:learned.id}:{}) };
        if (allowed && state.policy.enabled && Date.parse(state.policy.expiresAt ?? '') > now) reconnect(report,'standing-policy');
        state.reports = [report,...state.reports.filter(item=>item.episode!==vehicle.episode)].slice(0,20); break;
      }
      case 'approve': {
        const report = state.reports.find(item=>item.id===command.reportId);
        if (!report || report.state !== 'needs_decision') throw fail(409,'report_changed');
        reconnect(report,'human-decision'); break;
      }
      case 'resolve_unknown': {
        const report = state.reports.find(item=>item.id===command.reportId);
        if (!report || !['escalated','unknown'].includes(report.state) || report.episode!==vehicle.episode || !report.guidance
          || Date.parse(report.guidance.expiresAt)<=now || !recoveryGuidance(vehicle,now).canResolve) throw fail(409,'recovery_guide_changed');
        const before = chargingEvidence(vehicle), id = randomUUID();
        report.runbook = command.runbook;
        reconnect(report,'human-decision',true);
        const learned: MobilityCase = {id,vehicleId:vehicle.id,sourceReportId:report.id,signal:'charge_link_timeout',runbook:command.runbook,
          status:'candidate',createdAt:at,expiresAt:new Date(now+7*24*3600000).toISOString(),verifiedVersion:vehicle.version+1,
          verification:{before,after:chargingEvidence(vehicle)}};
        if (!verifiedCase(learned)) throw fail(409,'recovery_not_verified');
        report.caseId = id; report.guidance.canResolve = false;
        report.summary = command.language==='ko' ? '함께 확인한 가상 충전 재연결이 완료됐고 충전 재개를 확인했습니다. 이 결과는 후보 사례이며 별도 승인 전에는 재발에 자동 적용되지 않습니다.' : 'The guided simulated reconnection completed and charging resumed in the read-back. This is a candidate case; it cannot handle recurrence until separately approved.';
        state.cases = [learned,...state.cases].slice(0,10); break;
      }
      case 'promote_case': {
        const learned = state.cases.find(item=>item.id===command.caseId);
        if (!learned || learned.status!=='candidate' || learned.vehicleId!==vehicle.id || Date.parse(learned.createdAt)>now || Date.parse(learned.expiresAt)<=now || !verifiedCase(learned)) throw fail(409,'case_not_promotable');
        // Keep one active, exact signal pattern. Promotion neither enables policy nor performs a remedy.
        for (const previous of state.cases) if (previous.status==='active'&&previous.vehicleId===learned.vehicleId&&previous.signal===learned.signal) previous.status='revoked';
        learned.status='active';learned.activatedAt=at;break;
      }
      case 'revoke_case': {
        const learned = state.cases.find(item=>item.id===command.caseId);
        if (!learned || learned.vehicleId!==vehicle.id || learned.status==='revoked') throw fail(409,'case_changed');
        learned.status='revoked';break;
      }
      case 'trip_request': {
        if (!vehicle.parked) throw fail(409,'vehicle_moving');
        if (!candidates!.length) throw fail(404,'places_empty');
        // Grounded output is retained only for its display. Keep the initial 29-day deadline
        // through subsequent writes, leaving a day for Firestore's asynchronous TTL deletion.
        // Consent/receipt records never carry the provider summary or source names.
        record.mapsExpiresAt ??= new Date(now+29*24*60*60_000).toISOString();
        record.consents = record.consents.filter(item=>Date.parse(item.expiresAt)>now);
        const context=cloudDigest([command.kind, command.instruction.toLowerCase().replace(/\s+/g,' ').trim(), Math.floor(((now/3600000)+9)%24/6)]);
        const remembered = record.consents.find(item=>item.context===context && item.kind===command.kind && distance(item.origin,vehicle.location)<=500 && candidates!.some(place=>place.id===item.placeId));
        const favorite = candidates!.find(place=>state.favorites.some(saved=>saved.id===place.id && saved.kind===command.kind));
        // Multiple favorites are ambiguous. A previous explicit choice wins only within its exact context.
        const destination = remembered ? candidates!.find(place=>place.id===remembered.placeId) : candidates!.filter(place=>state.favorites.some(saved=>saved.id===place.id && saved.kind===command.kind)).length === 1 ? favorite : undefined;
        state.journey = { id:randomUUID(),state:destination ? 'moving':'choosing',kind:command.kind,origin:{...vehicle.location},position:{...vehicle.location},candidates:candidates!,destination,progress:0,
          consent:remembered ? 'remembered-context' : destination ? 'favorite':'selection-required',createdAt:at,expiresAt:new Date(now+30*60_000).toISOString(),source:'simulation',searchSummary };
        // Keep the context server-private; navigation consent is never a bearer credential.
        (record as RecordState & { pendingContext?: string }).pendingContext=context;
        if (destination) vehicle.parked=false; break;
      }
      case 'select_destination': {
        const journey=state.journey;
        if (!journey || journey.id!==command.journeyId || journey.state!=='choosing' || Date.parse(journey.expiresAt)<=now) throw fail(409,'journey_changed');
        const place=journey.candidates.find(item=>item.id===command.placeId); if (!place) throw fail(400,'destination_not_offered');
        journey.destination=place; journey.state='moving';journey.consent='explicit-selection';vehicle.parked=false;
        if (command.remember) record.consents=[{context:(record as RecordState & { pendingContext?: string }).pendingContext ?? '',kind:journey.kind,placeId:place.id,origin:{...journey.origin},expiresAt:new Date(now+7*24*60*60_000).toISOString()},...record.consents.filter(item=>item.kind!==journey.kind)].slice(0,3);
        break;
      }
      case 'advance': {
        const journey=state.journey;
        if (!journey || journey.id!==command.journeyId || journey.state!=='moving' || !journey.destination || Date.parse(journey.expiresAt)<=now) throw fail(409,'journey_changed');
        journey.progress=Math.min(1,journey.progress+0.1);
        const p=journey.progress, dest=journey.destination.location;
        journey.position={latitude:journey.origin.latitude+(dest.latitude-journey.origin.latitude)*p,longitude:journey.origin.longitude+(dest.longitude-journey.origin.longitude)*p};
        vehicle.location={...journey.position};
        if (p>=0.999) { journey.state='arrived';journey.progress=1;journey.position={...dest};vehicle.location={...dest};vehicle.parked=true; }
        break;
      }
      case 'stop':
        if (!state.journey || state.journey.id!==command.journeyId) throw fail(409,'journey_changed');
        state.journey.state='cancelled';vehicle.parked=true;break;
      case 'favorite': {
        const journey=state.journey;
        if (!journey || journey.id!==command.journeyId) throw fail(409,'journey_changed');
        const place=journey.candidates.find(item=>item.id===command.placeId); if (!place) throw fail(400,'destination_not_offered');
        state.favorites=[{id:place.id,kind:place.kind},...state.favorites.filter(item=>item.id!==place.id)].slice(0,10);break;
      }
    }
    vehicle.version++; vehicle.observedAt=at; return record;
  }
  private evidence(vehicle: SimulatedVehicle): Record<string,string> {
    return { signal:vehicle.diagnosticSignal,fault:vehicle.fault,battery:`${vehicle.batteryPercent}%`,temperature:`${vehicle.batteryCelsius} C`,charging:vehicle.charging,parked:String(vehicle.parked),attempts:String(vehicle.attempts) };
  }
}
