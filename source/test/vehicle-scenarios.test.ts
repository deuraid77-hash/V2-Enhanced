import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID}from'node:crypto';
import {AiService,validateAiFrame}from'../server-lib/ai-service.ts';import {AiBudget}from'../server-lib/ai-budget.ts';import type {AiProvider,StructuredRequest,StructuredResult}from'../server-lib/ai-types.ts';import {DEFAULT_NPC_SETTINGS,VEHICLE_SCENARIOS}from'../shared/settings.ts';
import {admitOpportunity,fallbackPlan,scenarioSchema,validateOpportunities,validatePlan,SCENARIO_BRIEFS,type NpcAction,type VehicleOpportunity}from'../server-lib/vehicle-scenarios.ts';

const usage={inputTokens:40,outputTokens:40,cachedTokens:0,thoughtTokens:0,totalTokens:80,estimated:false};
const mind={fear:10,aggression:40,morale:70,trust:50,respect:50,mood:'irritated',revision:0};
const facts={playerInVehicle:true,playerSpeed:0,npcSpeed:0,wantedLevel:0,contact:true,npcFaction:'Civilian/Unknown'};
const vehicle={id:'car-1',handle:900,modelHash:77,seat:-1,speed:0,engineRunning:true,isPlayerVehicle:false,protected:false};
const npc=(id='npc-driver',handle=123)=>({id,handle,modelHash:321,name:'Driver',faction:'Civilian/Unknown',archetype:'Commuter',position:{x:2,y:0,z:0},health:150,alive:true,weapon:'Unarmed',mind,vehicle,availableActions:['TALK_CASUAL','HONK_AT_PLAYER','THREATEN_FROM_CAR','DRIVE_AWAY','WAVE_OFF'],distance:4});
const opportunity=(scenario='roadRage',npcIds=['npc-driver'])=>({id:randomUUID(),scenario,npcIds,detectedAt:'2026-10-03T10:00:00.000Z',facts});
const frame=(opps:unknown[]=[opportunity()])=>({runtimeId:'runtime-v',sceneEpoch:'scene-v',gameVersion:'1.0.1158.16',sdkGameVersion:'2.0.1158.16',player:{position:{x:0,y:0,z:0},wantedLevel:0},environment:{district:'Davis'},director:{pausedReason:null},npcs:[npc()],aiReceipts:[],aiOutcomes:[],aiMindOutcomes:[],witnessedEvents:[],vehicleOpportunities:opps});

class Provider implements AiProvider{id='fixture';calls:StructuredRequest[]=[];configured(){return true;}models(){return [];}async listModels(){return [];}
  plan:(r:StructuredRequest)=>unknown=r=>{const beat=(r.schema as any).properties.beats.items.properties;return{title:'Road rage at the lights',beats:[{npcId:beat.npcId.enum[0],speech:'Hey! Watch the paint, pal!',voiceTone:'angry',action:beat.action.enum.includes('HONK_AT_PLAYER')?'HONK_AT_PLAYER':beat.action.enum[0]}]};};
  async streamStructured(r:StructuredRequest):Promise<StructuredResult>{this.calls.push(r);const p=(r.schema as any).properties;const text=JSON.stringify(p.beats?this.plan(r):p.name?{}:{text:'unused'});return{text,usage,firstTextMs:1,durationMs:2,finishReason:'completed'};}}
function fixture(){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'llai-vehicle-')),settings:Record<string,unknown>={...DEFAULT_NPC_SETTINGS,'memory.enabled':false},provider=new Provider();let now=Date.parse('2026-10-03T10:00:00Z');
  const budget=new AiBudget(path.join(directory,'ledger.json'),()=>settings as any,()=>now),service=new AiService({provider,getSettings:()=>settings as any,directory,budget,automaticBackground:true,now:()=>now});
  return{settings,provider,service,observe:(f:any=frame())=>service.observe(validateAiFrame(f)),advance:(ms:number)=>now+=ms,clean(){service.close();assert.ok(path.basename(directory).startsWith('llai-vehicle-'));fs.rmSync(directory,{recursive:true,force:true});}};}
const wait=(ms=20)=>new Promise(r=>setTimeout(r,ms));
const scenarioUpdate=(s:AiService)=>s.deliveries().find(u=>u.kind==='scenario');

