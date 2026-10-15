import type { VehicleCall } from '@contracts/gcp/mobility';

type Draft = NonNullable<VehicleCall['summary']>['followups'][number];
const WEEK_MS = 7 * 24 * 60 * 60_000;

/** Recheck even legacy drafts at the explicit completion tap. This never sends or schedules. */
export function callDraftReady(draft: Draft, now: number): boolean {
  if (!draft.title.trim()) return false;
  if (draft.kind === 'message') return !!draft.body?.trim() && !!draft.to?.trim();
  const when = draft.when ? Date.parse(draft.when) : NaN;
  return Number.isFinite(when) && when > now && when <= now + WEEK_MS;
}

/** Provider proposals must contain what their completion button promises. No invented defaults. */
export const callDraftResponseSchema = {
  type: 'ARRAY', maxItems: 3,
  items: { anyOf: [
    { type: 'OBJECT', required: ['kind','title','body','to'], properties: {
      kind: { type: 'STRING', enum: ['message'] }, title: { type: 'STRING' },
      body: { type: 'STRING', description: 'Nonempty reply draft, supported by the transcript; never claim it was sent.' },
      to: { type: 'STRING', description: 'The fictional recipient name from the call.' },
    } },
    { type: 'OBJECT', required: ['kind','title','dayOffset','localTime'], properties: {
      kind: { type: 'STRING', enum: ['calendar','reminder'] }, title: { type: 'STRING' },
      dayOffset: { type: 'INTEGER', minimum: 0, maximum: 7 },
      localTime: { type: 'STRING', description: 'The agreed KST clock time, 24-hour HH:mm. Never calculate a minute offset.' },
      body: { type: 'STRING' },
    } },
  ] },
};
