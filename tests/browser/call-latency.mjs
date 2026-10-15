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
const root=await mkdtemp(join(tmpdir(),'aide-call-latency-ui-')),directory=process.env.MOBILEOPS_SCREENSHOT_DIR??'test-results/screenshots';
const store=new SqliteCloudStore(':memory:');let server,browser,modelCalls=0,replyWaiting=false,releaseReply;const operations=[];
const replyBarrier=new Promise(resolve=>{releaseReply=resolve;});
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
    async call(input){modelCalls++;if(input.step==='reply'){replyWaiting=true;await replyBarrier;}return input.step==='open'?{...(input.handledBy==='aide'?{aide:'Hello Jordan, the driver is on the road, so My Aide is answering.'}:{}),caller:'Could we move the design review to 4:30 pm?',callerEnds:false}
      :input.step==='delegate'?{aide:'4:30 pm works. The driver will email the deck on arrival.',caller:'Perfect, thank you. Bye!',callerEnds:true}:{caller:'Great, noted.',callerEnds:false};},
    async assist(input){modelCalls++;return {reply:input.language==='ko'?'출발 전에 20도로 맞춰 둘까요?':'Shall I cool the cabin to 20° before you leave?',proposals:[{kind:'control',action:'set_temperature',value:20},{kind:'control',action:'climate_on'},{kind:'trip',tripKind:'charging',instruction:'fast charger nearby'}]};},
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
  await page.getByRole('button',{name:'Charging & map',exact:true}).click();
  await page.getByRole('button',{name:'Let Aide handle it',exact:true}).click();
  await page.getByRole('button',{name:'Go here',exact:true}).first().click();
  await page.getByRole('button',{name:'Try an incoming call',exact:true}).click();
  await page.getByRole('button',{name:'Team lead · meeting',exact:true}).click();
  await page.getByRole('button',{name:'Let My Aide answer',exact:true}).click();
  const sheet=page.getByRole('dialog',{name:'On a call'});
  await expect(sheet.getByText('Could we move the design review to 4:30 pm?')).toBeVisible();
  await sheet.getByRole('textbox',{name:'Reply yourself'}).fill('Yes, a synthetic reply.');
  await sheet.getByRole('button',{name:'Send',exact:true}).click();
  await expect.poll(()=>replyWaiting).toBe(true);
  const advanced=operations.filter(op=>op==='advance').length;
  await expect.poll(()=>operations.filter(op=>op==='advance').length).toBeGreaterThan(advanced);
  await page.setViewportSize({width:390,height:844});
  const stop=sheet.getByRole('button',{name:'Stop simulated drive',exact:true});await expect(stop).toBeEnabled();
  const contrast=await stop.evaluate(button=>{
    const luminance=color=>{const values=color.match(/\d+(?:\.\d+)?/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return values.reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);};
    const values=[luminance(getComputedStyle(button).color),luminance(getComputedStyle(document.querySelector('.aide-call-sheet')).backgroundColor)].sort((a,b)=>a-b);
    return (values[1]+.05)/(values[0]+.05);
  });
  assert.ok(contrast>=4.5,`The enabled Stop label needs readable contrast; observed ${contrast.toFixed(2)}:1`);
  console.log('Enabled Stop contrast:',contrast.toFixed(2)+':1');
  await axe(page);await page.screenshot({path:join(directory,'call-delayed-model-stop-390.png')});
  await stop.click();await expect(page.getByText('Cancelled',{exact:true})).toBeVisible();
  releaseReply();
  await expect(sheet.getByText('Great, noted.',{exact:true})).toBeVisible();
  await expect(page.getByText('Cancelled',{exact:true})).toBeVisible();
  await expect(stop).toHaveCount(0);
  assert.equal(operations.filter(op=>op==='call_say').length,1);assert.equal(operations.filter(op=>op==='stop').length,1);
  assert.equal(modelCalls,2);expect(errors).toEqual([]);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  console.log('Delayed-call browser gate passed: a held model reply permits simulated advance and Stop, survives reordered state, never revives the canceled drive, 390px/axe. Synthetic model/maps only.');
} catch(error){if(browser){const page=browser.contexts()[0]?.pages()[0];await page?.screenshot({path:join(directory,'call-latency-failure.png'),fullPage:true}).catch(()=>{});}throw error;}
finally{releaseReply?.();await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store.close();await rm(root,{recursive:true,force:true});}
