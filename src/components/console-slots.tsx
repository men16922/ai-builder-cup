import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { IconName } from '../ui';

/** A signed-in page tells the console shell what to show in the left navigation and the right-hand assistant. */
export type NavItem = { id: string; label: string; icon: IconName; badge?: number };
export type ConsoleSlots = { nav?: { items: NavItem[]; active: string; onSelect(id: string): void }; assistant?: ReactNode; assistantLabel?: string; user?: string; onSignOut?: () => void; signOutLabel?: string; pendingDecisions?: number };
type Context = { slots: ConsoleSlots; set(slots: ConsoleSlots): void; assistantOpen: boolean; setAssistantOpen(open: boolean): void; draft: string; setDraft(value: string): void };
const SlotsContext = createContext<Context | null>(null);

export function ConsoleSlotsProvider({ children }: { children: (context: Context) => ReactNode }) {
  const [slots, set] = useState<ConsoleSlots>({}), [assistantOpen, setAssistantOpen] = useState(false), [draft, setDraft] = useState('');
  const context = useMemo(() => ({ slots, set, assistantOpen, setAssistantOpen, draft, setDraft }), [slots, assistantOpen, draft]);
  return <SlotsContext.Provider value={context}>{children(context)}</SlotsContext.Provider>;
}
export const useConsole = () => useContext(SlotsContext);

/** Registers the slots while the page is mounted and clears them when it leaves. */
export function useConsoleSlots(slots: ConsoleSlots | undefined, key: string) {
  const context = useConsole(), set = context?.set;
  // The key (not the object) decides when to re-register, so a live assistant element can keep its own state.
  useEffect(() => { if (set && slots) { set(slots); return () => set({}); } }, [set, key]); // eslint-disable-line react-hooks/exhaustive-deps
}
