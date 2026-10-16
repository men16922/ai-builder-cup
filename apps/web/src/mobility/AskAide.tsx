import { useState, useSyncExternalStore } from 'react';
import type { AssistTurn } from '@contracts/gcp/mobility';
import { useLanguage } from '../i18n';
import { Button, Icon, type IconName } from '../ui';
import type { MobilityClient } from './mobility-client';

type Proposal = AssistTurn['proposals'][number];
/** Same glyphs as the matching vehicle controls, so a proposal reads as the control it will run. */
const proposalIcon = (proposal: Proposal): IconName => proposal.kind === 'trip'
  ? proposal.tripKind === 'charging' ? 'bolt' : proposal.tripKind === 'restaurant' ? 'restaurant' : 'navigation'
  : ({ lock: 'lock', unlock: 'lock_open', climate_on: 'fan', climate_off: 'fan', set_temperature: 'fan', set_charge_limit: 'bolt', start_charging: 'bolt', stop_charging: 'stop', flash: 'light', honk: 'volume' } as const)[proposal.action];
/** Ask your own Aide: My Aide answers and proposes catalog actions. Only the driver's tap runs one. */
export default function AskAide({ client, onTrip }: { client: MobilityClient; onTrip: (kind: 'restaurant'|'charging'|'poi', instruction: string) => void }) {
  const { t, language } = useLanguage(), board = useSyncExternalStore(client.subscribe, client.getSnapshot), assist = board.state?.assist;
  const [text, setText] = useState(''), [done, setDone] = useState<string[]>([]);
  const label = (proposal: Proposal) => {
    if (proposal.kind === 'trip') return proposal.tripKind === 'charging' ? t('충전소 찾아 안내', 'Find a charger and go') : proposal.tripKind === 'restaurant' ? t('식당 찾아 안내', 'Find a restaurant and go') : t('장소 찾아 안내', 'Find a place and go');
    const names: Record<string, [string, string]> = { lock: ['문 잠그기', 'Lock doors'], unlock: ['문 열기', 'Unlock doors'], climate_on: ['공조 켜기', 'Turn on climate'], climate_off: ['공조 끄기', 'Turn off climate'],
      set_temperature: [`희망 온도 ${proposal.value}°`, `Set cabin to ${proposal.value}°`], set_charge_limit: [`충전 한도 ${proposal.value}%`, `Charge limit ${proposal.value}%`], start_charging: ['충전 시작', 'Start charging'],
      stop_charging: ['충전 중지', 'Stop charging'], flash: ['라이트 깜빡이기', 'Flash lights'], honk: ['경적 울리기', 'Honk'] };
    return t(...names[proposal.action]);
  };
  const run = async (proposal: Proposal, key: string) => {
    if (proposal.kind === 'trip') { onTrip(proposal.tripKind, proposal.instruction); return; }
    await client.command({ operation: 'control', action: proposal.action, ...(proposal.value === undefined ? {} : { value: proposal.value }) });
    if (!client.getSnapshot().error) setDone(previous => [...previous, key]);
  };
  const ask = async () => { if (!text.trim()) return; setDone([]); await client.command({ operation: 'assist', text: text.trim(), language }); if (!client.getSnapshot().error) setText(''); };
  return <section className="aide-ask" aria-label={t('나만의 Aide에게 부탁하기', 'Ask your own Aide')}>
    <form className="aide-ask-form" onSubmit={event => { event.preventDefault(); void ask(); }}>
      <span className="aide-ask-mark" aria-hidden="true"><Icon name="sparkle" size={22} /></span>
      <label className="aide-sr" htmlFor="ask-aide">{t('나만의 Aide에게 부탁하세요', 'Ask your own Aide')}</label>
      <input id="ask-aide" value={text} maxLength={300} disabled={board.busy} onChange={event => setText(event.target.value)}
        placeholder={t('나만의 Aide에게 부탁하세요 — 예: 출발 전에 20도로 시원하게 해줘', 'Ask your own Aide — e.g. cool the car to 20° before I leave')} />
      <Button variant="filled" icon="send" loading={board.busy} disabled={!text.trim()} onClick={() => void ask()}>{t('부탁하기', 'Ask')}</Button>
    </form>
    {assist ? <div className="aide-ask-answer" aria-live="polite">
      <p><strong>My Aide</strong> {assist.reply}</p>
      {assist.proposals.length ? <div className="aide-ask-proposals">{assist.proposals.map((proposal, index) => { const key = `${assist.id}:${index}`;
        return done.includes(key) ? <span key={key} className="aide-ask-done"><Icon name="success" size={16} />{label(proposal)} · {t('완료 · 시뮬레이션', 'done · simulated')}</span>
          : <Button key={key} variant="tonal" disabled={board.busy} icon={proposalIcon(proposal)} onClick={() => void run(proposal, key)}>{label(proposal)}</Button>; })}</div> : null}
      <span className="ops-caption">{t('제안은 누르기 전에는 실행되지 않습니다.', 'Nothing runs until you tap a proposal.')}</span>
    </div> : null}
  </section>;
}
