import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react';
import { useConsole } from '../shell/console-slots';
import { useLanguage } from '../i18n';
import { Banner, Button, Details, Icon, IconButton, StatusChip } from '../ui';
import { agentErrors, agentLabels, chipFor, Report, stateLabels, Timeline } from './agent-parts';
import type { AgentClient } from './agent-client';
import type { AgentTask } from '@contracts/gcp/agent';

/** The right-hand crew assistant: a conversation where every instruction shows its progress, any decision it needs, and its report. */
export default function Assistant({ agents }: { agents: AgentClient }) {
  const { t, language, locale } = useLanguage(), consoleContext = useConsole();
  const board = useSyncExternalStore(agents.subscribe, agents.getSnapshot);
  const [text, setText] = useState(''), thread = useRef<HTMLDivElement>(null), field = useRef<HTMLTextAreaElement>(null);
  const labels = agentLabels(t), states = stateLabels(t), errors = agentErrors(t);
  const tasks = [...board.items].reverse().slice(-6);
  const examples = [t('shop-api 결제가 실패한다는 신고가 있어요. 확인하고 처리해 줘.', 'Customers report that shop-api checkout is failing. Investigate and handle it.'), t('shop-api 상태를 점검하고 요약해 줘.', 'Check shop-api and summarize its health.')];
  const send = (value: string) => { const instruction = value.trim(); if (!instruction || board.busy) return; void agents.send(instruction, language); setText(''); };
  // A question typed into the top bar arrives as a draft and is sent as soon as the panel opens.
  const draft = consoleContext?.draft;
  useEffect(() => { if (draft) { consoleContext?.setDraft(''); send(draft); } }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: 'smooth' }); }, [board.items, board.selectedId]);
  const time = (value: string) => new Date(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const submit = (event: FormEvent) => { event.preventDefault(); send(text); };
  const key = (event: KeyboardEvent) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(text); } };

  function Turn({ task }: { task: AgentTask }) {
    const approval = task.approval, active = task.state === 'working' || task.state === 'deciding';
    const minutes = approval ? Math.max(0, Math.ceil((Date.parse(approval.expiresAt) - Date.now()) / 60000)) : 0, seconds = Math.max(1, Math.round((Date.parse(task.updatedAt) - Date.parse(task.createdAt)) / 1000));
    return <article className="ops-turn" aria-label={task.instruction.slice(0, 60)}>
      <div className="ops-bubble ops-user">{task.instruction}</div>
      <div className="ops-reply">
        <div className="ops-reply-head"><span className="ops-gem"><Icon name="sparkle" size={16} /></span><strong>{'My Aide'}</strong><StatusChip type={chipFor[task.state]}>{states[task.state]}</StatusChip><span className="ops-caption">{time(task.updatedAt)}</span></div>
        {task.steps.length || active ? <Details summary={active ? t(`진행 중 · 단계 ${task.steps.length}`, `Working · ${task.steps.length} steps`) : t(`단계 ${task.steps.length}개 · ${seconds}초`, `${task.steps.length} steps · ${seconds}s`)} open={active || task.state === 'awaiting_approval'}><Timeline steps={task.steps} working={active} labels={labels} /></Details> : null}
        {approval && task.state === 'awaiting_approval' ? <section className="ops-approval ops-approval-compact" aria-label={t('승인 요청', 'Approval request')}>
          <div className="ops-approval-head"><Icon name="warning" size={20} /><strong>{t('당신의 결정이 필요합니다', 'Your decision is needed')}</strong><StatusChip type="warning">{t('위험도', 'Risk')}: {approval.risk}</StatusChip></div>
          <p className="ops-approval-action">{t(`${approval.action.service}의 트래픽 100%를 ${approval.action.revision} 리비전으로 되돌립니다.`, `Send 100% of ${approval.action.service} traffic back to revision ${approval.action.revision}.`)}</p>
          <p>{approval.reason}</p>
          {approval.reviewed?<div className="ops-reviewed-state"><p className="ops-caption">{t('검토한 서비스 상태','Reviewed service state')} · {time(approval.reviewed.observedAt)}</p>
            {approval.reviewed.traffic.map((split,index)=><p className="ops-caption" key={index}>{split.revision} · {split.percent}%</p>)}</div>:<p>{t('검토한 서비스 상태가 없습니다. 새 조사를 요청하세요.','The reviewed service state is missing. Request a new investigation.')}</p>}
          <p className="ops-caption">{t(`되돌릴 수 있고 리비전을 삭제하지 않습니다. ${minutes}분 안에 결정하세요.`, `Reversible; nothing is deleted. Decide within ${minutes} min.`)}</p>
          <div className="ops-actions"><Button variant="filled" loading={board.busy} disabled={!approval.reviewed} onClick={() => void agents.decide(task.id, 'approve')}>{t('승인하고 실행', 'Approve and apply')}</Button><Button disabled={board.busy} onClick={() => void agents.decide(task.id, 'reject')}>{t('거절', 'Reject')}</Button></div>
        </section> : null}
        {task.note ? <Banner type={task.state === 'failed' ? 'error' : 'warning'}>{task.note}</Banner> : null}
        {task.result ? <Report text={task.result} /> : null}
      </div>
    </article>;
  }

  return <div className="ops-chat">
    <div className="ops-thread" ref={thread} role="log" aria-live="polite" aria-label={t('My Aide 대화', 'Conversation with My Aide')}>
      {tasks.length ? tasks.map(task => <Turn key={task.id} task={task} />) : <div className="ops-welcome">
        <span className="ops-gem ops-gem-large"><Icon name="sparkle" size={30} /></span>
        <h2>{t('무엇을 챙겨 드릴까요?', 'What can your Aide take care of?')}</h2>
        <p>{t('한 문장으로 부탁하세요. My Aide가 전문 팀과 조사·진단하고, 큰 결정만 당신에게 묻습니다.', 'Say it in one sentence. My Aide works with its specialist team to investigate and diagnose, and only asks you for the big decisions.')}</p>
        <div className="ops-suggestions" role="group" aria-label={t('지시 예시', 'Example instructions')}>{examples.map(example => <Button key={example} variant="tonal" onClick={() => { setText(example); field.current?.focus(); }}>{example}</Button>)}</div>
      </div>}
      {board.error ? <Banner type="error">{errors[board.error] ?? t('요청을 처리하지 못했습니다. 잠시 뒤 다시 시도하세요.', 'The request could not be completed. Try again shortly.')}</Banner> : null}
    </div>
    <form className="ops-composer" onSubmit={submit}>
      <textarea ref={field} rows={1} value={text} maxLength={1000} placeholder={t('나만의 Aide에게 부탁하세요…', 'Ask your own Aide…')} aria-label={t('지시', 'Instruction')} onChange={event => setText(event.target.value)} onKeyDown={key} />
      <IconButton icon="send" label={t('부탁하기', 'Ask Aide')} onClick={event => { event.preventDefault(); send(text); }} />
    </form>
  </div>;
}
