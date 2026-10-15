import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteCloudStore } from '../../apps/gateway/src/store/sqlite-store.ts';
import { GcpWebAccess } from '../../apps/gateway/src/auth/web-access.ts';
import { GcpMobility } from '../../apps/gateway/src/mobility/service.ts';
import { handleGcpApi } from '../../apps/gateway/src/http/api.ts';

if (process.env.MOBILEOPS_OFFLINE_TEST !== '1') throw Error('Call uncertainty verification must be offline.');
const root = await mkdtemp(join(tmpdir(), 'aide-call-unknown-')), captures = process.env.MOBILEOPS_SCREENSHOT_DIR ?? 'test-results/screenshots';
const store = new SqliteCloudStore(':memory:'); let server, browser, models = 0; const operations = [];
try {
  await build({ entryPoints: ['tests/support/call-uncertainty-harness.tsx'], outfile: join(root, 'app.js'), bundle: true, platform: 'browser', format: 'esm', loader: { '.woff2': 'file', '.woff': 'file', '.svg': 'file', '.png': 'file' }, logLevel: 'silent' });
  const scope = { edition: 'organization', organizationId: 'synthetic-org', workspaceId: 'synthetic-workspace', label: 'Synthetic' };
  const access = new GcpWebAccess({ async verify(token) { if (token !== 'synthetic-driver') throw Error(); return { actorId: token, expiresAt: Date.now() + 600000 }; } }, store);
  await access.organization.provision({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, actorId: 'synthetic-driver', version: 1, active: true, roles: ['operator', 'reviewer'], updatedAt: new Date().toISOString() });
  const mobility = new GcpMobility(store, access, () => true, { engine: 'offline-fixture',
    async diagnose() { throw Error('No diagnosis expected'); },
    async call() { models++; throw Error('Synthetic unconfirmed provider outcome'); },
    async summarizeCall() { throw Error('No summary expected'); },
  });
  const command = mobility.command.bind(mobility); mobility.command = async (session, input, key) => { operations.push(input.operation); return command(session, input, key); };
  const services = { access, mobility, publicOrigin: 'http://127.0.0.1' };
  server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    if (path.startsWith('/api/')) { await handleGcpApi(request, response, services); return; }
    if (path === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><title>Offline call verification</title></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); return; }
    if (!/^\/(?:app\.(?:js|css)|[A-Za-z0-9_.-]+\.(?:woff2?|svg|png))$/.test(path)) { response.writeHead(404); response.end(); return; }
    try { response.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml' }[extname(path)]); response.end(await readFile(join(root, path.slice(1)))); } catch { response.writeHead(404); response.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const origin = `http://127.0.0.1:${server.address().port}`; services.publicOrigin = origin;
  browser = await chromium.launch({ headless: true }); const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin); await page.getByRole('button', { name: 'Create synthetic call', exact: true }).click();
  await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/gcp/mobility') && response.request().method() === 'POST'), page.getByRole('button', { name: 'Let My Aide answer', exact: true }).click()]);
  await expect.poll(() => models).toBe(1);
  await expect(page.getByRole('dialog', { name: 'We could not confirm the result', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View manual', exact: true }).click();
  await expect(page.getByText('Do not send the same action again while its result is unknown.', { exact: true })).toBeVisible();
  await expect(page.getByText('If it did not, start a new request.', { exact: true })).toHaveCount(0);
  const guideAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(guideAxe.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.html) }))).toEqual([]);
  await mkdir(captures, { recursive: true });
  await page.screenshot({ path: join(captures, 'call-error-manual-en-390.png'), fullPage: true });
  const beforeRead = operations.length;
  await page.getByRole('button', { name: 'Check latest state', exact: true }).click();
  await expect(page.getByText('Call outcome unconfirmed', { exact: true })).toBeVisible();
  assert.equal(operations.length, beforeRead); assert.equal(models, 1);
  await page.reload(); // A new client reads the durable unknown; no in-memory flag supplies it.
  await expect(page.getByText('Call outcome unconfirmed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Let My Aide answer', exact: true })).toHaveCount(0);
  const before = operations.length;
  await page.getByRole('button', { name: 'Read latest record', exact: true }).click();
  await page.waitForTimeout(1400);
  assert.equal(operations.length, before); assert.equal(models, 1);
  await page.getByLabel('Language / 언어').selectOption('ko');
  await expect(page.getByText('통화 결과 미확인', { exact: true })).toBeVisible();
  await expect(page.getByText('후속 작업 실행 안 함', { exact: true })).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.html) }))).toEqual([]);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir(captures, { recursive: true }); await page.screenshot({ path: join(captures, 'call-outcome-unknown-ko-390.png'), fullPage: true });
  await page.getByRole('button', { name: '닫기', exact: true }).last().click();
  await expect(page.getByText('통화 결과 미확인', { exact: true })).toHaveCount(0);
  assert.equal(models, 1); assert.equal(operations.filter(value => value === 'call_answer').length, 1);
  expect(errors).toEqual([]);
  console.log('Call uncertainty browser check passed: immediate HTTP unknown/manual without resend advice, explicit GET/durable unknown after reload, no repeated answer/model/follow-up, KO/EN, 390px/axe including the open manual. No live provider or real call.');
} catch (error) {
  await mkdir(captures, { recursive: true });
  await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: join(captures, 'call-uncertainty-failure.png'), fullPage: true });
  throw error;
} finally {
  await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  store.close(); await rm(root, { recursive: true, force: true });
}
