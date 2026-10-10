import { useLanguage } from '../../i18n';
import type { CloudEvidence } from '../../domain/cloud-operations';
import { Banner, StatusChip } from '../../ui';
import { inspectionReceipt } from './domain/inspection';

export default function InspectionResult({ evidence }: { evidence: CloudEvidence }) {
  const { t, language } = useLanguage(), receipt = inspectionReceipt(evidence);
  if (!receipt) return <Banner type="warning">{t('로그·지표 조회 완료 근거를 확인할 수 없습니다.', 'The log and metric query completion receipt could not be verified.')}</Banner>;
  const names = { 'gcp-run-logs': t('로그 조회', 'Log query'), 'gcp-run-requests': t('요청 수 조회', 'Request count query'), 'gcp-run-latency': t('응답 지연 조회', 'Latency query') };
  const states = { collected: t('반환 페이지 수집', 'Returned page collected'), no_data: t('조회 완료 · 표본 없음', 'Query completed · no samples'), denied: t('권한 거절', 'Access denied'), unavailable: t('조회 미완료', 'Query unavailable'), skipped: t('대상 미확인 · 생략', 'Target unverified · skipped') };
  const at = (value: string) => new Date(value).toLocaleString(language === 'ko' ? 'ko-KR' : 'en-US');
  return <section className="gcp-inspection-result" aria-label={t('로그·지표 조회 결과', 'Log and metric query results')}>
    <p>{at(receipt.window.start)} — {at(receipt.window.end)}</p>
    <div className="gcp-observation-grid">{receipt.outcomes.map(item => <div className="gcp-signal-card" key={item.id}><strong>{names[item.id]}</strong>
      <StatusChip type={['collected', 'no_data'].includes(item.status) ? 'info' : 'warning'}>{states[item.status]}</StatusChip>
      <span>{item.truncated ? t('다음 페이지 있음 · 부분 결과', 'More pages exist · partial results') : t('한 페이지 범위', 'One-page scope')}</span>
    </div>)}</div>
    <p>{t('조회 완료 · 근거 범위 · 서비스 상태는 별개입니다. 로그 최대 50건, 지표별 최대 120개 표본이며 빈 결과는 요청 0건이나 정상 판정을 뜻하지 않습니다.', 'Query completion, evidence coverage and application health are separate. At most 50 logs and 120 points per metric are read. Empty results do not mean zero requests or healthy service.')}</p>
  </section>;
}
