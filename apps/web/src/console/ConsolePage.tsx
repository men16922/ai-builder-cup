import { useLanguage } from '../i18n';
import { Banner, Spinner } from '../ui';
import ConsoleShell from '../shell/ConsoleShell';
import type { Edition } from '@contracts/core/edition';
import GcpAccess from './Access';
import ConnectedObservation from './ConnectedObservation';
import MobilityWelcome from '../mobility/MobilityWelcome';

export default function ConsolePage({ edition, hosted = false }: { edition: Edition; hosted?: boolean }) {
  return <ConsoleShell href={hosted ? '#/' : `#/${edition}/gcp`}><GcpContent key={edition} edition={edition} /></ConsoleShell>;
}

/** Public entry explains the driver value; unconfigured access never creates a sample session. */
function GcpContent({ edition }: { edition: Edition }) {
  const { t } = useLanguage();
  return <GcpAccess key={edition} edition={edition}>{access => access.status === 'ready' ? <ConnectedObservation client={access.client} label={access.label} />
    : access.status === 'loading' ? <Spinner label={t('불러오는 중', 'Loading')} />
      : <MobilityWelcome status={<Banner type="info" header={t('로그인 연결을 확인할 수 없습니다', 'Sign-in connection unavailable')}>
        {t('연결 설정을 불러오지 못했습니다. 로컬 개발 서버의 API 연결 또는 배포 설정을 확인해야 합니다.', 'Connection settings could not be loaded. Check the local API connection or deployment configuration.')}</Banner>} />}</GcpAccess>;
}
