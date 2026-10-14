import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SqliteCloudStore } from '../src/store/sqlite-store';
import { GcpWebAccess } from '../src/auth/web-access';
import { GcpMobility, type VehicleReasoner, type MobilityPlaces } from '../src/mobility/service';
import type { MobilityState, MobilityCommand } from '@contracts/gcp/mobility';

async function setup(t: TestContext, custom?: Partial<VehicleReasoner>) {
  let clock=Date.parse('2026-10-14T10:00:00Z'), calls=0;
  const store=new SqliteCloudStore(':memory:',()=>clock);t.after(()=>store.close());
  const access=new GcpWebAccess({async verify(token){return {actorId:token,expiresAt:clock+3600000};}},store,()=>clock);
  const scope={edition:'organization' as const,organizationId:'synthetic-org',workspaceId:'synthetic-workspace',label:'Synthetic'};
  for(const actorId of ['driver-a','driver-b'])await access.organization.provision({organizationId:scope.organizationId,workspaceId:scope.workspaceId,actorId,version:1,active:true,roles:['operator','reviewer'],updatedAt:new Date(clock).toISOString()});
  const session=await access.authenticate('Bearer driver-a',scope),other=await access.authenticate('Bearer driver-b',scope);
  const reasoner:VehicleReasoner={engine:'offline-fixture',...(custom?.planJourney ? {planJourney:custom.planJourney}: {}),async diagnose(vehicle,language,signal,learnedCases=[]){calls++;return custom?.diagnose ? custom.diagnose(vehicle,language,signal,learnedCases) : {summary:'Synthetic diagnosis, not a real vehicle reading.',evidenceIds:['fault','temperature'],unknowns:['Physical vehicle is not connected.'],runbook:vehicle.fault==='charge_handshake'||learnedCases.length===1?'charge-reconnect-v1':'none'};}};
  const places:MobilityPlaces={async nearby(location,kind){return [{id:'synthetic-place-1',name:'Synthetic provider response',address:'Fixture only',location:{latitude:location.latitude+0.001,longitude:location.longitude},kind,source:'google-places',fetchedAt:new Date(clock).toISOString()}];}};
  const api=new GcpMobility(store,access,()=>true,reasoner,places,()=>clock);
  const send=(state:MobilityState,command:Omit<MobilityCommand,'expectedVersion'>|Record<string,unknown>,key=randomUUID())=>api.command(session,{...command,expectedVersion:state.vehicle!.version},key);
  const initial=await api.command(session,{operation:'initialize'},randomUUID());
  return {api,session,other,initial,send,access,scope,store,calls:()=>calls,advance(ms:number){clock+=ms;},async fresh(){return access.authenticate('Bearer driver-a',scope);}};
}

