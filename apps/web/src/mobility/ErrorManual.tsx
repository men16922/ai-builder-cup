import { useState } from 'react';
import { useLanguage } from '../i18n';
import { Button, Dialog, Icon } from '../ui';

type Entry = { title: [string, string]; what: [string, string]; next: [string, string][] };
/** One manual page per server error code. Unknown codes fall back to an honest generic page. */
const manual: Record<string, Entry> = {
  vehicle_changed: { title: ['차량 상태가 바뀌었어요', 'Your car changed meanwhile'], what: ['다른 화면이나 기기에서 차량 상태가 먼저 바뀌어 이 요청을 적용하지 않았습니다.', 'Another screen or device changed the car first, so this request was not applied.'],
    next: [['최신 상태를 불러온 뒤 다시 시도하세요.', 'Load the latest state and try again.']] },
  mobility_outcome_unknown: { title: ['결과를 확인하지 못했어요', 'We could not confirm the result'], what: ['요청은 전달됐지만 완료 여부를 확인하지 못했습니다. 중복 실행을 막기 위해 자동으로 다시 보내지 않았습니다.', 'The request was sent but its completion could not be confirmed. To avoid doing it twice, it was not resent automatically.'],
    next: [['최신 상태에서 실제로 반영됐는지 먼저 확인하세요.', 'Check the latest state to see whether it took effect.'], ['반영되지 않았다면 새 요청으로 다시 시도하세요.', 'If it did not, start a new request.']] },
  mobility_in_progress: { title: ['아직 처리 중이에요', 'Still working on it'], what: ['같은 요청을 처리하고 있습니다.', 'The same request is still being handled.'], next: [['잠시 후 최신 상태를 확인하세요.', 'Check the latest state in a moment.']] },
  mobility_budget_exceeded: { title: ['잠시 쉬어갈게요', 'Taking a short break'], what: ['한 시간에 사용할 수 있는 AI·지도 요청 한도에 도달했습니다.', 'The hourly limit for AI and map requests was reached.'], next: [['다음 정각 이후 다시 시도하세요.', 'Try again after the top of the hour.']] },
  maps_not_configured: { title: ['지도 연결 준비 중', 'Maps is not connected yet'], what: ['Google 지도 검색이 아직 연결되지 않았습니다. 장소를 임의로 만들지 않습니다.', 'Google Maps search is not connected. Places are never made up.'], next: [['관리자에게 지도 연결을 요청하세요.', 'Ask the administrator to connect Maps.']] },
  places_empty: { title: ['주변에 결과가 없어요', 'Nothing nearby'], what: ['요청한 조건으로 주변 장소를 찾지 못했습니다.', 'No nearby place matched the request.'], next: [['조건을 넓히거나 다른 표현으로 다시 요청하세요.', 'Broaden the request or phrase it differently.']] },
  vehicle_moving: { title: ['주행 중에는 할 수 없어요', 'Not while driving'], what: ['차량이 이동 중이라 이 작업을 할 수 없습니다.', 'The car is moving, so this cannot be done now.'], next: [['도착하거나 이동을 취소한 뒤 다시 시도하세요.', 'Arrive or cancel the journey, then try again.']] },
  journey_changed: { title: ['이동 정보가 바뀌었어요', 'The journey changed'], what: ['진행 중인 이동이 바뀌었거나 만료됐습니다.', 'The current journey changed or expired.'], next: [['지도에서 최신 이동 상태를 확인하세요.', 'Check the latest journey on the map.']] },
  vehicle_fault_active: { title: ['먼저 차량 진단이 필요해요', 'Run a diagnosis first'], what: ['확인되지 않은 차량 경고가 있어 충전을 시작하지 않았습니다.', 'A vehicle warning is active, so charging was not started.'], next: [['차량 진단에서 경고를 확인하세요.', 'Review the warning in Vehicle diagnosis.']] },
  charge_limit_reached: { title: ['충전 한도에 도달했어요', 'Charge limit reached'], what: ['배터리가 이미 설정한 충전 한도 이상입니다.', 'The battery is already at or above your charge limit.'], next: [['충전 한도를 올린 뒤 다시 시작하세요.', 'Raise the charge limit, then start again.']] },
  not_charging: { title: ['충전 중이 아니에요', 'Not charging'], what: ['현재 충전 세션이 없습니다.', 'There is no active charging session.'], next: [['차량 상태를 새로고침하세요.', 'Refresh the vehicle state.']] },
  control_value_invalid: { title: ['설정값을 확인해 주세요', 'Check the value'], what: ['허용 범위를 벗어난 값입니다.', 'The value is outside the allowed range.'], next: [['온도는 16–28°C, 충전 한도는 50–100%입니다.', 'Temperature is 16–28°C; charge limit is 50–100%.']] },
  call_ai_not_configured: { title: ['통화 대행을 쓸 수 없어요', 'Call handling is unavailable'], what: ['AI 모델 연결이 설정되지 않았습니다.', 'The AI model is not configured.'], next: [['관리자에게 모델 연결을 요청하세요.', 'Ask the administrator to enable the model.']] },
  call_changed: { title: ['통화 상태가 바뀌었어요', 'The call changed'], what: ['통화가 이미 종료됐거나 다른 단계로 넘어갔습니다.', 'The call already ended or moved on.'], next: [['최신 통화 상태를 확인하세요.', 'Check the latest call state.']] },
  call_active: { title: ['이미 통화 중이에요', 'Already on a call'], what: ['진행 중인 통화가 있어 새 전화를 받을 수 없습니다.', 'A call is in progress, so a new one cannot start.'], next: [['현재 통화를 끝낸 뒤 다시 시도하세요.', 'End the current call first.']] },
  call_turn_limit: { title: ['대화가 길어졌어요', 'The call is getting long'], what: ['한 통화에서 주고받을 수 있는 대화 수에 도달했습니다.', 'This call reached its turn limit.'], next: [['통화를 종료하면 My Aide가 요약해 드립니다.', 'End the call and My Aide will summarize it.']] },
  followup_changed: { title: ['이미 처리된 항목이에요', 'Already handled'], what: ['이 후속 작업은 이미 처리되었습니다.', 'This follow-up was already handled.'], next: [['통화 기록에서 상태를 확인하세요.', 'Check it in your call history.']] },
  vehicle_ai_not_configured: { title: ['AI 진단을 쓸 수 없어요', 'AI diagnosis is unavailable'], what: ['진단 모델이 설정되지 않았습니다. 증상은 기록됐습니다.', 'The diagnosis model is not configured. The symptom was recorded.'], next: [['관리자에게 문의하세요.', 'Contact the administrator.']] },
  runbook_guard_refused: { title: ['안전 확인에서 멈췄어요', 'Stopped by the safety check'], what: ['현재 차량 조건에서는 자동 조치가 안전하지 않다고 판단했습니다.', 'The safety check judged the remedy unsafe in the current conditions.'], next: [['차량 진단의 근거를 확인하고 필요하면 서비스 센터에 문의하세요.', 'Review the evidence in Vehicle diagnosis and contact service if needed.']] },
  recovery_guide_changed: { title: ['복구 가이드가 만료됐어요', 'The recovery guide expired'], what: ['차량 상태가 바뀌어 이전 가이드를 쓸 수 없습니다.', 'The car changed, so the earlier guide no longer applies.'], next: [['진단을 다시 확인하세요.', 'Check the diagnosis again.']] },
  operator_required: { title: ['권한이 필요해요', 'Permission needed'], what: ['이 작업을 할 권한이 없습니다.', 'You do not have permission for this action.'], next: [['계정 권한을 확인하세요.', 'Check your account permissions.']] },
  reviewer_required: { title: ['승인 권한이 필요해요', 'Approval permission needed'], what: ['승인과 정책 변경은 검토자 권한이 필요합니다.', 'Approvals and policy changes need the reviewer role.'], next: [['검토 권한이 있는 계정으로 진행하세요.', 'Continue with a reviewer account.']] },
};
const fallback: Entry = { title: ['요청을 마치지 못했어요', 'The request did not finish'], what: ['결과를 확인하지 못했습니다. 자동으로 다시 실행하지 않았습니다.', 'The outcome could not be confirmed. Nothing was retried automatically.'],
  next: [['최신 상태를 확인하세요.', 'Check the latest state.'], ['문제가 계속되면 아래 오류 코드를 알려 주세요.', 'If it keeps happening, share the error code below.']] };

