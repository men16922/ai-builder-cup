import { useEffect, useState } from 'react';
import type { MobilityReport, MobilityState } from '@contracts/gcp/mobility';
import { useLanguage } from '../i18n';
import { Button, Card, Details, StatusChip } from '../ui';
import type { MobilityClient } from './mobility-client';

/** Observed simulator outcome comes from the Guardian, independently of the model's earlier hypothesis. */
export function RemedyOutcome({report}:{report:MobilityReport}) {
  const {t}=useLanguage();if(!report.remedy)return null;
  return <div className="aide-remedy-outcome"><strong>{t(`가상 충전 ${report.remedy.attempts}회 재연결 → ${report.remedy.powerKw} kW로 충전 재개`,`Simulated charge reconnected ${report.remedy.attempts} time → charging resumed at ${report.remedy.powerKw} kW`)}</strong>
    {report.caseId&&report.authorization==='standing-policy'?<p className="ops-caption">{t('이전에 함께 확인한 사례로 재발에 대응했습니다.','A previously verified case was used to handle this recurrence.')}</p>:null}
  </div>;
}

/** Guidance is server-produced; a person confirms the existing typed remedy, never new execution code. */
export function RecoveryGuide({report,state,client,busy}:{report:MobilityReport;state:MobilityState;client:MobilityClient;busy:boolean}) {
  const {t,language}=useLanguage(),[review,setReview]=useState(false),guide=report.guidance;
  useEffect(()=>setReview(false),[report.id,state.vehicle?.id]);
  if(!guide||!['escalated','unknown'].includes(report.state)||report.episode!==state.vehicle?.episode)return null;
  const labels={signal:t('확인 가능한 충전 링크 증상','Identifiable charge-link symptom'),parked:t('주차 상태','Parked vehicle'),temperature:t('배터리 온도 0–40°C','Battery temperature 0–40°C'),battery:t('배터리가 목표 미만','Battery below target'),attempts:t('이 증상에서 미시도','No attempt in this episode')};
  const available=guide.canResolve&&Date.parse(guide.expiresAt)>Date.now();
  return <section className="aide-recovery-guide">
    <h3>{t('함께 확인하고 복구','Check and recover together')}</h3>
    <ul className="aide-checks">{guide.checks.map(check=><li key={check.id}><span aria-hidden="true">{check.passed?'✓':'—'}</span>{labels[check.id]} <span className="ops-caption">{check.passed?t('충족','Met'):t('미충족','Not met')}</span></li>)}</ul>
    {!available?<p className="ops-caption">{t('현재 조건으로 재연결할 수 없습니다. 이 보고서의 근거와 확인되지 않은 부분을 운영자와 확인해 주세요.','Reconnection is unavailable under the current conditions. Review this report’s evidence and unknowns with a responder.')}</p>:review?<div className="aide-policy-review">
      <ol><li>{t('위의 현재 안전 조건을 확인합니다.','Review the current safety checks above.')}</li><li>{t('기존 충전 런북으로 가상 세션을 한 번 재연결합니다.','Reconnect the simulated session once using the existing charge runbook.')}</li><li>{t('서버에서 충전 재개를 확인한 뒤 후보 사례로 저장합니다.','Verify resumed charging in the server twin, then save a candidate case.')}</li></ol>
      <p className="ops-caption">{t('이번 복구 승인입니다. 향후 적용은 별도 사례 승인과 자동 대응 정책이 필요합니다.','This authorizes this recovery. Future use requires separate case approval and an active response policy.')}</p>
      <div className="ops-actions"><Button icon="wrench" variant="filled" loading={busy} onClick={()=>{void client.command({operation:'resolve_unknown',reportId:report.id,runbook:'charge-reconnect-v1',language});setReview(false);}}>{t('이 가이드로 함께 복구','Recover with this guide')}</Button><Button icon="close" disabled={busy} onClick={()=>setReview(false)}>{t('취소','Cancel')}</Button></div>
    </div>:<Button icon="book" disabled={busy} onClick={()=>setReview(true)}>{t('복구 가이드 검토','Review recovery guide')}</Button>}
  </section>;
}

export function LearnedCases({state,client,busy}:{state:MobilityState;client:MobilityClient;busy:boolean}) {
  const {t,locale}=useLanguage(),[reviewId,setReviewId]=useState<string>();
  useEffect(()=>setReviewId(undefined),[state.vehicle?.id,client]);
  if(!state.cases.length)return null;
  return <Card title={t('함께 해결한 경험','What we solved together')} description={t('검증한 복구만 기억합니다. 사례 승인과 자동 대응 권한은 별개입니다.','Remember verified recoveries. Case approval and automatic-response permission stay separate.')}>
    <div className="aide-learned-cases">{state.cases.map(item=>{
      const expired=Date.parse(item.expiresAt)<=Date.now();
      return <article key={item.id} className="aide-case">
        <div className="aide-case-heading"><h3>{t('충전 링크 중단 → 충전 재개','Charge-link interruption → charging resumed')}</h3><StatusChip type={item.status==='active'&&!expired?'success':'pending'}>{expired?t('만료','Expired'):item.status==='active'?t('재발 대응에 사용','Available for recurrence'):item.status==='candidate'?t('승인 전 후보','Candidate awaiting approval'):t('사용 중지','Revoked')}</StatusChip></div>
        <p className="ops-caption">{t('같은 차량·증상, 주차 중, 0–40°C, 목표 잔량 미만, 회당 한 번','Same vehicle and signal, parked, 0–40°C, battery below target, one attempt per episode')}</p>
        <Details summary={t('검증한 변화 보기','View verified change')}><p>{t('이전: 충전 중단 · 미시도 / 이후: 충전 재개 · 한 번 수행','Before: interrupted, no attempt / After: charging resumed, one attempt')}</p><p>{t('적용 기한','Valid until')}: {new Date(item.expiresAt).toLocaleString(locale)}</p><p>{t('가상 차량의 서버 상태 검증입니다. 실제 차량 진단이 아닙니다.','Verified server-twin state of a simulated vehicle. This is not a physical-vehicle diagnosis.')}</p></Details>
        {item.status==='candidate'&&!expired?(reviewId===item.id?<div className="aide-policy-review"><p>{t('이 차량에서 같은 충전 링크 증상이 재발할 때 기존 재연결 런북의 근거로 사용합니다. 지금 조치하지 않으며 자동 대응 정책도 켜지지 않습니다.','Use this verified case as evidence for the existing reconnect runbook when the same charge-link signal recurs on this vehicle. No remedy runs now and no response policy is enabled.')}</p><div className="ops-actions"><Button icon="approvals" variant="filled" disabled={busy} onClick={()=>{void client.command({operation:'promote_case',caseId:item.id});setReviewId(undefined);}}>{t('이 조건으로 사례 승인','Approve this bounded case')}</Button><Button icon="close" disabled={busy} onClick={()=>setReviewId(undefined)}>{t('취소','Cancel')}</Button></div></div>:<Button icon="add" disabled={busy} onClick={()=>setReviewId(item.id)}>{t('재발 대응에 등록','Register for recurrence')}</Button>):null}
        {item.status!=='revoked'&&!expired?<Button icon="delete" disabled={busy} onClick={()=>void client.command({operation:'revoke_case',caseId:item.id})}>{t('이 사례 사용 중지','Stop using this case')}</Button>:null}
      </article>;
    })}</div>
  </Card>;
}