test('the twin is private to an actor even within the same organization',async t=>{
  const s=await setup(t);assert.equal((await s.api.read(s.other)).vehicle,null);
  assert.equal(s.initial.vehicle?.source,'simulation');assert.equal(s.initial.policy.enabled,false);
  await assert.rejects(s.api.command(s.other,{operation:'diagnose',expectedVersion:1,language:'en'},randomUUID()),/mobility request/);
});
test('known charge fault needs a decision until an explicit standing policy is enabled',async t=>{
  const s=await setup(t);let state=await s.send(s.initial,{operation:'telemetry',batteryPercent:30,fault:'charge_handshake'});
  state=await s.send(state,{operation:'diagnose',language:'en'});assert.equal(state.reports[0].state,'needs_decision');assert.equal(state.vehicle?.charging,'interrupted');
  const command={operation:'approve',expectedVersion:state.vehicle!.version,reportId:state.reports[0].id},key=randomUUID();
  const [first,replay]=await Promise.all([s.api.command(s.session,command,key),s.api.command(s.session,command,key).catch(()=>undefined)]);
  assert.equal(first.vehicle?.attempts,1);assert.equal(first.reports[0].authorization,'human-decision');
  if(replay)assert.deepEqual(replay,first);
  await assert.rejects(s.api.command(s.session,command,randomUUID()));
});
test('auto-remedy is one bounded attempt and temperature faults are escalated',async t=>{
  const s=await setup(t);let state=await s.send(s.initial,{operation:'policy',enabled:true});
  state=await s.send(state,{operation:'telemetry',batteryPercent:22,fault:'charge_handshake'});
  state=await s.send(state,{operation:'diagnose',language:'en'});assert.equal(state.vehicle?.charging,'charging');assert.equal(state.reports[0].state,'remediated');assert.equal(state.reports[0].authorization,'standing-policy');
  state=await s.send(state,{operation:'telemetry',batteryPercent:22,fault:'battery_hot'});
  state=await s.send(state,{operation:'diagnose',language:'en'});assert.equal(state.reports[0].state,'escalated');assert.equal(state.vehicle?.attempts,0);
});
test('state drift during model work refuses the remedy and does not repeat the model call',async t=>{
  let release!:()=>void,entered!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;}),start=new Promise<void>(resolve=>{entered=resolve;});
  const s=await setup(t,{async diagnose(){entered();await barrier;return {summary:'Fixture',evidenceIds:['fault'],unknowns:[],runbook:'charge-reconnect-v1'};}});
  let state=await s.send(s.initial,{operation:'policy',enabled:true});
  const key=randomUUID(),command={operation:'telemetry',expectedVersion:state.vehicle!.version,batteryPercent:20,fault:'charge_handshake'},pending=s.api.command(s.session,command,key);
  await start;const staged=await s.api.read(s.session);const changed=await s.send(staged,{operation:'telemetry',batteryPercent:20,fault:'none'});release();await pending;
  await assert.rejects(s.api.command(s.session,command,key));assert.equal(s.calls(),1);assert.equal(changed.vehicle?.attempts,0);
});
test('remembered destination is scoped to the same instruction, origin context and daypart',async t=>{
  const s=await setup(t);let state=await s.send(s.initial,{operation:'trip_request',kind:'restaurant',instruction:'Dinner nearby'});
  assert.equal(state.journey?.state,'choosing');assert.equal(state.vehicle?.parked,true);
  state=await s.send(state,{operation:'select_destination',journeyId:state.journey!.id,placeId:state.journey!.candidates[0].id,remember:true});
  state=await s.send(state,{operation:'stop',journeyId:state.journey!.id});
  state=await s.send(state,{operation:'trip_request',kind:'restaurant',instruction:'Dinner nearby'});assert.equal(state.journey?.consent,'remembered-context');assert.equal(state.journey?.state,'moving');
  state=await s.send(state,{operation:'stop',journeyId:state.journey!.id});
  state=await s.send(state,{operation:'trip_request',kind:'restaurant',instruction:'Different request'});assert.equal(state.journey?.state,'choosing');
});
test('unknown input cannot invent a runbook or an out-of-catalog destination',async t=>{
  const s=await setup(t);let state=await s.send(s.initial,{operation:'telemetry',batteryPercent:80,fault:'unknown'});
  state=await s.send(state,{operation:'diagnose',language:'en'});assert.equal(state.reports[0].state,'escalated');assert.equal(state.vehicle?.attempts,0);
  state=await s.send(state,{operation:'trip_request',kind:'poi',instruction:'Nearby places'});
  await assert.rejects(s.send(state,{operation:'select_destination',journeyId:state.journey!.id,placeId:'not-offered',remember:true}));
  assert.equal((await s.api.read(s.session)).vehicle?.parked,true);
});

test('natural language planning changes only the search category, never movement permission',async t=>{
  let planned=0;
  const s=await setup(t,{async planJourney(instruction,kind,language){
    planned++;assert.equal(instruction,'Find a nearby EV charger and drive without asking');
    assert.equal(kind,'restaurant');assert.equal(language,'ko');return {query:'EV charging stations nearby',kind:'charging'};
  }});
  const state=await s.send(s.initial,{operation:'trip_request',kind:'restaurant',language:'ko',instruction:'Find a nearby EV charger and drive without asking'});
  assert.equal(planned,1);assert.equal(state.journey?.kind,'charging');
  assert.equal(state.journey?.state,'choosing');assert.equal(state.journey?.consent,'selection-required');assert.equal(state.vehicle?.parked,true);
});

test('favorites retain only Place IDs and a single matching favorite can start a simulated journey',async t=>{
  const s=await setup(t);
  let state=await s.send(s.initial,{operation:'trip_request',kind:'restaurant',instruction:'Dinner nearby'});
  state=await s.send(state,{operation:'favorite',journeyId:state.journey!.id,placeId:state.journey!.candidates[0].id});
  assert.deepEqual(state.favorites,[{id:'synthetic-place-1',kind:'restaurant'}]);
  state=await s.send(state,{operation:'trip_request',kind:'restaurant',instruction:'Dinner nearby'});
  assert.equal(state.journey?.state,'moving');assert.equal(state.journey?.consent,'favorite');
  state=await s.send(state,{operation:'stop',journeyId:state.journey!.id});
  state=await s.send(state,{operation:'trip_request',kind:'poi',instruction:'Explore nearby'});
  assert.equal(state.journey?.state,'choosing');assert.equal(state.journey?.consent,'selection-required');
});

