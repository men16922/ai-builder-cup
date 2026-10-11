import { randomUUID } from 'node:crypto';
import { syntheticTelemetry } from '../tests/fixtures/gcp-telemetry.ts';
import { GcpAnalyses } from '../server/modules/gcp/analyses.ts';
import { GcpOperations } from '../server/modules/gcp/operations.ts';
import { CloudWorkflow } from '../server/cloud-workflow.ts';
import { createCloudRunAdapters } from '../server/modules/gcp/inspection-adapter.ts';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, mkdtemp, rm, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { SqliteCloudStore } from '../server/cloud-sqlite-store.ts';
import { GcpWebAccess } from '../server/modules/gcp/web-access.ts';
import { GcpObservations } from '../server/modules/gcp/observations.ts';
import { CloudRunCollector } from '../server/modules/gcp/cloud-run-collector.ts';
import { CloudRunError } from '../server/modules/gcp/cloud-run-transport.ts';
import { handleGcpApi } from '../server/modules/gcp/api.ts';
if (process.env.MOBILEOPS_OFFLINE_TEST !== '1') throw Error('GCP fixture must remain offline.');
const root = await mkdtemp(join(tmpdir(), 'mobileops-gcp-web-'));
let browser, server, store; let telemetryReads = 0; let reads = 0, denied = false, changed = false;
try {
  await build({ entryPoints: ['tests/fixtures/gcp-web.tsx'], outfile: join(root, 'app.js'), bundle: true, platform: 'browser', format: 'esm', loader: { '.woff2': 'file', '.woff': 'file', '.svg': 'file', '.png': 'file' }, logLevel: 'silent' });
  await copyFile('public/mobileops-mark.svg', join(root, 'mobileops-mark.svg'));
  store = new SqliteCloudStore(join(root, 'test.sqlite'));
  const access = new GcpWebAccess({ async verify(token) { if (!['user-a', 'user-b'].includes(token)) throw Error(); return { actorId: token, expiresAt: Date.now() + 60000 }; } }, store);
  const scope = { edition: 'organization', organizationId: 'org-synthetic', workspaceId: 'workspace-synthetic', label: 'Synthetic GCP workspace' };
  const provision = (actorId, version = 1, active = true) => access.organization.provision({ ...Object.fromEntries(['organizationId', 'workspaceId'].map(key => [key, scope[key]])), actorId, version, active, roles: ['operator', 'reviewer'], updatedAt: new Date().toISOString() });
  await provision('user-a'); await provision('user-b');
  const target = { provider: 'gcp', projectId: 'example-mobileops-demo', location: 'asia-northeast3', resourceId: 'checkout-demo', resourceName: 'projects/example-mobileops-demo/locations/asia-northeast3/services/checkout-demo', resourceUid: 'synthetic-service-uid', revision: 'checkout-demo-00002' };
  const registrations = [{ kind: 'organization', organizationId: scope.organizationId }, { kind: 'personal', userId: 'user-a' }].map((owner, index) => {
    const binding = { owner, workspaceId: scope.workspaceId, environmentId: 'synthetic-env', target }; let serviceReads = 0;
    return { id: `resource-${index}`, label: index === 0 ? 'Synthetic organization service' : 'Synthetic personal service', binding, dataMode: 'synthetic', telemetryEnabled: true, collector: new CloudRunCollector({ binding, expectedIdentity: 'synthetic-principal', telemetry: { dataMode: 'synthetic', async identity() { return 'synthetic-principal'; }, async read(operation, window) { telemetryReads++; return syntheticTelemetry(binding, operation, window); } }, transport: {
      dataMode: 'synthetic', async identity() { return 'synthetic-principal'; }, async read(operation) {
        reads++; if (denied) throw new CloudRunError('access_denied');
        const metadata = { generation: '2', observedGeneration: '2', updateTime: '2026-10-10T01:00:00.000Z', reconciling: false };
        if (operation === 'revision') return { ...metadata, name: `${target.resourceName}/revisions/${target.revision}`, service: target.resourceName, uid: 'synthetic-revision-uid', conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }] };
        serviceReads++; return { ...metadata, name: target.resourceName, uid: target.resourceUid, etag: changed ? `synthetic-${serviceReads}` : 'synthetic-stable', terminalCondition: { state: 'CONDITION_SUCCEEDED' }, latestCreatedRevision: target.revision, latestReadyRevision: target.revision, trafficStatuses: [{ revision: target.revision, percent: 100 }] };
      },
    } }) };
  });
  let modelCalls = 0;
  const observations = new GcpObservations(store, access, registrations);
  const workflow = new CloudWorkflow(store, createCloudRunAdapters(registrations, 'synthetic', async () => { throw Error('No worker dispatch from analysis fixture'); }));
  const analyses = new GcpAnalyses(store, access, observations, workflow, { engine: 'synthetic-fixture', modelId: 'synthetic-browser-model', configurationId: 'fixture-v1', async analyze(evidence, language) {
    modelCalls++; return { summary: language === 'ko' ? '준비 상태가 관측됐지만 서비스 정상 여부는 미확인입니다.' : 'Readiness was observed; application health remains unknown.',
      findings: [{ statement: language === 'ko' ? '지정된 서비스의 메타데이터를 읽었습니다.' : 'The registered service metadata was collected.', evidenceIds: [evidence.observations[0].id, 'gcp-run-requests'], kind: 'observation' }], missingInformation: [language === 'ko' ? '요청 점검·변경 이력·로그 본문을 수집하지 않았습니다.' : 'Request probes, change history and log payloads were not collected.'], serviceAssessment: 'unknown' };
  } });
  const operations = new GcpOperations(store, access, analyses, registrations);
  // Presentation-only fixtures wrap already authorized records. They do not change the stored workflow.
  let expandedList = false, unknownView = false;
  const extraPlanIds = Array.from({ length: 7 }, () => randomUUID());
  const storedList = operations.list.bind(operations), storedView = operations.get.bind(operations);
  operations.list = async session => { const value = await storedList(session); return expandedList && value.items.length ? { ...value, items: [...value.items, ...extraPlanIds.map(id => ({ ...value.items[0], id }))] } : value; };
  operations.get = async (session, id) => {
    const value = await storedView(session, id); if (!unknownView || !value.execution) return value;
    const { result: _result, ...execution } = value.execution;
    return { ...value, evidence: undefined, execution: { ...execution, state: 'unknown' }, capabilities: { ...value.capabilities, execute: false } };
  };

  const services = { access, observations, analyses, operations, publicOrigin: 'http://127.0.0.1', web: {
    organization: { configured: true, scope, identity: { method: 'company' } }, personal: { configured: true, scope: { edition: 'personal', workspaceId: scope.workspaceId, label: 'Synthetic personal workspace' }, identity: { method: 'company' } },
  } };
  server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    try {
      if (path === '/fixture/expanded-list') { expandedList = true; response.end('ok'); return; }
      if (path === '/fixture/normal-list') { expandedList = false; response.end('ok'); return; }
      if (path === '/fixture/unknown-view') { unknownView = true; response.end('ok'); return; }
      if (path === '/fixture/stored-view') { unknownView = false; response.end('ok'); return; }
      if (path === '/fixture/deny') { denied = true; response.end('ok'); return; }
      if (path === '/fixture/change') { changed = true; response.end('ok'); return; }
      if (path === '/fixture/reset') { denied = false; changed = false; response.end('ok'); return; }
      if (path === '/fixture/revoke') { await provision('user-b', 2, false); response.end('ok'); return; }
      if (path.startsWith('/api/')) { await handleGcpApi(request, response, services); return; }
      if (path === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Synthetic GCP web contract</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); return; }
      const file = resolve(root, `.${path}`); if (!file.startsWith(`${root}/`)) throw Error();
      response.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[extname(file)] ?? 'application/octet-stream'); response.end(await readFile(file));
    } catch { response.writeHead(500); response.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const origin = `http://127.0.0.1:${server.address().port}`; services.publicOrigin = origin;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1100 }, locale: 'ko-KR', reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(10000); const errors = []; page.on('pageerror', error => errors.push(error.message));
  async function layout(stage) {
    if (process.env.MOBILEOPS_GCP_LAYOUT_AUDIT !== '1') return;
    const directory = process.env.MOBILEOPS_SCREENSHOT_DIR; if (!directory) throw Error('Layout audit requires a separate capture directory.');
    await mkdir(directory, { recursive: true }); await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    const measurements = { stage, width: page.viewportSize().width, height: await page.evaluate(() => document.documentElement.scrollHeight), actions: {} };
    for (const name of ['메타데이터·로그·지표 조회', '분석과 계획 준비', '검토 요청', '인계 기록 저장']) {
      const button = page.getByRole('button', { name, exact: true });
      if (await button.count() === 1) measurements.actions[name] = (await button.boundingBox())?.y;
    }
    console.log('GCP layout ' + JSON.stringify(measurements));
    await page.screenshot({ path: join(directory, `gcp-layout-${stage}.png`), fullPage: true });
  }
  await page.goto(origin); await expect(page.getByText('체험 모드 · 합성 데이터')).toBeVisible(); await page.getByRole('banner').getByRole('button', { name: 'Google로 로그인', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '허용된 Cloud Run 서비스', exact: true })).toContainText('Synthetic organization service');
  await layout('ready');
  expect(reads).toBe(0); expect(telemetryReads).toBe(0); expect(modelCalls).toBe(0);
  await expect(page.getByRole('region', { name: '선택 서비스 운영 개요' })).toContainText('미수집');
  const navigationRequests = []; page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) navigationRequests.push({ method: request.method(), path: new URL(request.url()).pathname }); });
  const beforeNavigation = navigationRequests.length;
  await page.getByRole('tab', { name: '저장', exact: true }).click(); await expect(page.getByText('아직 저장된 계획이 없습니다', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '계획', exact: true }).click(); await expect(page.getByText('현재 열린 계획이 없습니다', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '근거', exact: true }).click(); expect(navigationRequests).toHaveLength(beforeNavigation);
  await page.getByRole('button', { name: '메타데이터·로그·지표 조회', exact: true }).click();
  await expect(page.getByText('100%', { exact: true })).toBeVisible(); expect(reads).toBe(3); expect(telemetryReads).toBe(3);
  await expect(page.getByText('합성 관측 · 실제 GCP 결과가 아닙니다', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '로그·요청 지표', exact: true })).toBeVisible();
  await expect(page.getByText('HTTP 503', { exact: true })).toBeVisible();
  await expect(page.getByText('1,250 ms', { exact: true }).first()).toBeVisible();
  await layout('observed');
  await page.getByRole('button', { name: '분석과 계획 준비', exact: true }).click();
  await expect(page.getByText('합성 분석 · 실제 Gemini 호출 없음', { exact: true })).toBeVisible(); expect(modelCalls).toBe(1); expect(reads).toBe(3); expect(telemetryReads).toBe(3);
  await page.getByRole('button', { name: 'gcp-run-service', exact: true }).click(); await expect(page.locator('md-dialog[open]')).toContainText('synthetic-service-uid'); await page.getByRole('button', { name: '근거 닫기', exact: true }).click();
  await page.getByRole('button', { name: 'gcp-run-requests', exact: true }).click(); await expect(page.locator('md-dialog[open]')).toContainText('503'); await expect(page.locator('md-dialog[open]')).not.toContainText('NEVER_EXPORT'); await page.getByRole('button', { name: '근거 닫기', exact: true }).click();
  await page.getByRole('button', { name: '저장된 분석 확인', exact: true }).click(); await expect(page.getByText('합성 분석 · 실제 Gemini 호출 없음', { exact: true })).toBeVisible(); expect(modelCalls).toBe(1);
  await layout('plan');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(async () => (await page.getByRole('button', { name: '검토 요청', exact: true }).boundingBox())?.y ?? Infinity).toBeLessThan(1100);
  await page.getByRole('button', { name: '검토 요청', exact: true }).click();
  await page.getByRole('textbox', { name: '검토 메모', exact: true }).fill('합성 검토: 같은 서비스의 고정 로그·지표 범위를 확인합니다.');
  const reviewDraft = await page.getByRole('textbox', { name: '검토 메모', exact: true }).inputValue();
  const beforeBrowse = navigationRequests.length;
  await page.getByRole('tab', { name: '근거', exact: true }).click();
  await page.getByRole('tab', { name: '저장', exact: true }).click();
  await page.getByRole('searchbox', { name: '저장 계획 검색', exact: true }).fill('not-found'); await expect(page.getByText('검색 결과가 없습니다', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: '저장 계획 검색', exact: true }).fill('Synthetic organization');
  await expect(page.getByRole('button', { name: /^저장 계획 열기 / })).toHaveCount(1);
  const savedPlanId = (await page.getByRole('button', { name: /^저장 계획 열기 / }).getAttribute('aria-label')).slice('저장 계획 열기 '.length);
  await page.getByRole('combobox', { name: 'Language / 언어' }).selectOption('en');
  await expect(page.getByRole('searchbox', { name: 'Search stored plans', exact: true })).toHaveValue('Synthetic organization');
  await page.getByRole('tab', { name: 'Plan', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Review note', exact: true })).toHaveValue(reviewDraft);
  await page.getByRole('combobox', { name: 'Language / 언어' }).selectOption('ko');
  expect(navigationRequests).toHaveLength(beforeBrowse);
  await page.getByRole('button', { name: '계획 확인', exact: true }).click();
  await expect(page.getByRole('button', { name: '고정 로그·지표 조회 실행', exact: true })).toBeVisible(); expect(reads).toBe(3); expect(telemetryReads).toBe(3);
  // The server completes the read, but its first response is lost at the browser boundary.
  const executionRequests = [];
  await page.route('**/plans/*/execute', async route => {
    executionRequests.push({ body: route.request().postData(), key: route.request().headers()['idempotency-key'] });
    const response = await route.fetch(); if (executionRequests.length === 1) await route.abort('failed'); else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '고정 로그·지표 조회 실행', exact: true }).click();
  await page.getByRole('button', { name: '같은 요청 확인', exact: true }).click();
  await expect(page.getByRole('button', { name: '인계 기록 저장', exact: true })).toBeVisible();
  expect(executionRequests).toHaveLength(2); expect(executionRequests[0]).toEqual(executionRequests[1]); expect(reads).toBe(6); expect(telemetryReads).toBe(6); expect(modelCalls).toBe(1);
  await expect(page.locator('.gcp-inspection-result')).toContainText('로그 조회');
  await expect(page.locator('.gcp-inspection-result')).toContainText('요청 수 조회');
  await expect(page.locator('.gcp-inspection-result')).toContainText('응답 지연 조회');
  await expect(page.getByText('고정 범위 조회 완료', { exact: true }).first()).toBeVisible();
  await page.unroute('**/plans/*/execute');
  await page.getByRole('textbox', { name: '후속 담당자에게 남길 인계', exact: true }).fill('합성 인계: 요청 지표와 로그는 후속 확인이 필요합니다.');
  await page.getByRole('button', { name: '인계 기록 저장', exact: true }).click();
  await expect(page.locator('.gcp-handoff').getByText('합성 인계: 요청 지표와 로그는 후속 확인이 필요합니다.', { exact: true })).toBeVisible();
  // Extra synthetic list rows exercise local pagination without fetching any plan details.
  await fetch(`${origin}/fixture/expanded-list`);
  await page.reload(); await page.getByRole('banner').getByRole('button', { name: 'Google로 로그인', exact: true }).click();
  await page.getByRole('tab', { name: '저장', exact: true }).click();
  const beforePagination = navigationRequests.length;
  await expect(page.getByRole('button', { name: /^저장 계획 열기 / })).toHaveCount(6);
  await page.getByRole('button', { name: '다음 계획 페이지', exact: true }).click(); await expect(page.getByRole('button', { name: /^저장 계획 열기 / })).toHaveCount(2);
  await page.getByRole('searchbox', { name: '저장 계획 검색', exact: true }).fill(savedPlanId);
  await expect(page.getByRole('button', { name: /^저장 계획 열기 / })).toHaveCount(1); expect(navigationRequests).toHaveLength(beforePagination);
  await fetch(`${origin}/fixture/normal-list`);
  await page.getByRole('button', { name: /^저장 계획 열기 / }).click();
  await expect(page.getByRole('tab', { name: '계획', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.gcp-handoff').getByText('합성 인계: 요청 지표와 로그는 후속 확인이 필요합니다.', { exact: true })).toBeVisible(); expect(reads).toBe(6); expect(telemetryReads).toBe(6); expect(modelCalls).toBe(1);
  const directory = process.env.MOBILEOPS_SCREENSHOT_DIR ?? 'test-results/screenshots'; await mkdir(directory, { recursive: true }); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: join(directory, 'gcp-observation-synthetic.png'), fullPage: true });
  await page.getByRole('combobox', { name: 'Language / 언어' }).selectOption('en'); await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Prepare analysis and plan in English', exact: true }).click(); await expect(page.getByText('Readiness was observed; application health remains unknown.', { exact: true })).toBeVisible(); expect(modelCalls).toBe(2);
  await page.getByRole('button', { name: 'Request review', exact: true }).click(); await page.getByRole('button', { name: 'Confirm plan', exact: true }).click(); expect(reads).toBe(6); expect(telemetryReads).toBe(6);
  await page.getByRole('button', { name: 'Execute fixed log and metric read', exact: true }).click();
  await page.getByRole('textbox', { name: 'Handoff for the next operator', exact: true }).fill('Synthetic handoff: log payloads and request probes remain uncollected.');
  await page.getByRole('button', { name: 'Save handoff note', exact: true }).click();
  await expect(page.locator('.gcp-handoff').getByText('Synthetic handoff: log payloads and request probes remain uncollected.', { exact: true })).toBeVisible(); expect(reads).toBe(9); expect(telemetryReads).toBe(9);
  await page.getByRole('button', { name: 'Refresh stored status', exact: true }).click();
  await expect(page.locator('.gcp-handoff').getByText('Synthetic handoff: log payloads and request probes remain uncollected.', { exact: true })).toBeVisible(); expect(reads).toBe(9); expect(telemetryReads).toBe(9);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const beforeTabs = navigationRequests.length;
    for (const label of ['Evidence', 'Saved', 'Plan']) {
      const tab = page.getByRole('tab', { name: label, exact: true }); await tab.focus(); await page.keyboard.press('Enter');
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      // All three labels fit the mobile tab strip; the active tab must remain inside it.
      await expect.poll(() => page.getByRole('tablist', { name: 'GCP work views', exact: true }).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await expect.poll(() => tab.evaluate(element => {
        const box = element.getBoundingClientRect(), clip = element.closest('[role="tablist"]').getBoundingClientRect();
        return { visible: box.left >= clip.left - 1 && box.right <= clip.right + 1, tabLeft: box.left, tabRight: box.right, clipLeft: clip.left, clipRight: clip.right };
      })).toMatchObject({ visible: true });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(); expect(axe.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => ({ html: node.html, summary: node.failureSummary })) }))).toEqual([]);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: join(directory, `gcp-console-${label === 'Evidence' ? 'evidence' : label === 'Saved' ? 'saved' : 'results'}-en-${width}.png`), fullPage: true });
    }
    expect(navigationRequests).toHaveLength(beforeTabs); expect(reads).toBe(9); expect(telemetryReads).toBe(9); expect(modelCalls).toBe(2);
  }
  // A validated synthetic unknown response must not keep earlier success evidence on screen.
  await fetch(`${origin}/fixture/unknown-view`);
  // Open the original Korean plan explicitly; list browsing itself performs no detail reads.
  await page.getByRole('tab', { name: 'Saved', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search stored plans', exact: true }).fill(savedPlanId);
  await page.getByRole('button', { name: new RegExp('Open stored plan ' + savedPlanId) }).click();
  await expect(page.getByRole('region', { name: 'Selected service overview' })).toContainText('Read outcome unknown');
  await expect(page.locator('.gcp-inspection-result')).toHaveCount(0);
  const beforeUnknownNavigation = navigationRequests.length;
  await page.getByRole('combobox', { name: 'Language / 언어' }).selectOption('ko'); await expect(page.getByRole('region', { name: '선택 서비스 운영 개요' })).toContainText('읽기 결과 미확인');
  await page.getByRole('combobox', { name: 'Language / 언어' }).selectOption('en'); expect(navigationRequests).toHaveLength(beforeUnknownNavigation);
  await fetch(`${origin}/fixture/stored-view`);
  await page.getByRole('button', { name: 'Refresh stored status', exact: true }).click(); await expect(page.getByRole('region', { name: 'Selected service overview' })).toContainText('Read completed · health unconfirmed');
  await fetch(`${origin}/fixture/change`); await page.getByRole('button', { name: 'Read metadata, logs and metrics', exact: true }).click(); await expect(page.getByText('Changed during collection', { exact: true })).toBeVisible(); await expect(page.getByText('Synthetic analysis · No live Gemini call', { exact: true })).toHaveCount(0);
  await fetch(`${origin}/fixture/deny`); await page.getByRole('button', { name: 'Read metadata, logs and metrics', exact: true }).click(); await expect(page.getByText('100%', { exact: true })).toHaveCount(0); await expect(page.getByText('Access denied', { exact: true })).toBeVisible();
  await page.getByTestId('switch-user').click(); await expect(page.getByText('Access denied', { exact: true })).toHaveCount(0);
  await expect(page.getByText('user-b', { exact: true })).toBeVisible(); await fetch(`${origin}/fixture/revoke`); await page.getByRole('button', { name: 'Refresh service list', exact: true }).click();
  await expect(page.getByText('Previous results were cleared because access could not be verified. Sign in again or check permissions.', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Read metadata, logs and metrics', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Selected service overview' })).not.toContainText('Synthetic organization service');
  await expect(page.getByRole('button', { name: /^Open stored plan / })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out of web', exact: true }).click(); await expect(page.getByText('Rehearsal mode · synthetic data')).toBeVisible();
  await page.reload(); await expect(page.getByText('Rehearsal mode · synthetic data')).toBeVisible(); await expect(page.locator('.gcp-handoff')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Sign out of web', exact: true })).toHaveCount(0);
  await fetch(`${origin}/fixture/reset`); await page.getByTestId('personal').click(); await page.getByRole('banner').getByRole('button', { name: 'Sign in with Google', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Allowed Cloud Run service', exact: true })).toContainText('Synthetic personal service'); await page.getByRole('button', { name: 'Read metadata, logs and metrics', exact: true }).click(); await expect(page.getByText('100%', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toMatch(/user-a|token|revision|resource-|handoff|합성 인계/); expect(errors).toEqual([]);
  console.log('GCP web synthetic integration passed: actual API/authorization/store/collector with bounded telemetry and safe log projection, analysis/review/explicit read/handoff, lost execution response and same-key retry, persisted result restore after reload, unknown health, no reads during review/refresh, organization/personal scopes, user switch/revocation/logout, English mobile and axe.');
} catch (error) {
  if (browser) { const page = browser.contexts()[0]?.pages()[0]; if (page) { await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/gcp-web-failure.png', fullPage: true }).catch(() => {}); } }
  throw error;
} finally { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } store?.close(); await rm(root, { recursive: true, force: true }); }
