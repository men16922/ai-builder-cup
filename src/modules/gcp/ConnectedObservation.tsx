import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useConsoleSlots } from '../../components/console-slots';
import { useLanguage } from '../../i18n';
import { Banner, Button, Card, Select, Stack, Tabs } from '../../ui';
import type { GcpObservationClient } from './observation-client';
import ObservationPanel from './ObservationPanel';
import AnalysisPanel from './AnalysisPanel';
import WorkflowPanel from './WorkflowPanel';
import OperationsOverview from './OperationsOverview';
import PlanLibrary from './PlanLibrary';
import Assistant from './Assistant';
import Dashboard from './Dashboard';
import { AgentClient } from './agent-client';
export default function ConnectedObservation({ client, label }: { client: GcpObservationClient; label: string }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot), { t, language } = useLanguage();
  const selected = state.items.find(item => item.id === state.selectedId);
  const [chosenTab, setTab] = useState('');
  // With the agent crew connected the page becomes a console: dashboard first, the crew in a right-hand panel.
  const consoleMode = !!state.identity && !!state.agentsAvailable;
  const agents = useMemo(() => new AgentClient(client.agentCall), [client]);
  const board = useSyncExternalStore(agents.subscribe, agents.getSnapshot);
  useEffect(() => { if (!consoleMode) return; agents.open(); void agents.load(); return () => agents.close(); }, [agents, consoleMode]);
  const pending = board.items.filter(item => item.state === 'awaiting_approval' && item.approval && Date.parse(item.approval.expiresAt) > Date.now()).length;
  const tab = chosenTab || (consoleMode ? 'overview' : 'evidence');
  useConsoleSlots(consoleMode ? { assistant: <Assistant agents={agents} />, assistantLabel: 'Gemini', user: state.identity?.label, onSignOut: () => void client.signOut(), pendingDecisions: pending,
    nav: { active: tab, onSelect: setTab, items: [{ id: 'overview', label: t('개요', 'Overview'), icon: 'dashboard' }, { id: 'evidence', label: t('서비스·근거', 'Services & evidence'), icon: 'services' }, { id: 'workflow', label: t('계획', 'Plans'), icon: 'approvals', badge: pending || undefined },
      ...(state.workflowAvailable ? [{ id: 'saved', label: t('저장', 'Saved'), icon: 'history' as const }] : [])] } } : undefined, `${consoleMode}|${tab}|${pending}|${state.identity?.key}|${state.workflowAvailable}|${language}`);
  async function analyze() { await client.analyze(language); if (client.getSnapshot().operation) setTab('workflow'); }
  function openPlan(id: string) { setTab('workflow'); void client.loadPlan(id); }
  const message = state.error === 'analysis_unknown' ? t('분석 완료 여부가 불명확합니다. 같은 요청으로 모델을 다시 호출하지 않습니다.', 'The analysis outcome is unknown. This request will not call the model again.')
    : state.error === 'analysis_in_progress' ? t('분석 중입니다. 같은 요청 확인으로 결과를 확인하세요.', 'Analysis is in progress. Check the same request for its result.')
    : state.error?.startsWith('model_') ? t('모델 응답의 형식이나 근거를 확인할 수 없어 계획을 저장하지 않았습니다.', 'The model response or its evidence could not be validated. No plan was saved.')
    : state.error === 'collection_unknown' ? t('이전 수집의 완료 여부가 불명확합니다. 자동으로 다시 실행하지 않습니다.', 'The earlier collection outcome is unknown. It will not run again automatically.')
    : state.error === 'collection_in_progress' ? t('이 요청을 수집 중입니다. 잠시 뒤 같은 요청으로 확인하세요.', 'This request is still collecting. Check the same request shortly.')
      : ['web_sign_in_required', 'organization_access_denied', 'scope_denied'].includes(state.error ?? '') ? t('현재 접근 권한을 확인할 수 없어 이전 결과를 지웠습니다. 다시 로그인하거나 권한을 확인하세요.', 'Previous results were cleared because access could not be verified. Sign in again or check permissions.')
        : ['plan_expired', 'version_mismatch', 'state_changed', 'review_required'].includes(state.error ?? '') ? t('계획의 상태·버전·만료가 달라졌습니다. 저장된 계획을 다시 열어 확인하세요.', 'The plan state, version or expiry changed. Reopen the stored plan.')
        : t('결과를 확인하지 못했습니다. 설정과 권한을 확인하세요.', 'The result could not be confirmed. Check configuration and access.');
  const panelTab = tab === 'saved' && !state.workflowAvailable ? 'evidence' : tab;
  const emptyEvidence = <div className="gcp-empty-panel"><strong>{state.busy ? t('요청 확인 중', 'Checking request') : t('근거를 먼저 수집하세요', 'Collect evidence first')}</strong><p>{t('선택한 서비스의 메타데이터와 설정된 로그·지표를 명시적으로 조회합니다. 목록 선택만으로는 수집하지 않습니다.', 'Explicitly read the selected service metadata and configured logs and metrics. Selecting a service does not collect evidence.')}</p></div>;
  const emptyPlan = <div className="gcp-empty-panel"><strong>{state.busy ? t('저장 상태 확인 중', 'Checking stored state') : t('현재 열린 계획이 없습니다', 'No plan is open')}</strong><p>{t('근거를 수집한 뒤 분석과 계획을 준비하거나 저장된 계획을 여세요. 검토만으로 실행하지 않습니다.', 'Prepare an analysis and plan from collected evidence, or open a saved plan. Review alone does not execute it.')}</p></div>;
  const planView = state.operation ? <WorkflowPanel key={state.operation.plan.payload.planId} view={state.operation} client={client} busy={state.busy} /> : emptyPlan;
  const analysisPanel = state.observation ? <AnalysisPanel analysis={state.analysis} snapshot={state.observation.snapshot} busy={state.busy} available={!!selected?.analysisAvailable} onPrepare={() => void analyze()} /> : null;
  if (consoleMode) {
    const connection = <Card title={t('서비스 선택과 근거 수집', 'Choose a service and collect evidence')}><Stack>
      {state.error ? <Banner type="error" action={state.retryable ? <Button onClick={() => void client.retry()}>{t('같은 요청 확인', 'Check same request')}</Button> : undefined}>{message}</Banner> : null}
      <Stack row gap="s"><strong>{state.identity?.label}</strong><Button loading={state.busy} onClick={() => void client.refresh()}>{t('서비스 목록 새로고침', 'Refresh service list')}</Button></Stack>
      {state.items.length ? <div className="organization-connection-picker"><Select label={t('허용된 Cloud Run 서비스', 'Allowed Cloud Run service')} value={selected?.id} options={state.items.map(item => ({ value: item.id, label: item.label }))} disabled={state.busy} onChange={id => client.select(id)} /><Button variant="filled" loading={state.busy} disabled={!selected || state.retryable} onClick={() => void client.collect()}>{selected?.telemetryEnabled ? t('메타데이터·로그·지표 조회', 'Read metadata, logs and metrics') : t('메타데이터 조회', 'Read metadata')}</Button></div> : !state.busy ? <Banner type="info">{t('이 작업 공간에 허용된 Cloud Run 서비스가 없습니다. 서버 설정을 확인하세요.', 'No Cloud Run service is registered for this workspace. Check server configuration.')}</Banner> : null}
      {selected?.binding.target.provider === 'gcp' ? <p className="gcp-wrap">{selected.binding.target.projectId} · {selected.binding.target.location} · {selected.binding.target.revision}</p> : null}
    </Stack></Card>;
    return <Stack gap="l">
      {panelTab === 'overview' ? <Dashboard client={client} agents={agents} /> : null}
      {panelTab === 'evidence' ? <><OperationsOverview state={state} />{connection}<div className="gcp-console-workspace gcp-console-single"><div className="gcp-console-main">{state.observation ? <ObservationPanel snapshot={state.observation.snapshot} /> : emptyEvidence}</div>{analysisPanel}</div></> : null}
      {panelTab === 'workflow' ? <>{state.error ? <Banner type="error">{message}</Banner> : null}{planView}</> : null}
      {panelTab === 'saved' ? <PlanLibrary key={state.identity?.key} items={state.planItems ?? []} resources={state.items} selectedId={state.operation?.plan.payload.planId} busy={state.busy} onOpen={openPlan} /> : null}
    </Stack>;
  }
  return <Stack gap="l"><OperationsOverview state={state} /><Card title={t('GCP 관측 연결', 'GCP observation connection')} actions={state.identity ? <Button onClick={() => void client.signOut()}>{t('웹 로그아웃', 'Sign out of web')}</Button> : undefined}><Stack>
    <p>{label}</p>
    {state.error ? <Banner type="error" action={state.retryable ? <Button onClick={() => void client.retry()}>{t('같은 요청 확인', 'Check same request')}</Button> : undefined}>{message}</Banner> : null}
    {!state.identity ? <Button variant="filled" onClick={() => void client.signIn()}>{t('GCP 웹 로그인', 'Sign in to GCP workspace')}</Button> : <>
      <Stack row gap="s"><strong>{state.identity.label}</strong><Button loading={state.busy} onClick={() => { setTab('evidence'); void client.refresh(); }}>{t('서비스 목록 새로고침', 'Refresh service list')}</Button></Stack>
      {state.items.length ? <div className="organization-connection-picker"><Select label={t('허용된 Cloud Run 서비스', 'Allowed Cloud Run service')} value={selected?.id} options={state.items.map(item => ({ value: item.id, label: item.label }))} disabled={state.busy} onChange={id => { setTab('evidence'); client.select(id); }} /><Button variant="filled" loading={state.busy} disabled={!selected || state.retryable} onClick={() => { setTab('evidence'); void client.collect(); }}>{selected?.telemetryEnabled ? t('메타데이터·로그·지표 조회', 'Read metadata, logs and metrics') : t('메타데이터 조회', 'Read metadata')}</Button></div> : !state.busy ? <Banner type="info">{t('이 작업 공간에 허용된 Cloud Run 서비스가 없습니다. 서버 설정을 확인하세요.', 'No Cloud Run service is registered for this workspace. Check server configuration.')}</Banner> : null}
      {selected?.binding.target.provider === 'gcp' ? <p className="gcp-wrap">{selected.binding.target.projectId} · {selected.binding.target.location} · {selected.binding.target.revision}</p> : null}
    </>}
  </Stack></Card>
    {state.identity ? <div className="gcp-console-workspace"><div className="gcp-console-main"><Tabs label={t('GCP 작업 보기', 'GCP work views')} active={panelTab} onChange={setTab} tabs={[
      { id: 'evidence', label: t('근거', 'Evidence'), content: state.observation ? <ObservationPanel snapshot={state.observation.snapshot} /> : <div className="gcp-empty-panel"><strong>{state.busy ? t('요청 확인 중', 'Checking request') : t('근거를 먼저 수집하세요', 'Collect evidence first')}</strong><p>{t('선택한 서비스의 메타데이터와 설정된 로그·지표를 명시적으로 조회합니다. 목록 선택만으로는 수집하지 않습니다.', 'Explicitly read the selected service metadata and configured logs and metrics. Selecting a service does not collect evidence.')}</p></div> },
      { id: 'workflow', label: t('계획', 'Plan'), content: state.operation ? <WorkflowPanel key={state.operation.plan.payload.planId} view={state.operation} client={client} busy={state.busy} /> : <div className="gcp-empty-panel"><strong>{state.busy ? t('저장 상태 확인 중', 'Checking stored state') : t('현재 열린 계획이 없습니다', 'No plan is open')}</strong><p>{t('근거를 수집한 뒤 분석과 계획을 준비하거나 저장된 계획을 여세요. 검토만으로 실행하지 않습니다.', 'Prepare an analysis and plan from collected evidence, or open a saved plan. Review alone does not execute it.')}</p></div> },
      ...(state.workflowAvailable ? [{ id: 'saved', label: t('저장', 'Saved'), content: <PlanLibrary key={state.identity.key} items={state.planItems ?? []} resources={state.items} selectedId={state.operation?.plan.payload.planId} busy={state.busy} onOpen={openPlan} /> }] : []),
    ]} /></div>
      {state.observation ? <AnalysisPanel analysis={state.analysis} snapshot={state.observation.snapshot} busy={state.busy} available={!!selected?.analysisAvailable} onPrepare={() => void analyze()} /> : <aside className="gcp-analysis-placeholder" aria-label={t('분석 준비', 'Analysis preparation')}><span className="gcp-overview-label">{t('근거에서 다음 작업으로', 'From evidence to the next action')}</span><h2>{t('관측을 해석하고 계획을 준비합니다', 'Interpret evidence and prepare a plan')}</h2><ol><li>{t('허용된 서비스의 근거 수집', 'Collect evidence for an allowed service')}</li><li>{t('같은 근거로 분석과 고정 계획 준비', 'Analyze that evidence and prepare a fixed plan')}</li><li>{t('사람 검토 후 직접 읽기 실행', 'Review, then explicitly execute the read')}</li><li>{t('미확인 사항과 담당자에게 인계', 'Hand off unknowns and next steps')}</li></ol><p>{t('서비스 정상 여부를 근거 없이 추정하지 않습니다.', 'Application health is not inferred without evidence.')}</p></aside>}
    </div> : null}
  </Stack>;
}
