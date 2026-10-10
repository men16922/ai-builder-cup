import { type MouseEvent, type ReactNode } from 'react';
import './material';
import Icon, { type IconName } from './Icon';

export type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text';
type Props = { variant?: ButtonVariant; disabled?: boolean; loading?: boolean; href?: string; label?: string; icon?: IconName; fullWidth?: boolean; onClick?: (event: MouseEvent) => void; children: ReactNode };

/** A Material Web button. `loading` keeps the label, disables the control and announces busy state. */
export default function Button({ variant = 'outlined', disabled, loading, href, label, icon, fullWidth, onClick, children }: Props) {
  const common = { 'aria-label': label, 'aria-busy': loading || undefined, disabled: disabled || loading, href, className: fullWidth ? 'ops-block' : undefined, onClick: (event: MouseEvent) => { if (!disabled && !loading) onClick?.(event); } };
  const content = <>{loading ? <md-circular-progress slot="icon" indeterminate aria-hidden="true" className="ops-button-progress" /> : icon ? <span slot="icon"><Icon name={icon} size={18} /></span> : null}{children}</>;
  return variant === 'filled' ? <md-filled-button {...common}>{content}</md-filled-button>
    : variant === 'tonal' ? <md-filled-tonal-button {...common}>{content}</md-filled-tonal-button>
      : variant === 'text' ? <md-text-button {...common}>{content}</md-text-button>
        : <md-outlined-button {...common}>{content}</md-outlined-button>;
}
