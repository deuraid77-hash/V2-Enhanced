// Isolated Step3 browser fixture: real stores/routes, synthetic events and audio.
// No credential module, real capture host, or network provider is imported.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SettingsStore } from '../server-lib/settings-store.ts';
import { installSettingsRoutes } from '../server-lib/settings-routes.ts';
import { WorldState } from '../server-lib/world.ts';
import { installWorldRoutes } from '../server-lib/world-routes.ts';
import { MemoryStore } from '../server-lib/memory-store.ts';
import { installMemoryRoutes } from '../server-lib/memory-routes.ts';
import { AiBudget } from '../server-lib/ai-budget.ts';
import { AiScheduler } from '../server-lib/ai-scheduler.ts';
import { PttService } from '../server-lib/ptt.ts';
import { installPttRoutes } from '../server-lib/ptt-routes.ts';
import { TRANSCRIPTION_MODEL } from '../server-lib/ptt-provider.ts';
import { isAllowedLocalRequest } from '../server-lib/compatibility.ts';
import { AiError, ZERO_USAGE } from '../server-lib/ai-types.ts';
import type { MemoryTarget } from '../server-lib/memory-types.ts';

const app=express(),port=3107,settings=new SettingsStore(),world=new WorldState();settings.bindWorld(world);
const get=()=>settings.snapshot().settings,budget=new AiBudget(undefined,get),scheduler=new AiScheduler(get),memory=new MemoryStore(get);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),portal=path.join(root,'..','verification','npc-overhaul','mind-portal-dist');
const runtimeId='QA-MIND-NO-GTA-NO-PROVIDER',sceneEpoch='QA-SCENE';let connected=true,hostStarts=0,hostReason='',providerCalls=0;
const targets:MemoryTarget[]=Array.from({length:28},(_,i)=>({runtimeId,sceneEpoch,npcId:`QA-NPC-${i+1}`,handle:100+i,modelHash:10000+i}));
const mind={fear:22,aggression:67,morale:76,trust:48,respect:59,mood:'watchful',revision:2};
function seed(){for(let i=0;i<targets.length;i++){const target=targets[i],r=memory.bind(target,{faction:i%2?'Ballas':'Families',district:i%2?'Davis':'Grove Street',mind});memory.persona(r.mindId,{name:`QA ${i===0?'Marcus Reed':i===1?'Elena Cruz':`Resident ${i+1}`}`,age:24+i,job:i%2?'Mechanic':'Courier',backstory:'QA fixture persona. Grew up near the rail yards and knows every shortcut through the neighborhood.',speechStyle:'Direct, dry humour, short sentences.',quirks:['Checks parked cars','Never leaves a favour unpaid','Remembers names'],goal:'Keep the block peaceful enough to make a living.',fear:'Losing the trust of the neighborhood.',secret:'Keeps a notebook of unpaid debts.',voiceCasting:{gender:'neutral',ageBand:'adult',accent:'Los Santos',pitch:1,speed:1}},memory.epoch);const jobId=randomUUID(),commitId=memory.stage(target,jobId,[{type:'conversation',text:'QA acknowledged episode: a tense exchange ended with a respectful apology.'}],i%2?-8:12,3,'gemini',[{role:'player',text:'QA PRIVATE PLAYER WORDS MUST NEVER APPEAR'},{role:'npc',text:'QA NPC working line: We can talk, but keep your hands where I can see them.'}])!;memory.consume(target,{commitId,jobId,npcId:target.npcId,status:'applied',mind});const saved=memory.forTarget(target)!;memory.summarize(r.mindId,'QA AI summary: the player helped settle a dispute and earned cautious respect.',saved.episodes[0].id,memory.epoch);}
 const event={id:randomUUID(),type:'help' as const,at:new Date().toISOString(),npcIds:[targets[0].npcId],district:'Grove Street',position:{x:0,y:0,z:0}};memory.witness(event,[targets[0]]);memory.gossip(event,'QA rumour: someone settled an argument near the garages.','Families',memory.epoch);}
