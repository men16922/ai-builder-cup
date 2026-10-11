import { type ReactNode } from 'react';
import './material';
import Icon, { type IconName } from './Icon';

export function Stack({ gap = 'm', row = false, wrap = true, children }: { gap?: 'xs' | 's' | 'm' | 'l'; row?: boolean; wrap?: boolean; children: ReactNode }) {
  return <div className={`ops-stack ops-gap-${gap}${row ? ' ops-row' : ''}${wrap ? '' : ' ops-nowrap'}`}>{children}</div>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <header className="ops-page-header"><div><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>{actions ? <div className="ops-actions">{actions}</div> : null}</header>;
}

/** An elevated Material surface with an optional title row. */
export function Card({ title, description, actions, headingLevel = 2, children }: { title?: string; description?: string; actions?: ReactNode; headingLevel?: 2 | 3; children: ReactNode }) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3';
  return <section className="ops-card">{title || actions ? <div className="ops-card-head"><div>{title ? <Heading>{title}</Heading> : null}{description ? <p>{description}</p> : null}</div>{actions ? <div className="ops-actions">{actions}</div> : null}</div> : null}{children}</section>;
}

export type BannerType = 'info' | 'success' | 'warning' | 'error';
const bannerIcon: Record<BannerType, IconName> = { info: 'info', success: 'success', warning: 'warning', error: 'error' };
export function Banner({ type = 'info', header, action, children }: { type?: BannerType; header?: string; action?: ReactNode; children: ReactNode }) {
  return <div className={`ops-banner ops-${type}`} role={type === 'error' ? 'alert' : 'status'}><Icon name={bannerIcon[type]} /><div className="ops-banner-body">{header ? <strong>{header}</strong> : null}<div>{children}</div></div>{action ? <div className="ops-banner-action">{action}</div> : null}</div>;
}

export type ChipType = 'success' | 'info' | 'warning' | 'error' | 'pending';
const chipIcon: Record<ChipType, IconName> = { success: 'success', info: 'info', warning: 'warning', error: 'error', pending: 'pending' };
export function StatusChip({ type, children }: { type: ChipType; children: ReactNode }) {
  return <span className={`ops-chip ops-${type}`}><Icon name={chipIcon[type]} size={16} /><span>{children}</span></span>;
}

export function Details({ summary, open, children }: { summary: string; open?: boolean; children: ReactNode }) {
  return <details className="ops-details" open={open}><summary><Icon name="chevron" />{summary}</summary><div>{children}</div></details>;
}

export type Column<T> = { id: string; header: string; cell: (row: T) => ReactNode };
export function DataTable<T>({ caption, rows, columns, empty }: { caption: string; rows: T[]; columns: Column<T>[]; empty: string }) {
  return <div className="ops-table-wrap" tabIndex={0} role="region" aria-label={caption}><table className="ops-table"><caption>{caption}</caption>
    <thead><tr>{columns.map(column => <th key={column.id} scope="col">{column.header}</th>)}</tr></thead>
    <tbody>{rows.length ? rows.map((row, index) => <tr key={index}>{columns.map(column => <td key={column.id}>{column.cell(row)}</td>)}</tr>) : <tr><td colSpan={columns.length} className="ops-table-empty">{empty}</td></tr>}</tbody></table></div>;
}

export function FormField({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return <div className="ops-formfield"><strong>{label}</strong>{description ? <p>{description}</p> : null}{children}</div>;
}

export function Spinner({ label }: { label: string }) { return <md-circular-progress indeterminate aria-label={label} role="progressbar" />; }
