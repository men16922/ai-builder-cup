// Export selected original product components from the offline browser fixture.
// No signed-in browser, Google content, private screenshot or live provider is used.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const temporary = join(root, '.data/deck-captures');
const images = join(root, 'submission/deck/img');
await mkdir(temporary, { recursive: true });
await mkdir(images, { recursive: true });
let source = await readFile(join(root, 'tests/browser/my-aide.mjs'), 'utf8');
const contextOptions = "viewport:{width:1280,height:1000},locale:'en-US'";
if (!source.includes(contextOptions)) throw Error('Missing fixture context options');
source = source.replace(contextOptions, `${contextOptions},deviceScaleFactor:2`);
const exports = [
  ["await expect(page.getByText('Shall I cool the cabin to 20° before you leave?')).toBeVisible();assert.equal(modelCalls,1);", '.aide-ask', 'my-aide-ask.png'],
  ["await axe(page);await page.screenshot({path:join(directory,'my-aide-call-active.png')});", '.aide-call-sheet', 'my-aide-call.png'],
  ["await axe(page);await page.screenshot({path:join(directory,'my-aide-diagnosis.png'),fullPage:true});", '.aide-cluster', 'my-aide-diagnosis.png'],
];
for (const [checkpoint, selector, output] of exports) {
  const start = source.indexOf(checkpoint);
  if (start < 0 || source.indexOf(checkpoint, start + 1) >= 0) throw Error(`Missing or ambiguous fixture capture point: ${output}`);
  const end = start + checkpoint.length;
  const capture = `await page.setViewportSize({width:390,height:844});await page.locator('${selector}').screenshot({path:join(process.env.AIDE_DECK_IMAGES,'${output}'),animations:'disabled'});await page.setViewportSize({width:1280,height:1000});`;
  source = source.slice(0, end) + '\n  ' + capture + source.slice(end);
}
const script = join(temporary, 'run.mjs');
await writeFile(script, source);
const result = spawnSync(process.execPath, ['--import', 'tsx', script], {
  cwd: root,
  env: { ...process.env, MOBILEOPS_OFFLINE_TEST: '1', AIDE_DECK_IMAGES: images, MOBILEOPS_SCREENSHOT_DIR: temporary },
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status ?? 1);
const sha256 = data => createHash('sha256').update(data).digest('hex');
await writeFile(join(images, 'my-aide-provenance.json'), JSON.stringify({
  createdAt: new Date().toISOString(),
  kind: 'Offline synthetic product component captures; not deployed screenshots',
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  fixture: 'tests/browser/my-aide.mjs',
  fixtureSha256: sha256(await readFile(join(root, 'tests/browser/my-aide.mjs'))),
  images: await Promise.all(exports.map(async ([, selector, name]) => ({ name, selector, sha256: sha256(await readFile(join(images, name))) }))),
  limits: ['Fictional caller, vehicle and model output', 'No real Maps imagery or provider photos', 'No accounts, credentials or cloud resource identifiers'],
}, null, 2) + '\n');
console.log('Selected synthetic deck images exported with provenance.');
