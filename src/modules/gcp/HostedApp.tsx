import { useEffect, useState } from 'react';
import ConsoleHeader from '../../components/ConsoleHeader';
import { useLanguage } from '../../i18n';
import { Button, Card, PageHeader, Stack } from '../../ui';
import GcpApp from './App';
import { gcpModule } from './manifest';

/** Public GCP composition. No registry or fallback into local/provider demo applications. */
export default function HostedApp() {
  const { t } = useLanguage(), [route, setRoute] = useState(() => window.location.hash.slice(1) || '/');
  useEffect(() => { const update = () => { setRoute(window.location.hash.slice(1) || '/'); window.scrollTo(0, 0); }; window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  if (route === '/personal/gcp' || route === '/organization/gcp') return <GcpApp key={route} edition={route === '/personal/gcp' ? 'personal' : 'organization'} hosted />;
  return <><ConsoleHeader id="gcp-entry-header" href="#/" utilities={[]} provider={{ name: 'Google Cloud', icon: gcpModule.icon }} /><main className="edition-home"><Stack gap="l">
    <PageHeader title={route === '/' ? t('운영 공간을 선택하세요', 'Choose your workspace') : t('항목을 찾을 수 없습니다', 'Page not found')} description={t('Google Cloud · 근거 수집부터 계획 검토와 인계까지', 'Google Cloud · From evidence to plan review and handoff')} />
    {route !== '/' ? <Button href="#/">{t('운영 공간 선택', 'Choose workspace')}</Button> : <><p>{t('공간을 선택한 뒤 웹 로그인으로 접근 권한을 확인합니다. 조직 선택만으로 권한이 부여되지 않습니다.', 'After choosing a workspace, sign in to verify access. Selecting an organization does not grant permission.')}</p><div className="module-stage-grid">
      <Card title={t('개인용', 'Personal')}><Stack><p>{t('내 신원에 연결된 GCP 서비스의 근거와 계획을 확인합니다.', 'Review evidence and plans for GCP services assigned to your identity.')}</p><Button variant="filled" href="#/personal/gcp">{t('개인 GCP 열기', 'Open personal GCP')}</Button></Stack></Card>
      <Card title={t('조직용', 'Organization')}><Stack><p>{t('조직 멤버십과 역할에 따라 서비스 근거를 검토하고 인계합니다.', 'Review service evidence and hand off work within your organization membership and role.')}</p><Button variant="filled" href="#/organization/gcp">{t('조직 GCP 열기', 'Open organization GCP')}</Button></Stack></Card>
    </div></>}
  </Stack></main></>;
}
