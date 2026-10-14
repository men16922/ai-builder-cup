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
const img = name => `img/${name}`;
// Product screenshots are explicitly offline/synthetic. Never copy private cloud/account captures.
const slides = [
`<section class="title"><p class="eyebrow">AI Builder Cup 2026 · Connected mobility + operational productivity</p><h1>${brand}</h1><p class="lead">Less friction for the driver.<br>Less incident work for the responder.</p><p class="caption">A Hyundai-inspired EV companion with bounded AI assistance. Vehicle and driving are simulated.</p></section>`,
`<section><h2>The everyday interruption</h2><ul class="big"><li>A driver’s charging session stops. They need a safe next step, not another confusing error.</li><li>A responder is away from a desk when a release fails. Evidence is scattered across logs, metrics and revisions.</li><li>Repeated incidents should reuse verified experience, while unfamiliar situations still need a person.</li></ul><p class="caption">B2C goal: fewer interrupted journeys. Enterprise goal: less investigation and coordination work. Neither is a measured productivity claim.</p></section>`,
`<section><h2>Your car, now</h2><div class="cols"><div><p class="lead">Battery, charging and location at a glance.</p><ul><li>Vehicle home → charger, dinner or assistance</li><li>Actor-private serverless vehicle state</li><li>Web domains and Android MVVM / Material 3</li><li>Device-language English and Korean resources</li></ul><p class="caption">Offline synthetic UI capture; vehicle values are simulated.</p></div><img src="${img('mobility-home.png')}" alt="Synthetic Aide vehicle home"></div></section>`,
`<section><h2>Places come from Google</h2><p class="lead">“Find dinner nearby and take me there.”</p><ul class="big"><li>Gemini proposes a bounded query. Official Google Maps MCP searches real places.</li><li>The first destination needs selection. A Favorite or matching seven-day choice may handle the next request.</li><li>Genuine Google basemaps, adjacent source links and visible cancellation.</li></ul><p class="caption">Actual deployed search / tiles / Favorite / simulated arrival verified. Seoul route probes returned no routes; current movement is explicitly straight-line simulation, never physical steering.</p></section>`,
`<section><h2>Unfamiliar? Resolve it together.</h2><div class="cols"><div><ul class="big"><li>Report the unknown symptom without automatic repair.</li><li>Review five current safety checks.</li><li>Authorize one existing typed simulated reconnection.</li><li>Verify charging resumed; save a candidate case.</li></ul><p class="caption">Offline synthetic UI capture. The guided flow was also operated against the deployed Firestore/Gemini runtime.</p></div><img src="${img('mobility-recovery.png')}" alt="Synthetic guided charging recovery"></div></section>`,
`<section><h2>Learn the case. Keep authority separate.</h2><div class="cols"><div><p class="lead">Separate case approval does not run a remedy or enable autonomy.</p><ul><li>Same actor / workspace / vehicle / diagnostic signal</li><li>Parked, safe temperature, battery below target</li><li>Seven-day verified case + current 24-hour policy</li><li>One attempt per episode; revoke or disable anytime</li></ul><p class="caption">Offline synthetic UI capture; distinct deployed recurrence verified one simulated 72 kW charging read-back. Scripted reviewer actions, not a human trial.</p></div><img src="${img('mobility-recurrence.png')}" alt="Synthetic learned-case response"></div></section>`,
`<section><h2>Cloud operations, on its own boundary</h2><div class="arch"><div class="box phone">Android + web<br><small>Firebase identity · current membership · actor-private mobility</small></div><div class="arrow">▼</div><div class="box gateway">Cloud Run gateway + Firestore<br><small>bounded requests · reviewed-state grants · durable claims</small></div><div class="arrow">▼ A2A / ADK / Gemini</div><div class="row"><div class="box">Ops<br><small>typed reads + approved rollback</small></div><div class="box">Diagnosis<br><small>evidence + unknowns</small></div><div class="box">Guardian<br><small>independent authority checks</small></div></div></div><p class="caption">Chief coordinates the private crew. Real Cloud Run changes still require an actual human reviewer; the simulated vehicle policy grants no cloud authority.</p></section>`,
`<section><h2>The failure remains in the evidence</h2><ul class="big"><li>The first deployed learned-case recurrence became unknown. No remedy or resend occurred.</li><li>A separate diagnostic reproduced Gemini HTTP 429 capacity refusal.</li><li>Bounded thinking and clearer busy-state reporting were added. New direct qualification calls and a distinct deployed incident passed.</li></ul><p class="caption">A later success does not erase the earlier failure, prove reliability, or establish an accuracy/MTTR advantage. Expiry, ambiguity and lost replies stay unknown.</p></section>`,
`<section><h2>What we verified</h2><table><tr><th>Evidence</th><th>Scope</th></tr><tr><td>206 gateway / 97 crew tests; browser + axe + hosted gates</td><td>Local, offline and synthetic</td></tr><tr><td>68 Android core; app 3 / emulator 7; APK + lint</td><td>Core HTTP + emulator; no physical phone</td></tr><tr><td>Firebase / Firestore / Gemini / Maps workflow</td><td>Actual deployment, simulated vehicle, scripted UI choices</td></tr><tr><td>V2 broker rejects invalid capability and Origin</td><td>Deployed negative checks; real approval/conflict unverified</td></tr><tr><td>Original held-out evaluation: 13/18 first run</td><td>Different fixture protocol; later tuned 18/18 is not held out</td></tr></table><p class="caption">Remote Git CI, physical-device delivery, human productivity comparison and real V2 conflict are separate pending evidence.</p></section>`,
`<section class="title"><p class="eyebrow">${brand}</p><h2>Known situations, bounded action.<br>Unfamiliar situations, human assistance.</h2><p class="lead">A clear vehicle experience and an accountable response crew—without giving a model a credential or an unrestricted command.</p><p class="caption">Current web/API and private crew are deployed. Publication, final video, judge access and submission remain owner actions. This deck makes no physical-autonomy or measured productivity claim.</p></section>`,
];
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${brand}</title><style>${tokens}
@page { size: 1280px 720px; margin: 0 } *{box-sizing:border-box} body{margin:0;font-family:var(--md-ref-typeface-plain);color:var(--md-sys-color-on-surface);background:var(--md-sys-color-surface)}
section{width:1280px;height:720px;padding:56px 72px;page-break-after:always;overflow:hidden;position:relative}
h1{font-family:var(--md-ref-typeface-brand);font-size:84px;margin:12px 0;font-weight:500;background:linear-gradient(100deg,var(--md-sys-color-primary),var(--md-sys-color-tertiary));-webkit-background-clip:text;color:transparent}
h2{font-family:var(--md-ref-typeface-brand);font-size:44px;margin:0 0 28px;font-weight:500}.title{display:flex;flex-direction:column;justify-content:center}.eyebrow{font-size:20px;color:var(--md-sys-color-on-surface-variant);margin:0}
.lead{font-size:30px;line-height:1.4;max-width:900px}.big{font-size:30px;line-height:1.5}.big li{margin-bottom:18px}ul{padding-left:28px;font-size:24px;line-height:1.55}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}.cols img{width:100%;max-height:470px;object-fit:contain;border-radius:16px;border:1px solid var(--md-sys-color-outline-variant)}
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
