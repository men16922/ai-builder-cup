import type { VehicleCall } from '@contracts/gcp/mobility';
import { useLanguage } from '../i18n';
import { Button, Icon, StatusChip } from '../ui';

/** A durable unknown call is shown for review; this panel has no call-step or model callback. */
export default function CallUnconfirmed({ call, onRefresh, onDismiss }: { call: VehicleCall; onRefresh: () => void; onDismiss: () => void }) {
  const { t } = useLanguage();
  return <aside className="aide-call aide-call-summary" aria-label={t('통화 결과 미확인', 'Call outcome unconfirmed')}>
    <header className="aide-call-head"><div className="aide-call-avatar"><Icon name="phone" size={20}/></div>
      <div className="aide-call-who"><strong>{t('통화 결과 미확인', 'Call outcome unconfirmed')}</strong><span>{call.caller.name} · {t('가상 통화', 'Simulated call')}</span></div>
      <button type="button" className="aide-icon-button" aria-label={t('닫기', 'Close')} onClick={onDismiss}><Icon name="close" size={20}/></button></header>
    <p role="status">{t('AI 응답을 확인하지 못했습니다. 같은 통화 단계를 다시 실행하지 않았습니다. 최신 기록을 확인한 뒤 담당자와 검토하세요.', 'The AI response could not be confirmed. The same call step was not repeated. Read the latest record and review it with a responder.')}</p>
    <StatusChip type="warning">{t('후속 작업 실행 안 함', 'No follow-up performed')}</StatusChip>
    {call.turns.length ? <details><summary>{t('확인된 대화 기록', 'Confirmed transcript')}</summary><ol>{call.turns.map((turn, index) => <li key={index}><strong>{turn.role === 'caller' ? call.caller.name : turn.role === 'aide' ? 'My Aide' : t('나', 'You')}</strong><p>{turn.text}</p></li>)}</ol></details> : null}
    <div className="ops-actions"><Button variant="filled" icon="refresh" onClick={onRefresh}>{t('최신 기록 확인', 'Read latest record')}</Button><Button icon="close" onClick={onDismiss}>{t('닫기', 'Close')}</Button></div>
  </aside>;
}
