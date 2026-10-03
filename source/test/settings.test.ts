import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BUILTIN_PROFILES, DEFAULT_NPC_SETTINGS, SETTINGS_CATALOG, validateNpcSettings } from '../shared/settings.ts';
import { SettingsStore } from '../server-lib/settings-store.ts';

function fixture(run:(dir:string)=>void) {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lls4-settings-'));try {run(dir);}finally {fs.rmSync(dir,{recursive:true,force:true});}}
test('catalogue defines unique bounded settings and user-authorized combined $5 budget',()=>{
 assert.ok(SETTINGS_CATALOG.length>=120);assert.equal(new Set(SETTINGS_CATALOG.map(s=>s.key)).size,SETTINGS_CATALOG.length);
 assert.equal(DEFAULT_NPC_SETTINGS['ai.dailyBudgetUsd'],5);
 for(const s of SETTINGS_CATALOG){assert.ok(s.tooltip.length>20);assert.ok(s.consumer);assert.deepEqual(validateNpcSettings({[s.key]:s.default}),{[s.key]:s.default});}
});
test('every numeric and option setting rejects out-of-bounds values and every boolean rejects coercion',()=>{
 for(const s of SETTINGS_CATALOG){
  if(s.type==='number'){for(const value of [s.min!-1,s.max!+1,NaN,Infinity,'1'])assert.throws(()=>validateNpcSettings({[s.key]:value}),s.key);}
  if(s.type==='select')assert.throws(()=>validateNpcSettings({[s.key]:'unsupported-option'}));
  if(s.type==='boolean')assert.throws(()=>validateNpcSettings({[s.key]:'true'}));
 }
 assert.throws(()=>validateNpcSettings({'unknown':true}));assert.throws(()=>validateNpcSettings({'controls.menuKey':'F4'}));
 assert.throws(()=>validateNpcSettings({'conversation.language':'~r~Injected'}));
 assert.throws(()=>validateNpcSettings({'ai.liveModel':'../../secret'}));
});
test('later accepted revision wins and stale advisor or menu edit cannot overwrite it',()=>{
 const store=new SettingsStore();const initial=store.snapshot();
 const menu=store.configure({'audio.masterVolume':0.5},'game',initial.revision);
 assert.equal(menu.revision,2);assert.equal(menu.source,'game');
 assert.throws(()=>store.configure({'audio.masterVolume':1},'advisor',1),/changed elsewhere/);
 assert.equal(store.snapshot().settings['audio.masterVolume'],0.5);
 const portal=store.configure({'audio.masterVolume':0.7},'portal',2);assert.equal(portal.revision,3);
 assert.equal(store.configure({'audio.masterVolume':0.7},'portal',3).revision,3);
});
test('cross-setting consistency rejects invalid input without applying any partial values',()=>{
 const store=new SettingsStore();for(const patch of [
  {'ai.maxConcurrent':1,'ai.liveReservedSlots':2},
  {'conversation.rangeMeters':10,'conversation.walkAwayMeters':5},
  {'audio.maxDistanceMeters':5,'audio.referenceDistanceMeters':10},
  {'bank.maxLinesPerBucket':4,'bank.refillThreshold':10},
  {'controls.menuKey':'F7'},
  {'controls.controllerTalk':52},
  {'controls.menuModifier':236},
  {'controls.controllerPtt':235},
  {'controls.controllerWheel':219},
  {'controls.menuModifier':232},
  {'ai.liveMaxOutputTokens':512.5},
 ]) {assert.throws(()=>store.configure(patch,'portal'));assert.equal(store.snapshot().revision,1);}
});
test('settings persist full snapshot atomically, retain previous backup, and reload profiles',()=>fixture(dir=>{
 const file=path.join(dir,'settings.json'),store=new SettingsStore(file);
 store.configure({'audio.enabled':false},'portal');store.saveProfile('My Quiet');
 store.configure({'audio.enabled':true},'game');
 assert.ok(fs.existsSync(file+'.bak'));const reloaded=new SettingsStore(file);
 assert.equal(reloaded.snapshot().revision,3);assert.equal(reloaded.snapshot().settings['audio.enabled'],true);
 assert.equal(reloaded.profileSettings('My Quiet')['audio.enabled'],false);
 assert.ok(fs.readdirSync(dir).every(n=>!n.endsWith('.tmp')));
}));
test('failed atomic save keeps prior in-memory revision and preserves obstructing path',()=>fixture(dir=>{
 const file=path.join(dir,'settings.json'),store=new SettingsStore(file);fs.mkdirSync(file);
 assert.throws(()=>store.configure({'audio.enabled':false},'portal'),/previous revision/);
 assert.equal(store.snapshot().revision,1);assert.equal(store.snapshot().settings['audio.enabled'],true);assert.ok(fs.statSync(file).isDirectory());
}));
test('invalid stored configuration is preserved, never partially restored',()=>fixture(dir=>{
 const file=path.join(dir,'settings.json');fs.writeFileSync(file,'{"broken":');const store=new SettingsStore(file);
 assert.match(store.recovery!,/preserved/);assert.equal(store.snapshot().revision,1);
 const rejected=fs.readdirSync(dir).find(n=>n.includes('.rejected-'))!;assert.equal(fs.readFileSync(path.join(dir,rejected),'utf8'),'{"broken":');
}));
test('all presets validate and custom profile save/rename/export/import/delete roundtrips',()=>{
 const store=new SettingsStore();for(const name of Object.keys(BUILTIN_PROFILES)){const p=store.profileSettings(name);validateNpcSettings(p,false);store.configure(p,'profile');}
 store.saveProfile('Custom');store.renameProfile('Custom','My City');const exported=store.exportProfile('My City');
 const other=new SettingsStore();other.importProfile(exported);assert.deepEqual(other.profileSettings('My City'),store.profileSettings('My City'));
 other.deleteProfile('My City');assert.throws(()=>other.profileSettings('My City'),/not found/);
 assert.throws(()=>store.saveProfile('Chaos'));assert.throws(()=>store.renameProfile('My City','Chaos'));
 assert.throws(()=>other.importProfile({...exported,secret:'disallowed'}));
});