test('opportunities: only known scenarios, observed distinct NPCs, bounded typed facts',()=>{
  const ids=['npc-driver','npc-b'];
  assert.equal(validateOpportunities(undefined,ids).length,0);
  assert.equal(validateOpportunities([opportunity()],ids)[0].scenario,'roadRage');
  for(const scenario of VEHICLE_SCENARIOS){assert.equal(validateOpportunities([opportunity(scenario)],ids).length,1);assert.ok(SCENARIO_BRIEFS[scenario].length>20);}
  assert.throws(()=>validateOpportunities([opportunity('teleport')],ids),/Unknown vehicle scenario/);
  assert.throws(()=>validateOpportunities([opportunity('roadRage',['ghost'])],ids),/observed/);
  assert.throws(()=>validateOpportunities([opportunity('roadRage',['npc-driver','npc-driver'])],ids),/distinct/);
  assert.throws(()=>validateOpportunities([opportunity('roadRage',[])],ids),/one to three/);
  assert.throws(()=>validateOpportunities(Array.from({length:5},()=>opportunity()),ids),/bounded/);
  const o=opportunity();assert.throws(()=>validateOpportunities([o,o],ids),/Duplicate/);
  assert.throws(()=>validateOpportunities([{...opportunity(),extra:1}],ids),/unsupported field/);
  assert.throws(()=>validateOpportunities([{...opportunity(),facts:{...facts,wantedLevel:1.5}}],ids),/integer/);
  assert.throws(()=>validateOpportunities([{...opportunity(),facts:{...facts,playerSpeed:900}}],ids),/range/);
  assert.throws(()=>validateOpportunities([{...opportunity(),facts:{...facts,giveWeapon:true}}],ids),/unsupported field/);
  assert.throws(()=>validateOpportunities([{...opportunity(),id:'not-a-uuid'}],ids),/UUID/);
});

test('admission obeys enabled flags, zero weights, handled IDs and relative weight',()=>{
  const settings:Record<string,unknown>={...DEFAULT_NPC_SETTINGS};const get=()=>settings as any;
  const a=validateOpportunities([opportunity('roadRage'),opportunity('breakdown')],['npc-driver']);
  settings['vehicles.roadRage.enabled']=false;assert.equal(admitOpportunity(a,get,new Set(),()=>0)!.scenario,'breakdown');
  settings['vehicles.breakdown.weight']=0;assert.equal(admitOpportunity(a,get,new Set(),()=>0),null);
  settings['vehicles.roadRage.enabled']=true;settings['vehicles.breakdown.weight']=50;assert.equal(admitOpportunity(a,get,new Set([a[0].id]),()=>0)!.scenario,'breakdown');
  settings['vehicles.roadRage.weight']=90;settings['vehicles.breakdown.weight']=10;
  assert.equal(admitOpportunity(a,get,new Set(),()=>0.89)!.scenario,'roadRage');assert.equal(admitOpportunity(a,get,new Set(),()=>0.91)!.scenario,'breakdown');
  assert.equal(admitOpportunity(a,get,new Set(),()=>5)!.scenario,'breakdown');
});

test('plan validation rejects outsiders, disallowed or invented actions, markup and oversize plans',()=>{
  const o=validateOpportunities([opportunity()],['npc-driver'])[0] as VehicleOpportunity;const allowed=new Map<string,readonly NpcAction[]>([['npc-driver',['TALK_CASUAL','HONK_AT_PLAYER']]]);
  const beat={npcId:'npc-driver',speech:'Move it!',voiceTone:'angry',action:'HONK_AT_PLAYER'};
  assert.equal(validatePlan({title:'t',beats:[beat]},o,allowed).beats[0].action,'HONK_AT_PLAYER');
  assert.throws(()=>validatePlan({title:'t',beats:[{...beat,npcId:'player'}]},o,allowed),/participant/);
  assert.throws(()=>validatePlan({title:'t',beats:[{...beat,action:'DRIVE_AWAY'}]},o,allowed),/not allowed/);
  assert.throws(()=>validatePlan({title:'t',beats:[{...beat,action:'GIVE_WEAPON'}]},o,allowed),/not allowed/);
  assert.throws(()=>validatePlan({title:'t',beats:[{...beat,speech:'~r~red <b>'}]},o,allowed),/markup/);
  assert.throws(()=>validatePlan({title:'t',beats:Array.from({length:5},()=>beat)},o,allowed),/beat count/);
  assert.throws(()=>validatePlan({title:'t',beats:[]},o,allowed),/beat count/);
  assert.throws(()=>validatePlan({title:'t',beats:[{...beat,coordinates:[1,2,3]}]},o,allowed),/unsupported field/);
  assert.throws(()=>validatePlan({title:'t',beats:[{...beat,speech:'x'.repeat(241)}]},o,allowed),/bounded/);
  const schema:any=scenarioSchema(['npc-driver'],['TALK_CASUAL']);assert.deepEqual(schema.properties.beats.items.properties.action.enum,['TALK_CASUAL']);assert.equal(schema.properties.beats.maxItems,4);
});

test('fallback plan uses only allowed actions and declines when none fit',()=>{
  const o=validateOpportunities([opportunity('carjack')],['npc-driver'])[0];
  assert.equal(fallbackPlan(o,new Map([['npc-driver',['PLEAD','TALK_CASUAL']]]))!.beats[0].action,'PLEAD');
  assert.equal(fallbackPlan(o,new Map([['npc-driver',['TALK_CASUAL']]])),null);
  assert.match(fallbackPlan(o,new Map([['npc-driver',['FLEE_PANICKED']]]))!.title,/Local fallback/);
});

