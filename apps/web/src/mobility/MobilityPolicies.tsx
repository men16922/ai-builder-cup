import { useLanguage } from '../i18n';
import { Button, PageHeader, Stack } from '../ui';
import ConsoleHeader from '../shell/ConsoleHeader';

/** Public product/data boundaries. Account-specific records and credentials never appear here. */
export default function MobilityPolicies({privacy}:{privacy:boolean}) {
  const {t}=useLanguage();
  return <><ConsoleHeader id="aide-policy-header" href="#/" utilities={[]} /><main className="edition-home"><Stack gap="l">
    <PageHeader title={privacy?t('개인정보와 데이터','Privacy and data'):t('이용 안내','Terms of use')}/>
    {privacy?<>
      <p>{t('Aide는 Google 로그인으로 사용자를 확인합니다. 서버는 계정과 워크스페이스 권한을 확인한 뒤 해당 사용자에게 허용된 기록만 제공합니다.','Aide uses Google sign-in to verify identity. The server checks account and workspace permissions before returning authorized records.')}</p>
      <p>{t('차량, 배터리, 충전과 이동 위치는 시뮬레이션입니다. 휴대폰 GPS나 실제 차량의 제어 데이터는 수집하지 않습니다.','Vehicle, battery, charging and journey positions are simulated. Aide does not collect phone GPS or physical vehicle control data.')}</p>
      <p>{t('장소 검색을 요청하면 검색 내용과 가상 차량 좌표를 Google Maps에 전송합니다. Gemini에는 검색 요청 또는 가상 차량의 진단 근거를 전송합니다. 로그인 토큰과 지도 자격증명은 모델 입력에 포함하지 않습니다.','A place request sends your search and simulated coordinates to Google Maps. Gemini receives the search request or simulated diagnosis evidence. Sign-in tokens and Maps credentials are excluded from model input.')}</p>
      <p>{t('Favorite과 선택 기록은 계정별로 분리합니다. 이동 선택에 대한 동의는 7일, 자동 충전 재연결 정책은 24시간 후 만료됩니다. 지도 검색 결과는 표시 목적으로 최대 29일 보관 기한을 적용하며, 기한이 지난 차량 작업 공간은 다시 시작해야 합니다.','Favorites and choices are account scoped. Journey choice consent expires after 7 days; the automatic charging reconnect policy after 24 hours. Maps results have a display retention deadline of at most 29 days. An expired vehicle workspace must be initialized again.')}</p>
      <p>{t('로그아웃하면 현재 화면의 개인 기록과 실행 권한을 지웁니다. Firebase SDK는 기기 내부에 인증 상태를 저장할 수 있습니다. 서버 기록과 Google 계정 자체의 삭제를 의미하지 않습니다.','Sign-out clears personal records and authority from the current view. Firebase SDK may retain authentication state on the device. Sign-out does not delete server records or your Google account.')}</p>
    </>:<>
      <p>{t('Aide는 차량과 서비스 문제를 조사하고, 허용된 범위의 조치와 보고를 돕는 앱입니다. 차량과 운전 기능은 지도 시뮬레이션으로 제공됩니다. 실제 차량 운행이나 운전 중 판단을 위한 서비스가 아닙니다.','Aide helps investigate vehicle and service problems, perform authorized remedies and report results. Vehicle and driving features are map simulations. They do not operate a physical vehicle or provide driving decisions.')}</p>
      <p>{t('처음 방문하는 목적지는 선택을 받습니다. Favorite 또는 같은 상황의 이전 선택은 표시된 동의 범위에서만 재사용하며 이동을 취소할 수 있습니다. 차량 조치에는 현재 근거와 서버 권한 검증이 필요합니다.','First-time destinations require selection. Favorites or previous choices are reused within the displayed consent scope and journeys can be cancelled. Vehicle remedies require current evidence and server authorization.')}</p>
      <p>{t('장소와 추천은 Google Maps에서 제공합니다. 영업 여부, 충전기 이용 가능 여부와 AI 설명은 최신 상황과 다를 수 있으므로 제공된 출처를 확인하세요.','Places and grounded recommendations come from Google Maps. Opening status, charging availability and AI explanations may differ from current conditions; check the provided sources.')}</p>
      <p>{t('Aide는 현대자동차나 Tesla의 공식 앱이 아니며 제조사와의 제휴를 주장하지 않습니다.','Aide is not an official Hyundai or Tesla app and does not claim manufacturer affiliation.')}</p>
    </>}
    <p><a href="https://cloud.google.com/maps-platform/terms" target="_blank" rel="noopener noreferrer">Google Maps Platform Terms</a> · <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a></p>
    <div><Button href="#/">{t('Aide로 돌아가기','Return to Aide')}</Button></div>
  </Stack></main></>;
}
