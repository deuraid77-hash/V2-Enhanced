import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {SettingsStore} from '../server-lib/settings-store.ts';
import {DEFAULT_SETTINGS,WorldState} from '../server-lib/world.ts';
import {installSettingsRoutes} from '../server-lib/settings-routes.ts';
import {installWorldRoutes} from '../server-lib/world-routes.ts';
import {WORLD_MENU_CATALOG} from '../shared/world-settings.ts';

function fixture(run:(dir:string)=>void) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lls-bundle-'));
  try {run(dir);}finally {fs.rmSync(dir,{recursive:true,force:true});}
}

test('V4 migrates current director settings once and preserves the V3 rollback file',()=>fixture(dir=>{
  const legacy=path.join(dir,'world-settings.json');
  fs.writeFileSync(legacy,JSON.stringify({revision:18,settings:{...DEFAULT_SETTINGS,ambientHostility:22}}));
  const original=fs.readFileSync(legacy,'utf8');
  const file=path.join(dir,'npc-settings.json'),store=new SettingsStore(file),world=new WorldState(legacy);
  store.bindWorld(world);
  assert.equal(store.snapshot().world.revision,18);
  assert.equal(store.snapshot().world.settings.ambientHostility,22);
  world.configure({settings:{ambientHostility:35},expectedRevision:18,source:'game'});
  assert.equal(store.snapshot().world.source,'game');
  assert.equal(store.snapshot().world.revision,19);
  assert.equal(world.snapshot().config.settings.ambientHostility,35);
  assert.equal(fs.readFileSync(legacy,'utf8'),original);
  const restored=new SettingsStore(file), restoredWorld=new WorldState(legacy);restored.bindWorld(restoredWorld);
  assert.equal(restoredWorld.snapshot().config.revision,19);
  assert.equal(restoredWorld.snapshot().config.settings.ambientHostility,35);
}));

test('profiles carry NPC and all fourteen director settings through save/export/import/reload',()=>fixture(dir=>{
  const store=new SettingsStore(path.join(dir,'settings.json')),world=new WorldState();store.bindWorld(world);
  store.configure({'audio.masterVolume':0.4},'portal');
  world.configure({settings:{gangAggression:31,eventIntervalSeconds:185},expectedRevision:1});
  store.saveProfile('My streets');
  const profile=store.exportProfile('My streets');
  assert.equal(Object.keys(profile.worldSettings).length,14);
  assert.equal(profile.worldSettings.gangAggression,31);
  const restored=new SettingsStore(path.join(dir,'settings.json'));
  assert.deepEqual(restored.exportProfile('My streets'),profile);
  const imported=new SettingsStore();imported.importProfile(profile);
  assert.throws(()=>imported.importProfile(profile),/already exists/);
  imported.applyProfile('My streets',1,1);
  assert.equal(imported.snapshot().settings['audio.masterVolume'],0.4);
  assert.equal(imported.snapshot().world.settings.eventIntervalSeconds,185);
  assert.throws(()=>imported.importProfile({...profile,worldSettings:undefined}),/no world settings/);
}));

test('combined validation and both revision guards reject whole proposal without partial changes',()=>{
  const store=new SettingsStore(),world=new WorldState();store.bindWorld(world);
  assert.throws(()=>store.configureBundle({'audio.enabled':false},{maxSpawnedPeds:100},'advisor',1,1));
  assert.throws(()=>store.configureBundle({'controls.menuKey':'F7'},{ambientHostility:10},'advisor',1,1));
  assert.equal(store.snapshot().revision,1);assert.equal(world.snapshot().config.revision,1);
  const preview=store.previewBundle({'audio.enabled':false},{ambientHostility:10});
  assert.equal(preview.settings['audio.enabled'],false);assert.equal(store.snapshot().settings['audio.enabled'],true);
  world.configure({settings:{ambientHostility:20},expectedRevision:1});
  assert.throws(()=>store.configureBundle({'audio.enabled':false},{ambientHostility:10},'advisor',1,1),/changed elsewhere/);
  assert.equal(store.snapshot().settings['audio.enabled'],true);assert.equal(world.snapshot().config.settings.ambientHostility,20);
  assert.throws(()=>world.configure({settings:{ambientHostility:30},expectedRevision:1}),/changed elsewhere/);
});

