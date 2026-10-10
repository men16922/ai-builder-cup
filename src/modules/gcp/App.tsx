import { gcpModule } from './manifest';
import { useState } from 'react';
import { useConsole } from '../../components/console-slots';
import { useLanguage } from '../../i18n';
import { Banner, Button, Card, PageHeader, Spinner, Stack } from '../../ui';
import ModuleShell from '../shared/ModuleShell';
import type { Edition } from '../contracts';
import GcpAccess from './Access';
import ConnectedObservation from './ConnectedObservation';
import ObservationPanel from './ObservationPanel';
import { gcpPreview } from './preview';
import RehearsalConsole from './RehearsalConsole';
import SyntheticWorkflow from './SyntheticWorkflow';
export default function GcpApp({ edition, hosted = false }: { edition: Edition; hosted?: boolean }) {
  const { t } = useLanguage();
  return <ModuleShell icon={gcpModule.icon} name="Google Cloud" edition={edition} href={`#/${edition}/gcp`} home={hosted ? { href: '#/', label: t('운영 공간 선택', 'Choose workspace') } : undefined}><GcpContent key={edition} edition={edition} /></ModuleShell>;
}
function GcpContent({ edition }: { edition: Edition }) {
  const { t } = useLanguage(), [preview, setPreview] = useState<'observation' | 'workflow' | 'crew'>();
  // Once signed in with the crew connected the page is a console and the introduction header gets out of the way.
  const inConsole = !!useConsole()?.slots.nav;
  return <Stack gap="l">
    {inConsole ? null : <PageHeader title={t('GCP 운영 워크플로', 'GCP operations workflow')} description={t('AI Builder Cup · 한 서비스의 근거 수집부터 모바일 판단과 인계까지', 'AI Builder Cup · From service evidence to mobile review and handoff')}
      actions={preview ? <Button onClick={() => setPreview(undefined)}>{t('예시 닫기', 'Close example')}</Button> : <><Button variant="filled" onClick={() => setPreview('crew')}>{t('에이전트 팀 체험 (로그인 없이)', 'Try the agent crew (no sign-in)')}</Button><Button onClick={() => setPreview('observation')}>{t('합성 관측 예시', 'View synthetic observation')}</Button><Button onClick={() => setPreview('workflow')}>{t('합성 워크플로 체험', 'Try synthetic workflow')}</Button></>} />}
    {preview === 'crew' ? <RehearsalConsole onExit={() => setPreview(undefined)} /> : preview === 'workflow' ? <SyntheticWorkflow /> : preview === 'observation' ? <ObservationPanel snapshot={gcpPreview()} /> : <GcpAccess key={edition} edition={edition}>{access => access.status === 'ready'
      ? <ConnectedObservation client={access.client} label={access.label} /> : access.status === 'loading' ? <Spinner label={t('불러오는 중', 'Loading')} />
        : <Stack gap="l"><Banner type={access.status === 'failed' ? 'error' : 'info'} header={t('시연 환경 연결 준비 중', 'Demo environment connection pending')}>{t('Cloud Run 조회 화면은 서버의 웹 인증과 고정 서비스 설정이 필요합니다. 현재 실제 GCP 인증·Gemini·모바일 앱은 연결되지 않았습니다. 합성 예시에서 관측 화면을 살펴볼 수 있습니다.', 'Cloud Run observations require server-side web authentication and a fixed service configuration. Live GCP authentication, Gemini and the mobile app are not connected. Explore the observation layout with the synthetic example.')}</Banner><div className="module-stage-grid">{[
          [t('01 · 근거 수집', '01 · Collect evidence'), t('서비스와 지정 revision을 확인하고 로그·지표의 표본과 누락을 함께 봅니다.', 'Inspect the service and pinned revision, with telemetry samples and missing evidence.')],
          [t('02 · 검토와 고정 읽기', '02 · Review and fixed read'), t('관측 근거로 계획을 준비하고 사람이 확인한 뒤 직접 실행합니다.', 'Prepare a plan from evidence, review it, then explicitly execute the read.')],
          [t('03 · 결과와 인계', '03 · Results and handoff'), t('읽기 결과와 서비스 상태를 구분하고 다음 담당자에게 남깁니다. GCP Android 연동은 준비 중입니다.', 'Distinguish read results from service health and leave a handoff. GCP Android integration is in preparation.')],
        ].map(([title, description]) => <Card key={title} title={title}><p>{description}</p></Card>)}</div></Stack>}</GcpAccess>}
  </Stack>;
}
