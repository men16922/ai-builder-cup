import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n';
import { Button, Card, Icon, StatusChip } from '../ui';
import type { GcpObservationClient } from './observation-client';

type Card = { name: string; description: string; version?: string; protocolVersion?: string; preferredTransport?: string;
  capabilities: { streaming: boolean; pushNotifications: boolean; stateTransitionHistory: boolean }; defaultInputModes: string[]; defaultOutputModes: string[];
  skills: { id: string; name: string; description: string; tags: string[] }[] };
type Platform = { agentCard: Card | null; cardState: 'live' | 'unavailable' | 'not_configured'; fetchedAt?: string;
  facts: { modelId: string; modelLocation: string; crew: string[]; mapsMcp: boolean; placesPhotos: boolean; agents: boolean };
  usage: { model: number; places: number; modelLimit: number; placesLimit: number; resetsAt: string } | null };

/** Operator view of how My Aide is built: live A2A card, topology, enforced guardrails and this hour's budget. */
export default function PlatformPanel({ client }: { client: GcpObservationClient }) {
  const { t, locale } = useLanguage(), [view, setView] = useState<Platform>(), [failed, setFailed] = useState(false), [busy, setBusy] = useState(false);
  const load = async () => { setBusy(true); setFailed(false); try { setView(await client.agentCall('/platform') as Platform); } catch { setFailed(true); } finally { setBusy(false); } };
  useEffect(() => { void load(); }, [client]);
  const card = view?.agentCard;
  const guardrails: [string, string][] = [
    ['에이전트는 타입이 정해진 도구만 고릅니다. 자격증명, 실행 코드, IAM 변경은 받지 않습니다.', 'Agents choose typed tools only; they never receive credentials, write execution code or change IAM.'],
    ['변경은 Guardian 판정과 검토된 상태(UID·etag·시각)에 묶인 1회용 사람 승인이 필요합니다.', 'Every change needs a Guardian verdict and a single-use human approval bound to the reviewed UID, etag and time.'],
    ['결과가 불확실하면 자동으로 다시 보내지 않습니다. 같은 요청 키는 같은 결과만 돌려줍니다.', 'Unknown outcomes are never resent automatically; a replayed request key returns the same result.'],
    ['차량은 사용자별 서버 시뮬레이션입니다. 실제 차량 제어 API는 계약에 존재하지 않습니다.', 'The vehicle is a per-user server simulation; the contract cannot address a real vehicle control API.'],
    ['통화 발신자는 가상이며 모델은 대사만 만듭니다. 메시지·일정은 초안이고 사용자의 탭으로만 처리됩니다.', 'Callers are fictional and the model only writes lines; messages and events stay drafts until the driver taps.'],
    ['외부 호출(Gemini, Maps)은 저장 트랜잭션 밖에서, 요청 전에 예약된 시간당 한도 안에서만 실행됩니다.', 'External calls (Gemini, Maps) run outside store transactions, within an hourly budget reserved before the call.'],
    ['장소와 사진은 Google 결과만 사용하고 출처를 표시합니다. 결과가 없으면 만들어 내지 않습니다.', 'Places and photos come only from Google with attribution; nothing is invented when results are missing.'],
    ['신원·조직·역할은 서버에서 검증합니다. 표시 언어는 권한을 바꾸지 않습니다.', 'Identity, organization and roles are verified server-side; display language never changes authority.'],
  ];
  const meter = (used: number, limit: number) => <span className="aide-platform-meter"><span style={{ width: `${Math.min(100, used / limit * 100)}%` }} /></span>;
  return <div className="aide-platform">
    <header className="ops-page-header"><div><span className="aide-eyebrow">MY AIDE PLATFORM</span><h1>{t('플랫폼과 프로토콜', 'Platform and protocols')}</h1></div>
      <Button icon="refresh" loading={busy} onClick={() => void load()}>{t('새로고침', 'Refresh')}</Button></header>
    {failed ? <p role="alert" className="ops-caption">{t('플랫폼 정보를 불러오지 못했습니다. 다시 시도하세요.', 'Platform details could not be loaded. Try again.')}</p> : null}
    <Card title={t('My Aide가 일하는 방식', 'How My Aide works')} description={t('운전자 앱 하나 뒤에서 여러 전문 에이전트가 A2A로 협업하고, 변경은 언제나 안전 확인과 사람의 결정을 거칩니다.', 'Behind one driver app, specialist agents collaborate over A2A; every change passes a safety check and a human decision.')}>
      <svg className="aide-architecture" viewBox="0 0 960 360" role="img" aria-label={t('My Aide 아키텍처: 앱, 게이트웨이, A2A 에이전트, Google API', 'My Aide architecture: apps, gateway, A2A agents and Google APIs')}>
        <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" className="aide-arch-arrowhead" /></marker></defs>
        <g className="aide-arch-node"><rect x="20" y="40" width="150" height="70" rx="14" /><text x="95" y="70">{t('Android 앱', 'Android app')}</text><text x="95" y="92" className="sub">Kotlin · Compose</text></g>
        <g className="aide-arch-node"><rect x="20" y="140" width="150" height="70" rx="14" /><text x="95" y="170">{t('웹 콘솔', 'Web console')}</text><text x="95" y="192" className="sub">React · Material 3</text></g>
        <g className="aide-arch-node is-core"><rect x="250" y="70" width="190" height="120" rx="16" /><text x="345" y="104">Aide Gateway</text><text x="345" y="128" className="sub">Cloud Run · TypeScript</text><text x="345" y="150" className="sub">Firebase Auth · Firestore</text><text x="345" y="172" className="sub">{t('예산·영수증·버전 펜스', 'budgets · receipts · version fences')}</text></g>
        <g className="aide-arch-node is-agent"><rect x="530" y="40" width="160" height="64" rx="14" /><text x="610" y="68">Chief</text><text x="610" y="90" className="sub">ADK · A2A server</text></g>
        {[['Diagnosis', 760, 10], ['Guardian', 760, 80], ['Ops', 760, 150]].map(([name, x, y]) => <g key={name} className="aide-arch-node is-agent"><rect x={Number(x)} y={Number(y)} width="170" height="54" rx="14" /><text x={Number(x) + 85} y={Number(y) + 33}>{name}</text></g>)}
        <g className="aide-arch-node is-google"><rect x="530" y="230" width="180" height="70" rx="14" /><text x="620" y="260">Gemini</text><text x="620" y="282" className="sub">{t('진단·이동·통화 대행', 'diagnosis · trips · calls')}</text></g>
        <g className="aide-arch-node is-google"><rect x="750" y="230" width="190" height="70" rx="14" /><text x="845" y="260">Google Maps</text><text x="845" y="282" className="sub">MCP · Places (New) {t('사진', 'photos')}</text></g>
        <path d="M170 75 L250 110" className="aide-arch-edge" markerEnd="url(#arrow)" /><path d="M170 175 L250 150" className="aide-arch-edge" markerEnd="url(#arrow)" />
        <path d="M440 110 L530 74" className="aide-arch-edge is-a2a" markerEnd="url(#arrow)" /><text x="470" y="80" className="aide-arch-label">A2A</text>
        <path d="M690 64 L760 37" className="aide-arch-edge is-a2a" markerEnd="url(#arrow)" /><path d="M690 72 L760 107" className="aide-arch-edge is-a2a" markerEnd="url(#arrow)" /><path d="M690 84 L760 172" className="aide-arch-edge is-a2a" markerEnd="url(#arrow)" />
        <path d="M440 165 L530 255" className="aide-arch-edge" markerEnd="url(#arrow)" /><path d="M440 185 C470 350 760 350 805 302" className="aide-arch-edge" markerEnd="url(#arrow)" />
        <text x="20" y="300" className="aide-arch-label">{t('운전자·운영자', 'Drivers · operators')}</text><text x="20" y="320" className="aide-arch-note">{t('Guardian 판정 + 1회용 사람 승인 없이는 변경 없음', 'No change without a Guardian verdict and a single-use human approval')}</text>
      </svg>
    </Card>
    <div className="aide-platform-grid">
      <Card title={t('실시간 A2A Agent Card', 'Live A2A Agent Card')} description={t('Chief 에이전트가 공개하는 카드를 게이트웨이의 서비스 ID로 지금 읽어 왔습니다.', "Read just now from the Chief agent's well-known card with the gateway's service identity.")}>
        {card ? <div className="aide-agent-card">
          <div className="aide-agent-card-head"><Icon name="hub" size={22} /><div><strong>{card.name}</strong><span>{[card.version && `v${card.version}`, card.protocolVersion && `A2A ${card.protocolVersion}`, card.preferredTransport].filter(Boolean).join(' · ')}</span></div>
            <StatusChip type="success">{t('실시간', 'Live')}</StatusChip></div>
          {card.description ? <p>{card.description}</p> : null}
          <dl className="aide-agent-capabilities"><div><dt>{t('스트리밍', 'Streaming')}</dt><dd>{card.capabilities.streaming ? t('지원', 'Yes') : t('미지원', 'No')}</dd></div>
            <div><dt>{t('입력', 'Input')}</dt><dd>{card.defaultInputModes.join(', ') || '—'}</dd></div><div><dt>{t('출력', 'Output')}</dt><dd>{card.defaultOutputModes.join(', ') || '—'}</dd></div></dl>
          {card.skills.length ? <ul className="aide-agent-skills">{card.skills.map(skill => <li key={skill.id}><strong>{skill.name}</strong>{skill.description ? <p>{skill.description}</p> : null}{skill.tags.length ? <span>{skill.tags.map(tag => `#${tag}`).join(' ')}</span> : null}</li>)}</ul> : null}
          {view?.fetchedAt ? <p className="ops-caption">{t('가져온 시각', 'Fetched')} {new Date(view.fetchedAt).toLocaleTimeString(locale)} · {t('엔드포인트 주소는 표시하지 않습니다', 'endpoint address not shown')}</p> : null}
        </div> : <p className="ops-caption">{view?.cardState === 'not_configured' ? t('이 배포에는 에이전트 크루가 연결되어 있지 않습니다.', 'The agent crew is not connected in this deployment.') : view ? t('Agent Card를 지금 읽지 못했습니다. 표시를 추정하지 않습니다.', 'The Agent Card could not be read right now; nothing is assumed.') : t('불러오는 중', 'Loading')}</p>}
      </Card>
      <Card title={t('이번 시간 사용량', 'This hour')} description={t('모델·지도 호출은 요청 전에 예약됩니다. 한도에 닿으면 새 증상은 기록하되 조치하지 않습니다.', 'Model and Maps calls are reserved before they run. At the limit, new symptoms are recorded but nothing acts.')}>
        {view?.usage ? <div className="aide-platform-usage">
          <div><span>Gemini</span><strong>{view.usage.model} / {view.usage.modelLimit}</strong>{meter(view.usage.model, view.usage.modelLimit)}</div>
          <div><span>Google Maps</span><strong>{view.usage.places} / {view.usage.placesLimit}</strong>{meter(view.usage.places, view.usage.placesLimit)}</div>
          <p className="ops-caption">{t('초기화', 'Resets')} {new Date(view.usage.resetsAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</p></div>
          : <p className="ops-caption">{t('이 워크스페이스에는 차량 기능이 연결되어 있지 않습니다.', 'Vehicle features are not connected in this workspace.')}</p>}
        {view ? <dl className="aide-platform-facts"><div><dt>{t('모델', 'Model')}</dt><dd>{view.facts.modelId} · {view.facts.modelLocation}</dd></div>
          <div><dt>{t('에이전트', 'Agents')}</dt><dd>{view.facts.crew.length ? view.facts.crew.join(' · ') : '—'}</dd></div>
          <div><dt>Maps</dt><dd>{view.facts.mapsMcp ? 'MCP search_places' : '—'}{view.facts.placesPhotos ? ' · Places (New) photos' : ''}</dd></div></dl> : null}
      </Card>
    </div>
    <Card title={t('서버가 강제하는 안전 규칙', 'Guardrails the server enforces')}>
      <ol className="aide-guardrails">{guardrails.map(([ko, en]) => <li key={en}><Icon name="approvals" size={18} /><span>{t(ko, en)}</span></li>)}</ol>
    </Card>
  </div>;
}
