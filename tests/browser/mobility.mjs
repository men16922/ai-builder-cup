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

if(process.env.MOBILEOPS_OFFLINE_TEST!=='1')throw Error('Mobility UI gate must remain offline.');
const root=await mkdtemp(join(tmpdir(),'aide-mobility-ui-')),directory=process.env.MOBILEOPS_SCREENSHOT_DIR??'test-results/screenshots';
const store=new SqliteCloudStore(':memory:');let server,browser,modelCalls=0;const operations=[];
try {
  await build({entryPoints:['tests/support/mobility-harness.tsx'],outfile:join(root,'app.js'),bundle:true,platform:'browser',format:'esm',loader:{'.woff2':'file','.woff':'file','.svg':'file','.png':'file'},logLevel:'silent'});
  await mkdir(join(root,'vehicles'));await copyFile('apps/web/public/vehicles/aide-ev.png',join(root,'vehicles/aide-ev.png'));
  const scope={edition:'organization',organizationId:'synthetic-org',workspaceId:'synthetic-workspace',label:'Synthetic fixture'};
  const access=new GcpWebAccess({async verify(token){if(token!=='synthetic-driver')throw Error();return {actorId:'synthetic-driver',expiresAt:Date.now()+600000};}},store);
  await access.organization.provision({organizationId:scope.organizationId,workspaceId:scope.workspaceId,actorId:'synthetic-driver',version:1,active:true,roles:['operator','reviewer'],updatedAt:new Date().toISOString()});
  const mobility=new GcpMobility(store,access,()=>true,{engine:'offline-fixture',async diagnose(vehicle,language,_signal,cases=[]){
    modelCalls++;return {summary:language==='ko'?'가상 충전 연결에서 낯선 증상을 확인했습니다.':'An unfamiliar charging symptom was observed in the simulated vehicle.',evidenceIds:['signal','temperature','charging'],unknowns:[language==='ko'?'실제 차량은 연결되지 않았습니다.':'No physical vehicle is connected.'],runbook:vehicle.fault==='charge_handshake'||cases.length===1?'charge-reconnect-v1':'none'};
  }},{async nearby(location,kind){return [{id:'synthetic-destination',name:'Synthetic nearby destination',address:'',location:{latitude:location.latitude+.002,longitude:location.longitude+.002},kind,source:'google-places',fetchedAt:new Date().toISOString()}];}});
  const command=mobility.command.bind(mobility);mobility.command=async(session,input,key)=>{operations.push(input.operation);return command(session,input,key);};
  const services={access,mobility,publicOrigin:'http://127.0.0.1'};
  server=createServer(async(request,response)=>{
    const path=new URL(request.url,'http://127.0.0.1').pathname;
    if(path.startsWith('/api/')){await handleGcpApi(request,response,services);return;}
    if(path==='/'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><title>Aide mobility verification</title></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');return;}
    if(!/^\/(?:app\.(?:js|css)|[A-Za-z0-9_.-]+\.(?:woff2?|svg|png)|vehicles\/aide-ev\.png)$/.test(path)){response.writeHead(404);response.end();return;}
    try{response.setHeader('Content-Type',{'.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2','.woff':'font/woff','.svg':'image/svg+xml'}[extname(path)]);response.end(await readFile(join(root,path.slice(1))));}catch{response.writeHead(404);response.end();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;services.publicOrigin=origin;
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:1000},locale:'en-US'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await mkdir(directory,{recursive:true});
  await page.goto(origin);await page.getByRole('button',{name:'Connect simulated vehicle',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Aide EV',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Diagnose now',exact:true})).toHaveCount(0);
  // A typical laptop must show battery, range and charging without scrolling.
  // Wait for the real product image/font layout before measuring the first fold.
  await page.setViewportSize({width:1440,height:723});
  await page.getByAltText('Aide electric vehicle',{exact:true}).evaluate(image=>image.decode());
  await page.evaluate(()=>document.fonts.ready);
  console.log('Short desktop vehicle metrics:',await page.locator('.aide-vehicle-stats').evaluate(element=>({top:Math.round(element.getBoundingClientRect().top),bottom:Math.round(element.getBoundingClientRect().bottom),viewport:innerHeight})));
  await expect(page.locator('.aide-vehicle-stats')).toBeInViewport({ratio:1});
  await page.screenshot({path:join(directory,'mobility-home-short-desktop.png'),fullPage:false});
  await page.setViewportSize({width:1280,height:1000});
  await page.screenshot({path:join(directory,'mobility-home-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'Aide assistance',exact:true}).click();
  await page.getByText('Vehicle simulator',{exact:true}).click();
  await page.getByRole('button',{name:'Unfamiliar charging symptom',exact:true}).click();
  await expect(page.getByRole('button',{name:'Review recovery guide',exact:true})).toBeVisible();assert.equal(modelCalls,1);
  await page.getByRole('button',{name:'Refresh',exact:true}).click();assert.equal(modelCalls,1);assert.equal(operations.filter(op=>op==='diagnose').length,0);
  await page.getByRole('button',{name:'Review recovery guide',exact:true}).click();
  await page.screenshot({path:join(directory,'mobility-guided-recovery.png'),fullPage:true});
  await page.getByRole('button',{name:'Recover with this guide',exact:true}).click();
  await expect(page.getByText('Candidate awaiting approval',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Register for recurrence',exact:true}).click();
  await page.getByRole('button',{name:'Approve this bounded case',exact:true}).click();
  await expect(page.getByText('Available for recurrence',{exact:true})).toBeVisible();assert.equal(modelCalls,1);
  await expect(page.getByText('Decide before a change',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Configure automatic response',exact:true}).click();
  await page.getByRole('button',{name:'Allow this boundary',exact:true}).click();
  await expect(page.getByText('Automatic response enabled',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Unfamiliar charging symptom',exact:true}).click();
  await expect(page.getByText('Remedy confirmed',{exact:true})).toBeVisible();await expect(page.getByText('24-hour standing policy',{exact:false})).toBeVisible();assert.equal(modelCalls,2);
  await page.screenshot({path:join(directory,'mobility-case-recurrence-desktop.png'),fullPage:true});
  const violations=async()=>{const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.html)}))).toEqual([]);};
  await violations();
  await page.setViewportSize({width:390,height:844});await page.reload();
  await page.getByRole('button',{name:'Aide assistance',exact:true}).click();
  await expect(page.getByText('Available for recurrence',{exact:true})).toBeVisible();assert.equal(modelCalls,2);await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await violations();
  await page.getByLabel('Language / 언어').selectOption('ko');await expect(page.getByRole('heading',{name:'함께 해결한 경험'})).toBeVisible();
  await page.screenshot({path:join(directory,'mobility-case-recurrence-ko-390.png'),fullPage:true});
  await page.getByRole('button',{name:'이 사례 사용 중지',exact:true}).click();await expect(page.getByText('사용 중지',{exact:true})).toBeVisible();
  await page.getByText('차량 시뮬레이터',{exact:true}).click();await page.getByRole('button',{name:'낯선 충전 증상',exact:true}).click();
  await expect(page.getByRole('button',{name:'복구 가이드 검토',exact:true})).toBeVisible();assert.equal(modelCalls,3);assert.equal(operations.filter(op=>op==='resolve_unknown').length,1);
  // The API has an accepted moving journey from a different client. Reading/opening
  // it must not issue a fresh step, especially after an uncertain prior reply.
  const session=await access.authenticate('Bearer synthetic-driver',scope);
  let moving=await mobility.read(session);
  moving=await mobility.command(session,{operation:'trip_request',expectedVersion:moving.vehicle.version,kind:'poi',instruction:'Synthetic nearby destination',language:'en'},'55555555-5555-4555-8555-555555555555');
  moving=await mobility.command(session,{operation:'select_destination',expectedVersion:moving.vehicle.version,journeyId:moving.journey.id,placeId:'synthetic-destination',remember:false},'66666666-6666-4666-8666-666666666666');
  const beforeAdvance=operations.filter(op=>op==='advance').length;
  await page.reload();await page.getByRole('button',{name:'충전·지도',exact:true}).click();
  await page.waitForTimeout(1800);
  assert.equal(operations.filter(op=>op==='advance').length,beforeAdvance,'Reading a moving journey must not start another step');
  await page.getByRole('button',{name:'시뮬레이션 계속',exact:true}).click();
  await expect.poll(()=>operations.filter(op=>op==='advance').length).toBeGreaterThan(beforeAdvance);
  await page.getByRole('button',{name:'이동 취소',exact:true}).click();
  await expect(page.getByText('이동 취소',{exact:true})).toBeVisible();
  expect(errors).toEqual([]);console.log('Mobility browser gate passed: real authenticated synthetic API/store, unknown guided recovery/read-back, separate case promotion, policy-bound fresh recurrence, refresh/reload inert, revocation, KO/EN, desktop/390px and axe. No Google or physical vehicle calls.');
} catch(error){if(browser){const page=browser.contexts()[0]?.pages()[0];await page?.screenshot({path:join(directory,'mobility-case-failure.png'),fullPage:true}).catch(()=>{});}throw error;}
finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store.close();await rm(root,{recursive:true,force:true});}
