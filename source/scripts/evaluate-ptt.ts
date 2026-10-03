// Explicit paid evaluation using only the hash-bound synthetic Windows speech fixture.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {GoogleGenAI} from '@google/genai';
import {readGeminiCredential} from '../server-lib/compatibility.ts';
import {GeminiProvider} from '../server-lib/ai-provider.ts';
import {AiBudget} from '../server-lib/ai-budget.ts';
import {AiScheduler} from '../server-lib/ai-scheduler.ts';
import {AiError} from '../server-lib/ai-types.ts';
import {PttService} from '../server-lib/ptt.ts';
import {GeminiTranscriptionProvider} from '../server-lib/ptt-provider.ts';
import type {CaptureHost,TranscriptionResult} from '../server-lib/ptt-types.ts';
import {DEFAULT_NPC_SETTINGS} from '../shared/settings.ts';

if(process.env.LLAI_RUN_LIVE_AI_EVALUATION!=='true')throw new Error('Explicit live evaluation flag required.');
const directory=path.resolve('../verification/npc-overhaul');
const manifest=JSON.parse(fs.readFileSync(path.join(directory,'synthetic-ptt.json'),'utf8').replace(/^\uFEFF/,''));
const wav=fs.readFileSync(path.join(directory,'synthetic-ptt.wav'));
const expected='Hello, I am looking for a quiet place to park near Grove Street.';
if(manifest.text!==expected||manifest.source!=='Windows System.Speech'||manifest.microphoneOpened!==false||manifest.speakerPlayback!==false||createHash('sha256').update(wav).digest('hex')!==manifest.sha256)throw new Error('Only the known synthetic speech fixture is allowed.');
if(wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')throw new Error('Fixture must be a WAV file.');
let format=false,pcm:Buffer|undefined;
for(let offset=12;offset+8<=wav.length;){const type=wav.toString('ascii',offset,offset+4),size=wav.readUInt32LE(offset+4),start=offset+8;if(start+size>wav.length)throw new Error('Truncated WAV chunk.');if(type==='fmt '){if(size<16||wav.readUInt16LE(start)!==1||wav.readUInt16LE(start+2)!==1||wav.readUInt32LE(start+4)!==16000||wav.readUInt16LE(start+14)!==16)throw new Error('Fixture must be mono PCM16 at16kHz.');format=true;}if(type==='data')pcm=Buffer.from(wav.subarray(start,start+size));offset=start+size+(size%2);}
if(!format||!pcm||pcm.length<8000||pcm.length>640000)throw new Error('Fixture PCM is missing or out of bounds.');
const samples=pcm;let squares=0;for(let i=0;i<samples.length;i+=2)squares+=(samples.readInt16LE(i)/32768)**2;
const rms=Math.sqrt(squares/(samples.length/2)),durationMs=samples.length/32;
const key=readGeminiCredential();if(!key)throw new Error('Private Gemini credential unavailable.');
const ledger=path.join(process.env.LOCALAPPDATA!,'LivingLosSantos','Enhanced','ai-usage.json');
if(fs.existsSync(ledger)&&JSON.parse(fs.readFileSync(ledger,'utf8')).reservations?.length)throw new Error('Another provider evaluation is in progress.');
const settings={...DEFAULT_NPC_SETTINGS,'conversation.pushToTalk':true,'audio.micMaxSeconds':20};
const getSettings=()=>settings,budget=new AiBudget(ledger,getSettings),scheduler=new AiScheduler(getSettings);
const client=()=>new GoogleGenAI({apiKey:key,httpOptions:{timeout:18000}}),provider=new GeminiTranscriptionProvider(client,()=>true);
if(!(await new GeminiProvider(client,()=>true).listModels()).some(m=>m.id===provider.model&&m.available))throw new Error('Transcription model is not listed for this account.');
const host:CaptureHost={devices:async()=>[],start:async()=>({deviceId:'synthetic-file',deviceName:'Windows synthesis fixture; no microphone'}),focus:async()=>({valid:true}),lease:async()=>({state:'capturing'}),stop:async()=>({pcm:Buffer.from(samples),durationMs,rms}),cancel:async()=>{},close:async()=>{}};
let observed:TranscriptionResult|undefined,failure:AiError|undefined;
const service=new PttService({host,provider:{model:provider.model,configured:()=>true,transcribe:async input=>{try{observed=await provider.transcribe(input);return observed;}catch(error){if(error instanceof AiError)failure=error;throw error;}}},getSettings,budget,scheduler,validateTarget:()=>({scope:{runtimeId:'synthetic-ptt-evaluation',sceneEpoch:'fixture',npcIds:['fixture-npc']}})});
const before=budget.snapshot(),started=performance.now();let outcome:Record<string,unknown>;
try{
  let receipt=service.start({requestId:randomUUID(),runtimeId:'synthetic-ptt-evaluation',sceneEpoch:'fixture',npcId:'fixture-npc',expectedHandle:10,expectedModelHash:123});
  const startDeadline=Date.now()+3000;while(receipt.state==='starting'&&Date.now()<startDeadline){await new Promise(resolve=>setTimeout(resolve,10));receipt=service.get(receipt.id);}
  if(receipt.state!=='capturing')throw new AiError('fixture_start_failed','Synthetic capture did not start.');
  receipt=service.stop(receipt.id,{requestId:randomUUID()});const deadline=Date.now()+23000;
  while(['stopping','transcribing'].includes(receipt.state)&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,50));receipt=service.get(receipt.id);}
  if(receipt.state!=='ready')throw new AiError(receipt.reasonCode||'evaluation_timeout','Synthetic transcription did not complete.');
  const result=await service.result(receipt.id),words=(value:string)=>value.toLowerCase().replace(/[^a-z0-9 ]/g,'').split(/\s+/).filter(Boolean);
  const expectedWords=words(expected),actualWords=words(result.text);let row=Array.from({length:actualWords.length+1},(_,i)=>i);
  for(let i=1;i<=expectedWords.length;i++){const next=[i];for(let j=1;j<=actualWords.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+Number(expectedWords[i-1]!==actualWords[j-1]));row=next;}
  const edits=row[actualWords.length],wer=edits/expectedWords.length;
  outcome={state:receipt.state,source:result.source,language:result.language,text:result.text,wordErrors:edits,wordErrorRate:wer,passed:wer<=.1};
}catch(error){outcome={state:'failed',reasonCode:error instanceof AiError?error.code:'evaluation_error',passed:false};}
finally{await service.close();samples.fill(0);wav.fill(0);}
const after=budget.snapshot();
const report={classification:'VERIFIED synthetic file transcription through production PTT service; no physical microphone, game input or audible playback',at:new Date().toISOString(),model:provider.model,fixtureSha256:manifest.sha256,fixtureVoice:manifest.voice,expectedText:expected,clipDurationMs:durationMs,outcome,providerDurationMs:observed?.durationMs??failure?.durationMs??null,endToEndMs:performance.now()-started,usage:observed?.usage??failure?.usage??null,cost:{estimatedUsd:after.spentEstimateUsd-before.spentEstimateUsd,dailyRemainingUsd:after.remainingUsd,paidRequests:after.requests-before.requests,priceVersion:after.priceVersion},microphoneOpened:false,speakerPlayback:false,gameActionsExecuted:false,productionSettingsOrMemoriesChanged:false,sharedSpendingLedgerUpdated:true};
const file=path.join(directory,`ptt-provider-${Date.now()}.json`);fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify({file,...outcome,estimatedUsd:report.cost.estimatedUsd,dailyRemainingUsd:report.cost.dailyRemainingUsd}));
if(!outcome.passed)process.exitCode=1;
