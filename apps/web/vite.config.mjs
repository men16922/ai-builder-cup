import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gcpWebBoundary } from '../../scripts/build-policy.mjs';

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, '../..');

export default defineConfig({
  plugins: [react(), gcpWebBoundary()],
  root: here,
  resolve: { alias: { '@contracts': resolve(repository, 'packages/contracts/src') } },
  build: { outDir: resolve(repository, 'dist/web'), emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
});
