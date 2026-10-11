import { build } from 'esbuild';
import { readdir, readFile, writeFile, mkdir, copyFile, mkdtemp, rename, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gcpInputs, runtimePackages, gcpRuntimeLock } from './build-policy.mjs';

const hash = value => createHash('sha256').update(value).digest('hex'), json = value => JSON.stringify(value, null, 2) + '\n';
const destination = 'dist/gateway';
let existing; try { existing = await lstat(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (existing) {
  if (!existing.isDirectory() || !(await lstat(join(destination, 'candidate.json'))).isFile() || JSON.parse(await readFile(join(destination, 'candidate.json'), 'utf8')).kind !== 'mobileops.gcp-hosted-candidate') throw Error('Refusing to replace an unowned GCP output');
}
await mkdir('dist', { recursive: true });
const stage = await mkdtemp('dist/.gateway-build-');
try {
const result = await build({ entryPoints: { server: 'apps/gateway/src/main.ts', runtime: 'apps/gateway/src/runtime.ts' }, outdir: stage, outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'node', target: 'node24', format: 'esm', external: runtimePackages, metafile: true, sourcemap: false, logLevel: 'info' });
const inputs = gcpInputs(Object.keys(result.metafile.inputs));
for (const output of Object.values(result.metafile.outputs)) for (const item of output.imports) if (['node:child_process', 'node:sqlite'].includes(item.path) || item.external && !item.path.startsWith('node:') && !runtimePackages.some(name => item.path === name || item.path.startsWith(name + '/'))) throw Error(`Unexpected GCP external import: ${item.path}`);
const webInputs = gcpInputs(JSON.parse(await readFile('dist/web/module-inputs.json', 'utf8')));
const files = [];
async function copy(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) { if (relative !== 'assets') throw Error('Unexpected web directory'); await copy(join(directory, entry.name), relative + '/'); continue; }
    if (relative === 'module-inputs.json') continue;
    if (!entry.isFile() || !/^\/(?:index\.html|mark\.svg|assets\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)$/.test('/' + relative)) throw Error(`Unexpected web asset: ${relative}`);
    const data = await readFile(join(directory, entry.name)); await mkdir(join(stage, 'web', prefix), { recursive: true }); await writeFile(join(stage, 'web', relative), data); files.push({ path: '/' + relative, sha256: hash(data) });
  }
}
await copy('dist/web'); await writeFile(join(stage, 'web/web-manifest.json'), json({ version: 1, files: files.sort((a, b) => a.path.localeCompare(b.path)) }));
const rootPackage = JSON.parse(await readFile('package.json', 'utf8')), rootLock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const manifest = { name: 'mobileops-agent-gcp-hosted-candidate', version: rootPackage.version, private: true, type: 'module', engines: { node: '>=24.0.0' }, scripts: { start: 'node server.mjs' }, dependencies: Object.fromEntries(runtimePackages.map(name => [name, rootPackage.dependencies[name]])) };
if (Object.values(manifest.dependencies).some(version => !/^\d+\.\d+\.\d+$/.test(version))) throw Error('Exact dependency versions required');
const lock = gcpRuntimeLock(rootLock, manifest);
await writeFile(join(stage, 'package.json'), json(manifest)); await writeFile(join(stage, 'package-lock.json'), json(lock));
await copyFile('deploy/gateway/Dockerfile', join(stage, 'Dockerfile')); await copyFile('deploy/gateway/.dockerignore', join(stage, '.dockerignore'));
await writeFile(join(stage, 'module-inputs.json'), json({ web: webInputs, api: inputs }));
await writeFile(join(stage, 'candidate.json'), json({ kind: 'mobileops.gcp-hosted-candidate', version: 1, source: 'current-mixed-worktree', webAssets: files.length,
  api: { server: hash(await readFile(join(stage, 'server.mjs'))), runtime: hash(await readFile(join(stage, 'runtime.mjs'))) }, lockDigest: hash(json(lock)), dependencies: Object.keys(lock.packages).length - 1,
  limitations: ['Not deployed, no live Firebase/GCP/Gemini validation', 'No Docker build or image verification', 'Submission eligibility and source provenance unresolved', 'No credentials, configuration or membership bootstrap included'] }));
console.log(`GCP hosted candidate: dist/gateway, ${files.length} web assets, ${Object.keys(lock.packages).length - 1} locked runtime dependencies. No deployment.`);

await rm(destination, { recursive: true, force: true }); await rename(stage, destination);
} finally { await rm(stage, { recursive: true, force: true }); }
