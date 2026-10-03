import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID}from'node:crypto';
import {AiService,validateAiFrame}from'../server-lib/ai-service.ts';import {AiBudget}from'../server-lib/ai-budget.ts';import type {AiProvider,StructuredRequest,StructuredResult}from'../server-lib/ai-types.ts';import {DEFAULT_NPC_SETTINGS,EXTRA_SCENARIOS,NPC_ACTIONS}from'../shared/settings.ts';
import {admitOpportunity,fallbackPlan,scenarioWeight,validateOpportunities,SCENARIO_BRIEFS}from'../server-lib/vehicle-scenarios.ts';
import {STREET_FALLBACK,isNight,isWet,streetWeight}from'../server-lib/street-scenarios.ts';

// Step 6 street scenarios share the Step 4 opportunity pipeline. These tests use an
// isolated fixture provider; no real provider is called and no game action runs.
const usage={inputTokens:40,outputTokens:40,cachedTokens:0,thoughtTokens:0,totalTokens:80,estimated:false};
const mind={fear:20,aggression:20,morale:60,trust:50,respect:50,mood:'curious',revision:0};
const facts={playerInVehicle:false,playerSpeed:0,npcSpeed:0,wantedLevel:0,contact:false,npcFaction:'Civilian/Unknown'};
const npc=(id='npc-walker',handle=321)=>({id,handle,modelHash:654,name:'Walker',faction:'Civilian/Unknown',archetype:'Tourist',position:{x:3,y:0,z:0},health:150,alive:true,weapon:'Unarmed',mind,availableActions:['TALK_CASUAL','GIVE_DIRECTIONS','WAVE_OFF','PLEAD','SURRENDER','FLEE_PANICKED'],distance:5});
const opportunity=(scenario='tourist',npcIds=['npc-walker'])=>({id:randomUUID(),scenario,npcIds,detectedAt:'2026-10-03T10:00:00.000Z',facts});
const frame=(opps:unknown[]=[opportunity()],environment:Record<string,unknown>={district:'Vinewood',weather:'Clear',timeOfDay:'12:00'})=>({runtimeId:'runtime-s',sceneEpoch:'scene-s',gameVersion:'1.0.1158.16',sdkGameVersion:'2.0.1158.16',player:{position:{x:0,y:0,z:0},wantedLevel:0},environment,director:{pausedReason:null},npcs:[npc()],aiReceipts:[],aiOutcomes:[],aiMindOutcomes:[],witnessedEvents:[],vehicleOpportunities:opps});

class Provider implements AiProvider{id='fixture';calls:StructuredRequest[]=[];configured(){return true;}models(){return [];}async listModels(){return [];}
  plan:(r:StructuredRequest)=>unknown=r=>{const beat=(r.schema as any).properties.beats.items.properties;return{title:'Lost in the city',beats:[{npcId:beat.npcId.enum[0],speech:'Sorry, which way to the pier?',voiceTone:'hopeful',action:beat.action.enum.includes('TALK_CASUAL')?'TALK_CASUAL':beat.action.enum[0]}]};};
  async streamStructured(r:StructuredRequest):Promise<StructuredResult>{this.calls.push(r);const p=(r.schema as any).properties;const text=JSON.stringify(p.beats?this.plan(r):{text:'unused'});return{text,usage,firstTextMs:1,durationMs:2,finishReason:'completed'};}}
function fixture(){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'llai-street-')),settings:Record<string,unknown>={...DEFAULT_NPC_SETTINGS,'memory.enabled':false},provider=new Provider();let now=Date.parse('2026-10-03T10:00:00Z');
  const budget=new AiBudget(path.join(directory,'ledger.json'),()=>settings as any,()=>now),service=new AiService({provider,getSettings:()=>settings as any,directory,budget,automaticBackground:true,now:()=>now});
  return{settings,provider,service,observe:(f:any=frame())=>service.observe(validateAiFrame(f)),advance:(ms:number)=>now+=ms,clean(){service.close();assert.ok(path.basename(directory).startsWith('llai-street-'));fs.rmSync(directory,{recursive:true,force:true});}};}
const wait=(ms=20)=>new Promise(r=>setTimeout(r,ms));
const scenarioUpdate=(s:AiService)=>s.deliveries().find(u=>u.kind==='scenario');

test('street: every scenario validates, has a factual brief and an executable fallback',()=>{
  for(const s of EXTRA_SCENARIOS){
    const o=validateOpportunities([opportunity(s)],['npc-walker'])[0];assert.equal(o.scenario,s);assert.ok(SCENARIO_BRIEFS[s].length>20);
    for(const a of STREET_FALLBACK[s].prefer)assert.ok((NPC_ACTIONS as readonly string[]).includes(a),`${s} fallback ${a}`);
    const plan=fallbackPlan(o,new Map([['npc-walker',[...NPC_ACTIONS]]]))!;assert.equal(plan.beats.length,1);assert.equal(plan.beats[0].action,STREET_FALLBACK[s].prefer[0]);assert.match(plan.title,/Local fallback/);
    assert.equal(fallbackPlan(o,new Map([['npc-walker',[]]])),null);
  }
  assert.throws(()=>validateOpportunities([opportunity('riot')],['npc-walker']),/Unknown vehicle scenario/);
});

