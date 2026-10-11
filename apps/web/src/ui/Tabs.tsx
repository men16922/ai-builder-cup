import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export type TabItem = { id: string; label: string; content: ReactNode };

/** Accessible tabs with automatic activation on arrow keys. All panels stay mounted so drafts survive a tab change. */
export default function Tabs({ label, tabs, active, onChange }: { label: string; tabs: TabItem[]; active: string; onChange: (id: string) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (event: KeyboardEvent, index: number) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return; event.preventDefault(); const target = tabs[next]; onChange(target.id); refs.current[target.id]?.focus();
  };
  return <div className="ops-tabs">
    <div role="tablist" aria-label={label} className="ops-tablist">{tabs.map((tab, index) => <button key={tab.id} ref={node => { refs.current[tab.id] = node; }} role="tab" type="button" id={`tab-${tab.id}`} aria-selected={tab.id === active} aria-controls={`panel-${tab.id}`} tabIndex={tab.id === active ? 0 : -1} className="ops-tab" onClick={() => onChange(tab.id)} onKeyDown={event => move(event, index)}>{tab.label}</button>)}</div>
    {tabs.map(tab => <div key={tab.id} role="tabpanel" id={`panel-${tab.id}`} aria-labelledby={`tab-${tab.id}`} hidden={tab.id !== active} className="ops-tabpanel">{tab.content}</div>)}
  </div>;
}
