import { agentTaskSchema, type AgentStep, type AgentTask } from '@contracts/gcp/agent';
import { overviewSchema, type Overview } from '@contracts/gcp/overview';

/** A scripted crew for people who cannot sign in. Everything is computed in the browser: no network, no model, no Google call.
 * It returns exactly the shapes the live server returns, and the console validates them with the same schemas. */
type Script = { id: string; instruction: string; language: 'ko' | 'en'; createdAt: number; reads: number; decision?: 'approve' | 'reject'; decidedReads: number };
const SERVICE = 'shop-api', BAD = 'shop-api-bad', GOOD = 'shop-api-good', APPROVAL_MS = 8 * 60_000;

export class RehearsalError extends Error { constructor(code: string) { super(code); } }
export type Rehearsal = { agentCall: (path: string, pending?: { body: unknown; key: string }) => Promise<unknown> };

export function createRehearsal(now: () => number = Date.now): Rehearsal {
  const scripts = new Map<string, Script>(); let rolledBack = false;
  const iso = (millis: number) => new Date(millis).toISOString();

  const steps = (script: Script): AgentStep[] => {
    const ko = script.language === 'ko', at = iso(script.createdAt);
    const all: [string, AgentStep['kind'], string, string][] = [
      ['chief', 'note', ko ? '상태 점검과 원인 조사를 시작합니다.' : 'Starting a health check and root-cause search.', 'plan'],
      ['ops', 'call', ko ? `${SERVICE} 상태, 지표, 오류 로그를 읽습니다.` : `Reading ${SERVICE} state, metrics and error logs.`, 'ops'],
      ['ops', 'result', ko ? `${BAD}가 트래픽 100%를 받고 5xx 비율이 높습니다.` : `${BAD} takes 100% of traffic and its 5xx rate is high.`, 'ops'],
      ['diagnosis', 'result', ko ? `직전 리비전 ${GOOD}은 정상이었고 새 리비전만 실패합니다.` : `The previous revision ${GOOD} was healthy; only the new one fails.`, 'diagnosis'],
      ['guardian', 'result', ko ? '트래픽 롤백은 허용되지만 사람의 승인이 필요합니다.' : 'A traffic rollback is allowed but needs a person\'s approval.', 'guardian'],
    ];
    return all.slice(0, Math.min(all.length, script.reads + 1)).map(([agent, kind, summary, name]) => ({ at, agent, kind, name, summary }));
  };

  const view = (script: Script): AgentTask => {
    script.reads++;
    const ko = script.language === 'ko', current = steps(script);
    const approval = { action: { action: 'rollback_traffic' as const, service: SERVICE, revision: GOOD }, risk: 'medium' as const,
      reason: ko ? '새 리비전이 요청의 절반 이상을 실패시킵니다. 직전 정상 리비전으로 되돌리면 복구됩니다.' : 'The new revision fails more than half of the requests. Going back to the last good revision restores service.',
      requestedAt: iso(script.createdAt), expiresAt: iso(script.createdAt + APPROVAL_MS) };
    const base = { id: script.id, instruction: script.instruction, language: script.language, createdAt: iso(script.createdAt), updatedAt: iso(now()), steps: current };
    let task: AgentTask;
    if (script.decision === 'reject') task = { ...base, state: 'rejected', approval, decision: { value: 'reject', at: iso(now()), byYou: true }, note: ko ? '거절했으므로 아무것도 변경하지 않았습니다.' : 'You rejected it, so nothing was changed.' };
    else if (script.decision === 'approve' && script.decidedReads < 2) { script.decidedReads++; task = { ...base, state: 'deciding', approval, decision: { value: 'approve', at: iso(now()), byYou: true } }; }
    else if (script.decision === 'approve') {
      rolledBack = true;
      task = { ...base, state: 'completed', steps: [...current, { at: iso(now()), agent: 'ops', kind: 'result', name: 'ops', summary: ko ? `트래픽을 ${GOOD}으로 되돌렸습니다.` : `Traffic went back to ${GOOD}.` }],
        decision: { value: 'approve', at: iso(now()), byYou: true }, result: ko
          ? `### 무슨 일이 있었나\n${SERVICE}의 새 리비전이 오류를 냈습니다.\n\n### 한 일\n승인에 따라 트래픽을 ${GOOD}으로 되돌렸습니다.\n\n### 아직 모르는 것\n복구 직후라 오류율 지표는 아직 충분히 쌓이지 않았습니다. 몇 분 뒤 다시 확인하세요.`
          : `### What happened\nThe new ${SERVICE} revision was failing.\n\n### What I did\nWith your approval I sent traffic back to ${GOOD}.\n\n### Still unknown\nThe error-rate metric has not collected enough points since the change. Check again in a few minutes.` };
    } else if (current.length >= 5) task = { ...base, state: 'awaiting_approval', approval };
    else task = { ...base, state: 'working' };
    return agentTaskSchema.parse(task);
  };

  const overview = (): Overview => {
    const at = now();
    const revisions = [{ name: BAD, ready: 'ready' as const, createdAt: iso(at - 40 * 60_000), percent: rolledBack ? 0 : 100 }, { name: GOOD, ready: 'ready' as const, createdAt: iso(at - 3 * 3600_000), percent: rolledBack ? 100 : 0 }];
    return overviewSchema.parse({ generatedAt: iso(at), windowMinutes: 15, services: [{ name: SERVICE, region: 'asia-northeast3', observedAt: iso(at), revisions,
      requests: [{ revision: BAD, responseClass: '2xx', count: 540 }, { revision: BAD, responseClass: '5xx', count: 660 }, { revision: GOOD, responseClass: '2xx', count: rolledBack ? 210 : 0 }].filter(row => row.count > 0),
      latency: [{ revision: BAD, p95Ms: 1304 }, { revision: GOOD, p95Ms: 182 }],
      logs: [4, 3, 2, 1].map(minutes => ({ at: iso(at - minutes * 60_000), severity: 'ERROR', revision: BAD, status: 500, message: 'checkout failed: payment gateway timeout after 5000ms' })),
      coverage: { service: 'ok', requests: 'ok', logs: 'ok' } }] });
  };

  const taskId = (path: string) => /^\/agent-tasks\/([0-9a-f-]{36})(\/decision)?$/.exec(path);
  return { agentCall: async (path, pending) => {
    if (path === '/overview') return overview();
    if (path === '/agent-tasks' && !pending) return { items: [...scripts.values()].reverse().map(view) };
    if (path === '/agent-tasks' && pending) {
      const body = pending.body as { instruction?: unknown; language?: unknown };
      if (typeof body.instruction !== 'string' || !body.instruction.trim() || body.instruction.length > 1000 || (body.language !== 'ko' && body.language !== 'en')) throw new RehearsalError('invalid_request');
      const script: Script = { id: crypto.randomUUID(), instruction: body.instruction.trim(), language: body.language, createdAt: now(), reads: 0, decidedReads: 0 };
      scripts.set(script.id, script); return view(script);
    }
    const match = taskId(path), script = match && scripts.get(match[1]);
    if (!script) throw new RehearsalError('agent_task_not_found');
    if (!match[2]) return view(script);
    const decision = (pending?.body as { decision?: unknown } | undefined)?.decision;
    if (decision !== 'approve' && decision !== 'reject') throw new RehearsalError('invalid_request');
    if (script.decision) throw new RehearsalError('not_awaiting_approval');
    const waiting = view(script);
    if (waiting.state !== 'awaiting_approval') throw new RehearsalError('not_awaiting_approval');
    if (Date.parse(waiting.approval?.expiresAt ?? '') <= now()) throw new RehearsalError('approval_expired');
    script.decision = decision; return view(script);
  } };
}
