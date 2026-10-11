import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { relative, resolve, isAbsolute, delimiter, dirname } from 'node:path';

const root = realpathSync(process.cwd());
// Only GCP sources belong here: no other provider's code or SDK, no local data, no environment files.
const forbidden = /(?:^|\/)(?:aws|azure|onprem)(?:\/|[.-])|(?:@aws-sdk|@smithy)(?:\/|$)|\.data(?:\/|$)|\.env(?:\.|$)/;
const env = { ...process.env, PATH: [dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter).filter(path => !path.includes('node_modules'))].join(delimiter) };
delete env.NODE_PATH; delete env.NODE_OPTIONS;
const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--listFilesOnly'], { env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
if (result.error || result.status !== 0) throw Error(`Cannot verify source boundary: ${result.stderr}`);
for (const file of result.stdout.trim().split(/\r?\n/)) {
  const path = relative(root, resolve(file)).replaceAll('\\', '/');
  if (!path || path.startsWith('../') || isAbsolute(path) || forbidden.test(path) || realpathSync(file) !== resolve(file)) throw Error(`Excluded GCP source input: ${path}`);
}
console.log('GCP source boundary passed, including type-only imports and test support.');
