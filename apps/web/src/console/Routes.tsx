import { useEffect, useState } from 'react';
import ConsoleHeader from '../shell/ConsoleHeader';
import { useLanguage } from '../i18n';
import { Button, PageHeader, Stack } from '../ui';
import ConsolePage from './ConsolePage';
import MobilityPolicies from '../mobility/MobilityPolicies';

/** Public GCP composition. One console at `/`; no registry or fallback into any other application. */
const CONSOLE_ROUTES = new Set(['/', '/personal/gcp', '/organization/gcp']);

export default function Routes() {
  const { t } = useLanguage(), [route, setRoute] = useState(() => window.location.hash.slice(1) || '/');
  useEffect(() => { document.title = route === '/organization/gcp' ? t('Aide · 운영 워크스페이스','Aide · Operations workspace') : t('Aide · 커넥티드 모빌리티','Aide · Connected Mobility'); }, [route,t]);
  useEffect(() => { const update = () => { setRoute(window.location.hash.slice(1) || '/'); window.scrollTo(0, 0); }; window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  // Access is decided by the server (an allowed account that owns the registered service), never by which address was opened.
  if (CONSOLE_ROUTES.has(route)) return <ConsolePage edition={route === '/organization/gcp' ? 'organization' : 'personal'} hosted />;
  if(route==='/privacy'||route==='/terms')return <MobilityPolicies privacy={route==='/privacy'}/>;
  return <><ConsoleHeader id="gcp-entry-header" href="#/" utilities={[]} /><main className="edition-home"><Stack gap="l">
    <PageHeader title={t('항목을 찾을 수 없습니다', 'Page not found')} />
    <div><Button variant="filled" href="#/">{t('콘솔 열기', 'Open the console')}</Button></div>
  </Stack></main></>;
}
