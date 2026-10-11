// Scans every file that would be committed for secrets and for the real identifiers listed in .data/publish-denylist.txt.
// The denylist is local and ignored by Git on purpose: putting real identifiers in the repository would leak them.
// Usage: node scripts/check-publishable.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';

const generic = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'], [/AIza[0-9A-Za-z_-]{35}/, 'Google API key'], [/ya29\.[0-9A-Za-z_-]{20,}/, 'Google access token'],
  [/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, 'JWT'], [/"refresh_token"\s*:/, 'refresh token'], [/\b[0-9]{9,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com\b/, 'OAuth client id'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'GitHub token'], [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
];
// Build output and tool caches are never source. Compiled caches also embed the absolute path of the machine that built them.
const artifacts = /(?:^|\/)(?:__pycache__|node_modules|\.venv|dist|build|\.gradle|\.kotlin|\.pytest_cache|test-results)(?:\/|$)|\.egg-info(?:\/|$)|\.(?:pyc|pyo|class|apk|aab|jks|keystore|log)$/;
const homePath = /\/(?:Users|home)\/[A-Za-z0-9._-]+\//;
const denylistPath = '.data/publish-denylist.txt';
const denied = existsSync(denylistPath) ? readFileSync(denylistPath, 'utf8').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#')) : [];
if (!denied.length) console.warn('No local denylist found; only generic secret patterns are checked.');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const findings = [];
for (const file of files) {
  if (!existsSync(file) || !statSync(file).isFile()) continue;
  if (artifacts.test(file)) { findings.push(`${file}: build output or tool cache must not be committed`); continue; }
  if (file === 'docs/provenance/source-manifest.json' || statSync(file).size > 3_000_000) continue;
  // Binary files are read as bytes, so identifiers and local paths inside them are still found.
  const text = readFileSync(file).toString('latin1');
  if (homePath.test(text)) findings.push(`${file}: contains a local home directory path`);
  if (text.includes('\u0000')) { for (const value of denied) if (text.includes(value)) findings.push(`${file}: binary file contains a listed real identifier`); continue; }
  for (const [pattern, label] of generic) if (pattern.test(text)) findings.push(`${file}: ${label}`);
  for (const value of denied) if (text.includes(value)) findings.push(`${file}: contains a listed real identifier`);
}
if (findings.length) { console.error(findings.join('\n')); process.exit(1); }
console.log(`Publishable check passed: ${files.length} files, ${denied.length} local denylist entries, ${generic.length} secret patterns.`);
