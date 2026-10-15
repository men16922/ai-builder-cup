import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useConsole } from '../shell/console-slots';
import { useLanguage } from '../i18n';
import { Banner, Button, Card, DataTable, Icon, Select, Stack, StatusChip, type Column } from '../ui';
import type { AgentClient } from './agent-client';
import { chipFor, stateLabels } from './agent-parts';
import { overviewSchema, type Overview, type OverviewService } from '@contracts/gcp/overview';
import type { GcpObservationClient } from './observation-client';

const CLASS_COLOR: Record<string, string> = { '2xx': 'var(--md-sys-color-success)', '3xx': 'var(--md-sys-color-primary)', '4xx': 'var(--md-sys-color-warning)', '5xx': 'var(--md-sys-color-error)', other: 'var(--md-sys-color-outline)' };
const REVISION_COLORS = ['var(--md-sys-color-primary)', 'var(--md-sys-color-tertiary)', 'var(--md-sys-color-secondary)', 'var(--md-sys-color-warning)', 'var(--md-sys-color-outline)'];
const REFRESH_MS = 30_000;

type OverviewSource = Pick<GcpObservationClient, 'agentCall'>;
function useOverview(client: OverviewSource) {
  const [state, setState] = useState<{ data?: Overview; error?: string; loading: boolean }>({ loading: true });
  const load = useCallback(async () => {
    setState(previous => ({ ...previous, loading: true }));
    try { setState({ data: overviewSchema.parse(await client.agentCall('/overview')), loading: false }); }
    catch (error) { setState(previous => ({ data: previous.data, error: error instanceof Error && /^[a-z_]{1,64}$/.test(error.message) ? error.message : 'request_failed', loading: false })); }
  }, [client]);
  useEffect(() => { void load(); const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, REFRESH_MS); return () => clearInterval(timer); }, [load]);
  return { ...state, refresh: load };
}

function StackBar({ segments, label }: { segments: { key: string; value: number; color: string }[]; label: string }) {
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  return <div className="ops-stackbar" role="img" aria-label={label}>{total ? segments.filter(item => item.value > 0).map(item => <span key={item.key} className="ops-seg" style={{ width: `${item.value / total * 100}%`, background: item.color }} title={`${item.key}: ${item.value}`} />) : <span className="ops-seg ops-seg-empty" />}</div>;
}

function Kpi({ label, value, caption, tone, onClick }: { label: string; value: string; caption: string; tone?: 'ok' | 'warn' | 'bad' | 'info'; onClick?: () => void }) {
  const body = <><span className="ops-kpi-label">{label}</span><strong className="ops-kpi-value">{value}</strong><span className="ops-kpi-caption">{caption}</span></>;
  return onClick ? <button type="button" className={`ops-kpi ops-kpi-${tone ?? 'info'} ops-kpi-action`} onClick={onClick}>{body}</button> : <div className={`ops-kpi ops-kpi-${tone ?? 'info'}`} role="group" aria-label={label}>{body}</div>;
}

