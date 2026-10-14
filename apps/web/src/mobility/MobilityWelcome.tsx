import type { ReactNode } from 'react';
import { useLanguage } from '../i18n';
import { Button, Icon } from '../ui';

/** Honest signed-out entry: no fabricated battery readings or a sample console. */
export default function MobilityWelcome({ onSignIn, status, signingIn = false }: { onSignIn?: () => void; status?: ReactNode; signingIn?: boolean }) {
  const { t } = useLanguage();
  return <div className="aide-welcome">
    <section className="aide-welcome-hero">
      <div className="aide-welcome-copy"><span className="aide-eyebrow">AIDE · CONNECTED MOBILITY</span>
        <h1>{t('당신의 이동에,\n한발 먼저.', 'One step ahead\nof your journey.')}</h1>
        <p>{t('차량 상태부터 충전 문제, 오늘 저녁의 목적지까지. 필요한 순간에 Aide가 함께합니다.', 'From vehicle health to charging problems and tonight’s destination. Aide is with you when it matters.')}</p>
        {onSignIn ? <Button variant="filled" icon="person" loading={signingIn} onClick={onSignIn}>{signingIn ? t('Google 로그인 창 확인 중', 'Complete Google sign-in') : t('Google로 시작하기', 'Continue with Google')}</Button> : <p className="aide-muted">{t('로그인 연결 설정이 필요합니다.', 'Sign-in connection needs configuration.')}</p>}
        <span className="aide-disclosure">{t('차량·운전은 시뮬레이션 · 실제 차량 제어 없음', 'Simulated vehicle and driving · no physical vehicle control')}</span>
      </div>
      <div className="aide-welcome-car"><span className="aide-car-label">Aide EV</span><img src="/vehicles/aide-ev.png" alt={t('Aide 전기차 콘셉트 이미지', 'Aide electric vehicle concept')} /></div>
    </section>
    {status}
    <section className="aide-benefits" aria-label={t('Aide와 함께하는 일상', 'Everyday with Aide')}>
      {[
        ['target', t('내 차가 한눈에', 'Your car, at a glance'), t('배터리와 충전, 위치를 한 곳에서.', 'Battery, charging and location in one place.')],
        ['sparkle', t('문제가 생기면, Aide', 'When something goes wrong'), t('검증된 문제는 허용된 범위에서 해결하고 보고.', 'Known issues resolved within your authorization, then reported.')],
        ['history', t('기억할수록 편해지는 이동', 'A journey that remembers'), t('처음엔 선택하고, 같은 상황에선 Favorite으로.', 'Choose first. Use your Favorite in the same context.')],
      ].map(([icon, title, body]) => <article key={title}><Icon name={icon as 'target'|'sparkle'|'history'} size={22} /><h2>{title}</h2><p>{body}</p></article>)}
    </section>
    <footer className="aide-policy-links"><a href="#/personal/gcp">{t('개인 차량','My vehicle')}</a><a href="#/organization/gcp">{t('운영자 워크스페이스','Operations workspace')}</a><a href="#/privacy">{t('개인정보와 데이터','Privacy and data')}</a><a href="#/terms">{t('이용 안내','Terms of use')}</a></footer>
  </div>;
}
