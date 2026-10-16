import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { VehicleCall } from '@contracts/gcp/mobility';
import { useLanguage } from '../i18n';
import { Button, Icon, StatusChip } from '../ui';
import type { MobilityClient } from './mobility-client';
import CallUnconfirmed from './CallUnconfirmed';

const scenarios = ['meeting_reschedule', 'family_pickup', 'delivery'] as const;
/** Simulated incoming calls. Each caller is fictional and voiced by the model. */
export function CallScenarios({ client, compact = false }: { client: MobilityClient; compact?: boolean }) {
  const { t, language } = useLanguage(), board = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const label = { meeting_reschedule: t('팀장님 · 회의 일정', 'Team lead · meeting'), family_pickup: t('엄마 · 아이 픽업', 'Mom · school pickup'), delivery: t('택배 기사 · 배송', 'Courier · delivery') };
  const live = board.state?.call && ['ringing', 'active'].includes(board.state.call.state);
  return <div className={`aide-call-scenarios${compact ? ' is-compact' : ''}`}>{scenarios.map(scenario =>
    <Button key={scenario} icon="phone" disabled={(board.busy || !!board.callBusy) || !!live || !board.state?.vehicle} onClick={() => void client.command({ operation: 'call_incoming', scenario, language })}>{label[scenario]}</Button>)}</div>;
}

function speak(text: string, language: 'ko' | 'en', role: VehicleCall['turns'][number]['role']) {
  try {
    const synth = window.speechSynthesis; if (!synth) return;
    const utterance = new SpeechSynthesisUtterance(text); utterance.lang = language === 'ko' ? 'ko-KR' : 'en-US';
    utterance.pitch = role === 'aide' ? 1.15 : .9; utterance.rate = 1.05; synth.speak(utterance);
  } catch { /* Voice is optional; the transcript stays authoritative. */ }
}
const readVoice = () => { try { return localStorage.getItem('aide-call-voice') !== 'off'; } catch { return true; } };