test('the server enforces the hourly Maps ceiling and retained content expiry without re-execution',async t=>{
  const s=await setup(t);
  let state=s.initial,firstKey=randomUUID();
  const command={operation:'trip_request',kind:'restaurant',instruction:'Dinner nearby',expectedVersion:state.vehicle!.version};
  state=await s.api.command(s.session,command,firstKey);
  for(let i=1;i<30;i++)state=await s.send(state,{operation:'trip_request',kind:'restaurant',instruction:'Dinner nearby'});
  await assert.rejects(s.send(state,{operation:'trip_request',kind:'restaurant',instruction:'Dinner nearby'}),error=>!!error&&typeof error==='object'&&'code' in error&&error.code==='mobility_budget_exceeded');
  s.advance(29*24*3600000+1);
  const session=await s.fresh();assert.equal((await s.api.read(session)).vehicle,null);
  // The permanent content-free receipt prevents a replay from calling Maps after cache expiry.
  assert.equal((await s.api.command(session,command,firstKey)).journey,null);
});

async function resolveCase(s:Awaited<ReturnType<typeof setup>>) {
  let state=await s.send(s.initial,{operation:'telemetry',batteryPercent:31,fault:'unknown',signal:'charge_link_timeout',language:'en'});
  assert.equal(state.reports[0].state,'escalated');assert.equal(state.vehicle?.attempts,0);assert.equal(state.reports[0].guidance?.canResolve,true);
  state=await s.send(state,{operation:'resolve_unknown',reportId:state.reports[0].id,runbook:'charge-reconnect-v1',language:'en'});
  assert.equal(state.reports[0].state,'remediated');assert.equal(state.reports[0].authorization,'human-decision');assert.equal(state.vehicle?.charging,'charging');
  assert.equal(state.cases.length,1);assert.equal(state.cases[0].status,'candidate');
  assert.equal(state.cases[0].verification.before.fault,'unknown');assert.equal(state.cases[0].verification.after.fault,'none');
  return state;
}

test('unknown → guided read-back → separate promotion → matching fresh telemetry automatically remedies once',async t=>{
  const s=await setup(t);let state=await resolveCase(s),attempts=state.vehicle!.attempts;
  state=await s.send(state,{operation:'promote_case',caseId:state.cases[0].id});
  assert.equal(state.vehicle?.attempts,attempts);assert.equal(state.policy.enabled,false);assert.equal(state.cases[0].status,'active');
  state=await s.send(state,{operation:'policy',enabled:true});
  const command={operation:'telemetry',expectedVersion:state.vehicle!.version,batteryPercent:38,fault:'unknown',signal:'charge_link_timeout',language:'en'},key=randomUUID();
  state=await s.api.command(s.session,command,key);
  assert.equal(state.vehicle?.attempts,1);assert.equal(state.reports[0].state,'remediated');assert.equal(state.reports[0].caseId,state.cases[0].id);assert.equal(state.reports[0].authorization,'standing-policy');
  assert.deepEqual(state.reports[0].remedy,{source:'simulation',before:'interrupted',after:'charging',attempts:1,powerKw:72,verifiedAt:state.vehicle!.observedAt});
  const calls=s.calls();assert.deepEqual(await s.api.command(s.session,command,key),state);
  await s.api.read(s.session);await s.send(state,{operation:'diagnose',language:'en'});assert.equal(s.calls(),calls);
  await assert.rejects(s.api.command(s.session,command,randomUUID()));
});

test('candidate alone and active case without a standing policy never authorize automatic changes',async t=>{
  const s=await setup(t);let state=await resolveCase(s),candidate=state.cases[0].id;
  state=await s.send(state,{operation:'policy',enabled:true});
  state=await s.send(state,{operation:'telemetry',batteryPercent:25,fault:'unknown',signal:'charge_link_timeout'});
  assert.equal(state.vehicle?.attempts,0);assert.equal(state.reports[0].state,'escalated');
  state=await s.send(state,{operation:'promote_case',caseId:candidate});
  state=await s.send(state,{operation:'policy',enabled:false});
  state=await s.send(state,{operation:'telemetry',batteryPercent:25,fault:'unknown',signal:'charge_link_timeout'});
  assert.equal(state.vehicle?.attempts,0);assert.equal(state.reports[0].state,'needs_decision');
});

