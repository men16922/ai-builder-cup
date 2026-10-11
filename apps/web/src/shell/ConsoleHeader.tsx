import { productName } from '../brand';
import { LanguageSelector, useLanguage } from '../i18n';

export type Utility = { text: string; href?: string };

/** Top app bar. The brand region is fixed so that responsive layout never truncates the product name. */
export default function ConsoleHeader({ id, href, utilities }: { id: string; href: string; utilities: Utility[] }) {
  const { t } = useLanguage();
  return <header id={id} className="ops-topbar">
    <nav className="ops-brand-group" aria-label={t('제품 홈', 'Product home')}>
      <a href={href} className="ops-brand" aria-label={t(`${productName} 홈`, `${productName} home`)}><img src="/mark.svg" alt="" /><span>{productName}</span></a>
    </nav>
    <div className="ops-utilities">{utilities.map(item => item.href ? <a key={item.text} className="ops-utility" href={item.href}>{item.text}</a> : <span key={item.text} className="ops-utility">{item.text}</span>)}</div>
    <form className="ops-language" aria-label={t('표시 언어 설정', 'Display language settings')} onSubmit={event => event.preventDefault()}><LanguageSelector /></form>
  </header>;
}
