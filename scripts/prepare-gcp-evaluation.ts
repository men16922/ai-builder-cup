import { mkdtempSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareEvaluation, blankRuns } from '../apps/gateway/src/evaluation/pack';
import { assessRecordedRun, reviewTemplate } from '../apps/gateway/src/evaluation/review';

if (process.env.MOBILEOPS_OFFLINE_TEST !== '1') throw Error('Offline preparation only. Set MOBILEOPS_OFFLINE_TEST=1.');
const args = process.argv.slice(2);
if (args.length && (args[0] !== '--record' || args.length < 2 || args.length > 3)) throw Error('Usage: prepare:gcp-evaluation [--record RUN.json [REVIEW.json]]');
const read = (path: string) => {
  if (!statSync(path).isFile() || statSync(path).size > 262144) throw Error('Expected a bounded JSON file.');
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
};
const pack = await prepareEvaluation(), directory = mkdtempSync(join(tmpdir(), 'mobileops-gcp-evaluation-'));
const write = (name: string, value: unknown) => writeFileSync(join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
write('pack.json', pack);
write('runs-template.json', blankRuns(pack));
if (args.length) {
  const record = read(args[1]), review = args[2] ? read(args[2]) : undefined;
  write('record.json', record);
  write('assessment.json', assessRecordedRun(pack, record, review));
  write('review-template.json', reviewTemplate(pack, record));
}
const lines = ['# Aide · GCP 해석 평가 자료', '',
  '합성 근거 8종 × 한국어/영어 = 요청 16개. 실제 모델 호출은 수행하지 않았습니다.',
  'pack.json의 requests[].body만 모델 입력입니다. raw·criteria·comparison은 검토자용으로 입력에 섞지 않습니다.',
  'runs-template.json의 한 항목을 별도 RUN.json에 복사해 기록합니다. modelId/location/configurationDigest·시각·원문을 실제 기록과 맞춰 기입하세요. 실호출은 지정 대상/비용 허용 후 별도 경로에서 수행해야 합니다.',
  'npm run prepare:gcp-evaluation -- --record RUN.json [REVIEW.json]은 파일만 검사하며 모델을 호출하지 않습니다. 가져온 응답의 실제 출처를 증명하지 않습니다.',
  '생성된 review-template.json에 검토자/시각·각 항목 판단과 근거를 작성합니다. 구조 통과는 의미 통과가 아닙니다. 틀린 문장도 올바른 출처 ID로 구조 검사를 통과할 수 있습니다.',
  '회복 전후 두 출력을 함께 비교하세요. 모델에는 각 시점만 전달되므로 이전 시점이나 변화 원인을 알고 있다고 쓰면 안 됩니다. 실제 모델 평가와 수동/앱 작업 시간 측정은 별도입니다.', '',
  ...pack.scenarios.flatMap(s => [`## ${s.id} · ${s.title}`, '', `관측: ${s.snapshot.observedAt} / 근거 ID: ${s.evidence.id}`, `관측 일관성: ${s.snapshot.consistency} / 서비스 정상: unknown`, '', ...s.criteria.flatMap(c => [`- ${c.id}: ${c.requirement}`, `  - 금지 판단: ${c.unacceptable}`, `  - 대조 출처: ${c.sourceIds.join(', ')}`]), '']),
];
writeFileSync(join(directory, 'REVIEW.md'), lines.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
console.log(`Offline evaluation prepared: ${pack.scenarios.length} scenarios, ${pack.requests.length} requests, no model invocation.\nArtifacts: ${directory}`);
