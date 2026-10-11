import { type ReactNode } from 'react';
import { Icon, Spinner, StatusChip, type IconName } from '../ui';
import type { AgentStep, AgentTaskState } from '@contracts/gcp/agent';

export type Chip = Parameters<typeof StatusChip>[0]['type'];
export const chipFor: Record<AgentTaskState, Chip> = { working: 'pending', awaiting_approval: 'warning', deciding: 'pending', completed: 'success', rejected: 'info', failed: 'error', unknown: 'warning' };

/** Minimal, safe rendering of the crew's report: headings, bullets and bold only, always as text nodes. */
export function Report({ text }: { text: string }) {
  const inline = (line: string): ReactNode[] => line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => part.startsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part.startsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : part);
  const blocks: ReactNode[] = []; let bullets: string[] = [];
  const flush = () => { if (bullets.length) { blocks.push(<ul key={blocks.length}>{bullets.map((item, index) => <li key={index}>{inline(item)}</li>)}</ul>); bullets = []; } };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^[-*]\s+/.test(line)) { bullets.push(line.replace(/^[-*]\s+/, '')); continue; }
    flush();
    if (/^#{1,4}\s+/.test(line)) blocks.push(<h3 key={blocks.length}>{line.replace(/^#{1,4}\s+/, '')}</h3>);
    else if (line) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="ops-report">{blocks}</div>;
}

/** The state of an approved change, read from the Chief's result step (the gateway writes it as "state" or "state: reason"). */
export type ExecutionState = 'refused' | 'pending' | 'applied' | 'failed' | 'unknown';
const executionChip: Record<ExecutionState, Chip> = { applied: 'success', pending: 'pending', unknown: 'warning', failed: 'error', refused: 'info' };
export function executionState(step: AgentStep): ExecutionState | undefined {
  if (step.name !== 'propose_rollback' || step.kind !== 'result') return undefined;
  const match = /^(refused|pending|applied|failed|unknown)(?::|$)/.exec(step.summary);
  return match ? match[1] as ExecutionState : undefined;
}
export const executionLabels = (t: (ko: string, en: string) => string): Record<ExecutionState, string> => ({
  applied: t('적용됨 · 확인됨', 'Applied and confirmed'), pending: t('진행 중 · 아직 끝나지 않음', 'In progress, not finished'), unknown: t('결과 미확인', 'Outcome unknown'),
  failed: t('적용 실패', 'Not applied: failed'), refused: t('거절됨 · 변경 없음', 'Refused, nothing changed') });

const agentIcon: Record<string, IconName> = { ops: 'search', diagnosis: 'info', guardian: 'warning', chief: 'sparkle' };
export function Timeline({ steps, working, labels }: { steps: AgentStep[]; working: boolean; labels: Record<string, string> }) {
  return <ol className="ops-timeline" aria-label={labels.timeline}>
    {steps.map((step, index) => <li key={index} className={`ops-agent-${step.agent}`}>
      <span className="ops-agent-badge"><Icon name={agentIcon[step.agent] ?? 'info'} size={16} /></span>
      <div><strong>{labels[step.agent] ?? step.agent}</strong><span className="ops-step-kind">{step.kind === 'call' ? labels.asked : labels.answered}</span><p>{step.summary || step.name}</p>{(() => { const state = executionState(step); return state ? <StatusChip type={executionChip[state]}>{labels[`exec_${state}`]}</StatusChip> : null; })()}</div>
    </li>)}
    {working ? <li className="ops-agent-working"><Spinner label={labels.working} /><div><strong>{labels.working}</strong></div></li> : null}
  </ol>;
}


export const agentLabels = (t: (ko: string, en: string) => string): Record<string, string> => ({ timeline: t('에이전트 진행 단계', 'Crew progress'), ops: 'Ops', diagnosis: 'Diagnosis', guardian: 'Guardian', chief: 'Chief',
  ...Object.fromEntries(Object.entries(executionLabels(t)).map(([key, value]) => [`exec_${key}`, value])), asked: t('요청', 'asked'), answered: t('응답', 'answered'), working: t('팀이 일하는 중…', 'The crew is working…') });
export const stateLabels = (t: (ko: string, en: string) => string): Record<AgentTaskState, string> => ({ working: t('일하는 중', 'Working'), awaiting_approval: t('내 결정 필요', 'Needs your decision'), deciding: t('결정을 전달하는 중', 'Applying your decision'),
  completed: t('완료', 'Done'), rejected: t('거절함', 'Rejected'), failed: t('실패', 'Failed'), unknown: t('결과 미확인', 'Outcome unknown') });
export const agentErrors = (t: (ko: string, en: string) => string): Record<string, string> => ({ reviewer_required: t('승인은 검토자 역할이 필요합니다.', 'Approving needs the reviewer role.'), operator_required: t('지시에는 운영자 역할이 필요합니다.', 'Sending an instruction needs the operator role.'),
  approval_expired: t('승인 시간이 지났습니다. 다시 지시하세요.', 'The approval window passed. Ask again.'), not_awaiting_approval: t('이미 처리된 요청입니다.', 'This request was already handled.'),
  agents_not_configured: t('에이전트 팀이 연결되어 있지 않습니다.', 'The agent crew is not connected.') });
