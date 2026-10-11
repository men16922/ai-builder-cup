import { useEffect, useId, type ReactNode } from 'react';
import './material';
import { useElementEvent } from './events';

type Field = HTMLElement & { value: string };
export type SelectOption = { value: string; label: string };

export function Select({ label, value, options, disabled, onChange }: { label: string; value?: string; options: SelectOption[]; disabled?: boolean; onChange: (value: string) => void }) {
  const ref = useElementEvent<Event>('change', event => onChange((event.target as Field).value));
  useEffect(() => { if (ref.current && value !== undefined && (ref.current as Field).value !== value) (ref.current as Field).value = value; }, [value, options, ref]);
  return <md-outlined-select ref={ref} label={label} aria-label={label} disabled={disabled} className="ops-field">
    {options.map(option => <md-select-option key={option.value} value={option.value} selected={option.value === value}><div slot="headline">{option.label}</div></md-select-option>)}
  </md-outlined-select>;
}

export function TextArea({ label, description, value, disabled, maxLength = 2000, onChange }: { label: string; description?: string; value: string; disabled?: boolean; maxLength?: number; onChange: (value: string) => void }) {
  const ref = useElementEvent<Event>('input', event => onChange((event.target as Field).value.slice(0, maxLength)));
  useEffect(() => { if (ref.current && (ref.current as Field).value !== value) (ref.current as Field).value = value; }, [value, ref]);
  return <md-outlined-text-field ref={ref} type="textarea" rows={4} label={label} aria-label={label} supporting-text={description} disabled={disabled} className="ops-field" />;
}

export function SearchField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (value: string) => void }) {
  const ref = useElementEvent<Event>('input', event => onChange((event.target as Field).value));
  useEffect(() => { if (ref.current && (ref.current as Field).value !== value) (ref.current as Field).value = value; }, [value, ref]);
  return <md-outlined-text-field ref={ref} type="search" label={label} aria-label={label} placeholder={placeholder} className="ops-field" />;
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  const ref = useElementEvent<Event>('change', event => onChange((event.target as HTMLElement & { checked: boolean }).checked));
  const id = useId();
  useEffect(() => { if (ref.current) (ref.current as HTMLElement & { checked: boolean }).checked = checked; }, [checked, ref]);
  return <div className="ops-check"><md-checkbox ref={ref} id={id} /><label htmlFor={id}>{children}</label></div>;
}