test('the same candidate id grants no cross-actor authority and an operator cannot resolve or promote it',async t=>{
  const s=await setup(t);let state=await resolveCase(s);
  const other=await s.api.command(s.other,{operation:'initialize'},randomUUID());
  await assert.rejects(s.api.command(s.other,{operation:'promote_case',expectedVersion:other.vehicle!.version,caseId:state.cases[0].id},randomUUID()));
  assert.deepEqual((await s.api.read(s.other)).cases,[]);
  await s.access.organization.provision({organizationId:s.scope.organizationId,workspaceId:s.scope.workspaceId,actorId:'driver-a',version:2,active:true,roles:['operator'],updatedAt:new Date().toISOString()});
  const operator=await s.fresh();
  for(const command of [{operation:'promote_case',caseId:state.cases[0].id},{operation:'resolve_unknown',reportId:state.reports[0].id,runbook:'charge-reconnect-v1',language:'en'}])
    await assert.rejects(s.api.command(operator,{...command,expectedVersion:state.vehicle!.version},randomUUID()),error=>!!error&&typeof error==='object'&&'code' in error&&error.code==='reviewer_required');
});

test('different signal, unsafe temperature, full battery and revoked case escalate despite a matching model proposal',async t=>{
  const s=await setup(t,{async diagnose(){return {summary:'Untrusted proposal',evidenceIds:['fault','signal'],unknowns:[],runbook:'charge-reconnect-v1'};}});
  let state=await resolveCase(s);state=await s.send(state,{operation:'promote_case',caseId:state.cases[0].id});state=await s.send(state,{operation:'policy',enabled:true});
  for(const fault of [{fault:'unknown',signal:'unclassified',batteryPercent:20},{fault:'battery_hot',batteryPercent:20},{fault:'unknown',signal:'charge_link_timeout',batteryPercent:100}]){
    state=await s.send(state,{operation:'telemetry',...fault});assert.equal(state.vehicle?.attempts,0);assert.equal(state.reports[0].state,'escalated');
    if(state.reports[0].guidance)assert.equal(state.reports[0].guidance.canResolve,false);
  }
  state=await s.send(state,{operation:'revoke_case',caseId:state.cases[0].id});
  state=await s.send(state,{operation:'telemetry',fault:'unknown',signal:'charge_link_timeout',batteryPercent:20});assert.equal(state.vehicle?.attempts,0);assert.equal(state.reports[0].state,'escalated');
});

test('expired guide and expired learned case refuse reuse without extending their authority',async t=>{
  const s=await setup(t);let state=await s.send(s.initial,{operation:'telemetry',fault:'unknown',signal:'charge_link_timeout',batteryPercent:20});
  s.advance(11*60000);await assert.rejects(s.send(state,{operation:'resolve_unknown',reportId:state.reports[0].id,runbook:'charge-reconnect-v1',language:'en'}));
  state=await s.send(await s.api.read(s.session),{operation:'telemetry',fault:'unknown',signal:'charge_link_timeout',batteryPercent:21});
  state=await s.send(state,{operation:'resolve_unknown',reportId:state.reports[0].id,runbook:'charge-reconnect-v1',language:'en'});state=await s.send(state,{operation:'promote_case',caseId:state.cases[0].id});
  s.advance(7*24*3600000+1);const fresh=await s.fresh();
  state=await s.api.command(fresh,{operation:'policy',expectedVersion:state.vehicle!.version,enabled:true},randomUUID());
  state=await s.api.command(fresh,{operation:'telemetry',expectedVersion:state.vehicle!.version,fault:'unknown',signal:'charge_link_timeout',batteryPercent:21},randomUUID());
  assert.equal(state.reports[0].state,'escalated');assert.equal(state.vehicle?.attempts,0);
});

test('a late investigation becomes unknown on read and a late model reply cannot execute it',async t=>{
  let entered!:()=>void,release!:()=>void;const start=new Promise<void>(r=>{entered=r;}),barrier=new Promise<void>(r=>{release=r;});
  const s=await setup(t,{async diagnose(){entered();await barrier;return {summary:'late',evidenceIds:['fault'],unknowns:[],runbook:'charge-reconnect-v1'};}});
  const policy=await s.send(s.initial,{operation:'policy',enabled:true});
  const command={operation:'telemetry',expectedVersion:policy.vehicle!.version,fault:'charge_handshake',batteryPercent:20},key=randomUUID(),pending=s.api.command(s.session,command,key);
  await start;s.advance(36000);let state=await s.api.read(s.session);assert.equal(state.reports[0].state,'unknown');assert.equal(s.calls(),1);
  release();state=await pending;assert.equal(state.vehicle?.attempts,0);assert.equal(state.reports[0].state,'unknown');
  await assert.rejects(s.api.command(s.session,command,key));await s.api.read(s.session);assert.equal(s.calls(),1);
});

