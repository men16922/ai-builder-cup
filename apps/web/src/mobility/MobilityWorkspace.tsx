import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLanguage } from '../i18n';
import { Banner, Button, Card, Details, StatusChip } from '../ui';
import type { MobilityClient } from './mobility-client';
import JourneyPanel from './JourneyPanel';
import GoogleJourneyMap from './GoogleJourneyMap';
import {LearnedCases,RecoveryGuide,RemedyOutcome} from './RecoveryCases';

/** Driver workspace uses simulated telemetry; model proposals never grant execution authority. */
export default function MobilityWorkspace({ client, page='vehicle', onNavigate, journeyKind='restaurant' }: { client: MobilityClient; page?: 'vehicle'|'journey'|'assistance'; onNavigate?: (page:'journey'|'assistance',kind?:'restaurant'|'charging'|'poi')=>void; journeyKind?:'restaurant'|'charging'|'poi' }) {
  const { t, language, locale }=useLanguage(),board=useSyncExternalStore(client.subscribe,client.getSnapshot),state=board.state,vehicle=state?.vehicle;
  const [soc,setSoc]=useState(68),[policyReview,setPolicyReview]=useState(false);
  useEffect(()=>{client.open();void client.load();return()=>client.close();},[client]);
  useEffect(()=>{if(vehicle)setSoc(vehicle.batteryPercent);},[vehicle?.batteryPercent]);
  useEffect(()=>setPolicyReview(false),[vehicle?.id,client]);
  const report=state?.reports[0];
  const error=board.error==='maps_not_configured'?t('Google Places가 아직 연결되지 않았습니다.','Google Places is not connected yet.'):board.error==='vehicle_changed'?t('차량 상태가 바뀌었습니다. 새로고침하고 확인해 주세요.','Vehicle state changed. Refresh and check it.'):t('요청 결과를 확인하지 못했습니다. 자동 재실행하지 않았습니다. 최신 상태를 확인해 주세요.','The outcome could not be confirmed. It was not retried automatically. Check the latest state.');
  return <div className="aide-workspace">
    <header className="ops-page-header"><div><span className="aide-eyebrow">AIDE MOBILITY</span><h1>{page==='vehicle'?t('내 차, 지금','Your car, now'):page==='journey'?t('다음 목적지','Your next destination'):t('Aide가 함께 해결합니다','Aide is here to help')}</h1></div><Button icon="refresh" loading={board.busy} onClick={()=>void client.load()}>{t('새로고침','Refresh')}</Button></header>
    {board.error?<Banner type="error" action={<Button onClick={()=>void client.load()}>{t('최신 상태 확인','Check latest state')}</Button>}>{error}</Banner>:null}
    {!vehicle?<section className="aide-vehicle-empty"><img src="/vehicles/aide-ev.png" alt={t('Aide EV 콘셉트 차량','Aide EV concept vehicle')}/><h2>{t('나만의 Aide EV를 연결하세요','Meet your Aide EV')}</h2><p>{t('서버에 저장되는 가상 차량으로 충전과 이동을 경험합니다. 실제 차량을 제어하지 않습니다.','A server-persisted simulated vehicle for charging and journeys. No physical vehicle control.')}</p><Button variant="filled" loading={board.busy} disabled={!state} onClick={()=>void client.command({operation:'initialize'})}>{t('가상 차량 연결','Connect simulated vehicle')}</Button></section>:<>
      {page==='vehicle'?<section className="aide-vehicle-hero"><div className="aide-vehicle-heading"><div><span className="aide-eyebrow">CONNECTED VEHICLE</span><h2>{vehicle.model}</h2><p>{t('가상 차량 · 서버에서 갱신','Simulated vehicle · server updated')}</p></div><StatusChip type={vehicle.fault==='none'?'info':'warning'}>{vehicle.fault==='none'?(vehicle.parked?t('주차 중','Parked'):t('시뮬레이션 이동 중','Simulated driving')):t('확인이 필요한 상태','Needs attention')}</StatusChip></div>
        <img src="/vehicles/aide-ev.png" alt={t('Aide 전기차','Aide electric vehicle')}/>
        <div className="aide-vehicle-stats"><div><span>{t('배터리','Battery')}</span><strong>{vehicle.batteryPercent}<small>%</small></strong><meter min={0} max={100} value={vehicle.batteryPercent} aria-label={t('가상 배터리 잔량','Simulated battery level')}/></div><div><span>{t('예상 주행 가능 거리','Estimated range')}</span><strong>{vehicle.rangeKm}<small>km</small></strong><span>{t('시뮬레이터 추정값','Simulator estimate')}</span></div><div><span>{t('충전','Charging')}</span><strong>{vehicle.charging==='charging'?`${vehicle.powerKw} kW`:vehicle.charging==='interrupted'?t('연결 중단','Interrupted'):t('대기','Idle')}</strong><span>{t(`목표 ${vehicle.targetPercent}%`,`Target ${vehicle.targetPercent}%`)}</span></div></div>
        <div className="aide-vehicle-foot"><span>{t('최근 갱신','Updated')} {new Date(vehicle.observedAt).toLocaleTimeString(locale)}</span><span>{vehicle.location.latitude.toFixed(4)}, {vehicle.location.longitude.toFixed(4)} · {t('가상 위치','Simulated location')}</span></div>
      </section>:null}
      {page==='vehicle'&&state.mapsBrowserKey?<GoogleJourneyMap apiKey={state.mapsBrowserKey} latitude={vehicle.location.latitude} longitude={vehicle.location.longitude}/>:null}
      {page==='vehicle'?<div className="aide-home-actions">
        <Card title={t('어디로 갈까요?','Where shall we go?')} description={t('충전소와 목적지를 찾고, 지도에서 이동을 시뮬레이션합니다.','Find a charger or destination and simulate your journey on the map.')}>
          <div className="ops-actions"><Button variant="filled" onClick={()=>onNavigate?.('journey','charging')}>{t('충전소 찾기','Find a charger')}</Button><Button onClick={()=>onNavigate?.('journey','restaurant')}>{t('저녁 식사 요청','Find dinner')}</Button></div>
          {state.journey?.state==='moving'?<><StatusChip type="info">{t('지도 이동 시뮬레이션 진행 중','Map journey simulation in progress')}</StatusChip><Button disabled={board.busy} onClick={()=>void client.command({operation:'stop',journeyId:state.journey!.id})}>{t('이동 취소','Cancel journey')}</Button></>:null}
        </Card>
        <Card title={t('Aide 도움','Aide assistance')}>
          {report?.remedy?<RemedyOutcome report={report}/>:vehicle.fault!=='none'?<StatusChip type="warning">{t('확인이 필요한 증상이 있습니다','A symptom needs attention')}</StatusChip>:<p>{t('아직 대응 기록이 없습니다. 필요한 순간에 Aide가 함께합니다.','No response recorded yet. Aide is here when you need help.')}</p>}
          <p className="ops-caption">{state.policy.enabled&&Date.parse(state.policy.expiresAt??'')>Date.now()?t('24시간 한정 자동 대응 허용','Automatic response allowed for 24 hours'):t('변경 전 직접 결정','Decide before a change')}</p>
          <Button onClick={()=>onNavigate?.('assistance')}>{t('대응과 권한 확인','Review response and authority')}</Button>
        </Card>
      </div>:null}
      {page==='journey'?<JourneyPanel client={client} initialKind={journeyKind}/>:null}
      {page==='assistance'?<div className="aide-assistance-grid"><Card title={t('문제가 생기면, Aide','When something goes wrong')} description={t('알려진 상황은 검증된 런북으로. 낯선 상황은 사람과 함께.','Known situations use a verified runbook. Unfamiliar ones need a person.')}>
        {report?<section className="aide-report" aria-live="polite"><StatusChip type={report.state==='remediated'?'success':'warning'}>{report.state==='remediated'?t('조치 후 확인됨','Remedy confirmed'):report.state==='needs_decision'?t('내 결정 필요','Needs your decision'):report.state==='investigating'?t('조사 중 · 아직 조치 없음','Investigating · no remedy yet'):t('사람 확인 필요','Human assistance needed')}</StatusChip><RemedyOutcome report={report}/>{!report.remedy?<p>{report.summary}</p>:null}<p>{t('권한','Authority')}: {report.authorization==='standing-policy'?t('24시간 한정 자동 대응 정책','24-hour standing policy'):report.authorization==='human-decision'?t('직접 승인','Explicit human decision'):t('읽기 전용 조사','Read-only investigation')}</p><Details summary={t('근거와 수행 기록','Evidence and execution record')}>{report.remedy?<p>{report.summary}</p>:null}<ul>{report.evidence.map(item=><li key={item}>{item}</li>)}</ul>{report.unknowns.map(item=><p key={item}>{item}</p>)}</Details>
          <RecoveryGuide report={report} state={state} client={client} busy={board.busy}/>
          {report.state==='needs_decision'?<Button variant="filled" loading={board.busy} onClick={()=>void client.command({operation:'approve',reportId:report.id})}>{t('가상 충전 세션 재연결 승인','Approve simulated charge reconnection')}</Button>:null}
        </section>:<p className="ops-caption">{t('아직 조사 기록이 없습니다. 증상이 발생하면 Aide가 근거를 확인합니다.','No investigation yet. Aide checks the evidence when a symptom appears.')}</p>}
        <Button disabled={board.busy} onClick={()=>void client.command({operation:'diagnose',language})}>{t('지금 진단하기','Diagnose now')}</Button>
      </Card><Card title={t('자동 대응 범위','Automatic response boundary')}>
        <p>{t('주차 중인 가상 차량의 충전 연결 문제만, 안전 온도에서 한 번 재연결합니다. 같은 충전 링크 증상은 승인된 사례가 있을 때만 적용합니다. 과열과 분류되지 않은 경고는 사람에게 보고합니다.','Reconnect a parked simulated charge session once, within a safe temperature. A recurring charge-link signal also needs an approved case. Overheating and unclassified warnings are escalated.')}</p>
        <StatusChip type={state.policy.enabled&&Date.parse(state.policy.expiresAt??'')>Date.now()?'info':'pending'}>{state.policy.enabled&&Date.parse(state.policy.expiresAt??'')>Date.now()?t('자동 대응 허용됨','Automatic response enabled'):t('변경 전 직접 결정','Decide before a change')}</StatusChip>
        {policyReview?<div className="aide-policy-review"><p>{t('24시간 동안 내 가상 차량의 충전 연결 복구를 허용합니다. 회당 1회, 상태가 달라지면 중단합니다.','Allow simulated charge reconnection on your vehicle for 24 hours. One attempt per episode; stop if state changes.')}</p><Button variant="filled" onClick={()=>{void client.command({operation:'policy',enabled:true});setPolicyReview(false);}}>{t('이 범위로 허용','Allow this boundary')}</Button><Button onClick={()=>setPolicyReview(false)}>{t('취소','Cancel')}</Button></div>:<Button disabled={board.busy} onClick={()=>state.policy.enabled?void client.command({operation:'policy',enabled:false}):setPolicyReview(true)}>{state.policy.enabled?t('자동 대응 끄기','Disable automatic response'):t('자동 대응 설정','Configure automatic response')}</Button>}
      </Card></div>:null}
      {page==='assistance'?<LearnedCases state={state} client={client} busy={board.busy}/>:null}
      {page==='assistance'?<Details summary={t('차량 시뮬레이터','Vehicle simulator')}><div className="aide-simulator"><label>{t('가상 배터리','Simulated battery')} {soc}%<input type="range" min="0" max="100" value={soc} onChange={event=>setSoc(Number(event.target.value))} disabled={!vehicle.parked||board.busy}/></label><div className="ops-actions">{(['none','charge_handshake','battery_hot','unknown'] as const).map(fault=><Button key={fault} disabled={board.busy||!vehicle.parked} onClick={()=>void client.command({operation:'telemetry',batteryPercent:soc,fault,language,...(fault==='unknown'?{signal:'charge_link_timeout'}:{})})}>{fault==='none'?t('상태 적용','Apply state'):fault==='charge_handshake'?t('충전 연결 문제','Charging connection fault'):fault==='battery_hot'?t('배터리 과열','Battery overheating'):t('낯선 충전 증상','Unfamiliar charging symptom')}</Button>)}</div></div></Details>:null}
    </>}
  </div>;
}
