import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createDiagnosticReport,writeDiagnosticReport} from '../server-lib/diagnostics.ts';
test('diagnostics exclude arbitrary private text even when inserted into plausible metadata fields',()=>{
 const secret='PRIVATE-CANARY-DO-NOT-EXPORT';
 const result=createDiagnosticReport({settings:{revision:5,settings:{'conversation.language':secret,'ai.liveModel':secret,'audio.masterVolume':0.5}},world:{connected:true,telemetry:{protocol:4,pluginVersion:'4.0.0',gameFileVersion:'1.0.1158.16',gameVersion:'2.0.1158.16',npcs:[{name:secret,persona:secret}],events:[{message:secret}],npcRuntime:{lastError:secret,tick:{p95Ms:0.7,sampleCount:240,rawText:secret}}}},ai:{key:secret,prompt:secret,error:secret,provider:'gemini',budget:{dailyLimitUsd:5,spentEstimateUsd:0.03,dayTimezone:'Australia/Sydney',usage:{inputTokens:30,outputTokens:10},secret}},audio:{transcripts:[secret],deviceName:secret,capabilities:{playback:true,capture:false}}});
 assert.equal(JSON.stringify(result).includes(secret),false);assert.equal(result.versions.executable,'1.0.1158.16');assert.equal(result.game.trackedNpcs,1);assert.equal(result.audio.playback,true);assert.equal(result.settings.configuration['audio.masterVolume'],0.5);
 assert.equal((result.game.metrics.tick as any).p95Ms,0.7);
});
test('diagnostic export writes a bounded unique file without exposing full user paths in response',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lls4-diagnostics-'));try{
  const report=createDiagnosticReport({});const saved=writeDiagnosticReport(root,report);assert.equal(saved.sha256.length,64);assert.equal(fs.statSync(path.join(root,saved.filename)).size,saved.bytes);assert.equal(JSON.stringify(saved).includes(root),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('diagnostics use protocol4 metadata rather than its compatibility mirror',()=>{
 const report=createDiagnosticReport({world:{connected:true,telemetry:{protocol:3,pluginVersion:'4.0.0-foundation-enhanced',gameVersion:'1.0.1158.16',appliedRevision:2,npcs:[]}},ai:{capabilities:{provider:'gemini'},runtime:{protocol:4,gameFileVersion:'1.0.1158.16',sdkGameVersion:'2.0.1158.16',appliedNpcRevision:7,tickMetrics:{p95Ms:0.4,sampleCount:240}}}});
 assert.equal(report.versions.protocol,4);assert.equal(report.versions.executable,'1.0.1158.16');assert.equal(report.versions.sdk,'2.0.1158.16');assert.equal(report.game.npcSettingsRevision,7);assert.equal(report.ai.provider,'gemini');assert.equal((report.game.metrics.tick as any).p95Ms,0.4);
});
