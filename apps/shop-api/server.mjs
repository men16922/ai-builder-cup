// A tiny storefront API used as the target of the agent demo. FAIL_RATE and SLOW_MS simulate a bad release.
import http from 'node:http';

const failRate = Number(process.env.FAIL_RATE ?? 0), slowMs = Number(process.env.SLOW_MS ?? 0), version = process.env.APP_VERSION ?? 'v1';
const log = (severity, message, extra = {}) => console.log(JSON.stringify({ severity, message, version, ...extra }));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

http.createServer(async (request, response) => {
  if (request.url === '/healthz') { response.writeHead(200).end('ok'); return; }
  if (slowMs) await sleep(slowMs * (0.5 + Math.random()));
  if (Math.random() < failRate) {
    log('ERROR', 'checkout failed: payment gateway timeout after 5000ms', { component: 'payments', code: 'GATEWAY_TIMEOUT' });
    response.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'payment_unavailable' }));
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, version }));
}).listen(Number(process.env.PORT ?? 8080), () => log('INFO', `shop-api ${version} listening`));
