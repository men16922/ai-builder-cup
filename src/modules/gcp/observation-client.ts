import { gcpPlanListSchema, gcpWorkflowViewSchema, type GcpPlanItem, type GcpWorkflowView } from './domain/workflow';
import type { CloudOwner } from '../../domain/cloud-operations';
import { gcpAnalysisSchema, type GcpAnalysis } from './domain/analysis';
import type { WebIdentity, WebIdentityClient } from '../../platform/web-identity';
import { gcpApiBase, gcpScopeSchema, gcpResourceListSchema, gcpObservationSchema, type GcpScope, type GcpResource, type GcpObservation } from './domain/observations';
import { sameOwner } from '../../domain/cloud-operations';
export type GcpClientState = { identity: WebIdentity | null; items: GcpResource[]; selectedId?: string; observation?: GcpObservation; analysis?: GcpAnalysis; operation?: GcpWorkflowView; planItems?: GcpPlanItem[]; workflowAvailable?: boolean; agentsAvailable?: boolean; busy: boolean; error?: string; retryable: boolean };
class RequestError extends Error { readonly code: string; readonly status: number; constructor(code: string, status = 0) { super(code); this.code = code; this.status = status; } }
export class GcpObservationClient {
  private value: GcpClientState = { identity: null, items: [], busy: false, retryable: false };
  private readonly listeners = new Set<() => void>(); private readonly inflight = new Set<AbortController>();
  private readonly auth: WebIdentityClient; private readonly scope: GcpScope; private readonly fetcher: typeof fetch; private readonly unsubscribe: () => void;
  private epoch = 0; private sequence = 0; private closed = false; private accepting = true; private pending?: { resourceId: string; key: string };
  private pendingAnalysis?: { key: string; observation: GcpObservation; language: 'ko' | 'en' };
  private pendingWorkflow?: { path: string; body: unknown; key: string; analysis: GcpAnalysis };
  constructor(auth: WebIdentityClient, scope: GcpScope, fetcher: typeof fetch = fetch) {
    this.auth = auth; this.scope = gcpScopeSchema.parse(scope); this.fetcher = fetcher.bind(globalThis);
    this.unsubscribe = auth.subscribe(identity => {
      if (this.closed || !this.accepting && identity) return;
      if (identity?.key !== this.value.identity?.key) { this.clear(identity); if (identity) void this.refresh(); }
      else if (identity) this.set({ identity });
    });
  }
  /** Authenticated call for the agent dashboard. It shares the identity, scope and obsolete-response guard of every other request. */
  agentCall = async (path: string, pending?: { body: unknown; key: string }) => this.request(path, this.epoch, pending);
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(patch: Partial<GcpClientState>) { if (this.closed) return; this.value = { ...this.value, ...patch }; this.listeners.forEach(fn => fn()); }
  private clear(identity: WebIdentity | null) {
    this.epoch++; this.sequence++; this.inflight.forEach(x => x.abort()); this.inflight.clear(); this.pending = undefined; this.pendingAnalysis = undefined; this.pendingWorkflow = undefined;
    this.value = { identity, items: [], busy: false, retryable: false }; this.listeners.forEach(fn => fn());
  }
  private current(epoch: number) { if (this.closed || epoch !== this.epoch) throw new RequestError('obsolete_response'); }
  private async request(path: string, epoch: number, pending?: { body: unknown; key: string }) {
    this.current(epoch); const identity = this.value.identity; if (!identity) throw new RequestError('web_sign_in_required', 401);
    const controller = new AbortController(); this.inflight.add(controller); const timer = setTimeout(() => controller.abort(), 35000);
    try {
      let token: string; try { token = await this.auth.tokenFor(identity.key); } catch { throw new RequestError('web_sign_in_required', 401); }
      this.current(epoch); if (controller.signal.aborted) throw new RequestError('request_unknown');
      const response = await this.fetcher(`${gcpApiBase(this.scope)}${path}`, { method: pending ? 'POST' : 'GET', signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { Authorization: `Bearer ${token}`, ...(pending ? { 'Content-Type': 'application/json', 'Idempotency-Key': pending.key } : {}) }, ...(pending ? { body: JSON.stringify(pending.body) } : {}) });
      const text = await response.text(); this.current(epoch); if (controller.signal.aborted) throw new RequestError('request_unknown'); if (text.length > 262144) throw new RequestError('invalid_response');
      let body: unknown; try { body = JSON.parse(text); } catch { throw new RequestError('invalid_response', response.status); }
      if (!response.ok) { const code = body && typeof body === 'object' && 'code' in body && typeof body.code === 'string' && /^[a-z_]{1,64}$/.test(body.code) ? body.code : 'request_failed'; throw new RequestError(code, response.status); }
      return body;
    } finally { clearTimeout(timer); this.inflight.delete(controller); }
  }
  private failed(error: unknown, epoch: number, retryable = false, keepObservation = false) {
    if (this.closed || epoch !== this.epoch) return;
    if (error instanceof RequestError && [401, 403].includes(error.status)) { this.clear(this.value.identity); this.set({ error: error.code }); return; }
    this.set({ busy: false, observation: keepObservation ? this.value.observation : undefined, analysis: keepObservation ? this.value.analysis : undefined, operation: undefined, error: error instanceof RequestError ? error.code : 'request_unknown', retryable });
  }
  async signIn() { this.accepting = true; const epoch = this.epoch, key = this.value.identity?.key; try { await this.auth.signIn(); if (key && key === this.value.identity?.key) await this.refresh(); } catch { this.failed(new RequestError('sign_in_failed'), epoch); } }
  async signOut() { this.accepting = false; this.clear(null); const epoch = this.epoch; try { await this.auth.signOut(); } catch { this.failed(new RequestError('sign_out_failed'), epoch); } }
  async refresh() {
    if (!this.value.identity || this.value.busy) return;
    const epoch = this.epoch, sequence = ++this.sequence; this.pending = undefined; this.pendingAnalysis = undefined; this.pendingWorkflow = undefined; this.set({ busy: true, observation: undefined, analysis: undefined, operation: undefined, planItems: [], workflowAvailable: false, retryable: false, error: undefined });
    try {
      const list = gcpResourceListSchema.parse(await this.request('/resources', epoch)); this.current(epoch); if (sequence !== this.sequence) return;
      if (list.workspaceId !== this.scope.workspaceId || list.owner.kind !== this.scope.edition || this.scope.edition === 'organization' && (list.owner.kind !== 'organization' || list.owner.organizationId !== this.scope.organizationId)
        || list.items.some(item => !sameOwner(item.binding.owner, list.owner) || item.binding.workspaceId !== list.workspaceId) || new Set(list.items.map(item => item.id)).size !== list.items.length) throw new RequestError('invalid_response');
      const planItems = list.workflowAvailable ? await this.readPlans(epoch, list.owner) : []; this.current(epoch);
      this.set({ planItems, workflowAvailable: !!list.workflowAvailable, agentsAvailable: !!list.agentsAvailable, items: list.items, selectedId: list.items.find(item => item.id === this.value.selectedId)?.id ?? list.items[0]?.id, busy: false });
    } catch (error) { if (sequence === this.sequence) { this.set({ items: [], selectedId: undefined }); this.failed(error, epoch); } }
  }
  select(id: string) { if (this.value.busy || !this.value.items.some(item => item.id === id)) return; this.pending = undefined; this.pendingAnalysis = undefined; this.pendingWorkflow = undefined; this.set({ selectedId: id, observation: undefined, analysis: undefined, operation: undefined, retryable: false, error: undefined }); }
  async collect() { if (!this.value.selectedId || this.value.busy) return; await this.dispatch({ resourceId: this.value.selectedId, key: crypto.randomUUID() }); }
  async retry() { if (!this.value.retryable || this.value.busy) return; if (this.pendingWorkflow) await this.dispatchWorkflow(this.pendingWorkflow); else if (this.pendingAnalysis) await this.dispatchAnalysis(this.pendingAnalysis); else if (this.pending) await this.dispatch(this.pending); }
  private async dispatch(pending: { resourceId: string; key: string }) {
    const selected = this.value.items.find(item => item.id === pending.resourceId); if (!selected) return;
    const epoch = this.epoch; this.pending = pending; this.pendingAnalysis = undefined; this.pendingWorkflow = undefined; this.set({ busy: true, observation: undefined, analysis: undefined, operation: undefined, error: undefined, retryable: false });
    try {
      const result = gcpObservationSchema.parse(await this.request('/observations', epoch, { key: pending.key, body: { resourceId: pending.resourceId } })); this.current(epoch);
      if (result.resourceId !== selected.id || result.configurationDigest !== selected.configurationDigest || JSON.stringify(result.snapshot.binding) !== JSON.stringify(selected.binding) || result.snapshot.dataMode !== selected.dataMode) throw new RequestError('invalid_response');
      this.pending = undefined; this.pendingAnalysis = undefined; this.pendingWorkflow = undefined; this.set({ observation: result, busy: false });
    } catch (error) { this.failed(error, epoch, !(error instanceof RequestError) || error.status === 0 || error.code === 'collection_in_progress' || error.status >= 500); }
  }
  async analyze(language: 'ko' | 'en') {
    const observation = this.value.observation;
    if (!observation || this.value.busy || !this.value.items.find(item => item.id === observation.resourceId)?.analysisAvailable) return;
    await this.dispatchAnalysis({ key: crypto.randomUUID(), observation, language });
  }
  private async dispatchAnalysis(pending: { key: string; observation: GcpObservation; language: 'ko' | 'en' }) {
    const epoch = this.epoch, observation = pending.observation;
    this.pending = undefined; this.pendingAnalysis = pending; this.set({ busy: true, analysis: undefined, operation: undefined, error: undefined, retryable: false });
    try {
      const result = gcpAnalysisSchema.parse(await this.request('/analyses', epoch, { key: pending.key, body: { observationId: observation.snapshot.id, language: pending.language } })); this.current(epoch);
      const binding = observation.snapshot.binding, plan = result.plan;
      if (result.observationId !== observation.snapshot.id || result.configurationDigest !== observation.configurationDigest || result.resourceId !== observation.resourceId || result.language !== pending.language
        || plan.evidence.digest !== observation.evidenceDigest || plan.evidence.observedAt !== observation.snapshot.observedAt || plan.dataMode !== observation.snapshot.dataMode
        || !sameOwner(plan.owner, binding.owner) || plan.workspaceId !== binding.workspaceId || plan.environmentId !== binding.environmentId || JSON.stringify(plan.target) !== JSON.stringify(binding.target)
        || (plan.analysis.engine === 'gemini') !== (plan.dataMode === 'live')) throw new RequestError('invalid_response');
      const operation = this.value.workflowAvailable ? this.checkWorkflow(await this.request(`/plans/${result.id}`, epoch), result) : undefined;
      const planItems = this.value.workflowAvailable ? await this.readPlans(epoch, result.plan.owner) : this.value.planItems;
      this.pendingAnalysis = undefined; this.pendingWorkflow = undefined; this.set({ analysis: result, operation, planItems, busy: false });
    } catch (error) { this.failed(error, epoch, !(error instanceof RequestError) || error.status === 0 || error.code === 'analysis_in_progress' || error.status >= 500, true); }
  }
  private async readPlans(epoch: number, owner: CloudOwner) {
    const list = gcpPlanListSchema.parse(await this.request('/plans', epoch));
    if (!sameOwner(list.owner, owner) || list.workspaceId !== this.scope.workspaceId || new Set(list.items.map(x => x.id)).size !== list.items.length) throw new RequestError('invalid_response');
    return list.items;
  }
  private checkWorkflow(raw: unknown, analysis: GcpAnalysis) {
    const view = gcpWorkflowViewSchema.parse(raw);
    if (view.plan.digest !== analysis.planDigest || JSON.stringify(view.plan.payload) !== JSON.stringify(analysis.plan)) throw new RequestError('invalid_response');
    return view;
  }
  async loadPlan(id: string) {
    if (!this.value.identity || this.value.busy || !this.value.workflowAvailable || !this.value.planItems?.some(item => item.id === id)) return;
    const epoch = this.epoch; this.pending = undefined; this.pendingAnalysis = undefined; this.pendingWorkflow = undefined;
    this.set({ busy: true, observation: undefined, analysis: undefined, operation: undefined, retryable: false, error: undefined });
    try {
      const [rawAnalysis, rawView] = await Promise.all([this.request(`/analyses/${id}`, epoch), this.request(`/plans/${id}`, epoch)]);
      const analysis = gcpAnalysisSchema.parse(rawAnalysis), selected = this.value.items.find(item => item.id === analysis.resourceId);
      if (!selected || analysis.id !== id || analysis.configurationDigest !== selected.configurationDigest || this.value.planItems?.find(item => item.id === id)?.resourceId !== analysis.resourceId) throw new RequestError('invalid_response');
      const observation = gcpObservationSchema.parse(await this.request(`/observations/${analysis.observationId}`, epoch));
      if (observation.snapshot.id !== analysis.observationId || observation.snapshot.observedAt !== analysis.plan.evidence.observedAt
        || (analysis.plan.analysis.engine === 'gemini') !== (analysis.plan.dataMode === 'live')
        || observation.resourceId !== selected.id || observation.configurationDigest !== selected.configurationDigest || JSON.stringify(observation.snapshot.binding) !== JSON.stringify(selected.binding)
        || observation.evidenceDigest !== analysis.plan.evidence.digest || analysis.plan.dataMode !== selected.dataMode || observation.snapshot.dataMode !== selected.dataMode
        || !sameOwner(analysis.plan.owner, selected.binding.owner) || analysis.plan.workspaceId !== selected.binding.workspaceId || analysis.plan.environmentId !== selected.binding.environmentId || JSON.stringify(analysis.plan.target) !== JSON.stringify(selected.binding.target)) throw new RequestError('invalid_response');
      this.set({ selectedId: selected.id, observation, analysis, operation: this.checkWorkflow(rawView, analysis), busy: false });
    } catch (error) { this.failed(error, epoch); }
  }
  async refreshPlan() { if (this.value.analysis) await this.loadPlan(this.value.analysis.id); }
  async workflowAction(action: 'review' | 'approve' | 'reject' | 'request_changes' | 'execute' | 'handoff' | 'cancel', note = '') {
    const analysis = this.value.analysis, view = this.value.operation; if (!analysis || !view || this.value.busy) return;
    const expected = { expectedVersion: view.plan.payload.version, expectedDigest: view.plan.digest };
    const planPath = `/plans/${view.plan.payload.planId}`, executionPath = `/executions/${view.execution?.id}`;
    const path = action === 'review' ? `${planPath}/review` : action === 'execute' ? `${planPath}/execute` : action === 'handoff' || action === 'cancel' ? `${executionPath}/${action}` : `${planPath}/decision`;
    const body = action === 'review' ? expected : action === 'execute' ? { ...expected, planId: view.plan.payload.planId } : action === 'handoff' ? { note } : action === 'cancel' ? {} : { ...expected, decision: action, note };
    await this.dispatchWorkflow({ path, body, key: crypto.randomUUID(), analysis });
  }
  private async dispatchWorkflow(pending: { path: string; body: unknown; key: string; analysis: GcpAnalysis }) {
    const epoch = this.epoch; this.pending = undefined; this.pendingAnalysis = undefined; this.pendingWorkflow = pending; this.set({ busy: true, error: undefined, retryable: false });
    try {
      const operation = this.checkWorkflow(await this.request(pending.path, epoch, pending), pending.analysis);
      this.pendingWorkflow = undefined; this.set({ operation, busy: false });
    } catch (error) { this.failed(error, epoch, !(error instanceof RequestError) || error.status === 0 || error.status >= 500, true); }
  }
  close() { this.closed = true; this.epoch++; this.unsubscribe(); this.inflight.forEach(x => x.abort()); this.inflight.clear(); this.pending = undefined; this.pendingAnalysis = undefined; this.pendingWorkflow = undefined; this.listeners.clear(); }
}
