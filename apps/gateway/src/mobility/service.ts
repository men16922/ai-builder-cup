import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { mobilityCommandSchema, mobilityStateSchema, vehicleDiagnosisSchema, callStepSchema, callDigestSchema, assistPlanSchema, type AssistPlan, type AssistTurn, type CallStep, type CallDigest, type VehicleCall,
  journeySearchSchema, type JourneySearch, type MobilityCommand, type MobilityPlace, type MobilityReport, type MobilityState, type MobilityCase, type VehicleDiagnosis, type SimulatedVehicle } from '@contracts/gcp/mobility';
import { CloudOperationError } from '@contracts/core/workflow';
import type { GcpWebAccess, GcpWebSession } from '../auth/web-access';
import type { CloudStore, CloudTransaction } from '../store/store';
import { cloudDigest } from '../store/integrity';
import { cloudRecordKey } from '../workflow/workflow';
import { chargeReconnectVerdict, safeChargeConditions } from './runbooks';
import { chargingEvidence, matchingCases, recoveryGuidance, verifiedCase } from './case-learning';
import { callPersona, driverContext, followupWhen, settleVehicle, type CallInput } from './calls';
import { MobilityCallOutputError } from './google-ports';
import { callDraftReady } from './call-drafts';

export interface VehicleReasoner {
  readonly engine: 'gemini' | 'offline-fixture';
  diagnose(vehicle: SimulatedVehicle, language: 'ko'|'en', signal: AbortSignal, learnedCases?: readonly MobilityCase[]): Promise<VehicleDiagnosis>;
  planJourney?(instruction: string, kind: JourneySearch['kind'], language: 'ko'|'en', signal: AbortSignal): Promise<JourneySearch>;
  /** Voices a synthetic caller or drafts My Aide's reply. It never sends, books or controls anything. */
  call?(input: CallInput, signal: AbortSignal): Promise<CallStep>;
  summarizeCall?(input: CallInput, signal: AbortSignal): Promise<CallDigest>;
  /** Maps a driver request to a reply and up to three catalog proposals; the driver taps to act. */
  assist?(input: { text: string; language: 'ko'|'en'; context: string }, signal: AbortSignal): Promise<AssistPlan>;
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
// A call snapshot has one durable provider step, including across different request keys.
type CallClaim = Receipt & { requestId: string; deadline: number };
const fail = (status: number, code: string) => new CloudOperationError(status, code, 'The mobility request could not be confirmed.');
const distance = (a: SimulatedVehicle['location'], b: SimulatedVehicle['location']) => Math.hypot((a.latitude-b.latitude)*111_000, (a.longitude-b.longitude)*88_000);
const callSteps = new Set(['call_answer','call_say','call_delegate','call_end']);

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
  private callKey(session: GcpWebSession, call: VehicleCall) {
    return this.key(session, 'call-step', cloudDigest(call));
  }
  /** A vanished worker cannot leave a call answerable or "in progress" forever. No provider retry. */
  private async expireCall(tx: CloudTransaction, session: GcpWebSession, record: RecordState): Promise<boolean> {
    const live = record.state.call;
    if (!live || !['ringing', 'active'].includes(live.state)) return false;
    const key = this.callKey(session, live), claim = await tx.get<CallClaim>(key);
    if (!claim || claim.state !== 'working' || this.now() <= claim.deadline) return false;
    const requestKey = this.key(session, 'request', claim.requestId), receipt = await tx.get<Receipt>(requestKey);
    if (receipt?.state === 'working' && receipt.digest === claim.digest) tx.put(requestKey, { digest: receipt.digest, state: 'unknown' } satisfies Receipt);
    tx.put(key, { ...claim, state: 'unknown' } satisfies CallClaim);
    live.state = 'unknown';
    record.state.callRevision = (record.state.callRevision ?? 0) + 1;
    if (record.state.journey) record.state.journey.autopilot = false;
    return true;
  }
  private empty(): RecordState { return { state: { vehicle: null, reports: [], journey: null, favorites: [], cases: [], call: null, calls: [], assist: null,
    policy: { enabled: false, expiresAt: null, runbook: 'charge-reconnect-v1' }, mapsAvailable: !!this.places, mapsBrowserKey:null }, consents: [] }; }
  /** Stored twins written before newer fields existed take the contract defaults. */
  private normalize(record: RecordState): RecordState { record.state = mobilityStateSchema.parse(record.state); return record; }
  private view(state: MobilityState): MobilityState {
    const shown = mobilityStateSchema.parse({ ...structuredClone(state), mapsAvailable: !!this.places, mapsBrowserKey: this.mapsBrowserKey });
    if (shown.vehicle) settleVehicle(shown.vehicle, this.now());
    return mobilityStateSchema.parse(shown);
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
      await this.admit(tx,session);const key=this.key(session,'twin'),record=this.normalize(await tx.get<RecordState>(key) ?? this.empty());
      const callExpired = await this.expireCall(tx, session, record);
      if(this.expireInvestigations(record) || callExpired)tx.put(key,record,record.mapsExpiresAt?new Date(record.mapsExpiresAt):undefined);
      return this.view(record.state);
    });
  }
  /** The caller's own hourly AI and Maps usage against the fixed server ceilings. */
  async usage(session: GcpWebSession) {
    await this.access.current(session);
    return this.store.transact(async tx => {
      await this.admit(tx, session);
      const hour = Math.floor(this.now()/3600000), stored = await tx.get<Budget>(this.key(session,'budget')), budget = stored?.hour === hour ? stored : { hour, model: 0, places: 0 };
      return { model: budget.model, places: budget.places, modelLimit: 30, placesLimit: 30, resetsAt: new Date((hour+1)*3600000).toISOString() };
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
      const record = this.normalize(await tx.get<RecordState>(storageKey) ?? this.empty());
      this.expireInvestigations(record);
      const receipt = await tx.get<Receipt>(receiptKey);
      const budgetKey = this.key(session, 'budget');
      const callModel = callSteps.has(command.operation) || command.operation === 'assist';
      const storedBudget = investigates || callModel || command.operation === 'trip_request' ? await tx.get<Budget>(budgetKey) : undefined;
      if (receipt) {
        if (receipt.digest !== digest) throw fail(409,'mobility_request_changed');
        if (receipt.state === 'finished') return { replay: record.state };
        throw fail(409,receipt.state === 'unknown' ? 'mobility_outcome_unknown' : 'mobility_in_progress');
      }
      if (command.operation !== 'initialize' && (!record.state.vehicle || record.state.vehicle.version !== command.expectedVersion)) throw fail(409,'vehicle_changed');
      if (['policy','approve','resolve_unknown','promote_case','revoke_case'].includes(command.operation) && !session.context.roles.includes('reviewer')) throw fail(403,'reviewer_required');
      // Reject an impossible call step before spending a model call or a request claim.
      if (command.operation === 'assist' && !this.reasoner?.assist) throw fail(503,'assist_ai_not_configured');
      if (callSteps.has(command.operation) && (!this.reasoner?.call || !this.reasoner.summarizeCall)) throw fail(503,'call_ai_not_configured');
      this.precheckCall(record.state, command);
      const callStepKey = callModel && record.state.call ? this.callKey(session, record.state.call) : undefined;
      const callClaim = callStepKey ? await tx.get<CallClaim>(callStepKey) : undefined;
      if (callClaim) throw fail(409, callClaim.state === 'working' && this.now() <= callClaim.deadline ? 'mobility_in_progress' : 'mobility_outcome_unknown');
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
      if (investigates || callModel || command.operation === 'trip_request') {
        const hour = Math.floor(this.now()/3600000);
        const budget = storedBudget?.hour === hour ? storedBudget : { hour, model: 0, places: 0 };
        const usesModel = investigates || callModel || !!this.reasoner?.planJourney;
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
      if (callStepKey) tx.put(callStepKey, { digest, state: 'working', requestId, deadline: this.now() + 30_000 } satisfies CallClaim);
      return { record: staged, callStepKey };
    });
    if ('replay' in admitted) return this.view(admitted.replay!);
    const record = admitted.record!, before = record.state.vehicle, callStepKey = admitted.callStepKey;
    // Relative calendar days refer to the context sent to the model, even across midnight.
    const callReferenceAt = this.now();
    let diagnosis: VehicleDiagnosis | undefined, candidates: MobilityPlace[] | undefined, searchSummary: string | undefined, callStep: CallStep | undefined, callDigest: CallDigest | undefined, assistPlan: AssistPlan | undefined;
    const investigationLanguage = 'language' in command ? command.language : 'en';
    let appliedCommand: MobilityCommand = command.operation === 'telemetry' && investigates ? {operation:'diagnose',expectedVersion:before!.version,language:investigationLanguage} : command;
    try {
      if (investigates) {
        if (!this.reasoner) throw fail(503,'vehicle_ai_not_configured');
        diagnosis = vehicleDiagnosisSchema.parse(await this.reasoner.diagnose(before!,investigationLanguage,AbortSignal.timeout(25_000),matchingCases(before!,record.state.cases ?? [],this.now())));
      }
      if (command.operation === 'assist') assistPlan = assistPlanSchema.parse(await this.reasoner!.assist!({ text: command.text, language: command.language, context: driverContext(record.state, command.language, this.now()) }, AbortSignal.timeout(20_000)));
      if (callSteps.has(command.operation)) {
        const input = this.callInput(record.state,command,callReferenceAt);
        if (command.operation === 'call_end') callDigest = callDigestSchema.parse(await this.reasoner!.summarizeCall!(input, AbortSignal.timeout(25_000)));
        else callStep = callStepSchema.parse(await this.reasoner!.call!(input, AbortSignal.timeout(20_000)));
        if (callStep && !callStep.aide?.trim() && !callStep.caller?.trim()) throw fail(502, 'call_response_invalid');
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
        const current = this.normalize(await tx.get<RecordState>(storageKey) ?? this.empty());
        const claim = await tx.get<Receipt>(receiptKey);
        const callClaim = callStepKey ? await tx.get<CallClaim>(callStepKey) : undefined;
        if (callStepKey && (callClaim?.state !== 'working' || callClaim.digest !== digest || this.now() > callClaim.deadline)) throw fail(409, 'mobility_outcome_unknown');
        if (investigates) await tx.get<Receipt>(this.key(session,'diagnosis',before!.episode));
        if (claim?.state !== 'working' || claim.digest !== digest) throw fail(409,'mobility_outcome_unknown');
        if (callSteps.has(appliedCommand.operation)) {
          // A call only appends conversation/drafts. Current vehicle progress is retained;
          // authority, the exact captured call and its durable lease are checked independently.
          if (!current.state.call || !record.state.call || cloudDigest(current.state.call) !== cloudDigest(record.state.call)) throw fail(409, 'call_changed');
        } else if (appliedCommand.operation !== 'initialize' && current.state.vehicle?.version !== appliedCommand.expectedVersion) throw fail(409,'vehicle_changed');
        if (investigates && (this.now()-Date.parse(current.state.reports.find(report=>report.episode===before!.episode)?.at ?? '')>35000 || current.state.reports.find(report=>report.episode===before!.episode)?.state!=='investigating')) throw fail(409,'investigation_expired');
        const next = this.apply(structuredClone(current),appliedCommand,diagnosis,candidates,searchSummary,{step:callStep,digest:callDigest,assist:assistPlan,referenceAt:callReferenceAt});
        const state = mobilityStateSchema.parse(next.state);
        tx.put(storageKey,next,next.mapsExpiresAt ? new Date(next.mapsExpiresAt) : undefined);
        tx.put(receiptKey,{ digest, state:'finished' } satisfies Receipt);
        if (callStepKey && callClaim) tx.put(callStepKey, { ...callClaim, state: 'finished' } satisfies CallClaim);
        if (investigates) tx.put(this.key(session,'diagnosis',before!.episode),{digest,state:'finished'} satisfies Receipt);
        return state;
      });
      return this.view(finished);
    } catch (error) {
      const providerBusy = error instanceof Error && error.message === 'google_mobility_busy';
      const callOutput = callSteps.has(command.operation) ? error instanceof MobilityCallOutputError ? error : error instanceof z.ZodError ? new MobilityCallOutputError(command.operation === 'call_end' ? 'summary' : 'turn', error) : undefined : undefined;
      // Fixed classifications only: no identities, locations, tokens, prompts or provider bodies.
      if (investigates && process.env.MOBILEOPS_OFFLINE_TEST !== '1') console.warn(JSON.stringify({event:'mobility_investigation_unconfirmed',reason:providerBusy?'provider_capacity':error instanceof Error && ['TimeoutError','AbortError'].includes(error.name)?'deadline':'unconfirmed'}));
      if (callSteps.has(command.operation) && process.env.MOBILEOPS_OFFLINE_TEST !== '1') console.warn(JSON.stringify({event:'mobility_call_unconfirmed',operation:command.operation,reason:callOutput?'output_validation':providerBusy?'provider_capacity':error instanceof Error && ['TimeoutError','AbortError'].includes(error.name)?'deadline':'unconfirmed',...(callOutput?{phase:callOutput.phase,fields:callOutput.fields,constraints:callOutput.constraints}:{})}));
      // This is only a storage update: never retry the model, Places or a control action here.
      await this.store.transact(async tx => {
        const claim = await tx.get<Receipt>(receiptKey);
        const callClaim = callStepKey ? await tx.get<CallClaim>(callStepKey) : undefined;
        const raw = investigates || callSteps.has(command.operation) ? await tx.get<RecordState>(storageKey) : undefined, latest = raw ? this.normalize(raw) : undefined;
        if (investigates && before) await tx.get<Receipt>(this.key(session,'diagnosis',before.episode));
        if (claim?.state !== 'working') return;
        tx.put(receiptKey,{digest,state:'unknown'} satisfies Receipt);
        if (callStepKey && callClaim?.state === 'working' && callClaim.digest === digest) tx.put(callStepKey, { ...callClaim, state: 'unknown' } satisfies CallClaim);
        // A fresh request key or recreated service must not repeat an ambiguous call step.
        // Fence cleanup to the captured transcript so a late failure cannot erase a newer turn.
        if (callSteps.has(command.operation) && latest?.state.call && record.state.call) {
          const captured = record.state.call, live = latest.state.call;
          if (live.id === captured.id && cloudDigest(live) === cloudDigest(captured)) {
            live.state = 'unknown';
            latest.state.callRevision = (latest.state.callRevision ?? 0) + 1;
            if (latest.state.journey) latest.state.journey.autopilot = false;
            tx.put(storageKey, latest, latest.mapsExpiresAt ? new Date(latest.mapsExpiresAt) : undefined);
          }
        }
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
      // The client request was admitted before this provider/result failure. It is not a
      // malformed user request, and must retain unknown/no-resend guidance after cleanup.
      if (callOutput) throw fail(502, 'mobility_outcome_unknown');
      // A search or an assist proposal changes nothing, so the driver may simply ask again.
      if (!callSteps.has(command.operation) && !investigates) {
        if (providerBusy) throw fail(503, 'mobility_provider_busy');
        if (error instanceof Error && error.message === 'maps_search_out_of_range') throw fail(422, 'places_out_of_range');
      }
      throw error;
    }
  }
  private apply(record: RecordState, command: MobilityCommand, diagnosis?: VehicleDiagnosis, candidates?: MobilityPlace[], searchSummary?: string, call: { step?: CallStep; digest?: CallDigest; assist?: AssistPlan; referenceAt?: number } = {}): RecordState {
    const state = record.state, now = this.now(), at = new Date(now).toISOString();
    state.cases ??= [];
    if (command.operation === 'initialize') {
      if (!state.vehicle) state.vehicle = { id: randomUUID(), version:1, source:'simulation', model:'Aide EV', observedAt:at,
        batteryPercent:68,targetPercent:80,batteryCelsius:28,rangeKm:354,parked:true,charging:'idle',powerKw:0,fault:'none',diagnosticSignal:'none',episode:randomUUID(),attempts:0,
        location:{latitude:37.5665,longitude:126.978},locked:true,climate:{on:false,targetCelsius:21,cabinCelsius:24},tiresBar:[2.5,2.5,2.5,2.5],odometerKm:12840 };
      return record;
    }
    const vehicle = state.vehicle!;
    settleVehicle(vehicle, now);
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
        vehicle.diagnosticSignal = command.fault === 'charge_handshake' ? 'charge_handshake_timeout' : command.fault === 'battery_hot' ? 'battery_thermal_limit' : command.fault === 'tire_low' ? 'tire_pressure_low' : command.fault === 'unknown' ? command.signal ?? 'unclassified' : 'none';
        vehicle.tiresBar = command.fault === 'tire_low' ? [2.5,2.5,1.6,2.5] : [2.5,2.5,2.5,2.5]; delete vehicle.chargeSession;
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
          consent:remembered ? 'remembered-context' : destination ? 'favorite':'selection-required',createdAt:at,expiresAt:new Date(now+30*60_000).toISOString(),source:'simulation',searchSummary,autopilot:false };
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
        if (p>=0.999) {
          journey.state='arrived';journey.progress=1;journey.position={...dest};vehicle.location={...dest};vehicle.parked=true;journey.autopilot=false;
          // Straight-line simulation: energy and odometer follow the simulated distance, not a road route.
          const km=distance(journey.origin,dest)/1000;
          vehicle.batteryPercent=Math.max(0,vehicle.batteryPercent-Math.max(1,Math.round(km/5.2)));vehicle.rangeKm=Math.round(vehicle.batteryPercent*5.2);vehicle.odometerKm+=Math.max(1,Math.round(km));
        }
        break;
      }
      case 'stop':
        if (!state.journey || state.journey.id!==command.journeyId) throw fail(409,'journey_changed');
        state.journey.state='cancelled';state.journey.autopilot=false;vehicle.parked=true;break;
      case 'favorite': {
        const journey=state.journey;
        if (!journey || journey.id!==command.journeyId) throw fail(409,'journey_changed');
        const place=journey.candidates.find(item=>item.id===command.placeId); if (!place) throw fail(400,'destination_not_offered');
        state.favorites=[{id:place.id,kind:place.kind},...state.favorites.filter(item=>item.id!==place.id)].slice(0,10);break;
      }
      case 'control': {
        const action=command.action;
        if (action==='lock'||action==='unlock') vehicle.locked=action==='lock';
        else if (action==='climate_on'||action==='climate_off') vehicle.climate={...vehicle.climate,on:action==='climate_on',changedAt:at};
        else if (action==='set_temperature') {
          if (command.value===undefined||command.value>28) throw fail(400,'control_value_invalid');
          vehicle.climate={...vehicle.climate,targetCelsius:Math.round(command.value*2)/2,changedAt:at};
        } else if (action==='set_charge_limit') {
          if (command.value===undefined||command.value<50) throw fail(400,'control_value_invalid');
          vehicle.targetPercent=Math.round(command.value);
        } else if (action==='start_charging') {
          if (!vehicle.parked) throw fail(409,'vehicle_moving');
          if (vehicle.fault!=='none') throw fail(409,'vehicle_fault_active');
          if (vehicle.batteryPercent>=vehicle.targetPercent) throw fail(409,'charge_limit_reached');
          const journey=state.journey, atCharger=journey?.state==='arrived'&&journey.kind==='charging'&&!!journey.destination&&distance(journey.destination.location,vehicle.location)<300;
          vehicle.charging='charging';vehicle.powerKw=atCharger?150:11;vehicle.chargeSession={startedAt:at,startPercent:vehicle.batteryPercent,powerKw:vehicle.powerKw};
        } else if (action==='stop_charging') {
          if (vehicle.charging!=='charging') throw fail(409,'not_charging');
          vehicle.charging='idle';vehicle.powerKw=0;delete vehicle.chargeSession;
        }
        // flash and honk are acknowledged simulated signals with no stored effect beyond the version.
        break;
      }
      case 'assist': {
        // Keep only well-formed catalog proposals; a malformed suggestion is dropped, never repaired into an action.
        const proposals: AssistTurn['proposals'] = [];
        for (const item of call.assist!.proposals) {
          if (item.kind === 'control' && item.action) {
            const ranged = item.action === 'set_temperature' ? item.value !== undefined && item.value >= 16 && item.value <= 28 : item.action === 'set_charge_limit' ? item.value !== undefined && item.value >= 50 && item.value <= 100 : true;
            if (ranged) proposals.push({ kind: 'control', action: item.action, ...(['set_temperature','set_charge_limit'].includes(item.action) ? { value: item.action === 'set_temperature' ? Math.round(item.value! * 2) / 2 : Math.round(item.value!) } : {}) });
          } else if (item.kind === 'trip' && item.tripKind) proposals.push({ kind: 'trip', tripKind: item.tripKind, instruction: (item.instruction?.trim() || command.text).slice(0, 300) });
        }
        state.assist = { id: randomUUID(), at, request: command.text, reply: call.assist!.reply, proposals: proposals.slice(0, 3), language: command.language, engine: this.reasoner!.engine };
        break;
      }
      case 'call_incoming': {
        const persona=callPersona(command.scenario,command.language);
        state.call={id:randomUUID(),scenario:command.scenario,state:'ringing',caller:{name:persona.name,relation:persona.relation},handledBy:'driver',turns:[],startedAt:at,language:command.language,saved:false};
        break;
      }
      case 'call_answer': case 'call_say': case 'call_delegate': {
        const live=state.call!;
        if (command.operation==='call_answer') { live.state='active';live.handledBy=command.handledBy;live.engine=this.reasoner!.engine;if (state.journey?.state==='moving') state.journey.autopilot=true; }
        if (command.operation==='call_say') live.turns.push({role:'driver',text:command.text,at});
        if (command.operation==='call_delegate') live.handledBy='aide';
        if (call.step?.aide) live.turns.push({role:'aide',text:call.step.aide,at});
        if (call.step?.caller) live.turns.push({role:'caller',text:call.step.caller,at});
        break;
      }
      case 'call_end': {
        const live=state.call!, digest=call.digest!;
        live.state='ended';live.endedAt=at;
        live.summary={text:digest.text,actionItems:digest.actionItems,followups:digest.followups.map(item=>({id:randomUUID(),kind:item.kind,title:item.title,status:'draft' as const,
          ...(item.body?{body:item.body}:{}),...(item.to?{to:item.to}:{}),...followupWhen(item,call.referenceAt ?? now)}))};
        if (state.journey) state.journey.autopilot=false;
        break;
      }
      case 'call_decline': {
        const live=state.call!; live.state='declined';live.endedAt=at;break;
      }
      case 'call_save': {
        const live=state.call;
        if (!live||live.id!==command.callId||live.state!=='ended'||!live.summary) throw fail(409,'call_changed');
        live.saved=true;state.calls=[structuredClone(live),...state.calls.filter(item=>item.id!==live.id)].slice(0,10);break;
      }
      case 'followup': {
        const targets=[state.call,...state.calls].filter((item): item is VehicleCall=>item?.id===command.callId);
        const found=targets.flatMap(item=>item.summary?.followups.filter(entry=>entry.id===command.followupId)??[]);
        if (!found.length||found.some(entry=>entry.status!=='draft')) throw fail(409,'followup_changed');
        if (command.action==='done' && found.some(entry=>!callDraftReady(entry,now))) throw fail(409,'followup_not_ready');
        for (const entry of found) { entry.status=command.action==='done'?'done':'dismissed'; if (command.action==='done') entry.doneAt=at; }
        break;
      }
    }
    if (!callSteps.has(command.operation)) { vehicle.version++; vehicle.observedAt = at; }
    if (command.operation.startsWith('call_') || command.operation === 'followup') state.callRevision = (state.callRevision ?? 0) + 1;
    return record;
  }
  /** Call steps must match the live call; checked before any claim or model spend. */
  private precheckCall(state: MobilityState, command: MobilityCommand) {
    if (command.operation==='call_incoming' && state.call && ['ringing','active'].includes(state.call.state)) throw fail(409,'call_active');
    if (!['call_answer','call_say','call_delegate','call_end','call_decline'].includes(command.operation) || !('callId' in command)) return;
    const live=state.call, wanted=command.operation==='call_answer'||command.operation==='call_decline'?'ringing':'active';
    if (!live||live.id!==command.callId||live.state!==wanted) throw fail(409,'call_changed');
    if ((command.operation==='call_say'||command.operation==='call_delegate') && live.turns.length>13) throw fail(409,'call_turn_limit');
  }
  private callInput(state: MobilityState, command: MobilityCommand, referenceAt: number): CallInput {
    const live=state.call!, persona=callPersona(live.scenario,live.language);
    const step=command.operation==='call_answer'?'open':command.operation==='call_say'?'reply':command.operation==='call_delegate'?'delegate':'summary';
    return { scenario:live.scenario,language:live.language,caller:live.caller,goal:persona.goal,driverContext:driverContext(state,live.language,referenceAt),
      handledBy:command.operation==='call_answer'?command.handledBy:command.operation==='call_delegate'?'aide':live.handledBy,step,
      turns:[...live.turns.map(turn=>({role:turn.role,text:turn.text})),...(command.operation==='call_say'?[{role:'driver' as const,text:command.text}]:[])] };
  }
  private evidence(vehicle: SimulatedVehicle): Record<string,string> {
    return { signal:vehicle.diagnosticSignal,fault:vehicle.fault,battery:`${vehicle.batteryPercent}%`,temperature:`${vehicle.batteryCelsius} C`,charging:vehicle.charging,parked:String(vehicle.parked),attempts:String(vehicle.attempts) };
  }
}
