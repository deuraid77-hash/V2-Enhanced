import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BUILTIN_PROFILES, DEFAULT_NPC_SETTINGS, validateNpcSettings, type NpcSettings } from '../shared/settings.ts';

export class SettingsError extends Error { constructor(message: string, public status = 400) { super(message); } }
export type SettingsSource = 'portal' | 'game' | 'profile' | 'advisor' | 'defaults';
export interface SettingsSnapshot { revision: number; settings: NpcSettings; source: SettingsSource; updatedAt: string; }
interface Profile { name: string; settings: NpcSettings; updatedAt: string; }
const sources: SettingsSource[] = ['portal','game','profile','advisor','defaults'];
const MAX_FILE_BYTES = 1024 * 1024;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SettingsError('Expected a JSON object.');
  return value as Record<string,unknown>;
}
function name(value: unknown) {
  if (typeof value !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,39}$/u.test(value) || Object.hasOwn(BUILTIN_PROFILES,value)) throw new SettingsError('Use a unique custom profile name of 1–40 letters, numbers, spaces, hyphens or underscores.');
  return value;
}
function validateCombined(settings: NpcSettings) {
  if (Number(settings['ai.liveReservedSlots']) >= Number(settings['ai.maxConcurrent'])) throw new SettingsError('Reserved live slots must leave at least one background slot; use zero when concurrency is one.');
  if (Number(settings['conversation.walkAwayMeters']) < Number(settings['conversation.rangeMeters'])) throw new SettingsError('Walk-away range cannot be smaller than conversation start range.');
  if (Number(settings['audio.referenceDistanceMeters']) > Number(settings['audio.maxDistanceMeters'])) throw new SettingsError('Audio reference distance cannot exceed maximum audible range.');
  if (Number(settings['bank.refillThreshold']) > Number(settings['bank.maxLinesPerBucket'])) throw new SettingsError('Bank refill threshold cannot exceed bucket capacity.');
  const keys = ['menuKey','talkKey','wheelKey','pttKey','panicKey'].map(k => settings[`controls.${k}`]);
  if (new Set(keys).size !== keys.length) throw new SettingsError('Keyboard feature bindings must be distinct.');
  const controls = ['controllerMenu','controllerTalk','controllerWheel','controllerPtt','controllerPanic','menuModifier'].map(k=>settings[`controls.${k}`]);
  if(new Set(controls).size !== controls.length) throw new SettingsError('Controller feature bindings and the chord modifier must be distinct.');
}
export class SettingsStore {
  private state: SettingsSnapshot = { revision: 1, settings: {...DEFAULT_NPC_SETTINGS}, source: 'defaults', updatedAt: new Date().toISOString() };
  private profiles: Profile[] = [];
  private listeners = new Set<() => void>();
  public recovery: string | null = null;
  constructor(private file?: string, private now: () => number = Date.now) {
    if (!file || !fs.existsSync(file)) return;
    try {
      if (fs.statSync(file).size > MAX_FILE_BYTES) throw new Error('file size');
      const doc = record(JSON.parse(fs.readFileSync(file,'utf8')));
      if (doc.version !== 4) throw new Error('version');
      const snapshot = record(doc.snapshot);
      const settings = validateNpcSettings(snapshot.settings, false); validateCombined(settings);
      if (!Number.isSafeInteger(snapshot.revision) || Number(snapshot.revision) < 1 || Number(snapshot.revision) > 2147483647 || !sources.includes(snapshot.source as SettingsSource) || typeof snapshot.updatedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.updatedAt))) throw new Error('snapshot');
      if (!Array.isArray(doc.profiles) || doc.profiles.length > 32) throw new Error('profiles');
      const profiles: Profile[] = doc.profiles.map(p => { const v = record(p), settings = validateNpcSettings(v.settings, false); validateCombined(settings); return {name:name(v.name),settings,updatedAt:String(v.updatedAt).slice(0,40)}; });
      if (new Set(profiles.map(p=>p.name)).size !== profiles.length) throw new Error('duplicate profiles');
      this.state = { revision: Number(snapshot.revision), settings, source: snapshot.source as SettingsSource, updatedAt: snapshot.updatedAt };
      this.profiles = profiles;
    } catch {
      // Keep corrupt content for investigation. Never silently overwrite it or import a partial state.
      const rejected = `${file}.rejected-${this.now()}-${randomUUID()}.json`;
      fs.renameSync(file, rejected);
      this.recovery = 'Invalid settings preserved in a rejected file; defaults loaded. No runtime state was restored.';
    }
  }
  snapshot(): SettingsSnapshot { return structuredClone(this.state); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private persist(snapshot: SettingsSnapshot, profiles = this.profiles) {
    if (!this.file) return;
    const content = JSON.stringify({ version:4, snapshot, profiles },null,2);
    if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new SettingsError('Settings storage limit reached.',507);
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file),{recursive:true});
      fs.writeFileSync(temp,content,{encoding:'utf8',mode:0o600,flag:'wx'});
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file,`${this.file}.bak`);
      fs.renameSync(temp,this.file);
    } catch {
      try { fs.unlinkSync(temp); } catch {}
      throw new SettingsError('Could not save settings. The previous revision remains active.',500);
    }
  }
  configure(patch: unknown, source: SettingsSource, expectedRevision?: number): SettingsSnapshot {
    if (!sources.includes(source)) throw new SettingsError('Unsupported settings source.');
    if (expectedRevision !== undefined && expectedRevision !== this.state.revision) throw new SettingsError('Settings changed elsewhere. Refresh the current revision before applying this edit.',409);
    const changes = validateNpcSettings(patch), settings = {...this.state.settings,...changes}; validateCombined(settings);
    if (Object.entries(changes).every(([key,value])=>this.state.settings[key]===value)) return this.snapshot();
    if (this.state.revision === 2147483647) throw new SettingsError('Settings revision limit reached.',409);
    const next = {revision:this.state.revision+1,settings,source,updatedAt:new Date(this.now()).toISOString()};
    this.persist(next); this.state=next;
    for (const listener of this.listeners) { try {listener();} catch {} }
    return this.snapshot();
  }
  listProfiles() {
    return [...Object.keys(BUILTIN_PROFILES).map(name=>({name,builtin:true})),...this.profiles.map(p=>({name:p.name,builtin:false,updatedAt:p.updatedAt}))];
  }
  profileSettings(profileName: unknown): NpcSettings {
    if (typeof profileName !== 'string') throw new SettingsError('Profile name is required.');
    if (Object.hasOwn(BUILTIN_PROFILES,profileName)) return {...DEFAULT_NPC_SETTINGS,...BUILTIN_PROFILES[profileName]};
    const profile=this.profiles.find(p=>p.name===profileName); if (!profile) throw new SettingsError('Profile not found.',404);
    return {...profile.settings};
  }
  saveProfile(profileName: unknown, settings: unknown = this.state.settings) {
    const label=name(profileName), checked=validateNpcSettings(settings,false); validateCombined(checked);
    const list=this.profiles.filter(p=>p.name!==label);
    if(list.length>=32) throw new SettingsError('Custom profile limit reached.',409);
    list.push({name:label,settings:checked,updatedAt:new Date(this.now()).toISOString()});
    this.persist(this.state,list); this.profiles=list; return this.listProfiles();
  }
  renameProfile(oldName: unknown, newName: unknown) {
    const old=name(oldName), replacement=name(newName);
    if (!this.profiles.some(p=>p.name===old)) throw new SettingsError('Profile not found.',404);
    if (this.profiles.some(p=>p.name===replacement)) throw new SettingsError('Profile name already exists.',409);
    const list=this.profiles.map(p=>p.name===old?{...p,name:replacement,updatedAt:new Date(this.now()).toISOString()}:p);
    this.persist(this.state,list); this.profiles=list; return this.listProfiles();
  }
  deleteProfile(profileName: unknown) {
    const label=name(profileName),list=this.profiles.filter(p=>p.name!==label);
    if(list.length===this.profiles.length) throw new SettingsError('Profile not found.',404);
    this.persist(this.state,list);this.profiles=list;return this.listProfiles();
  }
  exportProfile(profileName: unknown) {return {format:'LivingLosSantos.profile',version:4,name:String(profileName),settings:this.profileSettings(profileName)};}
  importProfile(value: unknown) {
    const input=record(value);
    if(input.format!=='LivingLosSantos.profile'||input.version!==4||Object.keys(input).some(k=>!['format','version','name','settings'].includes(k))) throw new SettingsError('Unsupported profile export.');
    return this.saveProfile(input.name,input.settings);
  }
}
