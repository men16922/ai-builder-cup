import { useState } from 'react';
import { useLanguage } from '../../i18n';
import { Banner, Button, Card, Checkbox, Select, Stack, StatusChip, TextArea } from '../../ui';
import TelemetryPanel from './TelemetryPanel';
import { demoTelemetry, type DemoScenario } from './demo';

export default function SyntheticWorkflow() {
  const { t } = useLanguage(), [scenario, setScenario] = useState<DemoScenario>('signals'), [stage, setStage] = useState(0);
  const [reviewed, setReviewed] = useState(false), [note, setNote] = useState(''), [handoff, setHandoff] = useState('');
  const options = [
    { value: 'signals', label: t('오류 표본 · 조회 완료', 'Error samples · queries completed') },
    { value: 'empty', label: t('표본 없음 · 상태 미확인', 'No samples · health unknown') },
    { value: 'denied', label: t('응답 지연 권한 거절', 'Latency access denied') },
  ];
  const reset = (next: DemoScenario) => { setScenario(next); setStage(0); setReviewed(false); setNote(''); setHandoff(''); };
  const telemetry = demoTelemetry(scenario);
  return <section aria-label={t('합성 워크플로 체험', 'Synthetic workflow rehearsal')}><Stack gap="l">
    <Banner type="info" header={t('브라우저에서 진행하는 합성 체험', 'Synthetic rehearsal in this browser')}>{t('Google 로그인·GCP·Gemini 호출 없이 예제 근거 → 계획 검토 → 조회 결과 → 인계를 체험합니다. 예제 해석은 미리 작성한 문구이며, 닫기·새로고침·시나리오 변경 시 기록이 사라집니다.', 'Try example evidence → plan review → query results → handoff without Google sign-in, GCP or Gemini calls. Interpretation is prewritten. Closing, reloading or changing the scenario clears this rehearsal.')}</Banner>
    <Card title={t('Cloud Run 한 서비스 점검', 'Inspect one Cloud Run service')} description="example-mobileops-demo · asia-northeast3 · checkout-demo / checkout-demo-00003" actions={<Button onClick={() => reset(scenario)}>{t('체험 다시 시작', 'Restart rehearsal')}</Button>}><Stack>
      <Select label={t('체험 시나리오', 'Rehearsal scenario')} value={scenario} options={options} onChange={value => reset(value as DemoScenario)} />
      <ol className="gcp-demo-stages" aria-label={t('체험 단계', 'Rehearsal stages')}>{[t('근거 확인', 'Evidence'), t('계획 검토', 'Review plan'), t('조회 결과', 'Read results'), t('인계', 'Handoff')].map((label, index) => <li key={index} aria-current={Math.min(stage, 3) === index ? 'step' : undefined}><span>{String(index + 1).padStart(2, '0')}</span><strong>{label}</strong></li>)}</ol>
      {stage === 0 ? <><p>{t('15분의 합성 로그·요청 표본을 확인한 뒤, 같은 서비스에서 무엇을 다시 확인할지 검토하세요.', 'Inspect synthetic logs and request samples for 15 minutes, then review what to check again on the same service.')}</p><Button variant="filled" onClick={() => setStage(1)}>{t('합성 근거 보기', 'View synthetic evidence')}</Button></> : null}
    </Stack></Card>
    {stage >= 1 ? <div className="gcp-evidence-workspace"><TelemetryPanel telemetry={telemetry} /><aside className="gcp-analysis-panel"><Card title={t('예제 해석과 고정 계획', 'Example interpretation and fixed plan')}><Stack>
      <StatusChip type="info">{t('미리 작성한 예제 · Gemini 미호출', 'Prewritten example · no Gemini call')}</StatusChip>
      <p>{scenario === 'empty' ? t('조회는 끝났지만 표본이 없습니다. 요청 0건이나 정상 서비스로 판단할 수 없습니다.', 'Queries completed without samples. Neither zero requests nor healthy service can be inferred.') : scenario === 'denied' ? t('503 요청 표본이 있지만 응답 지연 조회 권한이 거절됐습니다. 일부 조회 성공이 전체 점검 완료를 뜻하지 않습니다.', '503 request samples exist, but the latency query was denied. Some successful queries do not complete the whole inspection.') : t('503 요청 12건과 분·응답 코드별 p95 1,250ms 표본이 있습니다. 전체 오류율과 원인은 아직 알 수 없습니다.', 'The example includes 12 requests with status 503 and a per-minute, per-code p95 of 1,250ms. Overall error rate and cause remain unknown.')}</p>
      <ol><li>{t('동일 서비스·지정 revision 확인', 'Read the same service and pinned revision')}</li><li>{t('15분 로그 최대 50건·요청 수/지연 각 120개 표본', '15-minute logs, at most 50 entries; request count/latency, at most 120 points each')}</li><li>{t('서비스 재확인 후 각 조회 결과 기록', 'Recheck service and record each query outcome')}</li></ol>
      <Banner type="warning">{t('서비스 상태 미확인 · 부분 근거', 'Application health unknown · partial evidence')}</Banner>
      {stage === 1 ? <Button variant="filled" onClick={() => setStage(2)}>{t('합성 계획 검토', 'Review synthetic plan')}</Button> : null}
      {stage === 2 ? <><Checkbox checked={reviewed} onChange={setReviewed}>{t('대상과 조회 범위를 확인했습니다', 'I checked the target and read scope')}</Checkbox><p>{t('이 확인은 체험 단계이며 실행이나 회사 승인이 아닙니다.', 'This is a rehearsal step, not execution or company approval.')}</p><Button variant="filled" disabled={!reviewed} onClick={() => setStage(3)}>{t('합성 조회 결과 보기', 'View synthetic read results')}</Button></> : null}
    </Stack></Card></aside></div> : null}
    {stage === 3 ? <Card title={t('합성 결과와 인계', 'Synthetic results and handoff')}><Stack>
      <div role="status"><StatusChip type={scenario === 'denied' ? 'error' : 'info'}>{scenario === 'denied' ? t('합성 조회 미완료', 'Synthetic queries incomplete') : t('합성 조회 완료 · 서비스 상태 미확인', 'Synthetic queries completed · health unknown')}</StatusChip></div>
      <div className="gcp-observation-grid">{(['logs', 'requests', 'latency'] as const).map(key => <div className="gcp-signal-card" key={key}><strong>{key === 'logs' ? t('로그', 'Logs') : key === 'requests' ? t('요청 수', 'Requests') : t('응답 지연', 'Latency')}</strong><span>{telemetry[key].status === 'denied' ? t('권한 거절', 'Access denied') : telemetry[key].status === 'no_data' ? t('조회 완료 · 표본 없음', 'Query completed · no samples') : t('조회 완료 · 부분 표본', 'Query completed · partial samples')}</span></div>)}</div>
      <TextArea label={t('체험 인계 메모', 'Rehearsal handoff note')} description={t('현재 브라우저 체험에서만 보이며 조회 결과를 바꾸지 않습니다.', 'Visible only during this browser rehearsal; it does not change the query outcome.')} value={note} onChange={setNote} />
      <Button disabled={!note.trim()} onClick={() => setHandoff(note.trim())}>{t('체험 인계 남기기', 'Record rehearsal handoff')}</Button>
      {handoff ? <div className="gcp-handoff" role="status"><strong>{t('체험 인계 기록됨', 'Rehearsal handoff recorded')}</strong><p>{handoff}</p></div> : null}
    </Stack></Card> : null}
  </Stack></section>;
}
