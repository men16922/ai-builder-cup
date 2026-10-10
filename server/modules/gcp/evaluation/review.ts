import { z } from 'zod';
import { cloudDigest } from '../../../cloud-integrity';
import { checkGcpModelAnalysis } from '../../../../src/modules/gcp/domain/analysis';
import { scenarioIds } from './scenarios';
import type { EvaluationPack } from './pack';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const time = z.iso.datetime().nullable();
export const recordedRunSchema = z.object({
  schemaVersion: z.literal(1), suiteDigest: digest, caseId: z.enum(scenarioIds), language: z.enum(['ko', 'en']), requestDigest: digest,
  provenance: z.enum(['synthetic-control', 'recorded-unverified']),
  modelId: z.string().min(1).max(200).nullable(), location: z.string().min(1).max(100).nullable(), configurationDigest: digest.nullable(),
  outcome: z.enum(['not_run', 'returned', 'failed', 'unknown']), startedAt: time, finishedAt: time, rawResponse: z.string().max(65536).nullable(),
}).strict().superRefine((run, ctx) => {
  const valid = run.outcome === 'not_run' ? run.startedAt === null && run.finishedAt === null && run.rawResponse === null
    : run.startedAt !== null && run.finishedAt !== null && Date.parse(run.finishedAt) >= Date.parse(run.startedAt)
      && run.modelId !== null && run.location !== null && run.configurationDigest !== null
      && (run.outcome === 'returned' ? run.rawResponse !== null : run.rawResponse === null);
  if (!valid) ctx.addIssue({ code: 'custom', message: 'Execution evidence is incomplete or inconsistent.' });
});
export const humanReviewSchema = z.object({
  suiteDigest: digest, caseDigest: digest, requestDigest: digest, responseDigest: digest, language: z.enum(['ko', 'en']),
  reviewer: z.string().trim().min(1).max(100), reviewedAt: z.iso.datetime(),
  criteria: z.array(z.object({ id: z.string().min(1).max(100), verdict: z.enum(['unreviewed', 'pass', 'fail', 'unknown']), note: z.string().trim().max(2000), sourceIds: z.array(z.string()).max(8) }).strict()).min(1).max(20),
}).strict();
/** Verifies artifact binding, never claims that an imported response came from Gemini. */
export function assessRecordedRun(pack: EvaluationPack, raw: unknown, review?: unknown) {
  const { digest: packDigest, ...content } = pack;
  if (cloudDigest(content) !== packDigest) throw Error('Evaluation pack integrity mismatch.');
  const run = recordedRunSchema.parse(raw), request = pack.requests.find(item => item.caseId === run.caseId && item.language === run.language);
  const scenario = pack.scenarios.find(item => item.id === run.caseId);
  if (!request || !scenario || run.suiteDigest !== pack.digest || run.requestDigest !== request.digest) throw Error('Evaluation input changed; prepare a new record.');
  const responseDigest = cloudDigest(run), sourceIds = scenario.evidence.observations.map(item => item.id);
  let contract: 'not_run' | 'passed' | 'model_response_invalid' | 'model_citation_invalid' = 'not_run';
  if (run.outcome === 'returned') {
    let parsed: unknown; try { parsed = JSON.parse(run.rawResponse!); } catch { /* recorded invalid JSON remains reviewable as a failed contract */ }
    const checked = checkGcpModelAnalysis(parsed, sourceIds); contract = checked.ok ? 'passed' : checked.code;
  }
  let semantics: 'not_run' | 'unreviewed' | 'not_reviewable' | 'human_pass' | 'human_fail' | 'unknown' = run.outcome === 'not_run' ? 'not_run' : contract === 'passed' ? 'unreviewed' : 'not_reviewable';
  let human: z.infer<typeof humanReviewSchema> | null = null;
  if (review !== undefined) {
    human = humanReviewSchema.parse(review);
    if (run.outcome !== 'returned' || contract !== 'passed' || human.suiteDigest !== pack.digest || human.caseDigest !== scenario.digest || human.requestDigest !== request.digest || human.responseDigest !== responseDigest || human.language !== run.language
      || Date.parse(human.reviewedAt) < Date.parse(run.finishedAt!) || human.criteria.length !== scenario.criteria.length
      || new Set(human.criteria.map(item => item.id)).size !== scenario.criteria.length) throw Error('Review does not match this output.');
    for (const item of human.criteria) {
      const rubric = scenario.criteria.find(value => value.id === item.id);
      if (!rubric || item.sourceIds.some(id => !sourceIds.includes(id)) || new Set(item.sourceIds).size !== item.sourceIds.length
        || (item.verdict !== 'unreviewed' && (!item.note || !item.sourceIds.length || !item.sourceIds.some(id => rubric.sourceIds.includes(id))))) throw Error('Review needs an explanation and relevant source IDs.');
    }
    semantics = human.criteria.some(item => item.verdict === 'fail') ? 'human_fail'
      : human.criteria.some(item => item.verdict === 'unreviewed') ? 'unreviewed'
        : human.criteria.some(item => item.verdict === 'unknown') ? 'unknown' : 'human_pass';
  }
  return { caseId: run.caseId, language: run.language, provenance: run.provenance, outcome: run.outcome, responseDigest, contract, semantics,
    modelLatencyMs: run.startedAt && run.finishedAt ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : null,
    manualTaskTimeMs: null, appTaskTimeMs: null, liveInvocationVerified: false, humanReview: human,
    limitation: 'Contract checks verify structure and citation existence only. Human judgments and imported provenance are not independently verified. No model accuracy or task-time improvement is inferred.' };
}
export function reviewTemplate(pack: EvaluationPack, raw: unknown) {
  const result = assessRecordedRun(pack, raw), run = recordedRunSchema.parse(raw), scenario = pack.scenarios.find(item => item.id === run.caseId)!;
  return { suiteDigest: pack.digest, caseDigest: scenario.digest, requestDigest: run.requestDigest, responseDigest: result.responseDigest, language: run.language,
    reviewer: '', reviewedAt: '', criteria: scenario.criteria.map(item => ({ id: item.id, verdict: 'unreviewed', note: '', sourceIds: [] })) };
}
