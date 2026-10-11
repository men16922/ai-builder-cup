import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useConsoleSlots } from '../../components/console-slots';
import { useLanguage } from '../../i18n';
import { Banner, Button, Card, Stack } from '../../ui';
import { AgentClient } from './agent-client';
import Assistant from './Assistant';
import { consoleNav } from './console-nav';
import Dashboard from './Dashboard';
import { createRehearsal } from './rehearsal';

/**
 * The signed-out console: the same frame as the signed-in one, driven by a scripted crew with synthetic data.
 * Nothing here reaches a server, so it says so on screen. Signing in swaps it for the real crew.
 */
export default function RehearsalConsole({ onSignIn, status }: { onSignIn?: () => void; status?: ReactNode }) {
  const { t, language } = useLanguage();
  const rehearsal = useMemo(() => createRehearsal(), []), agents = useMemo(() => new AgentClient(rehearsal.agentCall, 1200), [rehearsal]);
  const board = useSyncExternalStore(agents.subscribe, agents.getSnapshot);
  const [view, setView] = useState('overview');
  useEffect(() => { agents.open(); void agents.load(); return () => agents.close(); }, [agents]);
  const pending = board.items.filter(item => item.state === 'awaiting_approval' && item.approval && Date.parse(item.approval.expiresAt) > Date.now()).length;
  useConsoleSlots({ assistant: <Assistant agents={agents} />, assistantLabel: 'Gemini', pendingDecisions: pending, onSignIn, signInLabel: t('Google로 로그인', 'Sign in with Google'),
    nav: { active: view, onSelect: setView, groups: consoleNav(t, { pending, plans: true, services: [{ id: 'shop-api', label: 'shop-api' }] }) } }, `rehearsal|${pending}|${view}|${language}|${!!onSignIn}`);
  return <>
    <Banner type="info" header={t('체험 모드 · 합성 데이터', 'Rehearsal mode · synthetic data')} action={onSignIn ? <Button variant="filled" onClick={onSignIn}>{t('Google로 로그인', 'Sign in with Google')}</Button> : undefined}>
      {t('로그인 전에는 스크립트로 움직이는 예시 크루입니다. 실제 에이전트, 모델, Google 호출은 없고 모든 값은 예시입니다. 오른쪽 Gemini 버튼으로 지시해 보세요. 실제 크루는 허용된 계정으로 로그인하면 동작합니다.',
        'Before you sign in this is a scripted example crew. There are no live agents, no model and no Google calls, and every value is an example. Try an instruction from the Gemini button on the right. The real crew runs after you sign in with an allowed account.')}
    </Banner>
    {status}
    {view === 'overview' ? <Dashboard client={rehearsal} agents={agents} /> : <Card title={t('로그인하면 열립니다', 'Available after sign-in')}><Stack>
      <p>{t('서비스, 근거 수집, 계획은 허용된 계정으로 로그인한 실제 콘솔에서 동작합니다. 체험 모드에서는 개요와 에이전트 패널만 보여 줍니다.', 'Services, evidence collection and plans work in the real console after you sign in with an allowed account. The rehearsal shows only the overview and the agent panel.')}</p>
      {onSignIn ? <div><Button variant="filled" onClick={onSignIn}>{t('Google로 로그인', 'Sign in with Google')}</Button></div> : null}
    </Stack></Card>}
  </>;
}
