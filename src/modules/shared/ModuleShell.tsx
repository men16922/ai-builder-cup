import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { productName } from '../../brand';
import { ConsoleSlotsProvider, type ConsoleSlots } from '../../components/console-slots';
import { LanguageSelector, useLanguage } from '../../i18n';
import { Dialog, Icon, IconButton } from '../../ui';
import type { Edition } from '../contracts';

type Props = { name: string; icon: string; edition: Edition; href: string; children: ReactNode; company?: boolean; home?: { href: string; label: string } };

/** Google Cloud Console style frame: top bar, collapsible left navigation, content, and a right-hand assistant panel. */
export default function ModuleShell(props: Props) {
  return <ConsoleSlotsProvider>{context => <Frame {...props} slots={context.slots} assistantOpen={context.assistantOpen} setAssistantOpen={context.setAssistantOpen} setDraft={context.setDraft}>{props.children}</Frame>}</ConsoleSlotsProvider>;
}

function Frame({ name, icon, edition, href, children, company = false, home, slots, assistantOpen, setAssistantOpen, setDraft }: Props & { slots: ConsoleSlots; assistantOpen: boolean; setAssistantOpen(open: boolean): void; setDraft(value: string): void }) {
  const { t } = useLanguage();
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 688px)').matches);
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1180px)').matches);
  const [drawer, setDrawer] = useState(false), [rail, setRail] = useState(false), [menu, setMenu] = useState(false);
  const ask = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const small = window.matchMedia('(max-width: 688px)'), large = window.matchMedia('(min-width: 1180px)');
    const update = () => { setMobile(small.matches); setWide(large.matches); setDrawer(false); };
    small.addEventListener('change', update); large.addEventListener('change', update); return () => { small.removeEventListener('change', update); large.removeEventListener('change', update); };
  }, []);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === '/' && !(event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || (event.target as HTMLElement | null)?.isContentEditable)) { event.preventDefault(); ask.current?.focus(); } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, []);
  const space = edition === 'organization' ? t('조직용', 'Organization') : t('개인용', 'Personal');
  const homeLink = home ?? { href: `#/${edition}`, label: t('모듈 선택', 'Choose module') };
  const nav = slots.nav;
  const submit = (event: FormEvent) => { event.preventDefault(); if (!slots.assistant) return; setDraft(ask.current?.value.trim() ?? ''); if (ask.current) ask.current.value = ''; setAssistantOpen(true); };
  const navigation = <nav className={`ops-nav${rail && !mobile ? ' ops-rail' : ''}`} aria-label={t('모듈 탐색', 'Module navigation')}>
    {nav ? <>{nav.items.map(item => <button key={item.id} type="button" className="ops-nav-link" aria-current={nav.active === item.id ? 'page' : undefined} title={item.label} onClick={() => { nav.onSelect(item.id); setDrawer(false); }}>
      <Icon name={item.icon} size={22} /><span className="ops-nav-label">{item.label}</span>{item.badge ? <span className="ops-badge ops-badge-inline" aria-label={t(`${item.badge}건 대기`, `${item.badge} waiting`)}>{item.badge}</span> : null}</button>)}</>
      : <a className="ops-nav-link" aria-current="page" href={href} onClick={() => setDrawer(false)}><Icon name="dashboard" size={22} /><span className="ops-nav-label">{t('개요', 'Overview')}</span></a>}
    {!company ? <><div className="ops-nav-divider" role="separator" /><a className="ops-nav-link" href={homeLink.href} onClick={() => setDrawer(false)}><Icon name="cloud" size={22} /><span className="ops-nav-label">{homeLink.label}</span></a></> : null}
  </nav>;
  const showAssistant = !!slots.assistant && assistantOpen;
  return <div className={`ops-console${showAssistant && wide ? ' ops-with-assistant' : ''}${rail && !mobile ? ' ops-rail-on' : ''}`}>
    <header id="module-header" className="ops-topbar ops-console-bar">
      <IconButton icon="menu" label={mobile ? t('탐색 열기', 'Open navigation') : rail ? t('탐색 펼치기', 'Expand navigation') : t('탐색 접기', 'Collapse navigation')} onClick={() => mobile ? setDrawer(true) : setRail(!rail)} />
      <nav className="ops-brand-group" aria-label={t('제품 홈', 'Product home')}>
        <a href={href} className="ops-brand" aria-label={t(`${productName} 홈`, `${productName} home`)}><img src="/mobileops-mark.svg" alt="" /><span>{productName}</span></a>
      </nav>
      <span className="ops-workspace-chip" title={`${name} · ${space}`}><img src={icon} alt={name} /><span>{name} · {space}</span></span>
      {slots.assistant ? <form className="ops-askbar" role="search" onSubmit={submit}>
        <Icon name="sparkle" size={18} /><input ref={ask} type="text" maxLength={300} aria-label={t('에이전트에게 지시', 'Ask the crew')} placeholder={t('에이전트에게 지시하세요 — 예: shop-api 점검해 줘', 'Ask the crew — e.g. check shop-api')} /><kbd aria-hidden="true">/</kbd>
      </form> : <span className="ops-bar-spacer" />}
      <div className="ops-bar-right">
        {slots.assistant ? <button type="button" className="ops-gemini-button" aria-label={`${slots.assistantLabel ?? 'Gemini'}${slots.pendingDecisions ? ` · ${t(`결정 ${slots.pendingDecisions}건 대기`, `${slots.pendingDecisions} decision waiting`)}` : ''}`} aria-pressed={assistantOpen} onClick={() => setAssistantOpen(!assistantOpen)}><Icon name="sparkle" size={20} /><span>{slots.assistantLabel ?? 'Gemini'}</span>{slots.pendingDecisions ? <span className="ops-badge ops-badge-inline" aria-hidden="true">{slots.pendingDecisions}</span> : null}</button> : null}
        <form className="ops-language" aria-label={t('표시 언어 설정', 'Display language settings')} onSubmit={event => event.preventDefault()}><LanguageSelector /></form>
        {slots.user ? <div className="ops-account">
          <button type="button" className="ops-avatar" aria-label={t('계정', 'Account')} aria-expanded={menu} onClick={() => setMenu(!menu)}>{slots.user.slice(0, 1).toUpperCase()}</button>
          {menu ? <div className="ops-account-menu" role="group" aria-label={t('계정 메뉴', 'Account menu')}><p>{slots.user}</p>{slots.onSignOut ? <button type="button" onClick={() => { setMenu(false); slots.onSignOut?.(); }}>{slots.signOutLabel ?? t('웹 로그아웃', 'Sign out of web')}</button> : null}</div> : null}
        </div> : <Icon name="person" size={22} />}
      </div>
    </header>
    <div className="ops-body">
      {mobile ? null : <aside className="ops-sidebar">{navigation}</aside>}
      <main className="ops-main"><div className="module-content">{children}</div></main>
      {showAssistant ? <aside className="ops-assistant" aria-label={t('에이전트 패널', 'Crew assistant')}>
        <div className="ops-assistant-head"><Icon name="sparkle" size={20} /><strong>{slots.assistantLabel ?? 'Gemini'}</strong><span className="ops-flex" /><IconButton icon="close" label={t('에이전트 패널 닫기', 'Close the assistant')} onClick={() => setAssistantOpen(false)} /></div>
        <div className="ops-assistant-body">{slots.assistant}</div>
      </aside> : null}
    </div>
    {mobile && drawer ? <Dialog open={true} title={t('모듈 탐색', 'Module navigation')} closeLabel={t('탐색 닫기', 'Close navigation')} onDismiss={() => setDrawer(false)}>{navigation}</Dialog> : null}
  </div>;
}
