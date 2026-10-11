// Renders the submission deck to submission/deck/deck.html (keys 1-9 and arrows move between slides) and deck.pdf. Run: node --import tsx submission/deck/build.mjs
// The product name comes from apps/web/src/brand.ts and every number from the recorded evaluation results.
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..', '..');
const brand = (await readFile(join(root, 'apps/web/src/brand.ts'), 'utf8')).match(/productName = '([^']+)'/)[1];
const tokens = await readFile(join(root, 'apps/web/src/theme.generated.css'), 'utf8');
const results = JSON.parse(await readFile(join(root, 'apps/crew/evals/results/latest.json'), 'utf8'));
const baselinePath = join(root, 'apps/crew/evals/results/baseline-run1.json');
const baseline = existsSync(baselinePath) ? JSON.parse(await readFile(baselinePath, 'utf8')) : undefined;
const sum = report => { const runs = report.scenarios.flatMap(s => s.runs); return { passed: runs.filter(r => r.passed).length, total: runs.length }; };
const now = sum(results), first = baseline && sum(baseline);
// The "fixed and measured again" sentence appears only when the latest results really differ from the recorded first run.
const remeasured = !!baseline && JSON.stringify(baseline.scenarios.map(s => s.runs.map(r => r.final))) !== JSON.stringify(results.scenarios.map(s => s.runs.map(r => r.final)));
const median = id => results.scenarios.find(s => s.id === id)?.median_seconds;
const img = name => `img/${name}`; // relative, so the published deck.html never carries a local path
const rows = results.scenarios.map(s => `<tr><td><code>${s.id}</code></td><td>${s.runs.filter(r => r.passed).length}/${s.runs.length}</td><td>${s.median_seconds} s</td></tr>`).join('');
const slides = [
`<section class="title"><p class="eyebrow">AI Builder Cup 2026 · Future of Work &amp; Enterprise Productivity</p><h1>${brand}</h1><p class="lead">Be the boss. Hand the work to an agent crew from your phone and make only the big decisions.</p></section>`,
`<section><h2>The problem</h2><ul class="big"><li>Production trouble does not wait for you to reach a desk.</li><li>Finding the cause means opening several consoles, comparing revisions, reading logs, and then deciding.</li><li>The decision is small. The work around it is not, and it ties a person to a laptop.</li></ul></section>`,
`<section><h2>The idea</h2><div class="cols"><div><p class="lead">One sentence from a phone. A crew of Gemini agents does the investigation. You are asked only for the decision that is yours.</p><ul><li><b>Ask</b> in the assistant panel or the top bar</li><li><b>Watch</b> each agent's step stream in</li><li><b>Decide</b> on one approval card</li><li><b>Verify</b> in an honest report</li></ul></div><img src="${img('approval.png')}" alt="Console with the approval card"></div></section>`,
`<section><h2>A real console, not a chat box</h2><img class="wide" src="${img('dashboard.png')}" alt="Dashboard"><p class="caption">KPI tiles, traffic split, responses and latency per revision, error logs, and the crew in a right-hand Gemini panel.</p></section>`,
`<section><h2>Architecture</h2><div class="arch"><div class="box phone">Android app · Web console<br><small>Material 3 · Korean / English</small></div><div class="arrow">▼ Firebase identity · roles</div><div class="box gateway">Gateway · Cloud Run<br><small>tasks · signed approvals · Firestore</small></div><div class="arrow">▼ A2A streaming · identity tokens</div><div class="box chief">Chief agent · ADK · Gemini</div><div class="arrow">▼ A2A</div><div class="row"><div class="box">Ops<br><small>reads · applies approved rollback</small></div><div class="box">Diagnosis<br><small>hypotheses · unknowns</small></div><div class="box">Guardian<br><small>policy table</small></div></div></div></section>`,
`<section><h2>Why a model cannot talk its way into a change</h2><ul class="big"><li><b>Typed tools only.</b> No credentials, no generated code.</li><li><b>Signed approval.</b> An HMAC over the exact action, five minutes, verified by the one service that can change anything.</li><li><b>Two independent checks.</b> Policy before asking, policy and signature again before acting. Permission covers one service.</li><li><b>Honest about the unknown.</b> Empty metrics are unknown, never zero. Log text is data, not instructions. Nothing is retried automatically.</li></ul></section>`,
`<section><h2>We measured it</h2><p class="lead">Six scenarios, three runs each, against the real Gemini crew with fixed data. A run passes only if every exact rule check and every graded expectation passes.</p><div class="cols"><table><tr><th>Scenario</th><th>Passed</th><th>Median</th></tr>${rows}</table><div class="stat"><span class="num">${now.passed}/${now.total}</span><span>runs passed${remeasured ? `<br><small>first run: ${first.passed}/${first.total}. The evaluation exposed honesty gaps (calling empty data healthy, steering a user to delete by hand); we fixed the instructions and measured again. Tuned on these scenarios, so not a held-out score.</small>` : ''}</span></div></div></section>`,
`<section><h2>Impact we can show</h2><ul class="big"><li>From instruction to a reviewed decision in about <b>${Math.round(median('bad_release'))} seconds</b> (median of three runs, bad release).</li><li>The person taps <b>once</b>. The crew performed the reads, the comparison and the verification.</li><li>Every step is visible and every change is attributable to an approval.</li></ul><p class="caption">Timings are from our evaluation runs, not a benchmark against manual work.</p></section>`,
`<section><h2>Built on Google Cloud</h2><div class="chips"><span>Gemini 3.8 Flash</span><span>Agent Development Kit</span><span>A2A protocol</span><span>Cloud Run (5 private services)</span><span>Cloud Monitoring &amp; Logging</span><span>Firestore</span><span>Firebase Authentication</span><span>Secret Manager</span><span>Cloud Trace</span><span>Material Web &amp; Compose Material 3</span></div></section>`,
`<section><h2>Next</h2><ul class="big"><li>Voice instructions in the Android assistant</li><li>More reversible actions behind the same signed approval</li><li>Risk-based approvals to avoid approval fatigue</li><li>Interoperate with other teams' A2A agents</li></ul></section>`,
];
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${brand}</title><style>${tokens}
@page { size: 1280px 720px; margin: 0 } *{box-sizing:border-box} body{margin:0;font-family:var(--md-ref-typeface-plain);color:var(--md-sys-color-on-surface);background:var(--md-sys-color-surface)}
section{width:1280px;height:720px;padding:56px 72px;page-break-after:always;overflow:hidden;position:relative}
h1{font-family:var(--md-ref-typeface-brand);font-size:84px;margin:12px 0;font-weight:500;background:linear-gradient(100deg,var(--md-sys-color-primary),var(--md-sys-color-tertiary));-webkit-background-clip:text;color:transparent}
h2{font-family:var(--md-ref-typeface-brand);font-size:44px;margin:0 0 28px;font-weight:500}.title{display:flex;flex-direction:column;justify-content:center}.eyebrow{font-size:20px;color:var(--md-sys-color-on-surface-variant);margin:0}
.lead{font-size:30px;line-height:1.4;max-width:900px}.big{font-size:30px;line-height:1.5}.big li{margin-bottom:18px}ul{padding-left:28px;font-size:24px;line-height:1.55}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}.cols img{width:100%;border-radius:16px;border:1px solid var(--md-sys-color-outline-variant)}
.wide{width:100%;max-height:520px;object-fit:cover;object-position:top;border-radius:16px;border:1px solid var(--md-sys-color-outline-variant)}.caption{font-size:20px;color:var(--md-sys-color-on-surface-variant)}
table{border-collapse:collapse;font-size:22px;width:100%}td,th{padding:10px 14px;border-bottom:1px solid var(--md-sys-color-outline-variant);text-align:left}code{font-family:var(--ops-typeface-mono);font-size:19px}
.stat{display:flex;flex-direction:column;gap:12px;font-size:26px}.num{font-family:var(--md-ref-typeface-brand);font-size:96px;color:var(--md-sys-color-primary);line-height:1}small{font-size:18px;color:var(--md-sys-color-on-surface-variant)}
.arch{display:flex;flex-direction:column;align-items:center;gap:8px;font-size:24px}.box{padding:14px 26px;border-radius:16px;background:var(--md-sys-color-secondary-container);text-align:center}.box small{display:block}
.gateway{background:var(--md-sys-color-primary-container);color:var(--md-sys-color-on-primary-container)}.chief{background:var(--md-sys-color-primary);color:var(--md-sys-color-on-primary);padding:14px 60px}.arrow{font-size:18px;color:var(--md-sys-color-on-surface-variant)}.row{display:flex;gap:20px}.row .box{width:290px}
.chips{display:flex;flex-wrap:wrap;gap:16px}.chips span{padding:14px 24px;border-radius:28px;background:var(--md-sys-color-secondary-container);font-size:26px}
/* Screen: one slide at a time, scaled to the window. Print (the PDF): every slide in order. */
@media screen{body{background:#111;overflow:hidden}section{display:none;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(var(--scale,1));transform-origin:center;background:var(--md-sys-color-surface)}section.active{display:block}section.title.active{display:flex}
.nav{position:fixed;left:50%;bottom:8px;transform:translateX(-50%);padding:4px 12px;border-radius:12px;background:rgba(0,0,0,.65);font:13px sans-serif;color:#ccc;pointer-events:none}.nav b{color:#fff}}
@media print{.nav{display:none}}
</style><body>${slides.join('')}<div class="nav" aria-live="polite"></div><script>
// 1-9 jump to a slide (0 is slide 10). Arrows, space, PageUp/PageDown, Home/End and a click on the left or right half also move.
const slides = [...document.querySelectorAll('section')], nav = document.querySelector('.nav');
let at = Math.max(0, Math.min(slides.length - 1, (parseInt(location.hash.slice(1), 10) || 1) - 1));
const fit = () => document.documentElement.style.setProperty('--scale', Math.min(innerWidth / 1280, innerHeight / 720));
const show = n => { at = Math.max(0, Math.min(slides.length - 1, n)); slides.forEach((s, i) => s.classList.toggle('active', i === at)); history.replaceState(null, '', '#' + (at + 1)); nav.innerHTML = '<b>' + (at + 1) + '</b> / ' + slides.length + ' · press 1-' + Math.min(9, slides.length) + (slides.length > 9 ? ', 0' : '') + ' or the arrow keys'; };
addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^[0-9]$/.test(e.key)) { const n = e.key === '0' ? 10 : +e.key; if (n <= slides.length) show(n - 1); }
  else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); show(at + 1); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); show(at - 1); }
  else if (e.key === 'Home') show(0); else if (e.key === 'End') show(slides.length - 1);
});
addEventListener('click', e => show(e.clientX < innerWidth / 3 ? at - 1 : at + 1));
addEventListener('resize', fit); fit(); show(at);
</script></body></html>`;
await writeFile(join(here, 'deck.html'), html);
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(pathToFileURL(join(here, 'deck.html')).href); await page.waitForLoadState('networkidle');
await page.pdf({ path: join(here, 'deck.pdf'), width: '1280px', height: '720px', printBackground: true });
await browser.close(); console.log(`Deck written: ${slides.length} slides, ${brand}.`);
