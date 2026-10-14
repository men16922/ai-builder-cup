import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, readFile, mkdtemp, mkdir, rm, lstat, realpath, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { hostedFixture } from '../support/hosted-fixture.ts';
import { gcpInputs, runtimePackages, gcpRuntimeLock } from '../../scripts/build-policy.mjs';
if (process.env.MOBILEOPS_OFFLINE_TEST !== '1') throw Error('Hosted fixture must remain offline.');
const root = await mkdtemp(join(tmpdir(), 'mobileops-gcp-artifact-')), env = { PATH: dirname(process.execPath), MOBILEOPS_OFFLINE_TEST: '1' };
let runtime, browser;
try {
  for (const name of ['package.json', 'package-lock.json', 'server.mjs', 'runtime.mjs', 'candidate.json', 'web']) await cp(join('dist/gateway', name), join(root, name), { recursive: true });
  const graphs = JSON.parse(await readFile('dist/gateway/module-inputs.json', 'utf8')); gcpInputs(graphs.web); gcpInputs(graphs.api);
  for (const forbidden of ['apps/gateway/src/aws/organization-api.ts', 'apps/android/core/src/main/kotlin/Client.kt', 'apps/gateway/src/evaluation/pack.ts', 'apps/gateway/test/hosted.test.ts', 'tests/support/hosted-fixture.ts', 'apps/gateway/src/store/sqlite-store.ts', '.data/gcp/gateway.json']) assert.throws(() => gcpInputs([forbidden]));
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8')), manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.deepEqual(lock, gcpRuntimeLock(JSON.parse(await readFile('package-lock.json', 'utf8')), manifest)); assert.deepEqual(Object.keys(manifest.dependencies), runtimePackages);
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    try {
      assert.equal(await realpath(path), join(process.cwd(), path));
      await mkdir(dirname(join(root, path)), { recursive: true });
      await cp(path, join(root, path), { recursive: true, filter: source => !relative(path, source).split(sep).includes('node_modules') });
    } catch (error) { if (entry.optional && error.code === 'ENOENT') continue; throw error; }
  }
  async function noOutsideLinks(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { const file = join(directory, entry.name); if ((await lstat(file)).isSymbolicLink()) assert.ok((await realpath(file)).startsWith(root + sep)); else if (entry.isDirectory()) await noOutsideLinks(file); } }
  await noOutsideLinks(join(root, 'node_modules'));
  const imports = spawnSync(process.execPath, ['--input-type=module', '-e', "await Promise.all(['firebase-admin/app','firebase-admin/auth','firebase-admin/messaging','@google-cloud/firestore','google-auth-library'].map(name=>import(name))); console.log('isolated SDK imports passed');"], { cwd: root, env, encoding: 'utf8' }); assert.equal(imports.status, 0, imports.stderr);
  const disabled = spawnSync(process.execPath, ['server.mjs'], { cwd: root, env, encoding: 'utf8' }); assert.equal(disabled.status, 1); assert.match(disabled.stderr, /hosted startup failed/);
  const built = await import(pathToFileURL(join(root, 'runtime.mjs')).href), fixture = await hostedFixture(built);
  // The shipped Firebase browser code is real; a synthetic identity is never injected into it.
  // Signed-out entry has no fabricated vehicle or operational data. API ports are tested separately.
  fixture.services.web = { personal: { configured: false }, organization: { configured: false } };
  runtime = await built.startGcpHosted(fixture, join(root, 'web'), { port: 0, host: '127.0.0.1', synthetic: true });
  fixture.services.publicOrigin = `http://127.0.0.1:${runtime.server.address().port}`; const origin = fixture.services.publicOrigin;
  for (const path of ['/api/aws/status', '/api/state', '/api/onprem/status', '/api/organizations/config', '/package.json', '/web-manifest.json']) assert.equal((await fetch(origin + path)).status, 404);
  assert.equal((await fetch(origin + fixture.base + '/resources', { headers: { Origin: origin } })).status, 401);
  assert.equal((await fetch(origin + fixture.base + '/resources', { headers: { Origin: origin, Authorization: 'Bearer invalid-token' } })).status, 401);
  assert.equal((await fetch(origin + fixture.base + '/resources', { headers: { Origin: origin, Authorization: 'Bearer synthetic-member' } })).status, 200);
  assert.equal((await fetch(origin + fixture.base + '/resources', { headers: { Origin: 'https://wrong.invalid', Authorization: 'Bearer synthetic-member' } })).status, 403);
  const call = async (path, body, key = randomUUID()) => {
    const response = await fetch(origin + fixture.base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, Authorization: 'Bearer synthetic-member', 'Content-Type': 'application/json', 'Idempotency-Key': key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, 200); return response.json();
  };
  const observation = await call('/observations', { resourceId: fixture.resourceId }), analysis = await call('/analyses', { observationId: observation.snapshot.id, language: 'en' });
  const version = { expectedVersion: analysis.plan.version, expectedDigest: analysis.planDigest }, planPath = `/plans/${analysis.id}`;
  await call(planPath + '/review', version); await call(planPath + '/decision', { ...version, decision: 'approve', note: 'Synthetic artifact review' });
  assert.deepEqual(fixture.counts(), { closed: 0, reads: 3, models: 1 });
  const key = randomUUID(), input = { ...version, planId: analysis.id }, executed = await call(planPath + '/execute', input, key);
  assert.equal(executed.execution.state, 'succeeded'); assert.equal(executed.execution.result.serviceAssessment, 'unknown');
  assert.deepEqual((await call(planPath + '/execute', input, key)).execution, executed.execution);
  await call(`/executions/${executed.execution.id}/handoff`, { note: 'Synthetic artifact handoff' });
  assert.equal((await call(planPath)).execution.handoffs.length, 1); assert.deepEqual(fixture.counts(), { closed: 0, reads: 6, models: 1 });
  browser = await chromium.launch({ headless: true }); const english = await browser.newContext({ locale: 'en-US' }), englishPage = await english.newPage();
  // Without a saved choice, a non-Korean browser gets English first; a Korean browser gets Korean.
  await englishPage.goto(origin); await expect(englishPage.getByRole('heading',{name:'One step ahead of your journey.'})).toBeVisible(); await english.close();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ko-KR' }); const page = await context.newPage(); const remote = [], unexpected = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { if (!route.request().url().startsWith(origin + '/')) { remote.push(new URL(route.request().url()).hostname); return route.abort(); } return route.continue(); });
  page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/') && !path.startsWith('/api/gcp/config/')) unexpected.push(path); });
  // The product promise is visible before sign-in, while sensitive reads and changes stay private.
  await page.goto(origin); await expect(page.getByRole('heading', {name:'당신의 이동에, 한발 먼저.'})).toBeVisible();
  await expect(page.getByText('차량·운전은 시뮬레이션 · 실제 차량 제어 없음')).toBeVisible();
  await expect(page.getByText('체험 모드 · 합성 데이터')).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'Ask the crew'})).toHaveCount(0);
  await expect(page.getByRole('navigation',{name:'주 메뉴'})).toHaveCount(0);
  await page.getByLabel('Language / 언어').selectOption('en');
  await expect(page.getByRole('heading', {name:'One step ahead of your journey.'})).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', {name:'One step ahead of your journey.'})).toBeVisible();
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(value=>({id:value.id,nodes:value.nodes.map(node=>node.html.slice(0,300))})),[]);
  if (process.env.MOBILEOPS_SCREENSHOT_DIR) { await mkdir(process.env.MOBILEOPS_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.MOBILEOPS_SCREENSHOT_DIR,'aide-mobility-welcome.png'),fullPage:true}); }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 }); await expect(page.getByRole('button', {name:'Open navigation',exact:true})).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations.map(value => ({ id: value.id, nodes: value.nodes.map(node => ({ html: node.html.slice(0, 700), target: node.target })) })), []);
    if (process.env.MOBILEOPS_SCREENSHOT_DIR) { await mkdir(process.env.MOBILEOPS_SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: join(process.env.MOBILEOPS_SCREENSHOT_DIR, `gcp-hosted-en-${width}.png`), fullPage: true }); }
  }
  for (const route of ['/aws', '/personal/aws', '/organization/onprem', '/demo', '/catalog']) { await page.goto(origin + '/#' + route); await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible(); }
  for (const route of ['/', '/personal/gcp', '/organization/gcp']) { await page.goto(origin + '/#' + route); await expect(page.getByRole('heading',{name:'One step ahead of your journey.'})).toBeVisible(); } assert.deepEqual(remote, []); assert.deepEqual(unexpected, []); assert.deepEqual(errors, []); assert.deepEqual(fixture.counts(), { closed: 0, reads: 6, models: 1 });
  await browser.close(); browser = undefined; assert.equal(await runtime.close(), 'drained'); runtime = undefined; assert.equal(fixture.counts().closed, 1);
  // Process-level SIGTERM exercises the same bundled close method; no SDK/provider configuration.
  const childCode = `import {startGcpHosted} from './runtime.mjs'; const app=await startGcpHosted({services:{publicOrigin:'http://127.0.0.1'},async close(){console.log('resources closed')}},'./web',{port:0,host:'127.0.0.1',synthetic:true}); process.on('SIGTERM',async()=>{const outcome=await app.close(); console.log(outcome);process.exit(outcome==='drained'?0:1)});console.log('ready');`;
  await writeFile(join(root, 'signal-smoke.mjs'), childCode);
  const child = spawn(process.execPath, ['signal-smoke.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''; child.stdout.setEncoding('utf8'); child.stdout.on('data', value => { output += value; });
  try { for (let i = 0; !output.includes('ready') && i < 100; i++) { if (child.exitCode !== null) break; await new Promise(done => setTimeout(done, 20)); } assert.match(output, /ready/); const stopped = once(child, 'close'); child.kill('SIGTERM'); let timer; const [code] = await Promise.race([stopped, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('SIGTERM timeout')), 2000); })]).finally(() => clearTimeout(timer)); assert.equal(code, 0); assert.match(output, /resources closed\ndrained/); } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
  console.log(`GCP hosted artifact passed: isolated SDK imports (${Object.keys(lock.packages).length - 1} locked packages), disabled entry, GCP-only API/auth/Origin and explicit workflow/replay/handoff, KO/EN single-console entry/reload without a workspace picker or provider logo, 390/320px entry/axe, no signed-out sample controls or model/mutation calls, excluded local routes and SIGTERM. No live cloud or Docker calls.`);
} finally { await browser?.close(); await runtime?.close(); await rm(root, { recursive: true, force: true }); }