/** Incoming call, live call sheet and the post-call summary. My Aide drafts; only an explicit tap marks a follow-up done. */
export default function CallCenter({ client }: { client: MobilityClient }) {
  const { t } = useLanguage(), board = useSyncExternalStore(client.subscribe, client.getSnapshot), call = board.state?.call;
  const [draft, setDraft] = useState(''), [voice, setVoice] = useState(readVoice), [closed, setClosed] = useState(''), [now, setNow] = useState(Date.now());
  const spoken = useRef<{ id: string; count: number }>({ id: '', count: 0 }), log = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!call || call.state !== 'active') return;
    const fresh = spoken.current.id === call.id ? call.turns.slice(spoken.current.count) : call.turns;
    spoken.current = { id: call.id, count: call.turns.length };
    if (voice) fresh.filter(turn => turn.role !== 'driver').forEach(turn => speak(turn.text, call.language, turn.role));
    log.current?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [call?.id, call?.turns.length, call?.state, voice]);
  useEffect(() => { if (call?.state !== 'active') return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [call?.state]);
  useEffect(() => () => { try { window.speechSynthesis?.cancel(); } catch { /* optional */ } }, []);
  if (!call || call.state === 'declined' || call.state === 'unknown' && closed === call.id || call.state === 'ended' && (closed === call.id || !call.summary)) return null;
  if (call.state === 'unknown') return <CallUnconfirmed call={call} onRefresh={() => void client.load()} onDismiss={() => setClosed(call.id)}/>;
  const send = async (text: string) => { if (!text.trim()) return; setDraft(''); await client.command({ operation: 'call_say', callId: call.id, text: text.trim() }); };
  const toggleVoice = () => { const next = !voice; setVoice(next); try { localStorage.setItem('aide-call-voice', next ? 'on' : 'off'); if (!next) window.speechSynthesis?.cancel(); } catch { /* optional */ } };
  const seconds = Math.max(0, Math.round(((call.endedAt ? Date.parse(call.endedAt) : now) - Date.parse(call.startedAt)) / 1000));
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const autopilot = board.state?.journey?.state === 'moving' && board.state.journey.autopilot;
  const who = (role: string) => role === 'caller' ? call.caller.name : role === 'aide' ? 'My Aide' : t('나', 'You');

  if (call.state === 'ringing') return <section className="aide-call aide-call-ringing" role="dialog" aria-label={t(`${call.caller.name}님의 전화`, `Call from ${call.caller.name}`)}>
    <div className="aide-call-avatar is-ringing"><Icon name="phone" size={26} /></div>
    <div className="aide-call-who"><span>{t('수신 전화 · 시뮬레이션', 'Incoming call · simulated')}</span><strong>{call.caller.name}</strong><small>{call.caller.relation}</small></div>
    <div className="aide-call-actions">
      <Button variant="filled" icon="sparkle" loading={(board.busy || !!board.callBusy)} onClick={() => void client.command({ operation: 'call_answer', callId: call.id, handledBy: 'aide' })}>{t('My Aide가 받기', 'Let My Aide answer')}</Button>
      <Button icon="phone" disabled={(board.busy || !!board.callBusy)} onClick={() => void client.command({ operation: 'call_answer', callId: call.id, handledBy: 'driver' })}>{t('직접 받기', 'Answer')}</Button>
      <button type="button" className="aide-call-decline" aria-label={t('거절', 'Decline')} disabled={(board.busy || !!board.callBusy)} onClick={() => void client.command({ operation: 'call_decline', callId: call.id })}><Icon name="call_end" size={22} /></button>
    </div>
  </section>;

  if (call.state === 'active') return <section className="aide-call aide-call-sheet" role="dialog" aria-label={t('통화 중', 'On a call')}>
    <header className="aide-call-head">
      <div className="aide-call-avatar"><Icon name="phone" size={20} /></div>
      <div className="aide-call-who"><strong>{call.caller.name}</strong><span>{call.handledBy === 'aide' ? t('My Aide가 대신 통화 중', 'My Aide is on the call') : t('통화 중', 'On the call')} · {clock}</span></div>
      {autopilot ? <StatusChip type="info">{t('자율주행 시뮬레이션', 'Autopilot simulation')}</StatusChip> : null}
      <button type="button" className="aide-icon-button" aria-pressed={voice} aria-label={voice ? t('음성 끄기', 'Mute voice') : t('음성 켜기', 'Play voice')} onClick={toggleVoice}><Icon name={voice ? 'volume' : 'volume_off'} size={20} /></button>
      <button type="button" className="aide-call-decline" aria-label={t('통화 종료', 'End call')} disabled={(board.busy || !!board.callBusy)} onClick={() => void client.command({ operation: 'call_end', callId: call.id })}><Icon name="call_end" size={22} /></button>
    </header>
    {board.state?.journey?.state === 'moving' ? <div className="ops-actions"><Button icon="stop" disabled={board.busy} onClick={() => void client.command({ operation: 'stop', journeyId: board.state!.journey!.id })}>{t('이동 시뮬레이션 중지', 'Stop simulated drive')}</Button></div> : null}
    <ol className="aide-call-log" ref={log} aria-live="polite" tabIndex={0} aria-label={t("통화 내용", "Call transcript")}>{call.turns.map((turn, index) => <li key={index} className={`is-${turn.role}`}><span>{who(turn.role)}</span><p>{turn.text}</p></li>)}
      {(board.busy || !!board.callBusy) ? <li className="is-typing" aria-label={t('응답 중', 'Responding')}><span>{t('응답 중', 'Responding')}</span><p><i /><i /><i /></p></li> : null}</ol>
    <div className="aide-call-quick" role="group" aria-label={t('빠른 답변', 'Quick replies')} tabIndex={0}>{[t('네, 좋아요.', 'Sounds good.'), t('도착하면 다시 연락드릴게요.', "I'll call back when I arrive."), t('지금 운전 중이라 짧게 말할게요.', "I'm driving, so I'll keep it short.")].map(text =>
      <button key={text} type="button" disabled={(board.busy || !!board.callBusy) || call.turns.length > 13} onClick={() => void send(text)}>{text}</button>)}</div>
    <form className="aide-call-input" onSubmit={event => { event.preventDefault(); void send(draft); }}>
      <label className="aide-sr" htmlFor="call-reply">{t('직접 답하기', 'Reply yourself')}</label>
      <input id="call-reply" value={draft} maxLength={300} placeholder={t('직접 답하기…', 'Reply yourself…')} disabled={(board.busy || !!board.callBusy)} onChange={event => setDraft(event.target.value)} />
      <Button variant="filled" icon="send" disabled={(board.busy || !!board.callBusy) || !draft.trim()} onClick={() => void send(draft)}>{t('보내기', 'Send')}</Button>
      <Button icon="sparkle" disabled={(board.busy || !!board.callBusy) || call.turns.length > 13} onClick={() => void client.command({ operation: 'call_delegate', callId: call.id })}>{t('My Aide가 대신 답하기', 'Let My Aide reply')}</Button>
    </form>
  </section>;

  const summary = call.summary!;
  return <section className="aide-call aide-call-summary" role="dialog" aria-label={t('통화 요약', 'Call summary')}>
    <header className="aide-call-head"><div className="aide-call-avatar is-done"><Icon name="sparkle" size={20} /></div>
      <div className="aide-call-who"><strong>{t('My Aide 통화 요약', 'My Aide call summary')}</strong><span>{call.caller.name} · {clock}</span></div>
      <button type="button" className="aide-icon-button" aria-label={t('닫기', 'Close')} onClick={() => setClosed(call.id)}><Icon name="close" size={20} /></button></header>
    <p className="aide-call-summary-text">{summary.text}</p>
    {summary.actionItems.length ? <ul className="aide-call-items">{summary.actionItems.map(item => <li key={item}><Icon name="approvals" size={16} />{item}</li>)}</ul> : null}
    <Followups call={call} client={client} busy={(board.busy || !!board.callBusy)} />
    <div className="ops-actions">{call.saved ? <StatusChip type="success">{t('통화 기록에 저장됨', 'Saved to call history')}</StatusChip>
      : <Button variant="filled" icon="history" loading={(board.busy || !!board.callBusy)} onClick={() => void client.command({ operation: 'call_save', callId: call.id })}>{t('요약 저장', 'Save summary')}</Button>}
      <Button icon="close" onClick={() => setClosed(call.id)}>{t('닫기', 'Close')}</Button></div>
  </section>;
}

