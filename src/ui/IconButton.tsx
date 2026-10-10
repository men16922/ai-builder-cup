import { type MouseEvent } from 'react';
import Icon, { type IconName } from './Icon';

/** A round, labeled icon-only button (native button: always focusable and announced by its label). */
export default function IconButton({ icon, label, pressed, badge, onClick, size = 22 }: { icon: IconName; label: string; pressed?: boolean; badge?: number; onClick?: (event: MouseEvent) => void; size?: number }) {
  return <button type="button" className="ops-icon-button" aria-label={label} aria-pressed={pressed} title={label} onClick={onClick}><Icon name={icon} size={size} />{badge ? <span className="ops-badge" aria-hidden="true">{badge}</span> : null}</button>;
}
