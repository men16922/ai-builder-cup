import { useLanguage } from '../../i18n';
import { Banner, Spinner } from '../../ui';
import ModuleShell from '../shared/ModuleShell';
import type { Edition } from '../contracts';
import GcpAccess from './Access';
import ConnectedObservation from './ConnectedObservation';
import RehearsalConsole from './RehearsalConsole';

export default function GcpApp({ edition, hosted = false }: { edition: Edition; hosted?: boolean }) {
  return <ModuleShell href={hosted ? '#/' : `#/${edition}/gcp`}><GcpContent key={edition} edition={edition} /></ModuleShell>;
}

/** Always the console. Until a person signs in (or while the server is not reachable) it is the labeled rehearsal. */
function GcpContent({ edition }: { edition: Edition }) {
  const { t } = useLanguage();
  return <GcpAccess key={edition} edition={edition}>{access => access.status === 'ready' ? <ConnectedObservation client={access.client} label={access.label} />
    : access.status === 'loading' ? <Spinner label={t('불러오는 중', 'Loading')} />
      : <RehearsalConsole status={<Banner type={access.status === 'failed' ? 'error' : 'warning'} header={t('실제 크루에 연결되지 않았습니다', 'Not connected to the live crew')}>
        {t('이 환경은 서버의 웹 인증과 고정 서비스 설정이 필요합니다. 연결되면 로그인 버튼이 나타납니다.', 'This environment needs the server\'s web sign-in and fixed service configuration. The sign-in button appears once it is connected.')}</Banner>} />}</GcpAccess>;
}
