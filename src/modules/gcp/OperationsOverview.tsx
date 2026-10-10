import { useLanguage } from '../../i18n';
import { Icon } from '../../ui';
import type { GcpClientState } from './observation-client';

/** A summary of the selected records only; never an organization-wide health aggregate. */
export default function OperationsOverview({ state }: { state: GcpClientState }) {
  const { t, locale } = useLanguage();
  const selected = state.items.find(item => item.id === state.selectedId), target = selected?.binding.target;
  const snapshot = state.observation?.snapshot, operation = state.operation;
  const planState = !operation ? t('계획을 열거나 준비하세요', 'Open or prepare a plan')
    : operation.execution ? ({ queued: t('읽기 대기', 'Read queued'), running: t('읽기 진행 중', 'Read in progress'), succeeded: t('읽기 완료 · 정상 여부 별도 확인', 'Read completed · health unconfirmed'), failed: t('필수 읽기 미완료', 'Required read incomplete'), unknown: t('읽기 결과 미확인', 'Read outcome unknown'), cancelled: t('시작 전 중지', 'Stopped before read') })[operation.execution.state]
      : operation.plan.lifecycle === 'superseded' ? t('새 버전으로 대체됨', 'Superseded by a newer version')
        : Date.parse(operation.plan.payload.expiresAt) <= Date.parse(operation.serverTime) ? t('계획 만료', 'Plan expired')
          : ({ not_requested: t('검토 요청 전', 'Review not requested'), pending: t('사람 검토 대기', 'Awaiting human review'), approved: t('검토됨 · 실행 전', 'Reviewed · not executed'), rejected: t('계획 거절', 'Plan rejected'), changes_requested: t('계획 수정 요청', 'Changes requested') })[operation.plan.review.status];
  return <section className="gcp-overview" aria-label={t('선택 서비스 운영 개요', 'Selected service overview')}>
    <div className="gcp-overview-card"><span className="gcp-overview-label"><Icon name="target" size={18} /> {t('01 · 대상', '01 · Target')}</span><strong>{selected?.label ?? t('대상 선택 전', 'No service selected')}</strong><p>{target?.provider === 'gcp' ? `${target.projectId} · ${target.location}` : t('허용된 서비스 목록에서 선택합니다.', 'Choose from the allowed services.')}</p><span className="gcp-overview-footnote">{selected?.dataMode === 'synthetic' ? t('합성 환경', 'Synthetic environment') : selected ? t('설정된 GCP 대상 · 관측은 별도', 'Configured GCP target · observation required') : t('웹 로그인 후 목록을 확인합니다.', 'Sign in to see the list.')}</span></div>
    <div className="gcp-overview-card"><span className="gcp-overview-label"><Icon name="search" size={18} /> {t('02 · 근거', '02 · Evidence')}</span><strong>{snapshot ? t('저장된 관측 있음', 'Stored observation available') : t('미수집', 'Not collected')}</strong><p>{snapshot ? new Date(snapshot.observedAt).toLocaleString(locale) : t('조회 버튼을 눌러 한 시점의 근거를 수집하세요.', 'Use the read button to collect a point-in-time observation.')}</p><span className="gcp-overview-footnote">{snapshot ? t('관측 시각의 기록 · 서비스 정상 여부 미확인', 'Recorded at the observation time · health unknown') : t('미수집은 정상이나 0건을 뜻하지 않습니다.', 'Uncollected does not mean healthy or zero.')}</span></div>
    <div className="gcp-overview-card"><span className="gcp-overview-label"><Icon name="pending" size={18} /> {t('03 · 현재 계획', '03 · Current plan')}</span><strong>{planState}</strong><p>{operation ? `${t('고정 버전', 'Pinned version')} v${operation.plan.payload.version} · ${t('인계', 'Handoffs')} ${operation.execution?.handoffs.length ?? 0}` : t('근거 해석 → 사람 검토 → 명시적 읽기 → 인계', 'Interpret evidence → review → explicit read → handoff')}</p><span className="gcp-overview-footnote">{operation ? t('현재 열린 한 계획의 저장 상태입니다.', 'Stored state of this one open plan.') : t('저장 목록을 열어 이전 작업을 이어갈 수 있습니다.', 'Open a saved plan to continue earlier work.')}</span></div>
  </section>;
}
