import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, mkdtemp, rm, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { SqliteCloudStore } from '../../apps/gateway/src/store/sqlite-store.ts';
import { GcpWebAccess } from '../../apps/gateway/src/auth/web-access.ts';
import { GcpObservations } from '../../apps/gateway/src/workflow/observations.ts';
import { GcpAgentTasks } from '../../apps/gateway/src/crew/agent-tasks.ts';
import { GcpOverview } from '../../apps/gateway/src/crew/overview.ts';
import { handleGcpApi } from '../../apps/gateway/src/http/api.ts';

if (process.env.MOBILEOPS_OFFLINE_TEST !== '1') throw Error('Agent dashboard fixture must remain offline.');
const root = await mkdtemp(join(tmpdir(), 'mobileops-gcp-agents-'));
let browser, server, store;
const action = { action: 'rollback_traffic', service: 'shop-api', revision: 'shop-api-good' };
const ids = { task: 'a2a-task-fixture', context: 'a2a-context-fixture', call: 'adk-confirm-fixture' };
const status = (state, parts, final = false) => ({ kind: 'status-update', taskId: ids.task, contextId: ids.context, final, status: { state, ...(parts ? { message: { kind: 'message', role: 'agent', parts } } : {}) } });
const data = (value, type) => ({ kind: 'data', data: value, metadata: { adk_type: type } });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let streams = 0;
// Synthetic Google APIs behind the overview: one faulty revision serving all traffic, one healthy revision idle.
const resource = 'projects/example-project/locations/asia-northeast3/services/shop-api';
const series = (revision, klass, count) => ({ resource: { labels: { revision_name: revision } }, metric: { labels: { response_code_class: klass } }, points: [{ value: { int64Value: String(count) } }] });
const google = async input => {
  const url = decodeURIComponent(String(input)), json = body => new Response(JSON.stringify(body), { status: 200 });
  if (url.includes('/revisions')) return json({ revisions: ['shop-api-bad', 'shop-api-good'].map(name => ({ name: `${resource}/revisions/${name}`, createTime: '2026-10-10T00:30:00Z', conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }] })) });
  if (url.includes('/services/shop-api')) return json({ trafficStatuses: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'shop-api-bad', percent: 100 }] });
  if (url.includes('request_count')) return json({ timeSeries: [series('shop-api-bad', '5xx', 55), series('shop-api-bad', '2xx', 45), series('shop-api-good', '2xx', 60)] });
  if (url.includes('request_latencies')) return json({ timeSeries: [{ resource: { labels: { revision_name: 'shop-api-bad' } }, points: [{ value: { doubleValue: 1304.2 } }] }, { resource: { labels: { revision_name: 'shop-api-good' } }, points: [{ value: { doubleValue: 9.5 } }] }] });
  return json({ entries: [{ timestamp: new Date().toISOString(), severity: 'ERROR', textPayload: 'checkout failed: payment gateway timeout after 5000ms', resource: { labels: { revision_name: 'shop-api-bad' } }, httpRequest: { status: 500 } }] });
};
// A scripted crew: a slow investigation (so progress is visible), a pause for a person, then a report after the decision.
const chief = { async *stream(message) {
  streams++;
  if (streams === 1) {
    yield { kind: 'task', id: ids.task, contextId: ids.context, status: { state: 'submitted' } };
    await sleep(900); yield status('working', [data({ id: 'c1', name: 'ops', args: { request: 'Read shop-api state, request metrics and error logs' } }, 'function_call')]);
    await sleep(900); yield status('working', [data({ id: 'c1', name: 'ops', response: { result: 'shop-api-bad has a 55% 5xx rate and p95 1.3 s; shop-api-good had 0 errors.' } }, 'function_response')]);
    await sleep(600); yield status('working', [data({ id: 'c2', name: 'guardian', response: { result: 'A rollback needs a person to approve it.' } }, 'function_response')]);
    yield status('input-required', [data({ id: ids.call, name: 'adk_request_confirmation', args: { toolConfirmation: { hint: 'h', confirmed: false, payload: { action, risk: 'medium', reason: 'shop-api-bad fails 55% of requests while shop-api-good was healthy.' } }, originalFunctionCall: { name: 'propose_rollback' } } }, 'function_call')], true);
  } else {
    const response = message.parts[0].data.response;
    await sleep(700); yield status('working', [data({ id: 'c3', name: 'propose_rollback', response: { status: response.confirmed ? 'applied' : 'rejected_by_person' } }, 'function_response')]);
    yield { kind: 'artifact-update', taskId: ids.task, contextId: ids.context, artifact: { parts: [{ kind: 'text', text: '### What happened\nCheckout failed after revision `shop-api-bad`.\n\n### What I did\n- Rolled traffic back to `shop-api-good`\n- Re-read the traffic split\n\n### What needs you\n**Nothing now.** Metrics lag a few minutes.' }] } };
    yield status('completed', undefined, true);
  }
} };
try {
  await build({ entryPoints: ['tests/support/web-harness.tsx'], outfile: join(root, 'app.js'), bundle: true, platform: 'browser', format: 'esm', loader: { '.woff2': 'file', '.woff': 'file', '.svg': 'file', '.png': 'file' }, logLevel: 'silent' });
  await copyFile('apps/web/public/mark.svg', join(root, 'mark.svg'));
  store = new SqliteCloudStore(join(root, 'test.sqlite'));
  const access = new GcpWebAccess({ async verify(token) { if (token !== 'user-a') throw Error(); return { actorId: token, expiresAt: Date.now() + 600000 }; } }, store);
  const scope = { edition: 'organization', organizationId: 'org-synthetic', workspaceId: 'workspace-synthetic', label: 'Synthetic GCP workspace' };
  await access.organization.provision({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, actorId: 'user-a', version: 1, active: true, roles: ['operator', 'reviewer'], updatedAt: new Date().toISOString() });
  const target = { provider: 'gcp', projectId: 'example-mobileops-demo', location: 'asia-northeast3', resourceId: 'shop-api', resourceName: 'projects/example-mobileops-demo/locations/asia-northeast3/services/shop-api', resourceUid: 'synthetic-uid', revision: 'shop-api-bad' };
  const binding = { owner: { kind: 'organization', organizationId: scope.organizationId }, workspaceId: scope.workspaceId, environmentId: 'synthetic-env', target };
  const registrations = [{ id: 'shop-api', label: 'Synthetic shop-api', binding, dataMode: 'synthetic', telemetryEnabled: false, collector: { async collect() { throw Error('The agent dashboard never collects by itself.'); } } }];
  const services = { access, observations: new GcpObservations(store, access, registrations), agents: new GcpAgentTasks(store, access, chief, Buffer.from('fixture-approval-key-0123456789abcdef'), () => true, Date.now, {allows:()=>true,async read(){const observed_at=new Date().toISOString();return {state:{uid:'synthetic-uid',etag:'synthetic-etag',update_time:'2026-10-10T00:00:00Z',observed_at},display:{observedAt:observed_at,traffic:[{revision:'shop-api-bad',percent:100}]}};}}),
    overview: new GcpOverview(access, [{ name: 'shop-api', project: 'example-project', region: 'asia-northeast3' }], { token: async () => 'synthetic-token', fetcher: google }, () => true), publicOrigin: 'http://127.0.0.1',
    web: { organization: { configured: true, scope, identity: { method: 'company' } }, personal: { configured: false } } };
  server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    try {
      if (path.startsWith('/api/')) { await handleGcpApi(request, response, services); return; }
      if (path === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Agent dashboard fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); return; }
      const file = resolve(root, `.${path}`); if (!file.startsWith(`${root}/`)) throw Error();
      response.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[extname(file)] ?? 'application/octet-stream'); response.end(await readFile(file));
    } catch { response.writeHead(500); response.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const origin = `http://127.0.0.1:${server.address().port}`; services.publicOrigin = origin;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'en-US', reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(15000); const errors = []; page.on('pageerror', error => errors.push(error.message));
  const directory = process.env.MOBILEOPS_SCREENSHOT_DIR ?? 'test-results/screenshots'; await mkdir(directory, { recursive: true });
  await page.goto(origin); await page.getByRole('combobox', { name: 'Language / 언어' }).selectOption('en');
  // Signed out: explain the mobility product without synthetic telemetry or mutation controls.
  await expect(page.getByRole('heading',{name:'One step ahead of your journey.'})).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(navigation).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Agent tools' })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Google Cloud' })).toHaveCount(0);
  await page.screenshot({ path: join(directory, 'console-signed-out.png'), fullPage: true });
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  // Signed in with the crew connected: a console. The dashboard is first, the assistant is closed until asked for.
  await expect(page.getByText('Rehearsal mode · synthetic data')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
  await expect(navigation.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(navigation.getByRole('button', { name: 'Synthetic shop-api', exact: true })).toBeVisible();
  const kpis = page.getByRole('region', { name: 'Key metrics' });
  await expect(kpis.getByRole('group', { name: '5xx error rate' })).toContainText('55.0%');
  await expect(kpis.getByRole('group', { name: 'p95 latency' })).toContainText('1,304 ms');
  await expect(kpis.getByRole('group', { name: 'Serving revision' })).toContainText('shop-api-bad');
  await expect(page.getByRole('img', { name: 'shop-api-bad 100%' })).toBeVisible();
  await expect(page.getByText('checkout failed: payment gateway timeout after 5000ms')).toBeVisible();
  await expect(page.getByLabel('Crew assistant')).toHaveCount(0);
  await page.screenshot({ path: join(directory, 'console-dashboard.png'), fullPage: true });
  // An instruction typed into the top bar opens the assistant and is sent at once.
  await page.getByRole('textbox', { name: 'Ask the crew' }).first().fill('Customers report that shop-api checkout is failing. Investigate and handle it.');
  await page.keyboard.press('Enter');
  const assistant = page.getByRole('complementary', { name: 'Crew assistant' });
  await expect(assistant).toBeVisible();
  await expect(assistant.getByText('Customers report that shop-api checkout is failing. Investigate and handle it.')).toBeVisible();
  await expect(assistant.getByText('shop-api-bad has a 55% 5xx rate and p95 1.3 s; shop-api-good had 0 errors.')).toBeVisible();
  await expect(assistant.getByRole('region', { name: 'Approval request' })).toContainText('Send 100% of shop-api traffic back to revision shop-api-good.');
  expect(streams).toBe(1);
  // The dashboard also shows that a decision is waiting.
  await expect(page.getByText('1 decision is waiting for you')).toBeVisible();
  await page.screenshot({ path: join(directory, 'console-approval.png'), fullPage: true });
  const axeApproval = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axeApproval.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.html) }))).toEqual([]);
  await assistant.getByRole('button', { name: 'Approve and apply', exact: true }).click();
  await expect(assistant.getByRole('heading', { name: 'What happened' })).toBeVisible();
  await expect(assistant.getByText('Done', { exact: true }).first()).toBeVisible();
  await expect(assistant.getByRole('region', { name: 'Approval request' })).toHaveCount(0);
  await assistant.getByText(/steps · \d+s/).first().click();
  await expect(assistant.getByText('Applied and confirmed')).toBeVisible();
  expect(streams).toBe(2);
  await page.screenshot({ path: join(directory, 'console-done.png'), fullPage: true });
  // Collapsing the navigation to a rail and closing/reopening the assistant keep the page usable.
  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  await assistant.getByRole('button', { name: 'Close the assistant' }).click(); await expect(assistant).toHaveCount(0);
  await page.getByRole('button', { name: 'Ask Gemini' }).click(); await expect(assistant).toBeVisible();
  await page.getByRole('button', { name: 'Ask Gemini' }).click(); await expect(assistant).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand navigation' }).click();
  // Navigation entries change the page; the agent entries open the right-hand panel instead.
  await navigation.getByRole('button', { name: 'Plans', exact: true }).click(); await expect(page.getByText('No plan is open')).toBeVisible();
  await navigation.getByRole('button', { name: 'Overview', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
  await navigation.getByRole('button', { name: /^Decisions/ }).click(); await expect(assistant).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const axeMobile = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axeMobile.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.html) }))).toEqual([]);
  await page.screenshot({ path: join(directory, 'console-assistant-390.png'), fullPage: false });
  await assistant.getByRole('button', { name: 'Close the assistant' }).click();
  await page.screenshot({ path: join(directory, 'console-dashboard-390.png'), fullPage: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  console.log('GCP console integration passed: dashboard KPIs and charts from the overview, signed-out mobility welcome without synthetic data or private controls, sign-in swaps in the live crew, top-bar instruction opens the assistant, streamed progress, approval card with the exact action, one approval dispatch, final report, rail and assistant toggles, axe at desktop and 390px.');
} catch (error) {
  if (browser) { const page = browser.contexts()[0]?.pages()[0]; if (page) { await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/gcp-agents-failure.png', fullPage: true }).catch(() => {}); } }
  throw error;
} finally { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } store?.close(); await rm(root, { recursive: true, force: true }); }
void randomUUID;
