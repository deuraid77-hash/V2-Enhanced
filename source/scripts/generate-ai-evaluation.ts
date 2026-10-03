// Explicit paid synthetic test generation. Never imported by ordinary tests.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {GoogleGenAI} from '@google/genai';
import {readGeminiCredential} from '../server-lib/compatibility.ts';
import {GeminiProvider} from '../server-lib/ai-provider.ts';
import {AiBudget} from '../server-lib/ai-budget.ts';
import {AiScheduler} from '../server-lib/ai-scheduler.ts';
import {AiError,type StructuredResult} from '../server-lib/ai-types.ts';
import {DEFAULT_NPC_SETTINGS} from '../shared/settings.ts';
import {DATASET_SCHEMA,DATASET_SYSTEM,EVALUATION_CATEGORIES,stableHash,validateDataset} from '../test/evaluation/conversation-rubric.ts';

if(process.env.LLAI_RUN_LIVE_AI_EVALUATION!=='true')throw new Error('Explicit live evaluation flag required.');
const key=readGeminiCredential();if(!key)throw new Error('Private Gemini credential unavailable.');
const output=path.resolve('docs/evaluation/npc-conversation-cases-v1.json');
if(fs.existsSync(output))throw new Error('The versioned evaluation dataset already exists; preserve it for repeatable comparisons.');
const config={...DEFAULT_NPC_SETTINGS,'ai.maxRetries':0},getSettings=()=>config;
const ledger=path.join(process.env.LOCALAPPDATA!,'LivingLosSantos','Enhanced','ai-usage.json');
if(fs.existsSync(ledger)&&JSON.parse(fs.readFileSync(ledger,'utf8')).reservations?.length)throw new Error('Another evaluation or companion has active spending reservations.');
const budget=new AiBudget(ledger,getSettings),scheduler=new AiScheduler(getSettings);
const provider=new GeminiProvider(()=>new GoogleGenAI({apiKey:key,httpOptions:{timeout:18000}}),()=>true);
const model='gemini-3.5-flash-lite';
if(!(await provider.listModels()).some(m=>m.id===model&&m.available))throw new Error('Evaluation writer absent from authenticated model listing.');
const id=randomUUID(),before=budget.snapshot();
const prompt=JSON.stringify({task:'Generate nine short fictional player inputs, one per category, with a concise scene description. The multilingual case is Spanish. Keep scenario physically plausible; no real private information.',categories:EVALUATION_CATEGORIES});
let result:StructuredResult|undefined,reserved=false,started=false;
try{
  result=await scheduler.submit({id,lane:'B',sceneBound:false,scope:{runtimeId:'synthetic-evaluation',sceneEpoch:'dataset-v1',npcIds:[]},run:async signal=>{
    scheduler.admitProvider();budget.reserve({id,model,lane:'B',category:'evaluation-dataset',maxInputTokens:Buffer.byteLength(DATASET_SYSTEM+prompt+JSON.stringify(DATASET_SCHEMA),'utf8')+1024,maxOutputTokens:4096});reserved=true;budget.markStarted(id);started=true;
    const response=await provider.streamStructured({model,system:DATASET_SYSTEM,prompt,schema:DATASET_SCHEMA,maxOutputTokens:4096,signal});
    budget.record(id,response.usage.estimated?null:response.usage,{outcome:'completed',durationMs:response.durationMs,firstChunkMs:response.firstTextMs??undefined});reserved=false;scheduler.providerSucceeded();return response;
  }});
  const parsed=JSON.parse(result.text),normalizations:string[]=[];
  // Normalize only bounded synthetic fixture text; never modify output actions
  // or weaken the production NPC validator. Keep the original provider hash.
  if(Array.isArray(parsed?.cases))for(const row of parsed.cases)for(const [field,cap] of [['utterance',400],['scene',240]] as const)if(typeof row[field]==='string'&&row[field].length>cap){normalizations.push(`${row.category}.${field}:${row[field].length}->${cap}`);row[field]=row[field].slice(0,cap);}
  const cases=validateDataset(parsed),after=budget.snapshot();
  const document={format:'LivingLosSantos.synthetic-evaluation',version:1,classification:'VERIFIED AI-generated synthetic inputs; not gameplay evidence',createdAt:new Date().toISOString(),author:{provider:'gemini',model,systemHash:stableHash(DATASET_SYSTEM),schemaHash:stableHash(DATASET_SCHEMA),rawOutputHash:stableHash(result.text),normalizations,usage:result.usage,firstTextMs:result.firstTextMs,durationMs:result.durationMs,estimatedUsd:after.spentEstimateUsd-before.spentEstimateUsd},cases};
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(document,null,2),{flag:'wx'});
  console.log(JSON.stringify({success:true,file:output,cases:cases.length,datasetHash:stableHash(cases),estimatedUsd:document.author.estimatedUsd,dailyRemainingUsd:after.remainingUsd}));
}catch(error){
  if(reserved){if(started)budget.record(id,error instanceof AiError?error.usage??null:null,{outcome:'failed',durationMs:0});else budget.release(id);}
  if(result){const failed=path.resolve('../verification/npc-overhaul',`evaluation-writer-failure-${Date.now()}.json`);fs.mkdirSync(path.dirname(failed),{recursive:true});fs.writeFileSync(failed,JSON.stringify({classification:'Synthetic evaluation output rejected; no game action',result,validationError:error instanceof AiError&&error.code==='invalid_payload'?error.message:'Dataset requirements not met'},null,2),{flag:'wx'});}
  console.error(JSON.stringify({success:false,code:error instanceof AiError?error.code:'evaluation_generation_failed',validation:error instanceof AiError&&error.code==='invalid_payload'?error.message:'Dataset requirements not met',note:'Any started request remains in the shared spending ledger. No fixture was silently replaced.'}));process.exitCode=1;
}finally{scheduler.cancelAll();}
