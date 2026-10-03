// Explicit paid synthetic evaluation; never run by npm test.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {GoogleGenAI} from '@google/genai';
import {readGeminiCredential} from '../server-lib/compatibility.ts';
import {GeminiProvider,TEXT_MODELS} from '../server-lib/ai-provider.ts';
import {AiBudget} from '../server-lib/ai-budget.ts';
import {AiService,validateAiFrame} from '../server-lib/ai-service.ts';
import {AiError,type AiProvider,type AiSettings,type StructuredRequest} from '../server-lib/ai-types.ts';
import {DEFAULT_NPC_SETTINGS} from '../shared/settings.ts';
import {inputForCase,QUALITATIVE_RUBRIC,samplePercentile,scoreConversation,stableHash,validateDataset,type EvaluationCase} from '../test/evaluation/conversation-rubric.ts';

if(process.env.LLAI_RUN_LIVE_AI_EVALUATION!=='true')throw new Error('Explicit live evaluation flag required.');
const model=process.env.LLAI_EVALUATION_MODEL||'gemini-3.5-flash-lite';
if(!(TEXT_MODELS as readonly string[]).includes(model))throw new Error('Choose a verified text model.');
const key=readGeminiCredential();if(!key)throw new Error('Private Gemini credential unavailable.');
const dataset=JSON.parse(fs.readFileSync(path.resolve('docs/evaluation/npc-conversation-cases-v1.json'),'utf8'));
const cases=validateDataset({cases:dataset.cases});
const ledger=path.join(process.env.LOCALAPPDATA!,'LivingLosSantos','Enhanced','ai-usage.json');
if(fs.existsSync(ledger)&&JSON.parse(fs.readFileSync(ledger,'utf8')).reservations?.length)throw new Error('Another evaluation or companion has active spending reservations.');
// Isolated evaluation settings; no user setting or game state is changed.
// The shared budget still enforces the authorized US$5 combined daily limit.
let config:AiSettings={...DEFAULT_NPC_SETTINGS,'ai.liveModel':model,'ai.maxRetries':0,'ai.liveMaxOutputTokens':1024,'ai.maxInputTokensPerMinute':64000};
const getSettings=()=>config,budget=new AiBudget(ledger,getSettings);
const base=new GeminiProvider(()=>new GoogleGenAI({apiKey:key,httpOptions:{timeout:18000}}),()=>true);
if(!(await base.listModels()).some(m=>m.id===model&&m.available))throw new Error('Model unavailable in authenticated account listing.');
const requests:{systemHash:string;schemaHash:string;contextHash:string;maxOutputTokens:number;allowedActions:unknown}[]=[];
const provider:AiProvider={id:base.id,configured:()=>base.configured(),models:()=>base.models(),listModels:s=>base.listModels(s),streamStructured:async (request:StructuredRequest)=>{
  const props=request.schema.properties as Record<string,any>|undefined;
  requests.push({systemHash:stableHash(request.system),schemaHash:stableHash(request.schema),contextHash:stableHash(request.prompt),maxOutputTokens:request.maxOutputTokens,allowedActions:props?.action?.enum??null});
  return base.streamStructured(request);
}};
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lls-live-evaluation-'));
const service=new AiService({provider,getSettings,budget,directory,automaticBackground:false});
const before=budget.snapshot(),attempts:Record<string,any>[]=[];
const evidence=path.resolve('../verification/npc-overhaul',`ai-conversation-${model}-${Date.now()}.json`);
function makeFrame(row:EvaluationCase,index:number){
  const armed=['threat','combat'].includes(row.category),position={x:100,y:-1900,z:20};
  return validateAiFrame({runtimeId:'synthetic-evaluation',sceneEpoch:`case-${index}`,gameVersion:'1.0.1158.16',sdkGameVersion:'2.0.1158.16',appliedNpcRevision:0,
    npcs:[{id:`synthetic-npc-${index}`,handle:100+index,modelHash:123,name:'Fictional adult resident',faction:'Civilian/Unknown',archetype:row.category==='bribe'?'Fictional security guard':'Street resident',position,health:150,alive:true,weapon:'Unarmed',distance:3,mind:{fear:armed?60:0,aggression:row.category==='combat'?65:10,morale:70,trust:50,respect:50,mood:armed?'alarmed':'calm',revision:0},recentDamage:0,recentEvents:[`Synthetic evaluation scene: ${row.scene}`.slice(0,160)],inCombat:row.category==='combat',identity:{clothing:[{slot:0,drawable:index,texture:0}],homeArea:'Davis',role:'synthetic evaluation resident'}}],
    player:{position,wantedLevel:0,weaponDrawn:armed,weaponDrawnName:armed?'Pistol':'Unarmed',stance:armed?'Aiming':'Casual',factionStandings:{},districtStandings:{}},environment:{district:'Davis',weather:'CLEAR',timeOfDay:'12:00',nearbyGunfire:row.category==='combat'},aiReceipts:[],aiOutcomes:[],aiMindOutcomes:[]});
}
function report(){const after=budget.snapshot(),successful=attempts.filter(a=>a.status==='completed'&&a.source==='gemini'),first=successful.flatMap(a=>typeof a.firstTextMs==='number'?[a.firstTextMs]:[]),total=successful.flatMap(a=>typeof a.durationMs==='number'?[a.durationMs]:[]);return {classification:'Measured synthetic production-pipeline evaluation; not native gameplay or audio evidence',at:new Date().toISOString(),model,datasetHash:stableHash(cases),productionRequestHashes:requests,settings:{liveMaxOutputTokens:config['ai.liveMaxOutputTokens'],maxSpeechCharacters:config['ai.maxSpeechCharacters'],maxInputTokensPerMinute:config['ai.maxInputTokensPerMinute'],automaticBackground:false},attempts,mechanicalPasses:attempts.filter(a=>a.score?.passed).length,totalCases:attempts.length,providerCompleted:successful.length,latency:{sampleCount:successful.length,method:'nearest-rank empirical percentiles; small synthetic sample',firstTextP50Ms:samplePercentile(first,.5),firstTextP95Ms:samplePercentile(first,.95),completionP50Ms:samplePercentile(total,.5),completionP95Ms:samplePercentile(total,.95),audioMeasured:false},usage:{paidRequests:after.requests-before.requests,estimatedUsd:after.spentEstimateUsd-before.spentEstimateUsd,dailyRemainingUsd:after.remainingUsd,tokenDelta:Object.fromEntries(['inputTokens','outputTokens','cachedTokens','thoughtTokens'].map(k=>[k,Number(after.usage[k as keyof typeof after.usage])-Number(before.usage[k as keyof typeof before.usage])])),priceVersion:after.priceVersion},qualitativeRubric:QUALITATIVE_RUBRIC,qualitativeReview:'pending independent review',gameActionsExecuted:false,rawMicrophoneUsed:false,productionSettingsOrMemoriesChanged:false,sharedSpendingLedgerUpdated:true};}
try{
  for(const [index,row] of cases.entries()){
    config={...config,'conversation.language':row.language};const frame=makeFrame(row,index),requestStart=requests.length;service.observe(frame);
    try{
      const pending=service.enqueue({requestId:randomUUID(),runtimeId:frame.runtimeId,sceneEpoch:frame.sceneEpoch,npcIds:[frame.npcs[0].id],kind:'conversation',lane:'A',context:{playerUtterance:inputForCase(row),trigger:`evaluation-${row.category}`,history:[]}});
      let job=service.job(pending.id),deadline=Date.now()+25000;
      while(['queued','running','streaming'].includes(job.status)&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,100));service.observe(frame);job=service.job(pending.id);}
      if(['queued','running','streaming'].includes(job.status))job=service.cancel(job.id);
      const score=scoreConversation(row,job.result,job.status,job.source,Number(config['ai.maxSpeechCharacters']));
      attempts.push({category:row.category,status:job.status,source:job.source,reasonCode:job.reasonCode??null,firstTextMs:job.firstTextMs??null,durationMs:job.durationMs??null,providerRequests:requests.length-requestStart,score,result:job.result??null});
      console.log(JSON.stringify({category:row.category,status:job.status,source:job.source,passed:score.passed,firstTextMs:job.firstTextMs??null,reasonCode:job.reasonCode??null}));
    }catch(error){attempts.push({category:row.category,status:'rejected',reasonCode:error instanceof AiError?error.code:'evaluation_error',providerRequests:requests.length-requestStart});}
    fs.mkdirSync(path.dirname(evidence),{recursive:true});fs.writeFileSync(evidence,JSON.stringify(report(),null,2));
  }
}finally{service.close();}
const final=report();fs.writeFileSync(evidence,JSON.stringify(final,null,2));console.log(JSON.stringify({file:evidence,mechanicalPasses:final.mechanicalPasses,totalCases:final.totalCases,estimatedUsd:final.usage.estimatedUsd,dailyRemainingUsd:final.usage.dailyRemainingUsd,qualitativeReview:final.qualitativeReview}));
if(final.mechanicalPasses!==cases.length)process.exitCode=1;
// Preserve isolated memory/receipt artifacts with the report path for diagnosis.
// They contain synthetic data only and are never loaded by the real companion.
