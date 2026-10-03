import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { SettingsStore } from '../server-lib/settings-store.ts';
import { installSettingsRoutes } from '../server-lib/settings-routes.ts';

test('settings HTTP preserves explicit revision conflicts and profile mutations',async()=>{
 const app=express();app.use(express.json({limit:'300kb'}));const store=new SettingsStore();installSettingsRoutes(app,store);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const address=server.address();assert.ok(address&&typeof address!=='string');const root=`http://127.0.0.1:${address.port}`;
 async function request(url:string,method='GET',body?:unknown){const result=await fetch(root+url,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:result.status,value:await result.json() as any};}
 try {
  const original=await request('/api/settings');assert.equal(original.status,200);assert.equal(original.value.revision,1);assert.ok(original.value.catalog.length>=120);
  const apply=await request('/api/settings','PATCH',{source:'game',expectedRevision:1,settings:{'audio.masterVolume':0.2}});assert.equal(apply.value.revision,2);
  const stale=await request('/api/settings','PATCH',{source:'portal',expectedRevision:1,settings:{'audio.masterVolume':1}});assert.equal(stale.status,409);
  assert.equal((await request('/api/settings')).value.settings['audio.masterVolume'],0.2);
  assert.equal((await request('/api/settings','PATCH',{source:'portal',settings:{'ai.dailyBudgetUsd':6}})).status,400);
  assert.equal((await request('/api/settings','PATCH',{source:'fake',settings:{'audio.enabled':false}})).status,400);
  await request('/api/profiles','POST',{name:'Night mode'});
  const exported=await request('/api/profiles/Night%20mode/export');assert.equal(exported.value.profile.format,'LivingLosSantos.profile');
  await request('/api/profiles/Night%20mode','PATCH',{name:'My night'});
  assert.equal((await request('/api/profiles/My%20night/apply','POST',{expectedRevision:1})).status,409);
  assert.equal((await request('/api/profiles/My%20night','DELETE')).status,200);
  const imported=await request('/api/profiles/import','POST',{profile:exported.value.profile});assert.ok(imported.value.profiles.some((p:any)=>p.name==='Night mode'));
  assert.equal((await request('/api/profiles/Chaos','DELETE')).status,400);
 } finally {server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
