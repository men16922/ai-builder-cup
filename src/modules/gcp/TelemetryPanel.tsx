import { useLanguage } from '../../i18n';
import { Banner, Card, DataTable, Stack } from '../../ui';
import type { CloudRunTelemetry } from './domain/telemetry';
import { summarizeTelemetry } from './domain/telemetry-summary';

export default function TelemetryPanel({ telemetry }: { telemetry: CloudRunTelemetry }) {
  const { t, language } = useLanguage(), locale = language === 'ko' ? 'ko-KR' : 'en-US';
  const at = (value: string) => new Date(value).toLocaleString(locale);
  const number = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 1 });
  const state = (value: CloudRunTelemetry['logs']['status']) => ({ collected: t('표본 수집됨', 'Samples collected'), no_data: t('표본 없음 · 0 아님', 'No samples · not zero'), denied: t('권한 거절', 'Access denied'), unavailable: t('수집 미완료', 'Collection unavailable'), skipped: t('대상 미확인 · 조회 생략', 'Target unverified · not queried') })[value];
  const { counts, total, errorCount, highestP95Ms, logs } = summarizeTelemetry(telemetry);
  return <Card title={t('로그·요청 지표', 'Logs and request metrics')} description={`${at(telemetry.window.start)} — ${at(telemetry.window.end)}`}><Stack>
    <p>{t('지정 revision · 최근 2분을 제외한 15분 · 자동 새로고침 없음', 'Pinned revision · 15 minutes ending two minutes before collection · no automatic refresh')}</p>
    <div className="gcp-observation-grid">
      <div className="gcp-signal-card"><span>{t('반환된 요청 수', 'Returned request count')}</span><strong>{total === null ? '—' : number(total)}</strong><span>{state(telemetry.requests.status)}</span></div>
      <div className="gcp-signal-card"><span>{t('반환된 5xx 요청 수', 'Returned 5xx request count')}</span><strong>{errorCount === null ? '—' : number(errorCount)}</strong><span>{t('해당 표본이 없으면 미확인', 'Unknown when no matching samples exist')}</span></div>
      <div className="gcp-signal-card"><span>{t('분·응답 코드별 p95 최댓값', 'Highest per-minute, per-code p95')}</span><strong>{highestP95Ms === null ? '—' : `${number(highestP95Ms)} ms`}</strong><span>{state(telemetry.latency.status)}</span></div>
    </div>
    {counts.length ? <div className="gcp-traffic" aria-label={t('응답 코드별 반환된 요청 수', 'Returned request counts by response code')}>{counts.map(item => <div key={item.code}><div><span>HTTP {item.code}</span><strong>{number(item.count)}</strong></div><div className="gcp-traffic-track" aria-hidden="true"><span style={{ width: `${total ? item.count / total * 100 : 0}%` }} /></div></div>)}</div> : null}
    <DataTable caption={`${t('최근 로그 표본', 'Recent log samples')} (${logs.length})`} rows={logs} empty={state(telemetry.logs.status)}
      columns={[
        { id: 'time', header: t('시각', 'Time'), cell: row => at(row.timestamp) },
        { id: 'stream', header: t('출처', 'Stream'), cell: row => row.stream },
        { id: 'severity', header: t('심각도', 'Severity'), cell: row => row.severity },
        { id: 'status', header: 'HTTP', cell: row => row.responseCode ?? '—' },
        { id: 'latency', header: t('응답 시간', 'Latency'), cell: row => row.latencyMs === null ? '—' : `${number(row.latencyMs)} ms` },
      ]} />
    <Banner type="info">{t('한 페이지 표본이며 전체 요청 수·오류율·시간창 전체의 p95가 아닙니다. 누락은 0으로 채우지 않습니다. 로그 본문·URL·IP는 포함하지 않습니다. 이 근거만으로 서비스 정상이나 원인을 확정하지 않습니다.', 'These are one-page samples, not complete request totals, error rates or an interval-wide p95. Missing data is not filled with zero. Log payloads, URLs and IPs are excluded. These observations do not establish service health or cause.')}</Banner>
    <div className="gcp-wrap">{(['logs', 'requests', 'latency'] as const).map(key => { const item = telemetry[key]; return <p key={key}><strong>{key === 'logs' ? t('로그', 'Logs') : key === 'requests' ? t('요청 수', 'Requests') : t('응답 지연', 'Latency')}</strong>: {state(item.status)} · {item.status === 'collected' && item.truncated ? t('다음 페이지 있음 · 부분 결과', 'More pages exist · partial results') : item.status === 'collected' ? t('반환된 페이지', 'Returned page') : item.code}<br />{item.source} · {at(item.observedAt)}</p>; })}</div>
  </Stack></Card>;
}
