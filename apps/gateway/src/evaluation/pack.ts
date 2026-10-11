import { cloudDigest } from '../store/integrity';
import { geminiRequestBody, gcpPromptVersion } from '../google/gemini';
import { buildScenarios, suiteVersion } from './scenarios';

/** No model execution capability. Requests and reviewer-only expectations are separate. */
export async function prepareEvaluation() {
  const scenarios = await buildScenarios();
  const requests = scenarios.flatMap(scenario => (['ko', 'en'] as const).map(language => {
    const body = geminiRequestBody(scenario.evidence, language);
    return { caseId: scenario.id, caseDigest: scenario.digest, language, promptVersion: gcpPromptVersion, body, digest: cloudDigest(body) };
  }));
  const content = { suiteVersion, provenance: 'synthetic-evidence' as const, scenarios, requests,
    comparison: { before: 'recovery-before', after: 'recovery-after', instruction: 'Review both outputs together. The model receives each snapshot separately. It should identify failed versus ready metadata and observed errors versus explicit zero samples. Neither output may establish complete recovery, causality, an interval improvement rate or knowledge of the other snapshot. Compare time windows and preserve historical service UID uncertainty.' },
  };
  return { ...content, digest: cloudDigest(content) };
}
export type EvaluationPack = Awaited<ReturnType<typeof prepareEvaluation>>;
export function blankRuns(pack: EvaluationPack) {
  return pack.requests.map(request => ({ schemaVersion: 1, suiteDigest: pack.digest, caseId: request.caseId, language: request.language, requestDigest: request.digest,
    provenance: 'recorded-unverified', modelId: null, location: null, configurationDigest: null, outcome: 'not_run', startedAt: null, finishedAt: null, rawResponse: null }));
}
