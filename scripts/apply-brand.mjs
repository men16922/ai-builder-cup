// Changes the product's display name everywhere a person reads it. Resource names, package ids and URLs are not touched.
// Usage: node scripts/apply-brand.mjs "New Name" [--dry-run]     Then run: make check
import { readFileSync, writeFileSync } from 'node:fs';

const [name, flag] = process.argv.slice(2);
if (!name || !/^[A-Za-z][A-Za-z0-9 ]{1,23}$/.test(name)) { console.error('Give a display name of 2-24 letters, digits or spaces.'); process.exit(2); }
const current = /productName = '([^']+)'/.exec(readFileSync('apps/web/src/brand.ts', 'utf8'))?.[1];
if (!current) { console.error('apps/web/src/brand.ts has no productName.'); process.exit(2); }
// Files where the name is shown to people. The packaged Android identity (applicationId, namespace) stays as it is.
const files = ['apps/web/src/brand.ts', 'apps/web/index.html', 'AGENTS.md', 'README.md', 'submission/SUBMISSION.md', 'docs/ARCHITECTURE.md', 'docs/HACKATHON_PLAN.md', 'docs/STATUS.md', 'apps/android/README.md',
  'apps/gateway/src/main.ts', 'apps/gateway/test/hosted.test.ts', 'scripts/prepare-gcp-evaluation.ts', 'apps/android/app/src/main/AndroidManifest.xml',
  'apps/android/app/src/main/java/app/mobileops/agent/app/MobileOpsApp.kt', 'apps/android/app/src/main/java/app/mobileops/agent/app/MobileOpsMessagingService.kt'];
let total = 0;
for (const file of files) {
  let text; try { text = readFileSync(file, 'utf8'); } catch { continue; }
  const count = text.split(current).length - 1;
  if (!count) continue;
  total += count; console.log(`${file}: ${count}`);
  if (flag !== '--dry-run') writeFileSync(file, text.split(current).join(name));
}
console.log(`${flag === '--dry-run' ? 'Would change' : 'Changed'} ${total} occurrences of "${current}" to "${name}". The deck reads apps/web/src/brand.ts; rebuild it with: node --import tsx docs/deck/build.mjs`);
