import type { NavGroup } from '../shell/console-slots';

type Translate = (korean: string, english: string) => string;

/** The pages of the console. `service:<id>` opens the evidence page for one registered service. */
export type ConsoleView = 'overview' | 'evidence' | 'workflow' | 'saved' | 'vehicle' | 'journey' | 'assistance';
export const SERVICE_PREFIX = 'service:';

/**
 * The left navigation, laid out like Google Cloud Console: a home entry, then titled sections.
 * Signed-in and signed-out consoles share it so the frame never changes shape.
 */
export function consoleNav(t: Translate, options: { pending: number; plans: boolean; mobility?: boolean; operations?: boolean; services: { id: string; label: string }[] }): NavGroup[] {
  return [
    ...(options.mobility ? [{ id: 'mobility', label: t('나의 이동', 'My mobility'), items: [
      { id: 'vehicle', label: t('내 차량', 'My vehicle'), icon: 'target' as const },
      { id: 'journey', label: t('충전·지도', 'Charging & map'), icon: 'cloud' as const },
      { id: 'assistance', label: t('Aide 도움', 'Aide assistance'), icon: 'sparkle' as const },
    ] }] : []),
    ...(options.operations === false ? [] : [
    { id: 'home', items: [{ id: 'overview', label: t('개요', 'Overview'), icon: 'dashboard' as const }] },
    { id: 'run', label: t('운영', 'Operations'), items: [
      { id: 'evidence', label: t('서비스', 'Services'), icon: 'services' as const, children: options.services.map(service => ({ id: `${SERVICE_PREFIX}${service.id}`, label: service.label, icon: 'cloud' as const })) },
      { id: 'workflow', label: t('계획', 'Plans'), icon: 'list' as const },
      ...(options.plans ? [{ id: 'saved', label: t('저장된 계획', 'Saved plans'), icon: 'history' as const }] : []),
    ] },
    { id: 'crew', label: 'My Aide', items: [
      { id: 'ask', label: t('나만의 Aide에게 부탁하세요', 'Ask your own Aide'), icon: 'sparkle' as const, action: true },
      { id: 'decisions', label: t('결정 대기', 'Decisions'), icon: 'approvals' as const, action: true, badge: options.pending || undefined },
    ] },
    ]),
  ];
}
