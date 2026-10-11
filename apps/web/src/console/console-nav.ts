import type { NavGroup } from '../shell/console-slots';

type Translate = (korean: string, english: string) => string;

/** The pages of the console. `service:<id>` opens the evidence page for one registered service. */
export type ConsoleView = 'overview' | 'evidence' | 'workflow' | 'saved';
export const SERVICE_PREFIX = 'service:';

/**
 * The left navigation, laid out like Google Cloud Console: a home entry, then titled sections.
 * Signed-in and signed-out consoles share it so the frame never changes shape.
 */
export function consoleNav(t: Translate, options: { pending: number; plans: boolean; services: { id: string; label: string }[] }): NavGroup[] {
  return [
    { id: 'home', items: [{ id: 'overview', label: t('개요', 'Overview'), icon: 'dashboard' }] },
    { id: 'run', label: t('운영', 'Operations'), items: [
      { id: 'evidence', label: t('서비스', 'Services'), icon: 'services', children: options.services.map(service => ({ id: `${SERVICE_PREFIX}${service.id}`, label: service.label, icon: 'cloud' as const })) },
      { id: 'workflow', label: t('계획', 'Plans'), icon: 'list' },
      ...(options.plans ? [{ id: 'saved', label: t('저장된 계획', 'Saved plans'), icon: 'history' as const }] : []),
    ] },
    { id: 'crew', label: t('에이전트', 'Agents'), items: [
      { id: 'ask', label: t('에이전트에게 지시', 'Ask the crew'), icon: 'sparkle', action: true },
      { id: 'decisions', label: t('결정 대기', 'Decisions'), icon: 'approvals', action: true, badge: options.pending || undefined },
    ] },
  ];
}
