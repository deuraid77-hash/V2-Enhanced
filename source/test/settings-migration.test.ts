import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DEFAULT_NPC_SETTINGS,STEP3_ADDED_SETTINGS,migrateSavedNpcSettings,type NpcSettings} from '../shared/settings.ts';
import {SettingsStore} from '../server-lib/settings-store.ts';
import {DEFAULT_SETTINGS} from '../server-lib/world.ts';

function step2(){const old:NpcSettings={...DEFAULT_NPC_SETTINGS,'audio.masterVolume':0.4,'ai.dailyBudgetUsd':3};for(const key of STEP3_ADDED_SETTINGS)delete old[key];return old;}
test('only the exact known Step 2 additive settings migration is permitted',()=>{
  const old=step2(),upgraded=migrateSavedNpcSettings(old);
  assert.equal(upgraded['audio.masterVolume'],0.4);assert.equal(upgraded['ai.dailyBudgetUsd'],3);
  assert.equal(upgraded['safety.allowPoliceResponse'],true);assert.equal(upgraded['safety.maxPoliceResponseWanted'],1);
  const incomplete={...old};delete incomplete['general.enabled'];assert.throws(()=>migrateSavedNpcSettings(incomplete),/Incomplete/);
  assert.throws(()=>migrateSavedNpcSettings({...old,'unknown.hidden':true}),/Unsupported/);
  assert.throws(()=>migrateSavedNpcSettings({...old,'safety.allowPoliceResponse':true}),/Incomplete/);
});
test('saved Step 2 settings and custom profiles retain user values and original bytes on load',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lls-settings-migration-')),file=path.join(dir,'settings.json');
  try{
    const original=JSON.stringify({version:4,snapshot:{revision:7,settings:step2(),source:'portal',updatedAt:'2026-10-03T10:00:00Z'},profiles:[{name:'My prior setup',settings:step2(),worldSettings:DEFAULT_SETTINGS,updatedAt:'2026-10-03T10:00:00Z'}],world:{revision:4,settings:{...DEFAULT_SETTINGS,gangAggression:44},source:'game',updatedAt:'2026-10-03T10:00:00Z'}});
    fs.writeFileSync(file,original);const store=new SettingsStore(file);
    assert.equal(store.recovery,null);assert.equal(store.snapshot().revision,7);assert.equal(store.snapshot().settings['ai.dailyBudgetUsd'],3);
    assert.equal(store.snapshot().world.settings.gangAggression,44);assert.equal(store.exportProfile('My prior setup').settings['safety.maxPoliceResponseWanted'],1);
    assert.equal(fs.readFileSync(file,'utf8'),original);assert.deepEqual(fs.readdirSync(dir),['settings.json']);
    store.configure({'general.hints':false},'game',7);
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).snapshot.settings['safety.allowPoliceResponse'],true);
    assert.equal(fs.readFileSync(file+'.bak','utf8'),original);
  }finally{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(dir).startsWith('lls-settings-migration-'));fs.rmSync(dir,{recursive:true,force:true});}
});
test('Step 2 profile import adds only known new defaults while preserving both scopes',()=>{
  const store=new SettingsStore();store.importProfile({format:'LivingLosSantos.profile',version:4,name:'Old export',settings:step2(),worldSettings:{...DEFAULT_SETTINGS,ambientHostility:33}});
  const profile=store.exportProfile('Old export');assert.equal(profile.settings['audio.masterVolume'],0.4);assert.equal(profile.settings['safety.maxPoliceResponseWanted'],1);assert.equal(profile.worldSettings.ambientHostility,33);
});
