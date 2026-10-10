import { useState } from 'react';
import { useLanguage } from '../../i18n';
import { Banner, Button, Card, Details, Stack, StatusChip, TextArea } from '../../ui';
import type { GcpObservationClient } from './observation-client';
import type { GcpWorkflowView } from './domain/workflow';
import InspectionResult from './InspectionResult';
export default function WorkflowPanel({ view, client, busy }: { view: GcpWorkflowView; client: GcpObservationClient; busy: boolean }) {
  const { t, language } = useLanguage(), [reviewNote, setReviewNote] = useState(''), [handoffNote, setHandoffNote] = useState('');
  const { plan, execution, capabilities } = view;
  const fullInspection = plan.payload.action.id === 'gcp.cloudrun.inspect.v1';
  const expired = Date.parse(plan.payload.expiresAt) <= Date.parse(view.serverTime);
  const review = { not_requested: t('검토 전', 'Not requested'), pending: t('검토 대기', 'Awaiting review'), approved: t('계획 확인됨', 'Plan confirmed'), rejected: t('거절됨', 'Rejected'), changes_requested: t('수정 요청', 'Changes requested') }[plan.review.status];
  const outcome = execution ? { queued: t('실행 대기', 'Queued'), running: t('조회 중', 'Reading'), succeeded: fullInspection ? t('고정 범위 조회 완료', 'Fixed-scope queries completed') : t('필수 메타데이터 읽기 완료', 'Required metadata reads completed'), failed: t('필수 관측 미완료', 'Required observations incomplete'), unknown: t('실행 결과 미확인', 'Execution outcome unknown'), cancelled: t('조회 시작 전 중지', 'Stopped before collection') }[execution.state] : t('실행 전', 'Not started');
  const run = (action: Parameters<GcpObservationClient['workflowAction']>[0], note = '') => { void client.workflowAction(action, note); };
  return <Card title={t('검토 · 실행 · 결과와 인계', 'Review · Execute · Results and handoff')} actions={<>{capabilities.requestReview ? <Button variant="filled" disabled={busy} onClick={() => run('review')}>{t('검토 요청', 'Request review')}</Button> : null}<Button loading={busy} onClick={() => void client.refreshPlan()}>{t('저장된 상태 확인', 'Refresh stored status')}</Button></>}><Stack gap="l">
    <div className="gcp-workflow-stages"><div><span>01 · {t('고정 계획', 'Pinned plan')}</span><strong>{expired ? t('만료됨', 'Expired') : `v${plan.payload.version}`}</strong></div><div><span>02 · {t('사람 검토', 'Human review')}</span><strong>{review}</strong></div><div><span>03 · {t('읽기 실행', 'Read execution')}</span><strong>{outcome}</strong></div><div><span>04 · {t('인계 기록', 'Handoff notes')}</span><strong>{execution?.handoffs.length ?? 0}</strong></div></div>
    <p className="gcp-wrap">{t('계획 ID', 'Plan ID')}: {plan.payload.planId}</p>
    <Banner type="info">{t('검토 기록은 회사의 별도 승인을 대신하지 않습니다. 계획 확인만으로 실행하지 않으며, 아래 실행 버튼을 눌러야 고정된 범위를 조회합니다.', 'This review record does not replace company approval. Confirming a plan does not execute it. The execution button explicitly reads the pinned scope.')}</Banner>
    {fullInspection ? <p>{t('서비스·지정 revision·로그·요청 수·응답 지연·서비스 재확인, 최대 6회 읽기입니다. 실행 시점의 최근 2분을 제외한 15분, 로그 최대 50건·지표별 최대 120개 표본을 한 페이지만 조회합니다.', 'At most six reads: service, pinned revision, logs, request count, latency and service recheck. At execution time, read a 15-minute window ending two minutes earlier, at most 50 logs and 120 points per metric, one page only.')}</p> : null}
    {expired && plan.lifecycle === 'prepared' ? <Banner type="warning">{t('계획이 만료되었습니다. 새로운 관측으로 계획을 준비하세요.', 'The plan expired. Collect a new observation and prepare a new plan.')}</Banner> : null}
    {capabilities.decide ? <Stack><TextArea label={t('검토 메모', 'Review note')} value={reviewNote} disabled={busy} onChange={setReviewNote} /><Stack row gap="s"><Button disabled={busy} onClick={() => run('approve', reviewNote)}>{t('계획 확인', 'Confirm plan')}</Button><Button disabled={busy} onClick={() => run('request_changes', reviewNote)}>{t('수정 요청', 'Request changes')}</Button><Button disabled={busy} onClick={() => run('reject', reviewNote)}>{t('거절', 'Reject')}</Button></Stack></Stack> : null}
    {plan.review.note ? <p>{plan.review.note}</p> : null}
    {capabilities.execute ? <Button variant="filled" disabled={busy} onClick={() => run('execute')}>{fullInspection ? t('고정 로그·지표 조회 실행', 'Execute fixed log and metric read') : t('고정 메타데이터 조회 실행', 'Execute fixed metadata read')}</Button> : null}
    {execution ? <Stack><StatusChip type={execution.state === 'succeeded' ? 'success' : execution.state === 'failed' ? 'error' : 'pending'}>{outcome}</StatusChip>
      <p>{t('읽기 완료는 서비스 정상이나 복구 완료를 뜻하지 않습니다. 서비스 상태는 미확인입니다.', 'Read completion does not establish application health or recovery. Application health remains unknown.')}</p>
      {fullInspection && view.evidence ? <InspectionResult evidence={view.evidence} /> : null}
      {['queued', 'running', 'unknown'].includes(execution.state) ? <Banner type="warning">{t('저장된 상태를 확인하세요. 새로고침이나 같은 요청 재전송으로 조회를 다시 시작하지 않습니다. 중지는 시작 전 대기 상태에만 적용됩니다.', 'Refresh the stored status. Reloading or retrying the same request never starts another read. Cancellation only applies before collection starts.')}</Banner> : null}
      {capabilities.cancel ? <Button disabled={busy} onClick={() => run('cancel')}>{t('대기 실행 중지', 'Cancel queued execution')}</Button> : null}
      {view.evidence ? <Details summary={t('실행 결과 근거', 'Execution evidence')}><p>{t('결과 수집 시각', 'Result observed at')}: {new Date(view.evidence.observedAt).toLocaleString(language === 'ko' ? 'ko-KR' : 'en-US')}</p><pre className="gcp-source-detail">{JSON.stringify(view.evidence.observations, null, 2)}</pre></Details> : null}
      {capabilities.handoff ? <Stack gap="s"><TextArea label={t('후속 담당자에게 남길 인계', 'Handoff for the next operator')} description={t('인계 메모는 원래 실행 결과를 바꾸지 않습니다.', 'A handoff note preserves the original execution outcome.')} value={handoffNote} disabled={busy} onChange={setHandoffNote} /><Button disabled={busy || !handoffNote.trim()} onClick={() => run('handoff', handoffNote)}>{t('인계 기록 저장', 'Save handoff note')}</Button></Stack> : null}
      {execution.handoffs.map(note => <div key={note.id} className="gcp-handoff"><strong>{note.actorId}</strong><span>{new Date(note.at).toLocaleString(language === 'ko' ? 'ko-KR' : 'en-US')}</span><p>{note.note}</p></div>)}
    </Stack> : null}
  </Stack></Card>;
}