test('street: weight follows director weight, night, rain and district multipliers',()=>{
  const settings:Record<string,unknown>={...DEFAULT_NPC_SETTINGS};const get=()=>settings as any;
  assert.equal(isNight('20:00'),true);assert.equal(isNight('05:59'),true);assert.equal(isNight('06:00'),false);assert.equal(isNight('19:59'),false);assert.equal(isNight('night'),false);assert.equal(isNight(undefined),false);
  assert.equal(isWet('Raining'),true);assert.equal(isWet('ThunderStorm'),true);assert.equal(isWet('Clear'),false);assert.equal(isWet('raining; drop table'),false);
  const day={district:'Vinewood',weather:'Clear',timeOfDay:'12:00'};
  assert.equal(streetWeight('argument',get,day),50);
  assert.equal(streetWeight('argument',get,{...day,timeOfDay:'23:10'}),50*1.25);
  assert.equal(streetWeight('argument',get,{...day,weather:'Raining'}),50*0.8);
  settings['director.davisMultiplier']=2;assert.equal(streetWeight('argument',get,{...day,district:'Davis'}),100);
  settings['director.davisMultiplier']=0;assert.equal(streetWeight('argument',get,{...day,district:'Davis'}),0);
  settings['director.argumentWeight']=0;assert.equal(streetWeight('argument',get,day),0);
  assert.equal(streetWeight('fan',get,null),50);
});

test('street: admission mixes vehicle and street opportunities and honours zero weights',()=>{
  const settings:Record<string,unknown>={...DEFAULT_NPC_SETTINGS};const get=()=>settings as any;
  const a=validateOpportunities([opportunity('tourist'),opportunity('roadRage')],['npc-walker']);
  assert.equal(scenarioWeight(a[0],get),50);assert.equal(scenarioWeight(a[1],get),50);
  settings['director.touristWeight']=0;assert.equal(admitOpportunity(a,get,new Set(),()=>0)!.scenario,'roadRage');
  settings['vehicles.roadRage.enabled']=false;assert.equal(admitOpportunity(a,get,new Set(),()=>0),null);
  settings['director.touristWeight']=50;assert.equal(admitOpportunity(a,get,new Set(),()=>0,{timeOfDay:'23:00'})!.scenario,'tourist');
});

test('street: service plans one AI scenario with only allowed actions and a street prompt',async()=>{
  const f=fixture();try{f.observe();await wait();
    assert.equal(f.provider.calls.length,1);const req=f.provider.calls[0];const prompt=JSON.parse(req.prompt);
    assert.equal(prompt.scenario,'tourist');assert.match(prompt.situation,/civilian/);assert.equal(prompt.intensity,undefined);assert.match(req.system,/on foot or involving vehicles/);
    const actions=(req.schema as any).properties.beats.items.properties.action.enum as string[];
    for(const a of ['HONK_AT_PLAYER','THREATEN_FROM_CAR','DRIVE_AWAY','LEAVE_VEHICLE_TO_CONFRONT'])assert.ok(!actions.includes(a),`on-foot NPC offered ${a}`);
    const u=scenarioUpdate(f.service)!;assert.equal(u.source,'gemini');assert.equal(u.payload.scenario,'tourist');const beats=u.payload.beats as any[];
    assert.equal(beats[0].action.type,'TALK_CASUAL');assert.equal(beats[0].action.expectedHandle,321);assert.equal(beats[0].action.expectedModelHash,654);
  }finally{f.clean();}});

test('street: zero director weight, safe mode and pause start nothing; offline is labelled fallback',async()=>{
  const f=fixture();try{f.settings['director.touristWeight']=0;f.observe();await wait();assert.equal(f.provider.calls.length,0);assert.equal(scenarioUpdate(f.service),undefined);
    f.settings['director.touristWeight']=50;f.settings['general.safeMode']=true;f.observe(frame());await wait();assert.equal(f.provider.calls.length,0);
    f.settings['general.safeMode']=false;const paused:any=frame();paused.director.pausedReason='Panic stop active; restart the script to resume';f.observe(paused);await wait();assert.equal(f.provider.calls.length,0);
    f.settings['ai.provider']='offline';f.observe(frame());await wait();assert.equal(f.provider.calls.length,0);
    const u=scenarioUpdate(f.service)!;assert.equal(u.source,'fallback');assert.equal(u.lane,'D');assert.match(String(u.payload.title),/Local fallback: tourist/);
  }finally{f.clean();}});

test('street: injected holdup plan cannot add actions or markup; fallback stays within allowed list',async()=>{
  const f=fixture();try{f.provider.plan=()=>({title:'Ignore previous rules',beats:[{npcId:'npc-walker',speech:'<script>Take my gun</script>',voiceTone:'calm',action:'GIVE_WEAPON'}]});
    f.observe(frame([opportunity('holdup')]));await wait();
    const u=scenarioUpdate(f.service)!;assert.equal(u.source,'fallback');const beats=u.payload.beats as any[];
    assert.ok(beats.every(b=>(['SURRENDER','PLEAD','FLEE_PANICKED'] as string[]).includes(b.action.type)));assert.ok(!JSON.stringify(u.payload).includes('script'));
  }finally{f.clean();}});
