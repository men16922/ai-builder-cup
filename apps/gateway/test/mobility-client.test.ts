import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MobilityClient } from '../../web/src/mobility/mobility-client';

const state={vehicle:null,journey:null,reports:[],favorites:[],policy:{enabled:false,expiresAt:null,runbook:'charge-reconnect-v1'},mapsAvailable:true};
test('mobility views clear on permission denial and cannot return after sign-out or a late reply',async()=>{
  let denied=false,reply!:(value:unknown)=>void;
  const client=new MobilityClient(async()=>{
    if(denied)throw Object.assign(new Error('mobility_not_entitled'),{status:403});
    return state;
  });
  await client.load();assert.ok(client.getSnapshot().state);
  denied=true;await client.load();assert.equal(client.getSnapshot().state,undefined);
  const late=new MobilityClient(()=>new Promise(resolve=>{reply=resolve;}));
  const loading=late.load();late.close();reply(state);await loading;
  assert.equal(late.getSnapshot().state,undefined);assert.equal(late.getSnapshot().busy,false);
});
test('unknown commands are not retried by refresh or lifecycle cleanup',async()=>{
  let reads=0,changes=0;
  const client=new MobilityClient(async(_path,pending)=>{
    if(pending){changes++;throw new Error('mobility_outcome_unknown');}
    reads++;return state;
  });
  await client.load();await client.command({operation:'initialize'});await client.load();client.close();client.open();await client.load();
  assert.equal(changes,1);assert.equal(reads,3);
});

test('moving journeys are armed only by a confirmed intent; unknown steps and reads never rearm',async()=>{
  const now=new Date().toISOString(),id='11111111-1111-4111-8111-111111111111';
  const place={id:'fixture',name:'Synthetic destination',address:'',location:{latitude:37.567,longitude:126.979},kind:'poi',source:'google-places',fetchedAt:now};
  const moving={...state,vehicle:{id,version:1,source:'simulation',model:'Aide EV',observedAt:now,batteryPercent:50,targetPercent:80,batteryCelsius:28,rangeKm:260,parked:false,charging:'idle',powerKw:0,fault:'none',episode:id,attempts:0,location:{latitude:37.5665,longitude:126.978}},journey:{id,state:'moving',kind:'poi',origin:{latitude:37.5665,longitude:126.978},candidates:[place],destination:place,progress:0,position:{latitude:37.5665,longitude:126.978},consent:'explicit-selection',createdAt:now,expiresAt:new Date(Date.now()+60000).toISOString(),source:'simulation'}};
  let changes=0,unknown=false;
  const client=new MobilityClient(async(_path,pending)=>{if(pending){changes++;if(unknown)throw Error('mobility_outcome_unknown');}return moving;});
  await client.load();assert.equal(client.getSnapshot().journeyRunning,false);
  await client.command({operation:'advance',journeyId:id},true);assert.equal(changes,0);
  await client.command({operation:'advance',journeyId:id});assert.equal(client.getSnapshot().journeyRunning,true);assert.equal(changes,1);
  unknown=true;await client.command({operation:'advance',journeyId:id},true);assert.equal(client.getSnapshot().journeyRunning,false);assert.equal(changes,2);
  await client.load();await client.command({operation:'advance',journeyId:id},true);assert.equal(changes,2);assert.equal(client.getSnapshot().journeyRunning,false);
});
