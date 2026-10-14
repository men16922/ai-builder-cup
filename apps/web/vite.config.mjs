import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gcpWebBoundary } from '../../scripts/build-policy.mjs';

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, '../..');
// Local UI may use the existing authenticated gateway only when explicitly configured.
// Keep the proxy on loopback and preserve bearer/scope checks at the gateway.
const apiOrigin = process.env.AIDE_DEV_API_ORIGIN;
if (apiOrigin) {
  const url = new URL(apiOrigin);
  if (url.origin !== apiOrigin || url.protocol !== 'https:' || !url.hostname.endsWith('.run.app')) throw Error('Use an explicit Cloud Run HTTPS origin for local API development.');
}
const proxy = apiOrigin ? { '/api/': {
  target: apiOrigin, changeOrigin: true, secure: true,
  bypass(request, response) {
    const local = ['127.0.0.1:5174', 'localhost:5174'];
    const origin = request.headers.origin;
    if (!local.includes(request.headers.host ?? '') || origin && !local.some(host => origin === `http://${host}`)
      || request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin') {
      response.writeHead(403); response.end(); return false;
    }
  },
  configure(server) {
    server.on('proxyReq', request => { request.setHeader('Origin', apiOrigin); });
  },
} } : undefined;

export default defineConfig({
  plugins: [react(), gcpWebBoundary(), {
    name: 'aide-local-signin-address',
    configureServer(server) {
      // Firebase's existing local sign-in registration uses localhost. Keep the
      // listener on loopback and canonicalize the entry instead of widening it.
      server.middlewares.use((request, response, next) => {
        if (request.headers.host === '127.0.0.1:5174' && ['GET', 'HEAD'].includes(request.method ?? '')
          && ['/', '/index.html'].includes((request.url ?? '').split('?')[0])) {
          response.writeHead(302, { Location: `http://localhost:5174${request.url}`, 'Cache-Control': 'no-store' });
          response.end(); return;
        }
        next();
      });
    },
  }],
  root: here,
  resolve: { alias: { '@contracts': resolve(repository, 'packages/contracts/src') } },
  build: { outDir: resolve(repository, 'dist/web'), emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5174, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
});