test('a combined save failure publishes neither revision and preserves disk plus runtime settings',()=>fixture(dir=>{
  const file=path.join(dir,'settings.json'),store=new SettingsStore(file),world=new WorldState();store.bindWorld(world);
  const bytes=fs.readFileSync(file,'utf8'),prior=store.snapshot();let notifications=0;store.subscribe(()=>notifications++);
  fs.mkdirSync(file+'.bak'); // deterministic failure before replacement of the saved document
  assert.throws(()=>store.applyProfile('Chaos',1,1),/previous revision/);
  assert.deepEqual(store.snapshot(),prior);assert.equal(world.snapshot().config.revision,1);
  assert.equal(fs.readFileSync(file,'utf8'),bytes);assert.equal(notifications,0);
  assert.ok(fs.readdirSync(dir).every(n=>!n.endsWith('.tmp')));
}));

test('Chill and Chaos really alter existing street and gang intensity and complete profile publishes once',()=>{
  const store=new SettingsStore(),world=new WorldState();store.bindWorld(world);let observed=0;
  store.subscribe(()=>{observed++;assert.equal(world.snapshot().config.revision,store.snapshot().world.revision);});
  const chill=store.applyProfile('Chill',1,1);
  assert.equal(chill.world.settings.ambientHostility,15);assert.equal(chill.world.settings.gangAggression,25);
  assert.equal(observed,1);
  const chaos=store.applyProfile('Chaos',chill.revision,chill.world.revision);
  assert.equal(chaos.world.settings.ambientHostility,90);assert.equal(chaos.world.settings.gangAggression,95);
  assert.equal(chaos.world.settings.maxActiveEvents,3);assert.equal(observed,2);
  const unchanged=store.applyProfile('Chaos',chaos.revision,chaos.world.revision);
  assert.equal(unchanged.revision,chaos.revision);assert.equal(unchanged.world.revision,chaos.world.revision+1);
});

test('all fourteen world catalog entries match validated defaults and original bounds',()=>{
  assert.equal(WORLD_MENU_CATALOG.length,14);
  const world=new WorldState();
  for(const entry of WORLD_MENU_CATALOG){
    const key=entry.key.slice(6) as keyof typeof DEFAULT_SETTINGS;
    assert.equal(entry.default,DEFAULT_SETTINGS[key]);assert.ok(entry.tooltip.length>20);
    if(entry.type==='number'){
      assert.throws(()=>world.configure({settings:{[key]:entry.min!-1}}));
      assert.throws(()=>world.configure({settings:{[key]:entry.max!+1}}));
      assert.throws(()=>world.configure({settings:{[key]:entry.min!+0.5}}));
    }
  }
});

test('profile HTTP applies both snapshots and source atomically and refuses stale world previews',async()=>{
  const app=express();app.use(express.json());const store=new SettingsStore(),world=new WorldState();store.bindWorld(world);
  installSettingsRoutes(app,store);installWorldRoutes(app,world);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const request=async(url:string,method='GET',body?:unknown)=>{const response=await fetch(`http://127.0.0.1:${address.port}${url}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,value:await response.json() as any};};
  try {
    const compact=await request('/api/settings?catalog=false');assert.equal(compact.value.catalog,undefined);assert.equal(compact.value.world.revision,1);
    const preview=await request('/api/profiles/Chill/export');assert.equal(preview.value.profile.worldSettings.ambientHostility,15);
    const applied=await request('/api/profiles/Chill/apply','POST',{expectedRevision:1,expectedWorldRevision:1});
    assert.equal(applied.status,200);assert.equal(applied.value.world.source,'profile');assert.equal(applied.value.world.revision,2);
    const current=await request('/api/world');assert.equal(current.value.config.settings.ambientHostility,15);
    assert.equal((await request('/api/profiles/Chaos/apply','POST',{expectedRevision:applied.value.revision,expectedWorldRevision:1})).status,409);
    assert.equal((await request('/api/world/config','PATCH',{settings:{gangAggression:40},source:'game',expectedRevision:1})).status,409);
    assert.equal((await request('/api/world/config','PATCH',{settings:{gangAggression:40},source:'game',expectedRevision:2})).status,200);
    assert.equal((await request('/api/settings?catalog=false')).value.world.source,'game');
    const native=await request('/api/world/config?compact=true','PATCH',{settings:{gangAggression:41},source:'game',expectedRevision:3});
    assert.equal(native.status,200);assert.deepEqual(Object.keys(native.value).sort(),['config','success']);
    assert.equal(native.value.config.revision,4);assert.equal(native.value.config.settings.gangAggression,41);
  }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