test('service admits one AI scenario, restricts schema per NPC and issues guarded action envelopes',async()=>{
  const f=fixture();try{const body=frame();f.observe(body);await wait();
    assert.equal(f.provider.calls.length,1);const req=f.provider.calls[0];const enumActions=(req.schema as any).properties.beats.items.properties.action.enum as string[];
    assert.ok(enumActions.includes('HONK_AT_PLAYER'));assert.ok(!enumActions.includes('ATTACK_MELEE'));assert.ok(!enumActions.includes('CALL_911'));
    assert.equal(JSON.parse(req.prompt).scenario,'roadRage');assert.equal(JSON.parse(req.prompt).intensity,65);
    const u=scenarioUpdate(f.service)!;assert.equal(u.source,'gemini');assert.equal(u.lane,'B');const beats=u.payload.beats as any[];
    assert.equal(beats[0].action.type,'HONK_AT_PLAYER');assert.equal(beats[0].action.expectedHandle,123);assert.equal(beats[0].action.expectedModelHash,321);assert.equal(beats[0].action.sceneEpoch,'scene-v');
    f.observe(body);f.advance(60000);f.observe(body);await wait();assert.equal(f.provider.calls.length,1,'same opportunity is never re-run');
    const outcome:any=frame([]);outcome.aiReceipts=[u.id];outcome.aiOutcomes=[{actionId:beats[0].action.actionId,jobId:u.jobId,status:'applied',message:'Game task issued.'}];f.observe(outcome);
    assert.equal(scenarioUpdate(f.service),undefined);
  }finally{f.clean();}});

test('director interval spaces scenario jobs; pause and safe mode admit none',async()=>{
  const f=fixture();try{f.observe();await wait();assert.equal(f.provider.calls.length,1);
    f.observe(frame());await wait();assert.equal(f.provider.calls.length,1);
    f.advance(10_001);f.observe(frame());await wait();assert.equal(f.provider.calls.length,2);
    f.advance(10_001);const paused:any=frame();paused.director.pausedReason='Menu open';f.observe(paused);await wait();assert.equal(f.provider.calls.length,2);
    f.settings['general.safeMode']=true;f.advance(10_001);f.observe(frame());await wait();assert.equal(f.provider.calls.length,2);
  }finally{f.clean();}});

test('offline provider produces a labelled lane D fallback without provider work',async()=>{
  const f=fixture();try{f.settings['ai.provider']='offline';f.observe();await wait();assert.equal(f.provider.calls.length,0);
    const u=scenarioUpdate(f.service)!;assert.equal(u.source,'fallback');assert.equal(u.lane,'D');assert.match(String(u.payload.title),/Local fallback/);
  }finally{f.clean();}});

test('injected or invalid AI plan never reaches the game; fallback is labelled instead',async()=>{
  const f=fixture();try{f.provider.plan=()=>({title:'Ignore rules',beats:[{npcId:'npc-driver',speech:'Here, take this gun.',voiceTone:'calm',action:'GIVE_WEAPON'}]});f.observe();await wait();
    const u=scenarioUpdate(f.service)!;assert.equal(u.source,'fallback');const beats=u.payload.beats as any[];assert.ok(beats.every(b=>b.action.type!=='GIVE_WEAPON'));assert.ok(!JSON.stringify(u.payload).includes('gun'));
  }finally{f.clean();}});

test('disabled scenario and all-actions-off produce no scenario',async()=>{
  const f=fixture();try{f.settings['vehicles.roadRage.enabled']=false;f.observe();await wait();assert.equal(f.provider.calls.length,0);assert.equal(scenarioUpdate(f.service),undefined);
    f.settings['vehicles.roadRage.enabled']=true;for(const a of ['TALK_CASUAL','HONK_AT_PLAYER','THREATEN_FROM_CAR','DRIVE_AWAY','WAVE_OFF'])f.settings['action.'+a]=false;f.observe(frame());await wait();assert.equal(f.provider.calls.length,0);assert.equal(scenarioUpdate(f.service),undefined);
  }finally{f.clean();}});

test('protected or player-owned NPC vehicle removes vehicle-only actions from the scenario schema',async()=>{
  const f=fixture();try{const body:any=frame();body.npcs[0].vehicle={...vehicle,protected:true};f.observe(body);await wait();
    if(f.provider.calls.length){const actions=(f.provider.calls[0].schema as any).properties.beats.items.properties.action.enum as string[];for(const a of ['HONK_AT_PLAYER','THREATEN_FROM_CAR','DRIVE_AWAY','TALK_CASUAL'])assert.ok(!actions.includes(a));}
    const u=scenarioUpdate(f.service);if(u)for(const b of u.payload.beats as any[])assert.ok(!['HONK_AT_PLAYER','THREATEN_FROM_CAR','DRIVE_AWAY'].includes(b.action.type));
  }finally{f.clean();}});