/** Error popup: a one-line message first, the manual page for the code on request. */
export default function ErrorManual({ code, onDismiss, onRefresh }: { code?: string; onDismiss: () => void; onRefresh: () => void }) {
  const { t } = useLanguage(), [open, setOpen] = useState(false), entry = (code && manual[code]) || fallback;
  return <Dialog open={!!code} title={t(...entry.title)} closeLabel={t('닫기', 'Close')} onDismiss={() => { setOpen(false); onDismiss(); }}>
    <div className="aide-error-manual">
      <p>{t(...entry.what)}</p>
      {open ? <section aria-label={t('설명서', 'Manual')}><h3><Icon name="book" size={18} />{t('이렇게 해 보세요', 'What to do')}</h3><ol>{entry.next.map(step => <li key={step[1]}>{t(...step)}</li>)}</ol>
        <p className="aide-error-code">{t('오류 코드', 'Error code')} · <code>{code ?? 'unknown'}</code></p></section> : null}
      <div className="ops-actions"><Button icon="book" onClick={() => setOpen(!open)}>{open ? t('설명서 닫기', 'Hide manual') : t('설명서 보기', 'View manual')}</Button>
        <Button variant="filled" icon="refresh" onClick={() => { setOpen(false); onDismiss(); onRefresh(); }}>{t('최신 상태 확인', 'Check latest state')}</Button></div>
    </div>
  </Dialog>;
}
