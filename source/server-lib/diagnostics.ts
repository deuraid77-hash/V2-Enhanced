import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { SETTINGS_CATALOG } from '../shared/settings.ts';

function object(value: unknown): Record<string,unknown> {return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function number(value: unknown): number|null {return typeof value==='number'&&Number.isFinite(value)?value:null;}
function version(value: unknown) {return typeof value==='string'&&/^\d{1,5}(?:\.\d{1,6}){1,3}(?:-[a-z0-9-]{1,32})?$/.test(value)?value:null;}
// Deliberately whitelist fields instead of trying to redact arbitrary prompt/log text.
function numericMetrics(value: unknown, depth=0): Record<string,unknown> {
 if(depth>3)return {};
 const input=object(value),out:Record<string,unknown>={};
 const keys=['running','queued','requests','cancelled','completed','failed','rejected','cacheHits','cacheMisses','cacheHitRate','sampleCount','p50Ms','p95Ms','lastMs','maxMs','meanMs','averageMs','deferred','directorMs','npcAndTransportMs','gameFrameMs','voices','activeVoices','trackedNpcs','bytes','entries','files','dailyLimitUsd','spentEstimateUsd','reservedEstimateUsd','remainingUsd','sessionSpentEstimateUsd','unknownUsageRequests','inputTokens','outputTokens','cachedTokens','thoughtTokens','totalTokens','failures','A','B','C','D'];
 for(const key of keys)if(typeof input[key]==='number'&&Number.isFinite(input[key]))out[key]=input[key];
 for(const key of ['usage','budget','scheduler','latency','firstAudio','firstChunk','metrics','tick','cache','byLane','breaker'])if(input[key]&&typeof input[key]==='object')out[key]=numericMetrics(input[key],depth+1);
 return out;
}
export function createDiagnosticReport(input: {settings?:unknown;world?:unknown;ai?:unknown;audio?:unknown},now=new Date()) {
 const settings=object(input.settings),values=object(settings.settings),world=object(input.world),telemetry=object(world.telemetry),npcRuntime=object(telemetry.npcRuntime),audio=object(input.audio),ai=object(input.ai),aiRuntime=object(ai.runtime),provider=object(ai.capabilities).provider??ai.provider;
 const configuration:Record<string,unknown>={};
 for(const descriptor of SETTINGS_CATALOG) {
  const value=values[descriptor.key];
  if(descriptor.type==='text')configuration[descriptor.key]='[text omitted]';
  else if(descriptor.type==='boolean'&&typeof value==='boolean')configuration[descriptor.key]=value;
  else if(descriptor.type==='number'&&typeof value==='number'&&Number.isFinite(value))configuration[descriptor.key]=value;
  else if(descriptor.options?.includes(String(value)))configuration[descriptor.key]=value;
 }
 return {format:'LivingLosSantos.sanitized-diagnostics',version:4,createdAt:now.toISOString(),
  privacy:'No keys, player utterances, transcripts, microphone data, persona text, raw errors or file paths are included.',
  versions:{node:process.version,platform:process.platform,architecture:process.arch,protocol:number(aiRuntime.protocol??telemetry.protocol),plugin:version(telemetry.pluginVersion),executable:version(aiRuntime.gameFileVersion??telemetry.gameFileVersion??telemetry.gameVersion),sdk:version(aiRuntime.sdkGameVersion??telemetry.sdkGameVersion)},
  settings:{revision:number(settings.revision),configuration},
  game:{connected:world.connected===true,trackedNpcs:Array.isArray(telemetry.npcs)?telemetry.npcs.length:0,appliedRevision:number(telemetry.appliedRevision),npcSettingsRevision:number(aiRuntime.appliedNpcRevision??telemetry.appliedNpcRevision??npcRuntime.appliedSettingsRevision),metrics:numericMetrics({...npcRuntime,tick:aiRuntime.tickMetrics??telemetry.tickMetrics??npcRuntime.tick})},
  ai:{metrics:numericMetrics(ai),provider:['gemini','offline'].includes(String(provider))?provider:null,priceVersion:/^google-standard-usd-\d{4}-\d{2}-\d{2}$/.test(String(object(ai.budget).priceVersion))?object(ai.budget).priceVersion:null,dayTimezone:object(ai.budget).dayTimezone==='Australia/Sydney'?'Australia/Sydney':'UTC'},
  audio:{metrics:numericMetrics(audio),available:audio.available===true,playback:object(audio.capabilities).playback===true,microphone:object(audio.capabilities).capture===true},
  certification:'not certified in the game',
 };
}
export function writeDiagnosticReport(directory:string,report:ReturnType<typeof createDiagnosticReport>) {
 const root=path.resolve(directory),filename=`diagnostics-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}.json`,file=path.join(root,filename);
 const bytes=Buffer.from(JSON.stringify(report,null,2));
 if(bytes.length>256*1024)throw new Error('Diagnostic report exceeds its size limit.');
 fs.mkdirSync(root,{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});
 return {filename,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
