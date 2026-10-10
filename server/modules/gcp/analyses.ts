import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertCloudAccess, evidenceSchema, planPayloadSchema } from '../../../src/domain/cloud-operations';
import { CloudOperationError, type CloudPlan } from '../../../src/domain/cloud-workflow';
import { gcpAnalysisSchema, checkGcpModelAnalysis, prepareGcpAnalysisSchema, type GcpAnalysis } from '../../../src/modules/gcp/domain/analysis';
import { cloudDigest } from '../../cloud-integrity';
import { cloudRecordKey, type CloudWorkflow } from '../../cloud-workflow';
import type { CloudStore } from '../../cloud-store';
import type { GcpObservations } from './observations';
import type { GcpWebAccess, GcpWebSession } from './web-access';
import { GeminiError, gcpPromptVersion, type GcpAnalysisModel } from './gemini';
import type { GcpPlanItem } from '../../../src/modules/gcp/domain/workflow';

type Reservation = { state: 'pending' | 'complete' | 'failed' | 'unknown'; claim: string; id: string; deadline: number; code?: string };
const fail = (status: number, code: string) => new CloudOperationError(status, code, 'The analysis could not be confirmed. Refresh the observation or inspect the same request.');
export class GcpAnalyses {
  private readonly store: CloudStore; private readonly access: GcpWebAccess; private readonly observations: GcpObservations;
  private readonly workflow: CloudWorkflow; private readonly model: GcpAnalysisModel; private readonly now: () => number; private readonly modelDigest: string;
  constructor(store: CloudStore, access: GcpWebAccess, observations: GcpObservations, workflow: CloudWorkflow, model: GcpAnalysisModel, now = Date.now) {
    this.store = store; this.access = access; this.observations = observations; this.workflow = workflow; this.model = { enabled: model.enabled, engine: model.engine, modelId: model.modelId, configurationId: model.configurationId, analyze: model.analyze.bind(model) }; this.now = now;
    z.enum(['gemini', 'synthetic-fixture']).parse(model.engine); z.string().min(1).max(200).parse(model.modelId); z.string().min(1).max(4096).parse(model.configurationId);
    this.modelDigest = cloudDigest([model.engine, model.modelId, model.configurationId, gcpPromptVersion]);
  }
  available(mode: 'synthetic' | 'live', telemetry = false) { return this.model.enabled !== false && mode === (this.model.engine === 'gemini' ? 'live' : 'synthetic') && this.workflow.supports(telemetry ? 'gcp.cloudrun.inspect.v1' : 'gcp.cloudrun.metadata.inspect.v1', mode); }
  async get(session: GcpWebSession, id: string): Promise<GcpAnalysis> {
    z.uuid().parse(id); await this.access.current(session);
    const record = await this.store.transact(async tx => {
      await this.access.assertCurrentIn(tx, session);
      const raw = await tx.get<GcpAnalysis>(cloudRecordKey(session.context, 'gcp-analysis', id)); if (!raw) throw fail(404, 'analysis_not_found');
      const result = gcpAnalysisSchema.parse(raw), plan = await tx.get<CloudPlan>(cloudRecordKey(session.context, 'plan', id));
      if (result.id !== id || result.planDigest !== cloudDigest(result.plan) || plan?.digest !== result.planDigest || cloudDigest(plan.payload) !== result.planDigest) throw fail(409, 'integrity_mismatch');
      assertCloudAccess(session.context, result.plan); return result;
    });
    const observation = await this.observations.get(session, record.observationId);
    if (record.resourceId !== observation.resourceId || record.configurationDigest !== observation.configurationDigest || record.plan.evidence.digest !== observation.evidenceDigest
      || cloudDigest([record.plan.owner, record.plan.workspaceId, record.plan.environmentId, record.plan.target, record.plan.dataMode]) !== cloudDigest([observation.snapshot.binding.owner, observation.snapshot.binding.workspaceId, observation.snapshot.binding.environmentId, observation.snapshot.binding.target, observation.snapshot.dataMode])) throw fail(409, 'configuration_changed');
    return record;
  }
  async prepare(session: GcpWebSession, raw: unknown, requestKey: string): Promise<GcpAnalysis> {
    const input = prepareGcpAnalysisSchema.parse(raw); z.uuid().parse(requestKey); await this.access.current(session);
    if (this.model.engine === 'gemini' && process.env.MOBILEOPS_OFFLINE_TEST === '1') throw fail(503, 'model_disabled');
    const observation = await this.observations.get(session, input.observationId);
    assertCloudAccess(session.context, observation.snapshot.binding, 'prepare');
    if (!this.available(observation.snapshot.dataMode, !!observation.snapshot.telemetry)) throw fail(503, 'analysis_not_configured');
    const fingerprint = cloudDigest([input, observation.configurationDigest, observation.evidenceDigest, this.modelDigest]);
    const requestRecord = cloudRecordKey(session.context, 'gcp-analysis-request', cloudDigest([session.context.actorId, requestKey]));
    // Different request keys for the same observation/language/model reuse one paid generation.
    const workKey = cloudRecordKey(session.context, 'gcp-analysis-work', cloudDigest([session.context.actorId, fingerprint]));
    const claim = randomUUID();
    const reserved = await this.store.transact(async tx => {
      await this.access.assertCurrentIn(tx, session);
      const request = await tx.get<{ fingerprint: string }>(requestRecord), old = await tx.get<Reservation>(workKey);
      if (request && request.fingerprint !== fingerprint) throw fail(409, 'idempotency_conflict');
      let result = old;
      if (!result) { this.fresh(observation.snapshot.observedAt); result = { state: 'pending', claim, id: randomUUID(), deadline: this.now() + 30000 }; }
      else if (result.state === 'pending' && result.deadline <= this.now()) result = { ...result, state: 'unknown' };
      tx.put(requestRecord, { fingerprint }); tx.put(workKey, result); return result;
    });
    if (reserved.state === 'complete') return this.get(session, reserved.id);
    if (reserved.state === 'unknown') throw fail(409, 'analysis_unknown');
    if (reserved.state === 'failed') throw fail(409, reserved.code ?? 'analysis_failed');
    if (reserved.claim !== claim) throw fail(409, 'analysis_in_progress');
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const evidence = evidenceSchema.parse(await this.workflow.getEvidence(session.context, input.observationId));
      if (cloudDigest(evidence) !== observation.evidenceDigest) throw fail(409, 'integrity_mismatch');
      this.fresh(evidence.observedAt); await this.access.current(session);
      const output = await Promise.race([this.model.analyze(structuredClone(evidence), input.language, controller.signal), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(fail(409, 'analysis_unknown')); }, 20000);
      })]);
      const ids = new Set(evidence.observations.map(value => value.id));
      const checked = checkGcpModelAnalysis(output, [...ids]);
      if (!checked.ok) throw fail(502, checked.code);
      const analysis = checked.analysis;
      // Deterministic gaps survive even if the model omits or understates them.
      analysis.missingInformation = [...new Set([...analysis.missingInformation, ...evidence.observations.filter(value => value.quality !== 'complete').map(value => `${value.id}: ${input.language === 'en' ? value.limitation ?? value.quality : value.id === 'gcp-run-missing-signals' ? '누락된 신호와 조회 범위를 출처에서 확인하세요. 서비스 상태는 미확인입니다.' : value.quality === 'denied' ? '조회 권한이 거절되어 근거가 부족합니다.' : value.quality === 'missing' ? '관측이 누락되었거나 조회하지 않았습니다.' : value.quality === 'partial' ? '불완전한 관측이거나 수집 중 변경이 있어 추가 확인이 필요합니다.' : '조회 결과를 확인하지 못했습니다.'}`)])];
      const createdAt = new Date(this.now()).toISOString();
      const payload = planPayloadSchema.parse({ schemaVersion: 1, planId: reserved.id, version: 1, dataMode: evidence.dataMode, ...observation.snapshot.binding,
        evidence: { snapshotId: evidence.id, digest: observation.evidenceDigest, sourceIds: [...ids], observedAt: evidence.observedAt },
        analysis: { ...analysis, engine: this.model.engine, modelId: this.model.modelId, promptVersion: gcpPromptVersion },
        action: observation.snapshot.telemetry ? { id: 'gcp.cloudrun.inspect.v1', version: 1, effect: 'read', inputs: { windowMinutes: 15, maxLogEntries: 50 }, completionCriteria: [
          'Read the registered service and pinned revision, then one page of logs and two metric queries, followed by a service recheck.',
          'Require completion of each bounded query separately; preserve empty data and partial pages. Signal coverage and application health remain separate.',
          'Use a fixed fifteen-minute window ending two minutes before collection, at most fifty logs and 120 points per metric. No payloads, retries, extra pages or mutations.',
        ] } : { id: 'gcp.cloudrun.metadata.inspect.v1', version: 1, effect: 'read', inputs: {}, completionCriteria: [
          'Read the registered Cloud Run service and pinned revision metadata, then re-read the same service.',
          'Preserve denied, missing or changed observations; application health remains unknown. No logs, metrics or mutations.',
        ] }, createdAt, expiresAt: new Date(this.now() + 300000).toISOString(),
      });
      const result = gcpAnalysisSchema.parse({ id: reserved.id, resourceId: observation.resourceId, observationId: evidence.id, configurationDigest: observation.configurationDigest, language: input.language, plan: payload, planDigest: cloudDigest(payload) });
      await this.access.current(session); this.fresh(evidence.observedAt);
      const latest = await this.observations.get(session, input.observationId); if (cloudDigest(latest) !== cloudDigest(observation)) throw fail(409, 'configuration_changed');
      const saved = await this.store.transact(async tx => {
        await this.access.assertCurrentIn(tx, session);
        const pending = await tx.get<Reservation>(workKey), resultKey = cloudRecordKey(session.context, 'gcp-analysis', reserved.id), existing = await tx.get(resultKey);
        const indexKey = cloudRecordKey(session.context, 'gcp-plans', 'recent'), index = await tx.get<GcpPlanItem[]>(indexKey) ?? [];
        if (!pending || pending.claim !== claim || pending.state !== 'pending') return false;
        if (pending.deadline <= this.now()) { tx.put(workKey, { ...pending, state: 'unknown' }); return false; }
        if (existing) throw fail(409, 'immutable_analysis');
        await this.workflow.registerPlanIn(tx, session.context, payload);
        tx.put(indexKey, [{ id: result.id, resourceId: result.resourceId, createdAt: payload.createdAt }, ...index].slice(0, 50));
        tx.put(resultKey, result); tx.put(workKey, { ...pending, state: 'complete' }); return true;
      });
      if (!saved) throw fail(409, 'analysis_unknown');
      return result;
    } catch (cause) {
      const code = cause instanceof CloudOperationError || cause instanceof GeminiError ? cause.code : 'analysis_failed';
      await this.store.transact(async tx => { const record = await tx.get<Reservation>(workKey); if (record?.claim === claim && record.state === 'pending') tx.put(workKey, { ...record, state: record.deadline <= this.now() || code === 'analysis_unknown' ? 'unknown' : 'failed', code }); });
      if (cause instanceof CloudOperationError) throw cause; throw fail(502, code);
    } finally { clearTimeout(timer); controller.abort(); }
  }
  private fresh(at: string) { const age = this.now() - Date.parse(at); if (age < 0 || age > 900000) throw fail(409, 'evidence_expired'); }
}
