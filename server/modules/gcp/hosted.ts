import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { z } from 'zod';
import { handleGcpApi, isGcpApiPath, type GcpApiServices } from './api';
import { gcpServerConfiguration } from './configuration';

export function hostedEnvironment(env: Record<string, string | undefined>) {
  if (env.MOBILEOPS_GCP_HOSTED_ENABLED !== '1' || env.MOBILEOPS_GCP_ENABLED !== '1' || env.MOBILEOPS_OFFLINE_TEST === '1') throw Error('GCP hosted entry is disabled.');
  const value = env.PORT ?? '8080';
  if (!/^[1-9][0-9]{0,4}$/.test(value) || Number(value) > 65535) throw Error('Invalid hosted port.');
  if (!env.MOBILEOPS_GCP_CONFIG?.startsWith('/')) throw Error('Set the explicit GCP server configuration path.');
  return { port: Number(value), configurationPath: env.MOBILEOPS_GCP_CONFIG };
}
export function hostedConfiguration(input: unknown) {
  const config = gcpServerConfiguration.parse(input);
  if (!config.publicOrigin.startsWith('https://') || config.credentials.method !== 'metadata') throw Error('Hosted GCP requires HTTPS origin and a configured runtime service identity.');
  return config;
}
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const pathPattern = /^\/(?:index\.html|mobileops-mark\.svg|assets\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)$/;
const assetsSchema = z.object({ version: z.literal(1), files: z.array(z.object({ path: z.string().regex(pathPattern), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(512) }).strict();
async function regularFile(root: string, file: string, maximum: number) {
  const path = resolve(root, file); if (await realpath(path) !== path || !path.startsWith(root + '/')) throw Error('Invalid hosted asset.');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > maximum) throw Error('Invalid hosted asset.'); const bytes = await handle.readFile(); if (bytes.length > maximum) throw Error('Invalid hosted asset.'); return bytes; }
  finally { await handle.close(); }
}
/** Load the closed, hashed asset set once. Requests cannot select filesystem paths. */
export async function loadHostedAssets(directory: string) {
  const root = await realpath(directory), manifest = assetsSchema.parse(JSON.parse((await regularFile(root, 'web-manifest.json', 131072)).toString('utf8')));
  const assets = new Map<string, { type: string; bytes: Buffer }>(); let total = 0;
  for (const file of manifest.files) {
    const type = types[extname(file.path)]; if (!type || assets.has(file.path)) throw Error('Invalid hosted asset manifest.');
    const bytes = await regularFile(root, file.path.slice(1), 8388608); total += bytes.length;
    if (total > 33554432 || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw Error('Hosted asset integrity mismatch.');
    assets.set(file.path, { type, bytes });
  }
  if (!assets.has('/index.html') || !assets.has('/mobileops-mark.svg')) throw Error('Hosted entry assets are missing.');
  return assets;
}
export type HostedServices = { services: GcpApiServices; close(): Promise<void> };
/** Trusted entry/fixture port only. Synthetic mode is permitted solely in offline loopback tests. */
export async function startGcpHosted(composition: HostedServices, directory: string, options: { port: number; host: '0.0.0.0' | '127.0.0.1'; synthetic?: boolean; graceMs?: number }) {
  let closedResources: Promise<void> | undefined;
  const closeResources = () => closedResources ??= Promise.resolve().then(() => composition.close());
  try {
    const origin = new URL(composition.services.publicOrigin), synthetic = options.synthetic === true;
    if (origin.origin !== composition.services.publicOrigin || (synthetic ? process.env.MOBILEOPS_OFFLINE_TEST !== '1' || options.host !== '127.0.0.1' || origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:' : process.env.MOBILEOPS_OFFLINE_TEST === '1' || origin.protocol !== 'https:')) throw Error('Invalid hosted origin or test mode.');
    if (!Number.isInteger(options.port) || options.port < (synthetic ? 0 : 1) || options.port > 65535) throw Error('Invalid hosted port.');
    const graceMs = options.graceMs ?? 8000;
    if (!Number.isInteger(graceMs) || graceMs < 1 || graceMs > 8000 || !synthetic && options.graceMs !== undefined) throw Error('Invalid shutdown deadline.');
    const assets = await loadHostedAssets(directory), inFlight = new Set<Promise<void>>();
    let stopping = false, shutdown: Promise<'drained' | 'deadline' | 'failed'> | undefined;
    const server = createServer((request, response) => {
      response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Referrer-Policy', 'same-origin');
      const send = (status: number, code: string) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ code })); };
      response.once('finish', () => { if (stopping) setImmediate(() => server.closeIdleConnections()); });
      if (stopping) { response.setHeader('Connection', 'close'); send(503, 'shutting_down'); return; }
      if (request.headers.host !== new URL(composition.services.publicOrigin).host) { send(403, 'host_required'); return; }
      const path = request.url ?? '/';
      if (isGcpApiPath(path.split('?')[0])) {
        const work = handleGcpApi(request, response, composition.services).catch(() => { if (!response.headersSent && !response.destroyed) send(500, 'gcp_request_failed'); else response.destroy(); }); inFlight.add(work); void work.then(() => inFlight.delete(work)); return;
      }
      if (path === '/healthz' && request.method === 'GET') { send(200, 'ready'); return; }
      if (!['GET', 'HEAD'].includes(request.method ?? '')) { send(405, 'method_not_allowed'); return; }
      const asset = assets.get(path === '/' ? '/index.html' : path);
      if (!asset) { send(404, 'not_found'); return; }
      response.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': asset.bytes.length }); response.end(request.method === 'HEAD' ? undefined : asset.bytes);
    });
    server.requestTimeout = 35000; server.headersTimeout = 10000; server.maxHeadersCount = 64;
    await new Promise<void>((done, reject) => { const failed = (error: Error) => reject(error); server.once('error', failed); server.listen(options.port, options.host, () => { server.removeListener('error', failed); done(); }); });
    return { server, close() {
      if (shutdown) return shutdown;
      stopping = true;
      shutdown = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<'deadline'>(done => { timer = setTimeout(() => { server.closeAllConnections(); done('deadline'); }, graceMs); });
        const drain = (async () => {
          await new Promise<void>(done => server.close(() => done()));
          // A disconnected caller may still have an authorized model/read operation in progress.
          await Promise.allSettled([...inFlight]); await closeResources(); return 'drained' as const;
        })().catch(() => 'failed' as const);
        const outcome = await Promise.race([drain, deadline]); clearTimeout(timer); return outcome;
      })();
      return shutdown;
    } };
  } catch { await closeResources().catch(() => {}); throw Error('GCP hosted startup failed. Check fixed configuration and built assets.'); }
}
