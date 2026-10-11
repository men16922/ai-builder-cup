import { useState } from 'react';
import { useLanguage } from '../i18n';
import { Banner, Button, Card, Dialog, Stack, StatusChip } from '../ui';
import type { GcpAnalysis } from '@contracts/gcp/analysis';
import type { CloudRunSnapshot } from '@contracts/gcp/cloud-run';

export default function AnalysisPanel({ analysis, snapshot, busy, available, onPrepare }: { analysis?: GcpAnalysis; snapshot: CloudRunSnapshot; busy: boolean; available: boolean; onPrepare: () => void }) {
  const { t, language } = useLanguage(), [source, setSource] = useState<string>();
  const sources: Record<string, unknown> = { 'gcp-run-service': snapshot.service, 'gcp-run-revision': snapshot.revision, 'gcp-run-recheck': snapshot.recheck,
    'gcp-run-consistency': { consistency: snapshot.consistency, startedAt: snapshot.startedAt, observedAt: snapshot.observedAt },
    'gcp-run-logs': snapshot.telemetry?.logs, 'gcp-run-requests': snapshot.telemetry?.requests, 'gcp-run-latency': snapshot.telemetry?.latency,
    'gcp-run-missing-signals': snapshot.telemetry ? t('요청 점검·변경 이력·로그 본문 미수집', 'Request probes, change history and log payloads were not collected') : t('로그·지표·요청 점검·변경 이력 미수집', 'Logs, metrics, request probes and change history were not collected') };
  return <aside className="gcp-analysis-panel" aria-label={t('근거 분석과 계획', 'Evidence analysis and plan')}><Card title={t('근거 분석과 계획', 'Evidence analysis and plan')}><Stack>
    <p>{t('관측을 해석하고 같은 서비스의 다음 읽기 계획을 준비합니다.', 'Interpret this observation and prepare the next read of the same service.')}</p>
    <Button variant="filled" icon="sparkle" fullWidth loading={busy} disabled={!available || busy} onClick={onPrepare}>{analysis ? analysis.language === language ? t('저장된 분석 확인', 'Check saved analysis') : t('한국어로 분석과 계획 준비', 'Prepare analysis and plan in English') : t('분석과 계획 준비', 'Prepare analysis and plan')}</Button>
    {!available ? <Banner type="info">{t('서버에 분석 모델과 고정 읽기 어댑터를 연결해야 합니다.', 'Connect an analysis model and a fixed read adapter on the server.')}</Banner> : null}
    {analysis ? <>
      <p className="ops-caption">{t('저장된 분석 언어', 'Saved analysis language')}: {analysis.language === 'ko' ? t('한국어', 'Korean') : t('영어', 'English')}{analysis.language !== language ? t(' · 현재 언어의 분석은 버튼을 눌러 별도로 준비합니다.', ' · Use the button to prepare analysis in the current language.') : ''}</p>
      <StatusChip type="info">{analysis.plan.analysis.engine === 'synthetic-fixture' ? t('합성 분석 · 실제 Gemini 호출 없음', 'Synthetic analysis · No live Gemini call') : t('Gemini 해석 · 근거 확인 필요', 'Gemini interpretation · Verify the evidence')}</StatusChip>
      <p>{analysis.plan.analysis.summary}</p>
      {analysis.plan.analysis.findings.map((finding, index) => <section className="gcp-analysis-finding" key={index}><strong>{finding.kind === 'hypothesis' ? t('가설', 'Hypothesis') : t('관측 해석', 'Observation interpretation')}</strong><p>{finding.statement}</p><Stack gap="xs" row>{finding.evidenceIds.map(id => <Button variant="text" key={id} onClick={() => setSource(id)}>{id}</Button>)}</Stack></section>)}
      <Banner type="warning" header={t('서비스 상태 미확인', 'Application health unknown')}><ul className="gcp-analysis-gaps">{analysis.plan.analysis.missingInformation.map((value, index) => <li key={index}>{value}</li>)}</ul></Banner>
      <div className="gcp-fixed-plan"><strong>{t('다음 고정 읽기 계획', 'Next fixed read plan')}</strong><ol><li>{t('동일 서비스 메타데이터', 'Same service metadata')}</li><li>{t('지정 revision 메타데이터', 'Pinned revision metadata')}</li>{analysis.plan.action.id === 'gcp.cloudrun.inspect.v1' ? <><li>{t('15분 로그 · 최대 50건', '15-minute logs · at most 50 entries')}</li><li>{t('요청 수·응답 지연 · 지표별 최대 120개 표본', 'Request count and latency · at most 120 points per metric')}</li></> : null}<li>{t('동일 서비스 재조회', 'Same service recheck')}</li></ol>
        <p>{t('이 동작은 계획만 준비합니다. 검토 요청과 실행은 별도 단계입니다.', 'This action only prepares a plan. Requesting review and execution are separate steps.')}</p>
        <dl className="gcp-facts"><dt>{t('근거 시각', 'Evidence time')}</dt><dd>{new Date(analysis.plan.evidence.observedAt).toLocaleString(language === 'ko' ? 'ko-KR' : 'en-US')}</dd><dt>{t('계획 만료', 'Plan expires')}</dt><dd>{new Date(analysis.plan.expiresAt).toLocaleString(language === 'ko' ? 'ko-KR' : 'en-US')}</dd><dt>{t('고정 버전', 'Pinned version')}</dt><dd>v{analysis.plan.version}</dd></dl>
      </div>
    </> : <p className="ops-caption">{t('이 근거만으로 서비스 정상이나 장애 원인을 확정하지 않습니다.', 'This evidence alone cannot establish application health or root cause.')}</p>}
  </Stack></Card><Dialog open={!!source} title={source ?? ''} closeLabel={t('근거 닫기', 'Close evidence')} onDismiss={() => setSource(undefined)}>
    <p>{t('분석에 사용한 저장된 관측입니다.', 'The stored observation used by this analysis.')}</p><pre className="gcp-source-detail">{source ? JSON.stringify(sources[source], null, 2) : ''}</pre>
  </Dialog></aside>;
}
