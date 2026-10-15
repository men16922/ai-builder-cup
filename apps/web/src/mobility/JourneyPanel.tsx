import { useState, useSyncExternalStore } from 'react';
import type { MobilityPlace } from '@contracts/gcp/mobility';
import { useLanguage } from '../i18n';
import { Button, Card, Icon, StatusChip } from '../ui';
import GoogleJourneyMap from './GoogleJourneyMap';
import GroundedText from './GroundedText';
import type { MobilityClient } from './mobility-client';

/** Destination selection is explicit unless the server proves favorite or matching remembered consent. */
export default function JourneyPanel({ client, initialKind='restaurant' }: { client: MobilityClient; initialKind?:'restaurant'|'charging'|'poi' }) {
  const { t, language } = useLanguage(), board = useSyncExternalStore(client.subscribe, client.getSnapshot), state = board.state;
  const [instruction, setInstruction] = useState(''), [kind, setKind] = useState<'restaurant'|'charging'|'poi'>(initialKind), [remember, setRemember] = useState(true);
  const journey = state?.journey;
  const vehicle = state?.vehicle;
  const km = (place: MobilityPlace) => journey ? Math.hypot((place.location.latitude-journey.origin.latitude)*111, (place.location.longitude-journey.origin.longitude)*88) : 0;
  const arrival = (place: MobilityPlace) => Math.max(0, (vehicle?.batteryPercent ?? 0) - Math.max(1, Math.round(km(place)/5.2)));
  const examples = { restaurant: t('근처 저녁 먹을 곳을 추천하고 이동해 줘.', 'Find somewhere nearby for dinner and take me there.'), charging: t('근처 충전소를 찾아서 이동해 줘.', 'Find a charging station nearby and take me there.'), poi: t('근처 가볼 만한 곳을 찾아서 이동해 줘.', 'Find somewhere interesting nearby and take me there.') };
  const moving = journey?.state === 'moving';
  return <Card title={t('어디로 갈까요?', 'Where shall we go?')} description={t('처음엔 선택을 받고, 같은 맥락의 기억된 선택은 다음 이동에 사용합니다.', 'Choose first. A remembered choice in the same context can handle the next journey.')}>
    <div className="aide-trip-form"><div className="aide-segment" role="group" aria-label={t('목적지 종류', 'Destination type')}>
      {(['restaurant','charging','poi'] as const).map(value => <button key={value} type="button" aria-pressed={kind===value} disabled={!!moving} onClick={()=>setKind(value)}>{value==='restaurant'?t('오늘 저녁','Dinner'):value==='charging'?t('충전소','Charging'):t('주변 장소','Explore')}</button>)}
    </div><label className="aide-sr" htmlFor="journey-instruction">{t('Aide에게 이동 요청', 'Ask Aide for a journey')}</label>
      <textarea id="journey-instruction" value={instruction} maxLength={300} placeholder={examples[kind]} onChange={event=>setInstruction(event.target.value)} disabled={!!moving} />
      <Button variant="filled" loading={board.busy} disabled={!!moving||!state?.vehicle||!state.mapsAvailable} onClick={()=>void client.command({operation:'trip_request',kind,instruction:instruction.trim()||examples[kind],language})}>{t('Aide에게 맡기기','Let Aide handle it')}</Button>
      {!state?.mapsAvailable?<p className="ops-caption">{t('Google Places 연결을 준비 중입니다. 장소를 임의로 만들지 않습니다.','Google Places is not connected yet. Places are never fabricated.')}</p>:null}
    </div>
    {journey?<section className="aide-journey" aria-label={t('이동 시뮬레이션','Journey simulation')}>
      <div className="aide-journey-header"><StatusChip type={moving?'info':journey.state==='arrived'?'success':'pending'}>{moving?t('시뮬레이션 이동 중','Simulated driving'):journey.state==='arrived'?t('도착','Arrived'):journey.state==='cancelled'?t('이동 취소','Cancelled'):t('목적지를 선택하세요','Choose a destination')}</StatusChip>
        {journey.consent==='remembered-context'||journey.consent==='favorite'?<span className="ops-caption">{journey.consent==='favorite'?t('저장한 Favorite 사용','Using your Favorite'):t('같은 상황의 이전 선택 사용','Using your previous choice in this context')}</span>:null}</div>
      {state?.mapsBrowserKey ? <GoogleJourneyMap apiKey={state.mapsBrowserKey} latitude={journey.position.latitude} longitude={journey.position.longitude} journey={journey} places={journey.candidates} batteryPercent={vehicle?.batteryPercent} onCall={state.call?.state==='active'}/> : null}
      <div className={`aide-map-simulation${state?.mapsBrowserKey ? ' aide-map-fallback-hidden' : ''}`} role="img" aria-label={t(`이동 진행 ${Math.round(journey.progress*100)}퍼센트`,`Journey ${Math.round(journey.progress*100)} percent complete`)}>
        <svg viewBox="0 0 700 250" aria-hidden="true"><defs><pattern id="street-grid" width="70" height="50" patternUnits="userSpaceOnUse"><path d="M70 0H0V50" fill="none" stroke="currentColor" strokeWidth="1" /></pattern></defs><rect width="700" height="250" fill="url(#street-grid)" opacity=".2"/><path d="M90 190L600 55" stroke="var(--md-sys-color-primary)" strokeWidth="5" strokeDasharray="8 8" fill="none"/><circle cx="90" cy="190" r="8" fill="currentColor"/><circle cx="600" cy="55" r="12" fill="var(--md-sys-color-primary)"/><g transform={`translate(${90+510*journey.progress} ${190-135*journey.progress})`}><circle r="22" fill="var(--md-sys-color-primary)"/><path d="M-9 9L0-12 9 9 0 5Z" fill="white"/></g></svg>
        <span>{t('직선 경로 시뮬레이션 · 실제 도로 안내 아님','Straight-line simulation · not road navigation')}</span>
      </div>
      {journey.state==='arrived'&&journey.kind==='charging'&&vehicle?<div className="aide-arrival-charge"><Icon name="bolt" size={22}/><div><strong>{vehicle.charging==='charging'?t(`충전 중 · ${vehicle.powerKw} kW · ${vehicle.batteryPercent}%`,`Charging · ${vehicle.powerKw} kW · ${vehicle.batteryPercent}%`):t('충전소에 도착했어요','You have arrived at the charger')}</strong><p>{t(`충전 한도 ${vehicle.targetPercent}% · 가속 시뮬레이션`,`Charge limit ${vehicle.targetPercent}% · accelerated simulation`)}</p></div>
        {vehicle.charging==='charging'?<Button disabled={board.busy} onClick={()=>void client.command({operation:'control',action:'stop_charging'})}>{t('충전 중지','Stop charging')}</Button>:<Button variant="filled" icon="bolt" loading={board.busy} disabled={vehicle.batteryPercent>=vehicle.targetPercent} onClick={()=>void client.command({operation:'control',action:'start_charging'})}>{t('충전 시작','Start charging')}</Button>}</div>:null}
      {journey.destination?<div className="aide-destination">{journey.destination.photo?<PlacePhoto place={journey.destination}/>:null}<strong>{journey.destination.name}</strong><p>{journey.destination.address}</p><a target="_blank" rel="noopener noreferrer" href={journey.destination.mapsUrl??`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(journey.destination.name)}&query_place_id=${encodeURIComponent(journey.destination.id)}`}>{t('Google Maps에서 확인','View on Google Maps')}</a></div>:null}
      {journey.searchSummary?<div className="aide-maps-grounded-output"><GroundedText text={journey.searchSummary}/><div className="aide-maps-sources">{journey.candidates.map((place,index)=><a key={place.id} target="_blank" rel="noopener noreferrer" href={place.mapsUrl??`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=${encodeURIComponent(place.id)}`}>[{index}] Google Maps · {place.name}</a>)}</div></div>:null}
      {journey.state==='choosing'?<><label className="aide-remember"><input type="checkbox" checked={remember} onChange={event=>setRemember(event.target.checked)}/>{t('7일 동안 같은 상황의 선택 기억','Remember this choice in the same context for 7 days')}</label>
        <div className="aide-places">{journey.candidates.map((place,index)=><article key={place.id}><PlacePhoto place={place} index={index+1}/><div><h3><span className="aide-place-index" aria-hidden="true">{index+1}</span>{place.name}</h3>{place.address?<p>{place.address}</p>:null}<span className="ops-caption">{place.rating!==undefined?`★ ${place.rating} · `:''}{t(`${km(place).toFixed(1)}km · 도착 시 배터리 ${arrival(place)}%`,`${km(place).toFixed(1)} km · ${arrival(place)}% on arrival`)}{place.kind==='charging'?` · ${place.availablePorts===undefined?t('사용 가능 충전기 미확인','Available ports unknown'):t(`${place.availablePorts}개 사용 가능`,`${place.availablePorts} ports available`)}`:''}</span></div><div className="ops-actions"><Button loading={board.busy} variant="filled" onClick={()=>void client.command({operation:'select_destination',journeyId:journey.id,placeId:place.id,remember})}>{t('여기로 이동','Go here')}</Button><Button disabled={board.busy||state?.favorites.some(saved=>saved.id===place.id)} onClick={()=>void client.command({operation:'favorite',journeyId:journey.id,placeId:place.id})}>{state?.favorites.some(saved=>saved.id===place.id)?t('Favorite 저장됨','Favorite saved'):t('Favorite 저장','Save Favorite')}</Button></div></article>)}</div><p className="ops-caption">Google Maps</p></>:null}
      {moving&&!board.journeyRunning?<><p className="ops-caption">{t('읽기·새로고침 후에는 자동으로 이동을 이어가지 않습니다. 현재 상태를 확인하고 계속하거나 취소하세요.','Reading or refreshing does not resume movement. Check the current state, then continue or cancel.')}</p><Button variant="filled" loading={board.busy} onClick={()=>void client.command({operation:'advance',journeyId:journey.id})}>{t('시뮬레이션 계속','Continue simulation')}</Button></>:null}
      {moving?<Button onClick={()=>void client.command({operation:'stop',journeyId:journey.id})} disabled={board.busy}>{t('이동 취소','Cancel journey')}</Button>:null}
    </section>:null}
  </Card>;
}

/** Google Places photo with its required author attribution; a neutral tile when Google has no photo. */
function PlacePhoto({ place, index }: { place: MobilityPlace; index?: number }) {
  const { t } = useLanguage();
  return <figure className="aide-place-photo">{place.photo?<img src={place.photo.uri} alt={t(`${place.name} 사진`,`Photo of ${place.name}`)} loading="lazy" referrerPolicy="no-referrer"/>:<div className="aide-place-photo-empty" aria-hidden="true"><Icon name="map" size={28}/></div>}
    {index?<span className="aide-place-badge" aria-hidden="true">{index}</span>:null}
    {place.photo?.attributions.length?<figcaption>{t('사진','Photo')}: {place.photo.attributions.map((author,i)=><span key={i}>{i?', ':''}{author.uri?<a href={author.uri} target="_blank" rel="noopener noreferrer">{author.name}</a>:author.name}</span>)} · Google Maps</figcaption>:null}</figure>;
}
