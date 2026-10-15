import type { SimulatedVehicle } from '@contracts/gcp/mobility';
import { useLanguage } from '../i18n';

type Part = 'charge_port' | 'battery' | 'tire_rl' | 'unknown' | null;
/** Which part of the car the current simulated fault points to. */
export function faultPart(vehicle: SimulatedVehicle): Part {
  if (vehicle.fault === 'charge_handshake' || vehicle.fault === 'unknown' && vehicle.diagnosticSignal === 'charge_link_timeout') return 'charge_port';
  if (vehicle.fault === 'battery_hot') return 'battery';
  if (vehicle.fault === 'tire_low') return 'tire_rl';
  return vehicle.fault === 'unknown' ? 'unknown' : null;
}

/** Instrument cluster and a top-down car diagram: the affected part glows; everything else reads normal. */
export default function DiagnosisCluster({ vehicle }: { vehicle: SimulatedVehicle }) {
  const { t } = useLanguage(), part = faultPart(vehicle);
  const headline = part === 'charge_port' ? t('충전 포트 연결 점검 필요', 'Charge port connection needs attention') : part === 'battery' ? t('배터리 온도 높음', 'Battery temperature high')
    : part === 'tire_rl' ? t('뒤 왼쪽 타이어 공기압 낮음', 'Rear-left tire pressure low') : part === 'unknown' ? t('분류되지 않은 경고', 'Unclassified warning') : t('모든 시스템 정상', 'All systems normal');
  const ring = (value: number, max: number) => { const c = 2 * Math.PI * 34; return { strokeDasharray: `${c}`, strokeDashoffset: `${c * (1 - Math.min(1, Math.max(0, value / max)))}` }; };
  const tire = (index: number) => vehicle.tiresBar[index].toFixed(1);
  const hot = (name: Part) => part === name ? ' is-fault' : '';
  return <section className={`aide-cluster${part ? ' has-fault' : ''}`} aria-label={t('차량 계기판', 'Vehicle cluster')}>
    <header className="aide-cluster-head"><span className={`aide-cluster-dot${part ? ' is-fault' : ''}`} /><strong>{headline}</strong><span className="aide-drive-sim">SIM</span></header>
    <div className="aide-cluster-body">
      <div className="aide-gauges">
        <figure className="aide-gauge"><svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34" className="aide-gauge-track" /><circle cx="40" cy="40" r="34" className="aide-gauge-value" style={ring(vehicle.batteryPercent, 100)} /></svg>
          <figcaption><strong>{vehicle.batteryPercent}<small>%</small></strong><span>{t('배터리', 'Battery')}</span></figcaption></figure>
        <figure className={`aide-gauge${hot('battery')}`}><svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34" className="aide-gauge-track" /><circle cx="40" cy="40" r="34" className="aide-gauge-value" style={ring(vehicle.batteryCelsius, 60)} /></svg>
          <figcaption><strong>{vehicle.batteryCelsius}<small>°C</small></strong><span>{t('배터리 온도', 'Battery temp')}</span></figcaption></figure>
        <dl className="aide-cluster-facts">
          <div><dt>{t('주행 가능', 'Range')}</dt><dd>{vehicle.rangeKm} km</dd></div>
          <div><dt>{t('충전', 'Charging')}</dt><dd>{vehicle.charging === 'charging' ? `${vehicle.powerKw} kW` : vehicle.charging === 'interrupted' ? t('중단됨', 'Interrupted') : t('대기', 'Idle')}</dd></div>
          <div><dt>{t('실내', 'Cabin')}</dt><dd>{vehicle.climate.cabinCelsius}°C</dd></div>
          <div><dt>{t('누적 주행', 'Odometer')}</dt><dd>{vehicle.odometerKm.toLocaleString()} km</dd></div>
        </dl>
      </div>
      <svg className="aide-car-diagram" viewBox="-40 0 280 320" role="img" aria-label={t(`차량 도식: ${headline}`, `Vehicle diagram: ${headline}`)}>
        <rect x="46" y="20" width="108" height="280" rx="46" className="aide-car-body" />
        <path d="M62 86 Q100 66 138 86 L132 112 Q100 102 68 112 Z" className="aide-car-glass" />
        <path d="M66 236 Q100 246 134 236 L136 258 Q100 270 64 258 Z" className="aide-car-glass" />
        <rect x="70" y="124" width="60" height="96" rx="10" className={`aide-part${hot('battery')}`} /><text x="100" y="176" className="aide-part-label">{t('배터리', 'Battery')}</text>
        <rect x="80" y="262" width="40" height="18" rx="6" className="aide-part" /><text x="100" y="275" className="aide-part-label small">{t('모터', 'Motor')}</text>
        <circle cx="47" cy="200" r="7" className={`aide-part${hot('charge_port')}`} /><path d="M40 200 H8" className="aide-part-leader" /><text x="4" y="203" className="aide-part-label small end">{t('충전 포트', 'Charge port')}</text>
        {[[34, 62, 0], [154, 62, 1], [34, 218, 2], [154, 218, 3]].map(([x, y, index]) => <g key={index}>
          <rect x={x} y={y} width="14" height="44" rx="5" className={`aide-tire${index === 2 && part === 'tire_rl' ? ' is-fault' : ''}`} />
          <text x={index % 2 ? x + 30 : x - 14} y={y + 26} className={`aide-part-label small${index === 2 && part === 'tire_rl' ? ' warn-small' : ''}`}>{tire(index)}</text></g>)}
        {part === 'unknown' ? <text x="100" y="56" className="aide-part-label warn">?</text> : null}
      </svg>
    </div>
    <p className="aide-cluster-note">{t('타이어 단위 bar · 가상 센서값', 'Tires in bar · simulated sensor values')}</p>
  </section>;
}