seed();
const ptt=new PttService({getSettings:get,budget,scheduler,validateTarget:target=>{if(!connected)throw new AiError('stale_scene','QA game disconnected.',409);return{scope:{runtimeId:target.runtimeId,sceneEpoch:target.sceneEpoch,npcIds:[target.npcId]}};},host:{devices:async()=>[{id:'qa-microphone-a',name:'QA synthetic microphone A',isDefault:true,available:true},{id:'qa-microphone-b',name:'QA synthetic microphone B',isDefault:false,available:true}],start:async()=>{hostStarts++;return{deviceId:'qa-microphone-a',deviceName:'QA synthetic microphone A'};},lease:async()=>({state:hostReason?'cancelled':'capturing',reasonCode:hostReason}),stop:async()=>({pcm:Buffer.alloc(32000,1),durationMs:1000,rms:.2}),cancel:async()=>{},focus:async()=>({valid:!hostReason,reasonCode:hostReason}),close:async()=>{}},provider:{model:TRANSCRIPTION_MODEL,configured:()=>true,transcribe:async()=>{providerCalls++;return{text:'QA synthetic recognized words.',language:'English',model:TRANSCRIPTION_MODEL,usage:{...ZERO_USAGE,inputTokens:40,outputTokens:10,totalTokens:50},durationMs:20};}}});
app.use((req,res,next)=>{if(!isAllowedLocalRequest(req.headers.host,req.get('origin'),req.get('sec-fetch-site'),port)){res.status(403).json({success:false,error:'QA loopback origin required.'});return;}next();});app.use(express.json({limit:'256kb'}));
installSettingsRoutes(app,settings);installWorldRoutes(app,world);installMemoryRoutes(app,memory);installPttRoutes(app,ptt);
app.get('/api/health',(_req,res)=>res.json({status:'online',version:'4.0.0 QA MIND FIXTURE — NO GAME / NO API',geminiConfigured:false,bridge:{reachable:false}}));
app.get('/api/ai/status',(_req,res)=>res.json({success:true,protocol:4,capabilities:{jobs:false,streamingSpeech:false,lanes:[],activeJobKinds:[],provider:'QA fixture',configured:false,models:[]},scheduler:scheduler.snapshot(),budget:budget.snapshot(),runtime:{protocol:4,runtimeId,sceneEpoch,connected,appliedNpcRevision:settings.snapshot().revision},recentJobs:[]}));
app.post('/__qa/memory-change',(_req,res)=>{const first=memory.forTarget(targets[0]);if(first)memory.persona(first.mindId,first.persona!,memory.epoch);res.json({success:true,revision:memory.revision});});
app.post('/__qa/runtime',(req,res)=>{connected=req.body.connected!==false;if(!connected)memory.retainTargets([]);res.json({success:true});});
app.post('/__qa/host',(req,res)=>{hostReason=String(req.body.reason||'');res.json({success:true});});
app.get('/__qa/evidence',(_req,res)=>res.json({hostStarts,providerCalls,settings:settings.snapshot(),memory:memory.list(),ptt:ptt.status()}));
function tick(){if(!connected)return;const config=world.snapshot().config;world.exchange({protocol:3,runtimeId,pluginVersion:'4.0.0 QA MIND FIXTURE',gameVersion:'QA fixture',appliedRevision:config.revision,player:null,environment:null,npcs:[],director:{enabled:true,pausedReason:'QA fixture',settings:config.settings,territories:[],activeEvents:[],ownedPedCount:0},events:[],acknowledgements:[]});for(const t of targets){if(memory.forTarget(t))memory.bind(t,{faction:'Families',district:'Grove Street',mind});}}
tick();const timer=setInterval(tick,1000);
app.get('/',(_req,res)=>res.type('html').send(fs.readFileSync(path.join(portal,'index.html'),'utf8').replace('</body>','<div style="position:fixed;bottom:6px;right:10px;z-index:9999;background:#412600;color:#ffe0a4;padding:6px 10px;font:10px sans-serif;border:1px solid #b88734">ISOLATED QA — SYNTHETIC DATA / NO MICROPHONE / NO PAID API</div></body>')));app.use(express.static(portal));
const server=app.listen(port,'127.0.0.1',()=>console.log('Isolated mind QA fixture ready on127.0.0.1:3107. No real capture or provider.'));
function close(){clearInterval(timer);void ptt.close();scheduler.cancelAll();server.close();}process.once('SIGINT',close);process.once('SIGTERM',close);