export default function Dashboard({ client, agents, onOpenPlans }: { client: OverviewSource; agents: AgentClient; onOpenPlans?: () => void }) {
  const { t, locale } = useLanguage(), consoleContext = useConsole(), overview = useOverview(client);
  const board = useSyncExternalStore(agents.subscribe, agents.getSnapshot);
  const [selected, setSelected] = useState<string>();
  // A finished task may have changed the service, so show the new state now instead of at the next 30-second read.
  const finished = board.items.filter(item => item.state === 'completed').length, seenFinished = useRef(finished);
  useEffect(() => { if (finished > seenFinished.current) void overview.refresh(); seenFinished.current = finished; }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps
  const services = overview.data?.services ?? [], service: OverviewService | undefined = services.find(item => item.name === selected) ?? services[0];
  const number = (value: number) => value.toLocaleString(locale), clock = (value: string) => new Date(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const pending = board.items.filter(item => item.state === 'awaiting_approval' && item.approval && Date.parse(item.approval.expiresAt) > Date.now());
  const states = stateLabels(t);
  const stats = useMemo(() => {
    if (!service) return undefined;
    const total = service.requests.reduce((sum, row) => sum + row.count, 0);
    const byRevision = [...new Set(service.requests.map(row => row.revision))].map(revision => ({ revision, rows: service.requests.filter(row => row.revision === revision) }));
    const serving = service.revisions.filter(item => item.percent > 0), servingP95 = service.latency.filter(item => serving.some(rev => rev.name === item.revision)).map(item => item.p95Ms);
    // The error rate describes the revision(s) receiving traffic now, so an old revision's healthy requests cannot dilute a live problem.
    const live = service.requests.filter(row => serving.some(rev => rev.name === row.revision)), scoped = live.length ? live : service.requests;
    const liveTotal = scoped.reduce((sum, row) => sum + row.count, 0), errors = scoped.filter(row => row.responseClass === '5xx').reduce((sum, row) => sum + row.count, 0);
    return { total, errors, liveTotal, rate: liveTotal ? errors / liveTotal * 100 : undefined, byRevision, serving, p95: servingP95.length ? Math.max(...servingP95) : service.latency.length ? Math.max(...service.latency.map(item => item.p95Ms)) : undefined, maxLatency: Math.max(1, ...service.latency.map(item => item.p95Ms)), maxTotal: Math.max(1, ...byRevision.map(item => item.rows.reduce((sum, row) => sum + row.count, 0))) };
  }, [service]);
  const noMetrics = service?.coverage.requests === 'empty' ? t('표본 없음 · 0이 아니라 미확인', 'No samples · unknown, not zero') : t('지표를 읽지 못했습니다', 'Metrics unavailable');
  const logColumns: Column<OverviewService['logs'][number]>[] = [
    { id: 'time', header: t('시각', 'Time'), cell: row => clock(row.at) }, { id: 'severity', header: t('심각도', 'Severity'), cell: row => <StatusChip type={row.severity === 'ERROR' || row.severity === 'CRITICAL' ? 'error' : 'warning'}>{row.severity}</StatusChip> },
    { id: 'revision', header: t('리비전', 'Revision'), cell: row => row.revision ?? '—' }, { id: 'status', header: 'HTTP', cell: row => row.status ?? '—' }, { id: 'message', header: t('메시지 (신뢰할 수 없는 로그 텍스트)', 'Message (untrusted log text)'), cell: row => <span className="ops-log-text">{row.message}</span> },
  ];
  const rateTone = stats?.rate === undefined ? 'info' : stats.rate >= 5 ? 'bad' : stats.rate >= 1 ? 'warn' : 'ok';
  return <div className="ops-dash">
    <header className="ops-page-header"><div><h1>{t('개요', 'Overview')}</h1><p>{t('등록된 Cloud Run 서비스의 최근 15분 상태입니다. 읽기 전용이며 30초마다 새로 읽습니다.', 'The last 15 minutes of your registered Cloud Run services. Read-only, refreshed every 30 seconds.')}</p></div>
      <div className="ops-actions">{services.length > 1 ? <Select label={t('서비스', 'Service')} value={service?.name} options={services.map(item => ({ value: item.name, label: item.name }))} onChange={setSelected} /> : null}
        {overview.data ? <span className="ops-caption" aria-live="polite">{t('갱신', 'Updated')} {clock(overview.data.generatedAt)}</span> : null}
        <Button icon="refresh" loading={overview.loading} onClick={() => void overview.refresh()}>{t('새로고침', 'Refresh')}</Button></div></header>
    {overview.error ? <Banner type="error" action={<Button onClick={() => void overview.refresh()}>{t('다시 시도', 'Try again')}</Button>}>{overview.error === 'overview_not_configured' ? t('대시보드에 등록된 서비스가 없습니다.', 'No services are registered for the dashboard.') : t('개요를 읽지 못했습니다. 이전 값이 있으면 그대로 표시합니다.', 'The overview could not be read. Earlier values stay on screen if there are any.')}</Banner> : null}
    {pending.length ? <Banner type="warning" header={t(`결정 ${pending.length}건이 기다리고 있습니다`, `${pending.length} decision${pending.length > 1 ? 's are' : ' is'} waiting for you`)} action={<Button variant="filled" onClick={() => consoleContext?.setAssistantOpen(true)}>{t('My Aide와 검토', 'Review with My Aide')}</Button>}>
      {pending[0].approval ? t(`${pending[0].approval.action.service}의 트래픽을 ${pending[0].approval.action.revision}으로 되돌리자는 제안입니다.`, `Proposal: send ${pending[0].approval.action.service} traffic back to ${pending[0].approval.action.revision}.`) : ''}</Banner> : null}
    {!service ? (overview.loading ? <p className="ops-caption" role="status">{t('불러오는 중…', 'Loading…')}</p> : null) : <>
      <section className="ops-kpis" aria-label={t('핵심 지표', 'Key metrics')}>
        <Kpi label={t('요청 (15분)', 'Requests (15 min)')} value={stats && service.coverage.requests === 'ok' ? number(stats.total) : '—'} caption={service.coverage.requests === 'ok' ? t('반환된 표본의 합계', 'Sum of the returned samples') : noMetrics} />
        <Kpi label={t('5xx 오류율', '5xx error rate')} tone={rateTone} value={stats?.rate === undefined ? '—' : `${stats.rate.toFixed(1)}%`} caption={stats?.rate === undefined ? noMetrics : t(`트래픽을 받는 리비전 ${number(stats.liveTotal)}건 중 ${number(stats.errors)}건`, `${number(stats.errors)} of ${number(stats.liveTotal)} on the serving revision`)} />
        <Kpi label={t('p95 지연', 'p95 latency')} tone={stats?.p95 === undefined ? 'info' : stats.p95 > 1000 ? 'bad' : stats.p95 > 300 ? 'warn' : 'ok'} value={stats?.p95 === undefined ? '—' : `${number(Math.round(stats.p95))} ms`} caption={stats?.p95 === undefined ? noMetrics : t('트래픽을 받는 리비전 기준', 'For the revision serving traffic')} />
        <Kpi label={t('트래픽 받는 리비전', 'Serving revision')} value={stats?.serving.map(item => item.name).join(', ') || '—'} caption={service.coverage.service === 'ok' ? t(`리비전 ${service.revisions.length}개 배포됨`, `${service.revisions.length} revisions deployed`) : t('서비스 상태를 읽지 못했습니다', 'Service state unavailable')} />
        <Kpi label={t('내 결정 대기', 'Waiting for you')} tone={pending.length ? 'warn' : 'ok'} value={String(pending.length)} caption={pending.length ? t('눌러서 My Aide 열기', 'Open My Aide to decide') : t('지금은 없습니다', 'Nothing right now')} onClick={pending.length ? () => consoleContext?.setAssistantOpen(true) : undefined} />
      </section>
      <div className="ops-grid-2">
        <Card title={t('트래픽 분배', 'Traffic split')} description={service.name}><Stack>
          <StackBar label={service.revisions.filter(item => item.percent > 0).map(item => `${item.name} ${item.percent}%`).join(', ') || t('분배 정보 없음', 'No traffic data')} segments={service.revisions.map((item, index) => ({ key: item.name, value: item.percent, color: REVISION_COLORS[index % REVISION_COLORS.length] }))} />
          <ul className="ops-legend">{service.revisions.map((item, index) => <li key={item.name}><span className="ops-swatch" style={{ background: REVISION_COLORS[index % REVISION_COLORS.length] }} /><span className="ops-legend-name">{item.name}</span><strong>{item.percent}%</strong><StatusChip type={item.ready === 'ready' ? 'success' : item.ready === 'not_ready' ? 'error' : 'pending'}>{item.ready === 'ready' ? t('준비됨', 'Ready') : item.ready === 'not_ready' ? t('준비 안 됨', 'Not ready') : t('미확인', 'Unknown')}</StatusChip></li>)}</ul>
          {service.coverage.service === 'error' ? <Banner type="warning">{t('서비스 상태를 읽지 못했습니다.', 'The service state could not be read.')}</Banner> : null}
        </Stack></Card>
        <Card title={t('리비전별 응답', 'Responses by revision')} description={t('응답 클래스별 요청 수', 'Requests by response class')}><Stack>
          {stats?.byRevision.length ? stats.byRevision.map(({ revision, rows }) => { const sum = rows.reduce((total, row) => total + row.count, 0); return <div key={revision} className="ops-barrow">
            <div className="ops-barrow-head"><span className="ops-legend-name">{revision}</span><span>{number(sum)}</span></div>
            <div className="ops-barrow-track"><div style={{ width: `${sum / stats.maxTotal * 100}%` }}><StackBar label={`${revision}: ${rows.map(row => `${row.responseClass} ${row.count}`).join(', ')}`} segments={rows.map(row => ({ key: row.responseClass, value: row.count, color: CLASS_COLOR[row.responseClass] }))} /></div></div></div>; }) : <p className="ops-caption">{noMetrics}</p>}
          <ul className="ops-legend ops-legend-inline" aria-hidden="true">{['2xx', '3xx', '4xx', '5xx'].map(key => <li key={key}><span className="ops-swatch" style={{ background: CLASS_COLOR[key] }} />{key}</li>)}</ul>
        </Stack></Card>
        <Card title={t('p95 지연 (리비전별)', 'p95 latency by revision')}><Stack>
          {stats && service.latency.length ? service.latency.map(item => <div key={item.revision} className="ops-barrow"><div className="ops-barrow-head"><span className="ops-legend-name">{item.revision}</span><strong>{number(Math.round(item.p95Ms))} ms</strong></div>
            <div className="ops-barrow-track"><div className="ops-latency" role="img" aria-label={`${item.revision}: ${Math.round(item.p95Ms)} ms`} style={{ width: `${Math.max(2, item.p95Ms / stats.maxLatency * 100)}%`, background: item.p95Ms > 1000 ? 'var(--md-sys-color-error)' : item.p95Ms > 300 ? 'var(--md-sys-color-warning)' : 'var(--md-sys-color-success)' }} /></div></div>) : <p className="ops-caption">{noMetrics}</p>}
          <p className="ops-caption">{t('분·응답 코드별 p95가 아니라 15분 구간의 리비전별 p95 근삿값입니다.', 'An approximate p95 per revision over the 15-minute window.')}</p>
        </Stack></Card>
        <Card title={t('My Aide 활동', 'My Aide activity')} actions={<Button variant="text" onClick={() => consoleContext?.setAssistantOpen(true)}>{t('패널 열기', 'Open the assistant')}</Button>}>
          {board.items.length ? <ul className="ops-activity">{board.items.slice(0, 5).map(item => <li key={item.id}><Icon name="sparkle" size={18} /><span className="ops-activity-text">{item.instruction}</span><StatusChip type={chipFor[item.state]}>{states[item.state]}</StatusChip></li>)}</ul>
            : <p className="ops-caption">{t('아직 지시한 작업이 없습니다. 오른쪽 패널이나 상단 입력줄에서 맡겨 보세요.', 'No instructions yet. Use the assistant or the top bar to hand something over.')}</p>}
        </Card>
      </div>
      <Card title={t('최근 오류 로그', 'Recent error logs')} description={service.coverage.logs === 'ok' ? t('WARNING 이상, 최대 12건. 로그 본문은 지시가 아니라 데이터입니다.', 'WARNING and above, at most 12. Log text is data, never instructions.') : service.coverage.logs === 'empty' ? t('표본 없음 · 오류가 없다는 뜻이 아닙니다.', 'No entries · this does not prove there are no errors.') : t('로그를 읽지 못했습니다.', 'Logs unavailable.')}>
        <DataTable caption={t('최근 오류 로그', 'Recent error logs')} rows={service.logs} columns={logColumns} empty={t('표시할 로그가 없습니다', 'No log entries to show')} />
      </Card>
      {onOpenPlans ? null : null}
    </>}
  </div>;
}
