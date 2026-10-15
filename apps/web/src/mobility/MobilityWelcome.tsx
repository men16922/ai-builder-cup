import type { ReactNode } from 'react';
import { useLanguage } from '../i18n';
import { Button } from '../ui';

/** Signed-out entry: one promise, one sign-in action. No fabricated readings or sample console. */
export default function MobilityWelcome({ onSignIn, status, signingIn = false }: { onSignIn?: () => void; status?: ReactNode; signingIn?: boolean }) {
  const { t } = useLanguage();
  return <div className="aide-welcome">
    <section className="aide-welcome-hero">
      <div className="aide-welcome-copy">
        <h1>{t('당신의 이동에,\n한발 먼저.', 'One step ahead\nof your journey.')}</h1>
        <p>{t('차량 상태부터 충전 문제, 오늘 저녁의 목적지까지. 필요한 순간에 Aide가 함께합니다.', 'From vehicle health to charging problems and tonight’s destination. Aide is with you when it matters.')}</p>
        {onSignIn ? <Button variant="filled" icon="person" loading={signingIn} onClick={onSignIn}>{signingIn ? t('Google 로그인 창 확인 중', 'Complete Google sign-in') : t('Google로 시작하기', 'Continue with Google')}</Button> : <p className="aide-muted">{t('지금은 로그인할 수 없습니다. 잠시 후 다시 시도해 주세요.', 'Sign-in is unavailable right now. Please try again shortly.')}</p>}
        {status}
        <p className="aide-legal">{t('계속하면 ', 'By continuing you agree to the ')}<a href="#/terms">{t('이용 안내', 'Terms of use')}</a>{t('와 ', ' and ')}<a href="#/privacy">{t('개인정보 처리', 'Privacy notice')}</a>{t('에 동의합니다.', '.')}<br />{t('차량·운전은 시뮬레이션 · 실제 차량 제어 없음', 'Simulated vehicle and driving · no physical vehicle control')}</p>
      </div>
      <div className="aide-welcome-car"><img src="/vehicles/aide-ev.png" alt="" /></div>
    </section>
    <footer className="aide-policy-links"><span>© Aide</span><a href="#/organization/gcp">{t('운영자 로그인', 'Operator sign-in')}</a></footer>
  </div>;
}
