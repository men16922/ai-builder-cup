import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useConsoleSlots } from '../../components/console-slots';
import { useLanguage } from '../../i18n';
import { Banner, Button } from '../../ui';
import { AgentClient } from './agent-client';
import Assistant from './Assistant';
import Dashboard from './Dashboard';
import { createRehearsal } from './rehearsal';

/** The signed-out way to try the crew: the same console, driven by a scripted crew with synthetic data. Nothing here reaches a server. */
export default function RehearsalConsole({ onExit }: { onExit: () => void }) {
  const { t, language } = useLanguage();
  const rehearsal = useMemo(() => createRehearsal(), []), agents = useMemo(() => new AgentClient(rehearsal.agentCall, 1200), [rehearsal]);
  const board = useSyncExternalStore(agents.subscribe, agents.getSnapshot);
  useEffect(() => { agents.open(); void agents.load(); return () => agents.close(); }, [agents]);
  const pending = board.items.filter(item => item.state === 'awaiting_approval' && item.approval && Date.parse(item.approval.expiresAt) > Date.now()).length;
  useConsoleSlots({ assistant: <Assistant agents={agents} />, assistantLabel: 'Gemini', user: t('체험 · 합성', 'Rehearsal · synthetic'), onSignOut: onExit, signOutLabel: t('체험 종료', 'Exit rehearsal'), pendingDecisions: pending,
    nav: { active: 'overview', onSelect: () => undefined, items: [{ id: 'overview', label: t('개요', 'Overview'), icon: 'dashboard' }] } }, `rehearsal|${pending}|${language}`);
  return <>
    <Banner type="info" header={t('스크립트 리허설 · 합성 데이터', 'Scripted rehearsal · synthetic data')} action={<Button onClick={onExit}>{t('체험 종료', 'Exit rehearsal')}</Button>}>
      {t('로그인 없이 흐름을 체험합니다. 실제 에이전트, 모델, Google 호출은 없고 모든 값은 예시입니다. 실제 크루는 로그인한 콘솔에서 동작합니다.', 'Try the flow without signing in. There are no live agents, no model and no Google calls here, and every value is an example. The real crew runs in the signed-in console.')}
    </Banner>
    <Dashboard client={rehearsal} agents={agents} />
  </>;
}
