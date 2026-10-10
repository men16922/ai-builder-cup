import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { gcpWebBoundary } from './scripts/gcp-build-policy.mjs';

export default defineConfig({
  plugins: [react(), gcpWebBoundary()],
  build: { outDir: 'dist-gcp-web' },
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
});
