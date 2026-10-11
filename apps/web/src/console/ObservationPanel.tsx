import { useLanguage } from '../i18n';
import { Banner, Card, Details, Stack, StatusChip } from '../ui';
import type { CloudRunSnapshot } from '@contracts/gcp/cloud-run';
import TelemetryPanel from './TelemetryPanel';
export default function ObservationPanel({ snapshot }: { snapshot: CloudRunSnapshot }) {
  const { language, t } = useLanguage(); const service = snapshot.service.status === 'collected' ? snapshot.service.value : undefined;
  const revision = snapshot.revision.status === 'collected' ? snapshot.revision.value : undefined;
  const readiness = (value?: string) => ({ succeeded: t('준비 완료', 'Ready'), failed: t('준비 실패', 'Readiness failed'), pending: t('대기 중', 'Pending'), reconciling: t('배포 반영 중', 'Reconciling') })[value ?? ''] ?? t('미확인', 'Unknown');
  const consistency = snapshot.consistency === 'stable' ? t('변경 없음', 'No change observed') : snapshot.consistency === 'changed' ? t('조회 중 변경', 'Changed during collection') : t('재확인 미완료', 'Recheck incomplete');
  const target = snapshot.binding.target;
  const status = (value: string) => ({ collected: t('수집됨', 'Collected'), denied: t('권한 거절', 'Access denied'), missing: t('대상 미확인', 'Not found'), skipped: t('조회 생략', 'Not queried'), unavailable: t('미수집', 'Unavailable') })[value];
  const date = (value: string) => new Date(value).toLocaleString(language === 'ko' ? 'ko-KR' : 'en-US');
  return <Stack gap="l">
    <Banner type={snapshot.dataMode === 'synthetic' ? 'info' : 'warning'} header={snapshot.dataMode === 'synthetic' ? t('합성 관측 · 실제 GCP 결과가 아닙니다', 'Synthetic observation · Not a live GCP result') : t('한 시점의 메타데이터 관측', 'Metadata observation at one point in time')}>
      {snapshot.telemetry ? t('배포 준비 상태와 서비스 정상 여부는 다릅니다. 제한된 로그·지표의 표본과 누락을 함께 확인하세요.', 'Deployment readiness does not establish application health. Review bounded telemetry samples and missing evidence together.') : t('배포 준비 상태와 서비스 정상 여부는 다릅니다. 로그·지표·요청 점검·변경 이력은 아직 수집하지 않았습니다.', 'Deployment readiness does not establish application health. Logs, metrics, request probes and change history have not been collected.')}
    </Banner>
    <div className="gcp-evidence-heading"><div><span>Cloud Run</span><h2>{target.provider === 'gcp' ? target.resourceName.split('/').at(-1) : '—'}</h2><p>{target.provider === 'gcp' ? `${target.projectId} · ${target.location}` : ''}</p></div><div><span>{t('수집 완료 시각', 'Collection finished')}</span><p>{date(snapshot.observedAt)}</p></div></div>
    <div className="gcp-observation-grid">
      <div className="gcp-signal-card"><span>{t('서비스 배포 준비', 'Service deployment readiness')}</span><strong>{readiness(service?.readiness)}</strong><StatusChip type={service?.readiness === 'failed' ? 'error' : service?.readiness === 'succeeded' ? 'info' : 'pending'}>{status(snapshot.service.status)}</StatusChip></div>
      <div className="gcp-signal-card"><span>{t('지정 revision 준비', 'Pinned revision readiness')}</span><strong>{readiness(revision?.readiness)}</strong><span className="gcp-wrap">{target.provider === 'gcp' ? target.revision : '—'}</span></div>
      <div className="gcp-signal-card"><span>{t('조회 전후 비교', 'Before / after comparison')}</span><strong>{consistency}</strong><span>{t('서비스 정상 판정: 미확인', 'Application health: unknown')}</span></div>
    </div>
    <div className="gcp-details-grid">
      <Card title={t('관측된 트래픽 배분', 'Observed traffic allocation')}>
        {service?.traffic?.length ? <div className="gcp-traffic">{service.traffic.map((row, index) => <div key={index}><div><span className="gcp-wrap">{row.revision ?? t('revision 미확인', 'Unknown revision')}</span><strong>{row.percent === null ? '—' : `${row.percent}%`}</strong></div>{row.percent !== null ? <div className="gcp-traffic-track" aria-hidden="true"><span style={{ width: `${row.percent}%` }} /></div> : null}</div>)}</div> : <p>{t('트래픽 배분을 확인하지 못했습니다. 트래픽 0%라는 뜻은 아닙니다.', 'Traffic allocation is unavailable. This does not mean zero traffic.')}</p>}
        <p className="ops-caption">{t('라우팅 설정 관측이며 요청 수나 오류율 그래프가 아닙니다.', 'This observes routing allocation, not request volume or error rate.')}</p>
      </Card>
      <Card title={t('배포 근거', 'Deployment evidence')}><dl className="gcp-facts">
        <dt>{t('최근 생성 revision', 'Latest created revision')}</dt><dd>{service?.latestCreatedRevision ?? '—'}</dd>
        <dt>{t('최근 준비 revision', 'Latest ready revision')}</dt><dd>{service?.latestReadyRevision ?? '—'}</dd>
        <dt>{t('요청 / 관측 generation', 'Requested / observed generation')}</dt><dd>{service?.generation ?? '—'} / {service?.observedGeneration ?? '—'}</dd>
        <dt>{t('배포 반영 중', 'Reconciling')}</dt><dd>{service?.reconciling === null || !service ? t('미확인', 'Unknown') : service.reconciling ? t('예', 'Yes') : t('아니요', 'No')}</dd>
      </dl></Card>
    </div>
    {snapshot.telemetry ? <TelemetryPanel telemetry={snapshot.telemetry} /> : null}
    <Card title={t('출처와 부족한 근거', 'Sources and missing evidence')}><Stack>
      {(['service', 'revision', 'recheck'] as const).map((key, index) => { const item = snapshot[key]; return <Details key={key} summary={`${[t('서비스 조회', 'Service read'), t('지정 revision 조회', 'Pinned revision read'), t('서비스 재조회', 'Service recheck')][index]} · ${status(item.status)}`}><div className="gcp-wrap"><p>{item.status === 'skipped' ? t('서비스 식별이 확인되지 않아 호출하지 않았습니다.', 'Not called because service identity was not verified.') : item.source}</p><p>{date(item.observedAt)}</p><p>{item.status === 'collected' ? item.value.missingFields.length ? `${t('누락/확인 필요', 'Missing / needs review')}: ${item.value.missingFields.join(', ')}` : t('선택한 메타데이터 필드를 수집했습니다.', 'The selected metadata fields were collected.') : item.code}</p></div></Details>; })}
      <Banner type="warning">{snapshot.telemetry ? t('로그 본문·요청 점검·변경 이력은 수집하지 않았습니다. 시각이 같은 증상도 인과관계를 뜻하지 않습니다.', 'Log payloads, request probes and change history were not collected. Symptoms at the same time do not establish causality.') : t('로그·지표가 없어 원인과 영향은 판단하지 않았습니다. 다음 단계에서 근거를 보완하고 Gemini 분석·고정 점검 계획으로 이어갑니다.', 'Cause and impact remain unassessed without logs and metrics. Add evidence before Gemini analysis and a fixed inspection plan.')}</Banner>
    </Stack></Card>
  </Stack>;
}
