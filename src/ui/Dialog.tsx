import { useEffect, type ReactNode } from 'react';
import './material';
import { useElementEvent } from './events';
import Button from './Button';

/** Modal built on md-dialog (a native dialog: focus trap, Escape and inert background). */
export default function Dialog({ open, title, closeLabel, onDismiss, children }: { open: boolean; title: string; closeLabel: string; onDismiss: () => void; children: ReactNode }) {
  const ref = useElementEvent<Event>('closed', () => onDismiss());
  useEffect(() => { const node = ref.current as (HTMLElement & { open: boolean }) | null; if (node && node.open !== open) node.open = open; }, [open, ref]);
  return <md-dialog ref={ref} aria-label={title}>
    <div slot="headline">{title}</div>
    <div slot="content">{children}</div>
    <div slot="actions"><Button variant="text" label={closeLabel} onClick={onDismiss}>{closeLabel.split(' ').at(-1) ?? closeLabel}</Button></div>
  </md-dialog>;
}