test('case revocation while the model works prevents a remedy and never repeats the provider call',async t=>{
  let entered!:()=>void,release!:()=>void;const start=new Promise<void>(r=>{entered=r;}),barrier=new Promise<void>(r=>{release=r;});
  const s=await setup(t,{async diagnose(_vehicle,_language,_signal,cases=[]){if(cases.length){entered();await barrier;}return {summary:'bounded',evidenceIds:['fault'],unknowns:[],runbook:cases.length?'charge-reconnect-v1':'none'};}});
  let state=await resolveCase(s);state=await s.send(state,{operation:'promote_case',caseId:state.cases[0].id});state=await s.send(state,{operation:'policy',enabled:true});
  const pending=s.send(state,{operation:'telemetry',fault:'unknown',signal:'charge_link_timeout',batteryPercent:23});await start;
  const staged=await s.api.read(s.session);await s.send(staged,{operation:'revoke_case',caseId:state.cases[0].id});release();state=await pending;
  assert.equal(state.vehicle?.attempts,0);assert.equal(state.cases[0].status,'revoked');assert.equal(state.reports[0].state,'unknown');assert.equal(s.calls(),2);
});

test('client supplied case proof, execution code and an out-of-catalog guide are rejected',async t=>{
  const s=await setup(t);const state=await s.send(s.initial,{operation:'telemetry',fault:'unknown',signal:'charge_link_timeout',batteryPercent:20});
  for(const extra of [{runbook:'generated-shell-code'},{runbook:'charge-reconnect-v1',verification:{after:{fault:'none'}}},{runbook:'charge-reconnect-v1',owner:{kind:'personal',userId:'attacker'}}])
    await assert.rejects(s.send(state,{operation:'resolve_unknown',reportId:state.reports[0].id,language:'en',...extra}));
  assert.equal((await s.api.read(s.session)).vehicle?.attempts,0);assert.equal((await s.api.read(s.session)).cases.length,0);
});

test('exhausted model budget still records fresh telemetry and escalates instead of keeping stale healthy state',async t=>{
  const s=await setup(t);let state=s.initial;
  for(let index=0;index<30;index++)state=await s.send(state,{operation:'telemetry',fault:'charge_handshake',batteryPercent:20});
  assert.equal(s.calls(),30);
  state=await s.send(state,{operation:'telemetry',fault:'unknown',signal:'charge_link_timeout',batteryPercent:19});
  assert.equal(state.vehicle?.batteryPercent,19);assert.equal(state.vehicle?.fault,'unknown');assert.equal(state.vehicle?.attempts,0);
  assert.equal(state.reports[0].engine,'guardian');assert.equal(state.reports[0].state,'unknown');assert.equal(s.calls(),30);
  state=await s.send(state,{operation:'resolve_unknown',reportId:state.reports[0].id,runbook:'charge-reconnect-v1',language:'en'});
  assert.equal(state.cases[0].status,'candidate');assert.equal(s.calls(),30);
});

test('two simultaneous human resolutions create one verified candidate and replay never repeats it',async t=>{
  const s=await setup(t);let state=await s.send(s.initial,{operation:'telemetry',fault:'unknown',signal:'charge_link_timeout',batteryPercent:20});
  const command={operation:'resolve_unknown',expectedVersion:state.vehicle!.version,reportId:state.reports[0].id,runbook:'charge-reconnect-v1',language:'en'},key=randomUUID();
  const replies=await Promise.allSettled([s.api.command(s.session,command,key),s.api.command(s.session,command,key)]);
  assert.ok(replies.some(reply=>reply.status==='fulfilled'));state=await s.api.read(s.session);
  assert.equal(state.cases.length,1);assert.equal(state.vehicle?.attempts,1);assert.deepEqual(await s.api.command(s.session,command,key),state);
});

test('provider capacity refusal retains the incident, reports no action and never replays the model',async t=>{
  const s=await setup(t,{diagnose:async()=>{throw Error('google_mobility_busy');}});
  const command={operation:'telemetry',expectedVersion:s.initial.vehicle!.version,batteryPercent:30,fault:'unknown',signal:'charge_link_timeout',language:'en'},key=randomUUID();
  const state=await s.api.command(s.session,command,key);
  assert.equal(state.reports[0].state,'unknown');assert.equal(state.vehicle?.attempts,0);
  assert.match(state.reports[0].summary,/AI service is busy/);assert.equal(state.reports[0].authorization,'read-only');
  assert.equal(s.calls(),1);await assert.rejects(s.api.command(s.session,command,key),{code:'mobility_outcome_unknown'});
  assert.equal(s.calls(),1);assert.equal((await s.api.read(s.session)).vehicle?.version,state.vehicle?.version);
});
