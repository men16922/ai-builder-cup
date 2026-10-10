import { useState } from 'react';
import { useLanguage } from '../../i18n';
import { Button, Card, SearchField, Stack } from '../../ui';
import type { GcpPlanItem } from './domain/workflow';
import type { GcpResource } from './domain/observations';

export default function PlanLibrary({ items, resources, selectedId, busy, onOpen }: { items: GcpPlanItem[]; resources: GcpResource[]; selectedId?: string; busy: boolean; onOpen: (id: string) => void }) {
  const { t, locale } = useLanguage(), [query, setQuery] = useState(''), [page, setPage] = useState(1);
  const label = (item: GcpPlanItem) => resources.find(resource => resource.id === item.resourceId)?.label ?? item.resourceId;
  const filtered = items.filter(item => `${label(item)} ${item.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 6)), current = Math.min(page, pages), visible = filtered.slice((current - 1) * 6, current * 6);
  return <Card title={t('저장된 계획과 결과', 'Stored plans and results')} description={`(${filtered.length}/${items.length}) ${t('최근 50개까지의 저장 목록입니다. 열면 저장 근거와 결과를 읽으며 GCP를 다시 조회하지 않습니다. 열지 않은 계획의 검토·실행 상태는 미확인입니다.', 'Up to 50 recent saved plans. Opening reads stored evidence and results without querying GCP again. Review and execution state are unknown until opened.')}`}><Stack>
    <SearchField label={t('저장 계획 검색', 'Search stored plans')} placeholder={t('서비스 또는 계획 ID 검색', 'Search service or plan ID')} value={query} onChange={value => { setQuery(value); setPage(1); }} />
    <p role="status" className="ops-caption">{t(`${filtered.length}개 계획`, `${filtered.length} matching plans`)}</p>
    {visible.length ? <ul className="gcp-plan-grid">{visible.map(item => <li key={item.id}><Card headingLevel={3}>
      <strong className="gcp-wrap">{label(item)}</strong>
      <dl className="gcp-facts"><dt>{t('계획 생성 시각', 'Plan created')}</dt><dd>{new Date(item.createdAt).toLocaleString(locale)}</dd><dt>{t('계획 ID', 'Plan ID')}</dt><dd><span className="gcp-plan-id">{item.id}</span></dd></dl>
      <Button disabled={busy} variant={item.id === selectedId ? 'filled' : 'outlined'} label={t(`저장 계획 열기 ${item.id}`, `Open stored plan ${item.id}`)} onClick={() => onOpen(item.id)}>{item.id === selectedId ? t('현재 계획 다시 열기', 'Reopen current plan') : t('저장 계획 열기', 'Open stored plan')}</Button>
    </Card></li>)}</ul>
      : <div className="gcp-empty-panel"><strong>{query ? t('검색 결과가 없습니다', 'No matching plans') : t('아직 저장된 계획이 없습니다', 'No saved plans yet')}</strong><p>{query ? t('서비스 이름이나 계획 ID를 확인하세요.', 'Check the service name or plan ID.') : t('근거를 수집하고 분석과 계획을 준비하면 여기에 표시됩니다.', 'Collect evidence and prepare an analysis and plan to see it here.')}</p></div>}
    {pages > 1 ? <nav className="ops-pager" aria-label={t('저장 계획 페이지', 'Stored plan pages')}>
      <Button variant="text" disabled={current <= 1} label={t('이전 계획 페이지', 'Previous plan page')} onClick={() => setPage(current - 1)}>{t('이전', 'Previous')}</Button>
      <span aria-live="polite">{t(`${current} / ${pages} 계획 페이지`, `Plan page ${current} of ${pages}`)}</span>
      <Button variant="text" disabled={current >= pages} label={t('다음 계획 페이지', 'Next plan page')} onClick={() => setPage(current + 1)}>{t('다음', 'Next')}</Button>
    </nav> : null}
  </Stack></Card>;
}
