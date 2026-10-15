import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLanguage } from '../i18n';
import { Icon, type IconName } from '../ui';
import type { MobilityClient } from './mobility-client';

/** Remote controls for the simulated car, laid out like a phone key: one tap per action, state on the tile. */
export default function VehicleControls({ client }: { client: MobilityClient }) {
  const { t } = useLanguage(), board = useSyncExternalStore(client.subscribe, client.getSnapshot), vehicle = board.state?.vehicle;
  const [toast, setToast] = useState(''), [limit, setLimit] = useState(80);
  useEffect(() => { if (vehicle) setLimit(vehicle.targetPercent); }, [vehicle?.targetPercent]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 2600); return () => clearTimeout(timer); }, [toast]);
  if (!vehicle) return null;
  const run = async (action: string, done: string, value?: number) => {
    await client.command({ operation: 'control', action, ...(value === undefined ? {} : { value }) });
    if (!client.getSnapshot().error) setToast(done);
  };
  const charging = vehicle.charging === 'charging', climate = vehicle.climate;
  const tile = (icon: IconName, label: string, status: string, active: boolean, onClick: () => void, disabled = false) =>
    <button type="button" className={`aide-control${active ? ' is-on' : ''}`} aria-pressed={active} disabled={board.busy || disabled} onClick={onClick}>
      <span className="aide-control-icon"><Icon name={icon} size={22} /></span><strong>{label}</strong><span>{status}</span></button>;
  return <section className="aide-controls" aria-label={t('차량 제어', 'Vehicle controls')}>
    <div className="aide-control-grid">
      {tile(vehicle.locked ? 'lock' : 'lock_open', vehicle.locked ? t('잠김', 'Locked') : t('열림', 'Unlocked'), vehicle.locked ? t('눌러서 열기', 'Tap to unlock') : t('눌러서 잠그기', 'Tap to lock'), vehicle.locked,
        () => void run(vehicle.locked ? 'unlock' : 'lock', vehicle.locked ? t('차 문을 열었어요', 'Doors unlocked') : t('차 문을 잠갔어요', 'Doors locked')))}
      {tile('fan', t('공조', 'Climate'), climate.on ? t(`실내 ${climate.cabinCelsius}° → ${climate.targetCelsius}°`, `Cabin ${climate.cabinCelsius}° → ${climate.targetCelsius}°`) : t(`꺼짐 · 실내 ${climate.cabinCelsius}°`, `Off · cabin ${climate.cabinCelsius}°`), climate.on,
        () => void run(climate.on ? 'climate_off' : 'climate_on', climate.on ? t('공조를 껐어요', 'Climate off') : t('출발 전에 실내 온도를 맞추고 있어요', 'Preconditioning the cabin')))}
      {tile('bolt', charging ? t('충전 중', 'Charging') : t('충전', 'Charge'), charging ? `${vehicle.powerKw} kW · ${vehicle.batteryPercent}%` : t(`한도 ${vehicle.targetPercent}%`, `Limit ${vehicle.targetPercent}%`), charging,
        () => void run(charging ? 'stop_charging' : 'start_charging', charging ? t('충전을 멈췄어요', 'Charging stopped') : t('충전을 시작했어요', 'Charging started')), !charging && (!vehicle.parked || vehicle.batteryPercent >= vehicle.targetPercent))}
      {tile('light', t('라이트', 'Flash'), t('차 위치 찾기', 'Find my car'), false, () => void run('flash', t('라이트를 깜빡였어요', 'Lights flashed')))}
      {tile('volume', t('경적', 'Honk'), t('주차장에서 찾기', 'Locate in a lot'), false, () => void run('honk', t('경적을 울렸어요', 'Horn sounded')))}
    </div>
    <div className="aide-control-settings">
      <label className="aide-temp"><span>{t('희망 온도', 'Cabin target')}</span>
        <span className="aide-stepper"><button type="button" aria-label={t('온도 내리기', 'Lower temperature')} disabled={board.busy || climate.targetCelsius <= 16} onClick={() => void run('set_temperature', t(`희망 온도 ${climate.targetCelsius - .5}°`, `Target ${climate.targetCelsius - .5}°`), climate.targetCelsius - .5)}><Icon name="minus" size={18} /></button>
          <strong>{climate.targetCelsius.toFixed(1)}°</strong>
          <button type="button" aria-label={t('온도 올리기', 'Raise temperature')} disabled={board.busy || climate.targetCelsius >= 28} onClick={() => void run('set_temperature', t(`희망 온도 ${climate.targetCelsius + .5}°`, `Target ${climate.targetCelsius + .5}°`), climate.targetCelsius + .5)}><Icon name="add" size={18} /></button></span></label>
      <label className="aide-limit"><span>{t('충전 한도', 'Charge limit')} <strong>{limit}%</strong></span>
        <input type="range" min={50} max={100} step={5} value={limit} disabled={board.busy} onChange={event => setLimit(Number(event.target.value))}
          onPointerUp={() => { if (limit !== vehicle.targetPercent) void run('set_charge_limit', t(`충전 한도 ${limit}%`, `Charge limit ${limit}%`), limit); }}
          onKeyUp={() => { if (limit !== vehicle.targetPercent) void run('set_charge_limit', t(`충전 한도 ${limit}%`, `Charge limit ${limit}%`), limit); }} /></label>
    </div>
    <p className="aide-toast" role="status" aria-live="polite">{toast ? <><Icon name="success" size={16} />{toast} · {t('시뮬레이션', 'simulated')}</> : null}</p>
  </section>;
}
