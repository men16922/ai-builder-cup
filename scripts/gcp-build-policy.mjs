import { realpathSync } from 'node:fs';
import { relative, resolve, isAbsolute } from 'node:path';
export const excludedGcpInput = /(?:^|\/)(?:modules\/(?:aws|onprem|azure|registry)|apps\/(?:demo|personal|organization)|src\/(?:App|main|company-main|store)\.|src\/data\/|server\/(?:service|index|http|cloud-http|cloud-index|cloud-sqlite-store)\.|platform\/firebase\/(?:organization|load-organization)\.|(?:@aws-sdk|@smithy)(?:\/|$)|\.data(?:\/|$)|\.env(?:\.|$)|mobile\/|evaluation\/|(?:fixtures|tests)\/|[^/]+\.test\.)/;
export function gcpInputs(inputs, root = process.cwd()) {
  root = realpathSync(root);
  const paths = [...new Set(inputs.filter(id => !id.startsWith('\0')).map(id => relative(root, resolve(root, id.split('?')[0])).replaceAll('\\', '/')))].sort();
  for (const path of paths) if (!path || path.startsWith('../') || isAbsolute(path) || excludedGcpInput.test(path)) throw Error(`Excluded GCP build input: ${path}`);
  return paths;
}
export function gcpWebBoundary() {
  return { name: 'gcp-hosted-boundary', generateBundle() { this.emitFile({ type: 'asset', fileName: 'module-inputs.json', source: JSON.stringify(gcpInputs([...this.getModuleIds()]), null, 2) + '\n' }); } };
}
export const runtimePackages = ['firebase-admin', '@google-cloud/firestore', 'google-auth-library'];
/** Retain the existing exact npm resolutions; never discover a fresh dependency version. */
export function gcpRuntimeLock(root, manifest) {
  if (root.lockfileVersion !== 3) throw Error('Expected npm lock v3');
  const selected = new Set(), queue = [];
  const add = (from, name, optional = false) => {
    let base = from, found;
    while (true) {
      const path = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
      if (root.packages[path]) { found = path; break; }
      if (!base) break;
      const parent = base.lastIndexOf('/node_modules/'); base = parent < 0 ? '' : base.slice(0, parent);
    }
    if (!found) { if (optional) return; throw Error(`Missing locked GCP dependency: ${name}`); }
    if (!selected.has(found)) { selected.add(found); queue.push(found); }
  };
  for (const name of Object.keys(manifest.dependencies)) add('', name);
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i], entry = root.packages[path];
    if (!entry.integrity || !entry.resolved?.startsWith('https://registry.npmjs.org/') || /(?:@aws-sdk|@smithy)/.test(path)) throw Error(`Invalid GCP dependency: ${path}`);
    for (const name of Object.keys(entry.dependencies ?? {})) add(path, name, name in (entry.optionalDependencies ?? {}));
    for (const name of Object.keys(entry.optionalDependencies ?? {})) add(path, name, true);
    for (const name of Object.keys(entry.peerDependencies ?? {})) add(path, name, entry.peerDependenciesMeta?.[name]?.optional === true);
  }
  return { name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages: {
    '': { name: manifest.name, version: manifest.version, engines: manifest.engines, dependencies: manifest.dependencies },
    ...Object.fromEntries([...selected].sort().map(path => { const entry = { ...root.packages[path] }; delete entry.dev; delete entry.devOptional; delete entry.peer; return [path, entry]; })),
  } };
}
