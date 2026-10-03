import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import express from 'express';
import {createDiagnosticReport} from '../server-lib/diagnostics.ts';
import {installDiagnosticRoutes} from '../server-lib/diagnostic-routes.ts';

async function fixture(run:(root:string,dir:string,setUnavailable:()=>void)=>Promise<void>) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lls-diag-http-')),app=express();app.use(express.json());let fail=false;
  installDiagnosticRoutes(app,dir,()=>{if(fail)throw new Error('PRIVATE-CREDENTIAL-CANARY');return createDiagnosticReport({settings:{revision:2},ai:{rawError:'PRIVATE-CREDENTIAL-CANARY'}});});
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();assert.ok(address&&typeof address!=='string');
  try {await run(`http://127.0.0.1:${address.port}`,dir,()=>{fail=true;});}
  finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));fs.rmSync(dir,{recursive:true,force:true});}
}
const post=(url:string,body:unknown={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

test('diagnostic HTTP export matches native filename/size/hash contract and excludes private data',()=>fixture(async(root,dir)=>{
  const response=await post(root+'/api/diagnostics/export');assert.equal(response.status,200);const result=await response.json() as any;
  assert.deepEqual(Object.keys(result).sort(),['bytes','filename','sha256','success']);assert.equal(result.success,true);
  const data=fs.readFileSync(path.join(dir,result.filename));assert.equal(result.bytes,data.length);assert.equal(result.sha256,createHash('sha256').update(data).digest('hex'));
  assert.equal(JSON.stringify(result).includes(dir),false);assert.equal(data.includes('PRIVATE-CREDENTIAL-CANARY'),false);
  const read=await fetch(root+'/api/diagnostics');assert.equal(read.status,200);const document=await read.json() as any;assert.equal(document.report.settings.revision,2);
  assert.equal((await post(root+'/api/diagnostics/export',{privateText:'refused'})).status,400);
}));

test('diagnostic HTTP errors remain sanitized and export cap preserves every prior file',()=>fixture(async(root,dir,setUnavailable)=>{
  for(let i=0;i<32;i++)assert.equal((await post(root+'/api/diagnostics/export')).status,200);
  const limit=await post(root+'/api/diagnostics/export');assert.equal(limit.status,409);assert.equal((await limit.json() as any).code,'diagnostic_export_limit');assert.equal(fs.readdirSync(dir).length,32);
  setUnavailable();const read=await fetch(root+'/api/diagnostics');assert.equal(read.status,503);assert.ok(!(await read.text()).includes('PRIVATE-CREDENTIAL-CANARY'));
  const write=await post(root+'/api/diagnostics/export');assert.equal(write.status,500);assert.ok(!(await write.text()).includes('PRIVATE-CREDENTIAL-CANARY'));
}));
