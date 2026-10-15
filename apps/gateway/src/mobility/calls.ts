import type { MobilityState, SimulatedVehicle, VehicleCall } from '@contracts/gcp/mobility';

/** Synthetic callers. Every name, goal and schedule is fictional; no call reaches a real person. */
const personas = {
  meeting_reschedule: {
    ko: { name: '김지훈 팀장', relation: '회사 팀장', goal: '오후 3시 디자인 리뷰를 4시 30분으로 미루고 싶고, 회의 전에 발표 자료를 메일로 받고 싶다.' },
    en: { name: 'Jordan Kim', relation: 'Team lead', goal: 'Wants to move the 3:00 pm design review to 4:30 pm and needs the slide deck emailed before the meeting.' },
  },
  family_pickup: {
    ko: { name: '엄마', relation: '가족', goal: '저녁 6시에 학원이 끝나는 민서를 데려올 수 있는지 묻고, 오는 길에 우유를 사 오라고 부탁한다.' },
    en: { name: 'Mom', relation: 'Family', goal: 'Asks whether the driver can pick up Minseo from the academy at 6:00 pm and buy milk on the way.' },
  },
  delivery: {
    ko: { name: '택배 기사', relation: '배송', goal: '오늘 오후 택배가 도착하는데 집에 아무도 없어 어디에 맡길지 묻는다. 비밀번호 같은 민감한 정보는 묻지 않는다.' },
    en: { name: 'Courier', relation: 'Delivery', goal: 'A parcel arrives this afternoon and nobody is home; asks where to leave it. Never asks for door codes or other secrets.' },
  },
} as const;
export type CallScenario = keyof typeof personas;
export const callPersona = (scenario: CallScenario, language: 'ko' | 'en') => personas[scenario][language];

/** What My Aide may know about the driver: a fictional schedule plus the simulated vehicle and trip. */
export function driverContext(state: MobilityState, language: 'ko' | 'en', now = Date.now()): string {
  const clock = new Date(now).toLocaleString(language === 'ko' ? 'ko-KR' : 'en-US', { timeZone: 'Asia/Seoul', weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const vehicle = state.vehicle, journey = state.journey;
  const trip = journey?.state === 'moving' && journey.destination ? (language === 'ko' ? `${journey.destination.name}(으)로 이동 중, ${Math.round(journey.progress * 100)}% 진행` : `driving to ${journey.destination.name}, ${Math.round(journey.progress * 100)}% complete`)
    : language === 'ko' ? '주차 중' : 'parked';
  return language === 'ko'
    ? `현재 시각: ${clock} (KST). 오늘 일정(가상): 15:00 디자인 리뷰, 18:30 저녁 약속. 차량(가상): 배터리 ${vehicle?.batteryPercent ?? '?'}%, ${trip}. 집 택배는 경비실 보관을 선호함.`
    : `Now: ${clock} (KST). Today (fictional): 3:00 pm design review, 6:30 pm dinner plan. Vehicle (simulated): battery ${vehicle?.batteryPercent ?? '?'}%, ${trip}. Prefers parcels left at the building concierge.`;
}

export type CallInput = {
  scenario: CallScenario; language: 'ko' | 'en'; caller: { name: string; relation: string }; goal: string; driverContext: string;
  handledBy: 'driver' | 'aide'; step: 'open' | 'reply' | 'delegate' | 'summary'; turns: { role: VehicleCall['turns'][number]['role']; text: string }[];
};

const BATTERY_KWH = 77.4, CHARGE_SPEEDUP = 20, AMBIENT_CELSIUS = 24, CABIN_DEGREES_PER_SECOND = .25;
/** Charging and cabin climate progress from stored start points; reads stay side-effect free. */
export function settleVehicle(vehicle: SimulatedVehicle, now: number) {
  const session = vehicle.chargeSession;
  if (vehicle.charging === 'charging' && session && vehicle.fault === 'none') {
    const hours = Math.max(0, now - Date.parse(session.startedAt)) / 3_600_000 * CHARGE_SPEEDUP;
    const percent = Math.min(vehicle.targetPercent, session.startPercent + session.powerKw * hours / BATTERY_KWH * 100);
    vehicle.batteryPercent = Math.max(vehicle.batteryPercent, Math.floor(percent)); vehicle.rangeKm = Math.round(vehicle.batteryPercent * 5.2);
    if (percent >= vehicle.targetPercent) { vehicle.charging = 'idle'; vehicle.powerKw = 0; delete vehicle.chargeSession; }
  }
  const climate = vehicle.climate;
  if (climate.changedAt) {
    const goal = climate.on ? climate.targetCelsius : AMBIENT_CELSIUS, moved = Math.max(0, now - Date.parse(climate.changedAt)) / 1000 * CABIN_DEGREES_PER_SECOND;
    const cabin = climate.cabinCelsius < goal ? Math.min(goal, climate.cabinCelsius + moved) : Math.max(goal, climate.cabinCelsius - moved);
    vehicle.climate = { on: climate.on, targetCelsius: climate.targetCelsius, cabinCelsius: Math.round(cabin * 10) / 10, ...(cabin === goal ? {} : { changedAt: new Date(now).toISOString() }) };
  }
}

/** Resolves a model-drafted follow-up time on the server: the model names the agreed KST day and clock time, never does date arithmetic. */
export function followupWhen(item: { minutesFromNow?: number; dayOffset?: number; localTime?: string }, now: number): { when?: string } {
  if (item.localTime) {
    const kst = new Date(now + 9 * 3_600_000), [hour, minute] = item.localTime.split(':').map(Number);
    return { when: new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + (item.dayOffset ?? 0), hour, minute) - 9 * 3_600_000).toISOString() };
  }
  return item.minutesFromNow === undefined ? {} : { when: new Date(now + item.minutesFromNow * 60_000).toISOString() };
}