/** Drafts only. "Done" records a simulated send/booking; nothing reaches a real inbox or calendar. */
export function Followups({ call, client, busy }: { call: VehicleCall; client: MobilityClient; busy: boolean }) {
  const { t, locale } = useLanguage();
  if (!call.summary?.followups.length) return null;
  return <ul className="aide-followups">{call.summary.followups.map(item => <li key={item.id} className={`is-${item.status}`}>
    <Icon name={item.kind === 'message' ? 'chat' : item.kind === 'calendar' ? 'event' : 'pending'} size={20} />
    <div><strong>{item.title}</strong>{item.to ? <span>{t(`받는 사람: ${item.to}`, `To: ${item.to}`)}</span> : null}{item.when ? <span>{new Date(item.when).toLocaleString(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span> : null}
      {item.body ? <p>{item.body}</p> : null}</div>
    {item.status === 'draft' ? <div className="ops-actions">
      <Button icon={item.kind === 'message' ? 'send' : item.kind === 'calendar' ? 'event' : 'bell'} variant="tonal" disabled={busy} onClick={() => void client.command({ operation: 'followup', callId: call.id, followupId: item.id, action: 'done' })}>
        {item.kind === 'message' ? t('메시지 보내기', 'Send message') : item.kind === 'calendar' ? t('일정 추가', 'Add to calendar') : t('알림 설정', 'Set reminder')}</Button>
      <Button icon="close" variant="text" disabled={busy} onClick={() => void client.command({ operation: 'followup', callId: call.id, followupId: item.id, action: 'dismiss' })}>{t('무시', 'Dismiss')}</Button></div>
      : <StatusChip type={item.status === 'done' ? 'success' : 'pending'}>{item.status === 'done' ? t('완료 · 시뮬레이션', 'Done · simulated') : t('무시함', 'Dismissed')}</StatusChip>}
  </li>)}</ul>;
}

/** Saved calls with their summaries and follow-ups. */
export function CallHistory({ client }: { client: MobilityClient }) {
  const { t, locale } = useLanguage(), board = useSyncExternalStore(client.subscribe, client.getSnapshot), calls = board.state?.calls ?? [];
  return <div className="aide-call-history">
    <section className="ops-card aide-call-intro"><div><h2>{t('운전 중 전화는 My Aide에게', 'Calls while you drive, handled by My Aide')}</h2>
      <p>{t('My Aide가 대신 받아 용건을 듣고, 통화가 끝나면 요약과 답장·일정 초안을 준비합니다. 보내거나 추가하는 건 언제나 당신이 결정합니다.', 'My Aide answers, listens and, when the call ends, prepares a summary with reply and calendar drafts. Sending or adding is always your call.')}</p>
      <span className="ops-caption">{t('체험용 수신 전화 · 가상 발신자', 'Try an incoming call · fictional callers')}</span><CallScenarios client={client} /></div></section>
    {calls.length ? <ol className="aide-call-records">{calls.map(call => <li key={call.id} className="ops-card">
      <header><div className="aide-call-avatar is-done"><Icon name="phone" size={18} /></div><div><strong>{call.caller.name}</strong><span>{new Date(call.startedAt).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {call.handledBy === 'aide' ? t('My Aide가 받음', 'Handled by My Aide') : t('직접 통화', 'You answered')}</span></div></header>
      <p>{call.summary?.text}</p><Followups call={call} client={client} busy={(board.busy || !!board.callBusy)} /></li>)}</ol>
      : <p className="ops-caption">{t('저장한 통화 요약이 아직 없습니다.', 'No saved call summaries yet.')}</p>}
  </div>;
}
