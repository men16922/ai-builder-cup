import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCloudStore } from '../src/store/sqlite-store';
import { GcpWebAccess } from '../src/auth/web-access';
import { GcpOverview } from '../src/crew/overview';
import { overviewSchema } from '@contracts/gcp/overview';

const target = { name: 'shop-api', project: 'example-project', region: 'asia-northeast3' };
const resource = 'projects/example-project/locations/asia-northeast3/services/shop-api';
const ts = (revision: string, extra: object) => ({ resource: { labels: { revision_name: revision } }, ...extra });

async function setup(routes: (url: string, init?: RequestInit) => unknown, entitled = () => true) {
  const store = new SqliteCloudStore(':memory:'); let clock = Date.parse('2026-10-10T01:00:00.000Z'); const urls: string[] = [];
  const access = new GcpWebAccess({ async verify(token) { if (token !== 'user-a') throw Error(); return { actorId: token, expiresAt: clock + 3600000 }; } }, store, () => clock);
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); urls.push(url); const body = routes(url, init);
    return body instanceof Response ? body : new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  const overview = new GcpOverview(access, [target], { token: async () => 'synthetic-token', fetcher, now: () => clock }, entitled);
  const session = await access.authenticate('Bearer user-a', { edition: 'personal', workspaceId: 'ws', label: 'p' }, 'mobile');
  return { overview, session, store, urls, advance: (ms: number) => { clock += ms; } };
}
const good = (url: string) => {
  if (url.endsWith(resource)) return { trafficStatuses: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'shop-api-bad', percent: 100 }] };
  if (url.includes('/revisions')) return { revisions: [{ name: `${resource}/revisions/shop-api-bad`, createTime: '2026-10-10T00:30:00Z', conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }] }, { name: `${resource}/revisions/shop-api-good`, conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }] }] };
  if (url.includes('request_count')) return { timeSeries: [ts('shop-api-bad', { metric: { labels: { response_code_class: '5xx' } }, points: [{ value: { int64Value: '55' } }] }), ts('shop-api-bad', { metric: { labels: { response_code_class: '2xx' } }, points: [{ value: { int64Value: '45' } }] })] };
  if (url.includes('request_latencies')) return { timeSeries: [ts('shop-api-bad', { points: [{ value: { doubleValue: 1304.26 } }] })] };
  return { entries: [{ timestamp: '2026-10-10T00:55:00Z', severity: 'ERROR', textPayload: `boom\u0000 ${'x'.repeat(400)}`, resource: { labels: { revision_name: 'shop-api-bad' } }, httpRequest: { status: 500 } }] };
};

test('the overview combines service state, per-revision requests, latency and bounded logs', async () => {
  const { overview, session, urls } = await setup(good);
  const view = overviewSchema.parse(await overview.read(session)), service = view.services[0];
  assert.deepEqual(service.revisions.map(r => [r.name, r.percent, r.ready]), [['shop-api-bad', 100, 'ready'], ['shop-api-good', 0, 'ready']]);
  assert.deepEqual(service.requests.map(r => [r.revision, r.responseClass, r.count]), [['shop-api-bad', '5xx', 55], ['shop-api-bad', '2xx', 45]]);
  assert.deepEqual(service.latency, [{ revision: 'shop-api-bad', p95Ms: 1304.3 }]);
  assert.equal(service.logs[0].message.length, 180); assert.doesNotMatch(service.logs[0].message, /\u0000/); assert.equal(service.logs[0].status, 500);
  assert.deepEqual(service.coverage, { service: 'ok', requests: 'ok', logs: 'ok' });
  assert.ok(urls.every(url => /^https:\/\/(run|monitoring|logging)\.googleapis\.com\//.test(url)));
  // Every Monitoring read is filtered to the one registered service and location.
  assert.ok(urls.filter(url => url.includes('/timeSeries')).every(url => decodeURIComponent(url).includes('resource.labels.service_name="shop-api"') && decodeURIComponent(url).includes('resource.labels.location="asia-northeast3"')));
});

test('missing data is labeled empty or error, never zero, and one failing read does not hide the rest', async () => {
  const { overview, session } = await setup(url => url.includes('request_count') ? new Response('{}', { status: 403 }) : url.includes('request_latencies') ? {} : url.includes('entries') ? { entries: [] } : good(url));
  const service = (await overview.read(session)).services[0];
  assert.deepEqual(service.coverage, { service: 'ok', requests: 'error', logs: 'empty' }); assert.deepEqual(service.requests, []); assert.equal(service.revisions.length, 2);
});

test('results are cached briefly and a failed read is not cached', async () => {
  const { overview, session, urls, advance } = await setup(good);
  await overview.read(session); const first = urls.length; await overview.read(session); assert.equal(urls.length, first);
  advance(25_000); await overview.read(session); assert.equal(urls.length, first * 2);
});

test('only a signed-in person with a current session can read the overview', async () => {
  const { overview, session, advance } = await setup(good);
  advance(2 * 3600_000); await assert.rejects(overview.read(session));
});

test('a signed-in person who owns no registered service gets no overview and causes no Google read', async () => {
  const { overview, session, urls } = await setup(good, () => false);
  await assert.rejects(overview.read(session), { status: 403, code: 'crew_not_entitled' });
  assert.equal(urls.length, 0);
});
