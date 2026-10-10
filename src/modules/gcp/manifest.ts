import type { ModuleManifest } from '../contracts';
import icon from './assets/google-cloud.png';
export const gcpModule = { id: 'gcp', name: 'Google Cloud', icon, mobile: true,
  focus: { ko: 'Cloud Run 근거 → Gemini 분석 → 모바일 검토와 인계', en: 'Cloud Run evidence → Gemini analysis → mobile review and handoff' },
} as const satisfies ModuleManifest;
