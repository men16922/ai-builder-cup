import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { productName } from '../brand';
import { ConsoleSlotsProvider, type ConsoleSlots, type NavGroup, type NavItem } from './console-slots';
import { LanguageSelector, useLanguage } from '../i18n';
import { Button, Dialog, Icon, IconButton } from '../ui';

type Props = { href: string; children: ReactNode };

/**
 * Google Cloud Console style frame: top bar, collapsible left navigation with titled sections,
 * content, and a right-hand rail that expands into the Gemini-style crew assistant.
 */
export default function ConsoleShell(props: Props) {
  return <ConsoleSlotsProvider>{context => <Frame {...props} slots={context.slots} assistantOpen={context.assistantOpen} setAssistantOpen={context.setAssistantOpen} setDraft={context.setDraft}>{props.children}</Frame>}</ConsoleSlotsProvider>;
}

function Frame({ href, children, slots, assistantOpen, setAssistantOpen, setDraft }: Props & { slots: ConsoleSlots; assistantOpen: boolean; setAssistantOpen(open: boolean): void; setDraft(value: string): void }) {
  const { t } = useLanguage();
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1180px)').matches);
  const [drawer, setDrawer] = useState(false), [rail, setRail] = useState(false), [menu, setMenu] = useState(false);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const ask = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const small = window.matchMedia('(max-width: 760px)'), large = window.matchMedia('(min-width: 1180px)');
    const update = () => { setMobile(small.matches); setWide(large.matches); setDrawer(false); };
    small.addEventListener('change', update); large.addEventListener('change', update); return () => { small.removeEventListener('change', update); large.removeEventListener('change', update); };
  }, []);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === '/' && !(event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || (event.target as HTMLElement | null)?.isContentEditable)) { event.preventDefault(); ask.current?.focus(); } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, []);
  const nav = slots.nav, assistantLabel = slots.assistantLabel ?? 'Gemini';
  const submit = (event: FormEvent) => { event.preventDefault(); if (!slots.assistant) return; setDraft(ask.current?.value.trim() ?? ''); if (ask.current) ask.current.value = ''; setAssistantOpen(true); };
  const pick = (item: NavItem) => { if (item.action) setAssistantOpen(true); else nav?.onSelect(item.id); setDrawer(false); };
  const compact = rail && !mobile;

  const entry = (item: NavItem, depth: 0 | 1) => {
    const own = nav?.active === item.id, inside = !!item.children?.some(child => child.id === nav?.active), expanded = !closed[item.id];
    return <div key={item.id} className="ops-nav-entry">
      <div className={`ops-nav-row${depth ? ' ops-nav-sub' : ''}`}>
        <button type="button" className="ops-nav-link" aria-current={own ? 'page' : undefined} data-inside={inside || undefined} title={item.label} onClick={() => pick(item)}>
          <Icon name={item.icon} size={depth ? 18 : 22} /><span className="ops-nav-label">{item.label}</span>
          {item.badge ? <span className="ops-badge ops-badge-inline" aria-label={t(`${item.badge}건 대기`, `${item.badge} waiting`)}>{item.badge}</span> : null}
        </button>
        {item.children?.length && !compact ? <button type="button" className="ops-nav-toggle" aria-expanded={expanded} aria-label={`${item.label} · ${expanded ? t('접기', 'Collapse') : t('펼치기', 'Expand')}`} onClick={() => setClosed({ ...closed, [item.id]: expanded })}><Icon name="chevron" size={18} /></button> : null}
      </div>
      {item.children?.length && expanded && !compact ? <div className="ops-nav-children">{item.children.map(child => entry(child, 1))}</div> : null}
    </div>;
  };
  const section = (group: NavGroup, index: number) => <div key={group.id} className="ops-nav-group" role="group" aria-label={group.label}>
    {group.label && !compact ? <div className="ops-nav-heading">{group.label}</div> : index ? <div className="ops-nav-divider" role="separator" /> : null}
    {group.items.map(item => entry(item, 0))}
  </div>;
  const navigation = <nav className={`ops-nav${compact ? ' ops-rail' : ''}`} aria-label={t('주 메뉴', 'Main navigation')}>
    {nav ? nav.groups.map(section) : <a className="ops-nav-link" aria-current="page" href={href} onClick={() => setDrawer(false)}><Icon name="dashboard" size={22} /><span className="ops-nav-label">{t('개요', 'Overview')}</span></a>}
  </nav>;
  const showAssistant = !!slots.assistant && assistantOpen;
  const gemini = <>
    <Icon name="sparkle" size={20} />
    {slots.pendingDecisions ? <span className="ops-badge ops-badge-inline" aria-hidden="true">{slots.pendingDecisions}</span> : null}
  </>;
  const geminiLabel = `${assistantLabel}${slots.pendingDecisions ? ` · ${t(`결정 ${slots.pendingDecisions}건 대기`, `${slots.pendingDecisions} decision waiting`)}` : ''}`;
  return <div className={`ops-console${showAssistant && wide ? ' ops-with-assistant' : ''}${compact ? ' ops-rail-on' : ''}${!nav ? ' ops-no-nav' : ''}`}>
    <header id="module-header" className="ops-topbar ops-console-bar">
      {nav ? <IconButton icon="menu" label={mobile ? t('탐색 열기', 'Open navigation') : rail ? t('탐색 펼치기', 'Expand navigation') : t('탐색 접기', 'Collapse navigation')} onClick={() => mobile ? setDrawer(true) : setRail(!rail)} /> : null}
      <nav className="ops-brand-group" aria-label={t('제품 홈', 'Product home')}>
        <a href={href} className="ops-brand" aria-label={t(`${productName} 홈`, `${productName} home`)}><img src="/mark.svg" alt="" /><span>{productName}</span></a>
      </nav>
      {slots.assistant ? <form className="ops-askbar" role="search" onSubmit={submit}>
        <Icon name="sparkle" size={18} /><input ref={ask} type="text" maxLength={300} aria-label={t('에이전트에게 지시', 'Ask the crew')} placeholder={t('에이전트에게 지시하세요 — 예: shop-api 점검해 줘', 'Ask the crew — e.g. check shop-api')} /><kbd aria-hidden="true">/</kbd>
      </form> : <span className="ops-bar-spacer" />}
      <div className="ops-bar-right">
        {slots.assistant && mobile ? <button type="button" className="ops-gemini-button" aria-label={geminiLabel} aria-pressed={assistantOpen} onClick={() => setAssistantOpen(!assistantOpen)}>{gemini}</button> : null}
        <form className="ops-language" aria-label={t('표시 언어 설정', 'Display language settings')} onSubmit={event => event.preventDefault()}><LanguageSelector /></form>
        {slots.user ? <div className="ops-account">
          <button type="button" className="ops-avatar" aria-label={t('계정', 'Account')} aria-expanded={menu} onClick={() => setMenu(!menu)}>{slots.user.slice(0, 1).toUpperCase()}</button>
          {menu ? <div className="ops-account-menu" role="group" aria-label={t('계정 메뉴', 'Account menu')}><p>{slots.user}</p>{slots.onSignOut ? <button type="button" onClick={() => { setMenu(false); slots.onSignOut?.(); }}>{slots.signOutLabel ?? t('웹 로그아웃', 'Sign out of web')}</button> : null}</div> : null}
        </div> : slots.onSignIn ? <Button variant="filled" onClick={slots.onSignIn}>{slots.signInLabel ?? t('로그인', 'Sign in')}</Button> : <Icon name="person" size={22} />}
      </div>
    </header>
    <div className="ops-body">
      {mobile || !nav ? null : <aside className="ops-sidebar">{navigation}</aside>}
      <main className="ops-main"><div className="module-content">{children}</div></main>
      {showAssistant ? <aside className="ops-assistant" aria-label={t('에이전트 패널', 'Crew assistant')}>
        <div className="ops-assistant-head"><Icon name="sparkle" size={20} /><strong>{assistantLabel}</strong><span className="ops-flex" /><IconButton icon="close" label={t('에이전트 패널 닫기', 'Close the assistant')} onClick={() => setAssistantOpen(false)} /></div>
        <div className="ops-assistant-body">{slots.assistant}</div>
      </aside> : null}
      {slots.assistant && !mobile ? <aside className="ops-side-rail" aria-label={t('에이전트 도구', 'Agent tools')}>
        <button type="button" className="ops-side-button" aria-pressed={assistantOpen} aria-label={t(`${assistantLabel}에게 묻기`, `Ask ${assistantLabel}`)} title={t(`${assistantLabel}에게 묻기`, `Ask ${assistantLabel}`)} onClick={() => setAssistantOpen(!assistantOpen)}>
          <Icon name="sparkle" size={24} />{slots.pendingDecisions ? <span className="ops-badge ops-badge-inline" aria-hidden="true">{slots.pendingDecisions}</span> : null}
        </button>
      </aside> : null}
    </div>
    {mobile && drawer ? <Dialog open={true} title={t('주 메뉴', 'Main navigation')} closeLabel={t('탐색 닫기', 'Close navigation')} onDismiss={() => setDrawer(false)}>{navigation}</Dialog> : null}
  </div>;
}
