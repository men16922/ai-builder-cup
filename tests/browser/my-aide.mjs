import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile,mkdtemp,mkdir,copyFile,rm} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {SqliteCloudStore} from '../../apps/gateway/src/store/sqlite-store.ts';
import {GcpWebAccess} from '../../apps/gateway/src/auth/web-access.ts';
import {GcpMobility} from '../../apps/gateway/src/mobility/service.ts';
import {handleGcpApi} from '../../apps/gateway/src/http/api.ts';

if(process.env.MOBILEOPS_OFFLINE_TEST!=='1')throw Error('My Aide UI gate must remain offline.');
const root=await mkdtemp(join(tmpdir(),'aide-my-aide-ui-')),directory=process.env.MOBILEOPS_SCREENSHOT_DIR??'test-results/screenshots';
const store=new SqliteCloudStore(':memory:');let server,browser,modelCalls=0;const operations=[];
const axe=async page=>assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(value=>({id:value.id,nodes:value.nodes.map(node=>node.html.slice(0,200))})),[]);
try {
  await build({entryPoints:['tests/support/mobility-harness.tsx'],outfile:join(root,'app.js'),bundle:true,platform:'browser',format:'esm',loader:{'.woff2':'file','.woff':'file','.svg':'file','.png':'file'},logLevel:'silent'});
  await mkdir(join(root,'vehicles'));await copyFile('apps/web/public/vehicles/aide-ev.png',join(root,'vehicles/aide-ev.png'));
  const scope={edition:'organization',organizationId:'synthetic-org',workspaceId:'synthetic-workspace',label:'Synthetic fixture'};
  const access=new GcpWebAccess({async verify(token){if(token!=='synthetic-driver')throw Error();return {actorId:'synthetic-driver',expiresAt:Date.now()+600000};}},store);
  await access.organization.provision({organizationId:scope.organizationId,workspaceId:scope.workspaceId,actorId:'synthetic-driver',version:1,active:true,roles:['operator','reviewer'],updatedAt:new Date().toISOString()});
  // Fixture model: deterministic caller and aide lines; the gateway still enforces every bound.
  const reasoner={engine:'offline-fixture',
    async diagnose(){modelCalls++;return {summary:'A low tire pressure signal was observed on the rear-left wheel of the simulated vehicle.',evidenceIds:['fault','signal'],unknowns:['No physical vehicle is connected.'],runbook:'none'};},
    async call(input){modelCalls++;return input.step==='open'?{...(input.handledBy==='aide'?{aide:'Hello Jordan, the driver is on the road, so My Aide is answering.'}:{}),caller:'Could we move the design review to 4:30 pm?',callerEnds:false}
      :input.step==='delegate'?{aide:'4:30 pm works. The driver will email the deck on arrival.',caller:'Perfect, thank you. Bye!',callerEnds:true}:{caller:'Great, noted.',callerEnds:false};},
    async summarizeCall(){modelCalls++;return {text:'Jordan moved the design review to 4:30 pm. The deck will be emailed on arrival.',actionItems:['Email the deck before 4:30 pm'],
      followups:[{kind:'message',title:'Confirm the new time',body:'4:30 pm works for me. Deck coming soon.',to:'Jordan Kim'},{kind:'calendar',title:'Design review',minutesFromNow:120}]};}};
  const places={async nearby(location,kind){return [1,2,3].map(index=>({id:`synthetic-place-${index}`,name:`Synthetic ${kind} ${index}`,address:`Fixture street ${index}`,rating:4+index/10,
    location:{latitude:location.latitude+.002*index,longitude:location.longitude+.001*index},kind,source:'google-places',fetchedAt:new Date().toISOString(),
    ...(index<3?{photo:{uri:`https://lh3.googleusercontent.com/synthetic-photo-${index}`,attributions:[{name:`Synthetic Author ${index}`,uri:'https://maps.google.com/maps/contrib/0'}]}}:{})}));}};
  const mobility=new GcpMobility(store,access,()=>true,reasoner,places,Date.now,'synthetic-browser-key-000000');
  const command=mobility.command.bind(mobility);mobility.command=async(session,input,key)=>{operations.push(input.operation);return command(session,input,key);};
  const services={access,mobility,publicOrigin:'http://127.0.0.1'};
  server=createServer(async(request,response)=>{
    const path=new URL(request.url,'http://127.0.0.1').pathname;
    if(path.startsWith('/api/')){await handleGcpApi(request,response,services);return;}
    if(path==='/'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><title>My Aide verification</title></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');return;}
    if(!/^\/(?:app\.(?:js|css)|[A-Za-z0-9_.-]+\.(?:woff2?|svg|png)|vehicles\/aide-ev\.png)$/.test(path)){response.writeHead(404);response.end();return;}
    try{response.setHeader('Content-Type',{'.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2','.woff':'font/woff','.svg':'image/svg+xml'}[extname(path)]);response.end(await readFile(join(root,path.slice(1))));}catch{response.writeHead(404);response.end();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;services.publicOrigin=origin;
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:1000},locale:'en-US'});
  const stub=await readFile('tests/support/google-maps-stub.js','utf8'),photo=await readFile('apps/web/public/vehicles/aide-ev.png');
  // Only the local fixture, the offline Maps stand-in and synthetic photo bytes are reachable.
  await context.route('**/*',route=>{const url=new URL(route.request().url());
    if(url.hostname==='maps.googleapis.com')return route.fulfill({contentType:'text/javascript',body:stub});
    if(url.hostname==='lh3.googleusercontent.com')return route.fulfill({contentType:'image/png',body:photo});
    return url.origin===origin?route.continue():route.abort();});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await mkdir(directory,{recursive:true});
  await page.goto(origin);await page.getByRole('button',{name:'Connect simulated vehicle',exact:true}).click();

  // Remote controls: state on the tile, a simulated acknowledgement, no model call.
  await page.getByRole('button',{name:/^Locked/}).click();await expect(page.getByRole('button',{name:/^Unlocked/})).toHaveAttribute('aria-pressed','false');
  await expect(page.getByText(/Doors unlocked · simulated/)).toBeVisible();
  await page.getByRole('button',{name:/^Climate/}).click();await expect(page.getByText(/Preconditioning the cabin/)).toBeVisible();
  await page.getByRole('button',{name:'Raise temperature',exact:true}).click();await expect(page.getByText('21.5°',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/^Charge Limit/}).click();await expect(page.getByRole('button',{name:/^Charging 11 kW/})).toBeVisible();
  await page.getByRole('button',{name:/^Charging 11 kW/}).click();await expect(page.getByRole('button',{name:/^Charge Limit/})).toBeVisible();
  assert.equal(modelCalls,0);await axe(page);
  await page.screenshot({path:join(directory,'my-aide-home.png'),fullPage:true});

  // Places: photo-first cards with Google author attribution and numbered markers that match the cards.
  await page.getByRole('button',{name:'Charging & map',exact:true}).click();
  await page.getByRole('button',{name:'Charging',exact:true}).click();await page.getByRole('button',{name:'Let Aide handle it',exact:true}).click();
  await expect(page.getByRole('img',{name:'Photo of Synthetic charging 1'})).toBeVisible();await expect(page.getByRole('link',{name:'Synthetic Author 1'})).toBeVisible();
  await expect(page.locator('.aide-place-photo-empty')).toHaveCount(1);
  await expect.poll(()=>page.evaluate(()=>window.__labels?.slice(-3))).toEqual(['1','2','3']);
  await axe(page);await page.screenshot({path:join(directory,'my-aide-places.png'),fullPage:true});
  await page.getByRole('button',{name:'Go here',exact:true}).first().click();await expect(page.getByText('Driving',{exact:true})).toBeVisible();

  // A call arrives while driving: My Aide answers, the car keeps moving, the phone badge rides on the map.
  await page.getByRole('button',{name:'Try an incoming call',exact:true}).click();await page.getByRole('button',{name:'Team lead · meeting',exact:true}).click();
  const ringing=page.getByRole('dialog',{name:'Call from Jordan Kim'});await expect(ringing).toBeVisible();
  await page.screenshot({path:join(directory,'my-aide-call-ringing.png')});
  await ringing.getByRole('button',{name:'Let My Aide answer',exact:true}).click();
  const sheet=page.getByRole('dialog',{name:'On a call'});await expect(sheet.getByText('Could we move the design review to 4:30 pm?')).toBeVisible();
  await expect(sheet.getByText('Autopilot simulation',{exact:true})).toBeVisible();await expect.poll(()=>page.evaluate(()=>window.__phoneShown)).toBe(true);
  const advanced=operations.filter(op=>op==='advance').length;await expect.poll(()=>operations.filter(op=>op==='advance').length).toBeGreaterThan(advanced);
  await sheet.getByRole('textbox',{name:'Reply yourself'}).fill('Yes, 4:30 pm is fine.');await sheet.getByRole('button',{name:'Send',exact:true}).click();
  await expect(sheet.getByText('Great, noted.')).toBeVisible();
  await sheet.getByRole('button',{name:'Let My Aide reply',exact:true}).click();await expect(sheet.getByText('Perfect, thank you. Bye!')).toBeVisible();
  await axe(page);await page.screenshot({path:join(directory,'my-aide-call-active.png')});
  await sheet.getByRole('button',{name:'End call',exact:true}).click();
  const summary=page.getByRole('dialog',{name:'Call summary'});await expect(summary.getByText(/moved the design review to 4:30 pm/)).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.__phoneShown)).toBe(false);
  await summary.getByRole('button',{name:'Send message',exact:true}).click();await expect(summary.getByText('Done · simulated',{exact:true})).toBeVisible();
  await summary.getByRole('button',{name:'Save summary',exact:true}).click();await expect(summary.getByText('Saved to call history',{exact:true})).toBeVisible();
  await axe(page);await page.screenshot({path:join(directory,'my-aide-call-summary.png')});
  await summary.getByRole('button',{name:'Close',exact:true}).last().click();await expect(summary).toHaveCount(0);
  await page.getByRole('button',{name:'Calls',exact:true}).click();await expect(page.locator('.aide-call-records').getByText(/Handled by My Aide/)).toBeVisible();
  await expect(page.locator('.aide-call-records').getByText('Done · simulated',{exact:true})).toBeVisible();

  // Diagnosis: wait for arrival, then a low tire glows on the diagram and offers a service search, with no remedy.
  await page.getByRole('button',{name:'Charging & map',exact:true}).click();await expect(page.getByText('Arrived',{exact:true}).first()).toBeVisible({timeout:20000});
  await page.getByRole('button',{name:'Vehicle diagnosis',exact:true}).click();await expect(page.getByText('All systems normal',{exact:true})).toBeVisible();
  await page.getByText('Vehicle simulator',{exact:true}).click();await page.getByRole('button',{name:'Low tire pressure',exact:true}).click();
  await expect(page.getByText('Rear-left tire pressure low',{exact:true})).toBeVisible();await expect(page.locator('.aide-tire.is-fault')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Find a nearby service shop',exact:true})).toBeVisible();
  await axe(page);await page.screenshot({path:join(directory,'my-aide-diagnosis.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:join(directory,'my-aide-diagnosis-390.png'),fullPage:true});await page.setViewportSize({width:1280,height:1000});

  // Error popup: the manual page for the server's code, and nothing is retried.
  let refused=false;await page.route('**/gcp/mobility',route=>{if(route.request().method()==='POST'&&!refused){refused=true;return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'vehicle_changed'})});}return route.continue();});
  const before=operations.length;await page.getByRole('button',{name:'Diagnose now',exact:true}).click();
  const popup=page.getByRole('dialog',{name:'Your car changed meanwhile'});await expect(popup).toBeVisible();
  await page.getByRole('button',{name:'View manual',exact:true}).click();await expect(page.getByText('vehicle_changed',{exact:true})).toBeVisible();
  await page.screenshot({path:join(directory,'my-aide-error-manual.png')});assert.equal(operations.length,before,'A refused request must not be resent');
  await page.getByRole('button',{name:'Check latest state',exact:true}).click();await expect(popup).toBeHidden();
  expect(errors).toEqual([]);
  console.log(`My Aide browser gate passed: remote controls, photo place cards with attribution and numbered markers, simulated call answered by My Aide with autopilot and phone badge, drafted follow-ups needing a tap, saved history, tire diagnosis diagram, error manual without resend, axe and 390px. Model fixture calls: ${modelCalls}. No Google or physical vehicle calls.`);
} catch(error){if(browser){const page=browser.contexts()[0]?.pages()[0];await page?.screenshot({path:join(directory,'my-aide-failure.png'),fullPage:true}).catch(()=>{});}throw error;}
finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store.close();await rm(root,{recursive:true,force:true});}
