import { randomUUID, createHash } from 'node:crypto';
import { AiBudget } from './ai-budget.ts';
import { AiScheduler } from './ai-scheduler.ts';
import { AiError, boundedInteger, boundedText, onlyKeys, record, settingBoolean, settingNumber, settingString, type SettingsGetter } from './ai-types.ts';
import type { CaptureHost, CaptureReceipt, PttTarget, TranscriptionProvider, TranscriptionResult, ValidatedPttTarget } from './ptt-types.ts';
import { transcriptionReservation, TRANSCRIPTION_MODEL } from './ptt-provider.ts';

const ACTIVE = new Set(['starting', 'capturing', 'stopping', 'transcribing']);
const UUID = /^[\da-f]{8}-[\da-f]{4}-[1-5][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
function uuid(v: unknown) { if (typeof v !== 'string' || !UUID.test(v)) throw new AiError('invalid_payload', 'A valid UUID is required.'); return v; }
type Entry = { receipt: CaptureReceipt; fingerprint: string; sequence: number; stopRequestId?: string; result?: TranscriptionResult; conversationRequestId: string; config: string; focusAt?:number; checkingFocus?:boolean };
export type PttOptions = { host: CaptureHost; provider: TranscriptionProvider; getSettings: SettingsGetter; budget: AiBudget; scheduler: AiScheduler; validateTarget: (target: PttTarget) => ValidatedPttTarget; now?: () => number; autoTick?: boolean; micTestMs?: number };
export class PttService {
  private entries = new Map<string, Entry>(); private timer?: ReturnType<typeof setInterval>; private now: () => number; private closed = false; private captureAvailable = false; private micTesting = false;
  constructor(private options: PttOptions) { this.now = options.now ?? Date.now; if (options.autoTick !== false) { this.timer = setInterval(() => this.validateActive(), 100); this.timer.unref(); } }
  private iso(at = this.now()) { return new Date(at).toISOString(); }
  private configuration() { const s = this.options.getSettings(); return JSON.stringify(['conversation.pushToTalk','audio.micDeviceId','audio.micMaxSeconds','audio.micSensitivity','audio.micSilenceThreshold','controls.pttKey','controls.controllerPtt'].map(k => s[k])); }
  private guard(target: PttTarget) {
    const get = this.options.getSettings;
    if (this.closed || !settingBoolean(get, 'general.enabled', true) || settingBoolean(get, 'general.safeMode', false) || !settingBoolean(get, 'ai.enabled', true) || settingString(get, 'ai.provider', 'gemini') !== 'gemini' || !settingBoolean(get, 'conversation.pushToTalk', false)) throw new AiError('disabled', 'Held push-to-talk is disabled.', 409);
    return this.options.validateTarget(target);
  }
  private prune() { for (const [id,e] of this.entries) if (!ACTIVE.has(e.receipt.state) && this.now() - Date.parse(e.receipt.finishedAt || e.receipt.createdAt) > 300000) { e.result = undefined; this.entries.delete(id); } }
  private entry(id: string) { this.prune(); const e = this.entries.get(uuid(id)); if (!e) throw new AiError('capture_expired', 'Capture receipt is unavailable or expired.', 410); return e; }
  private copy(e: Entry) { return { ...e.receipt, elapsedMs: e.receipt.startedAt ? Math.max(0, Math.min(e.receipt.maxDurationMs, Date.parse(e.receipt.finishedAt || this.iso()) - Date.parse(e.receipt.startedAt))) : 0 }; }
  private change(e: Entry, state: CaptureReceipt['state'], reasonCode?: string) { e.receipt.state = state; e.receipt.updatedAt = this.iso(); if (reasonCode) e.receipt.reasonCode = reasonCode; if (!ACTIVE.has(state)) { e.receipt.finishedAt = this.iso(); e.receipt.leaseExpiresAt = null; } }
  private capabilities(capture = this.captureAvailable, reasonCode?: string) { return { capture, transcription: this.options.provider.configured(), ...(reasonCode ? { reasonCode } : {}) }; }
  async devices() { try { const devices = await this.options.host.devices(); this.captureAvailable = devices.some(d => d.available); return { success: true, capabilities: this.capabilities(), selectedDeviceId: settingString(this.options.getSettings, 'audio.micDeviceId', 'default'), devices }; } catch { this.captureAvailable = false; return { success: true, capabilities: this.capabilities(false, 'capture_unavailable'), selectedDeviceId: settingString(this.options.getSettings, 'audio.micDeviceId', 'default'), devices: [] }; } }
  status() { this.validateActive(); const all = [...this.entries.values()]; return { success: true, capabilities: this.capabilities(), enabled: settingBoolean(this.options.getSettings, 'conversation.pushToTalk', false), active: all.find(e => ACTIVE.has(e.receipt.state)) ? this.copy(all.find(e => ACTIVE.has(e.receipt.state))!) : null, recent: all.slice(-8).reverse().map(e => this.copy(e)) }; }
  start(value: unknown) {
    this.prune(); const v = record(value, 'capture'); onlyKeys(v, ['requestId','runtimeId','sceneEpoch','npcId','expectedHandle','expectedModelHash'], 'capture');
    const requestId = uuid(v.requestId); const target: PttTarget = { runtimeId: boundedText(v.runtimeId,128,'runtimeId'), sceneEpoch: boundedText(v.sceneEpoch,128,'sceneEpoch'), npcId: boundedText(v.npcId,128,'npcId'), expectedHandle: boundedInteger(v.expectedHandle,1,2147483647,'handle'), expectedModelHash: boundedInteger(v.expectedModelHash,-2147483648,4294967295,'modelHash') };
    const fingerprint = createHash('sha256').update(JSON.stringify(target)).digest('hex'); const old = [...this.entries.values()].find(e => e.receipt.requestId === requestId);
    if (old) { if (old.fingerprint !== fingerprint) throw new AiError('request_conflict','This request ID belongs to a different capture.',409); return this.copy(old); }
    this.guard(target); if (!this.options.provider.configured()) throw new AiError('provider_unconfigured','Gemini transcription is not configured.',503);
    if ([...this.entries.values()].some(e => ACTIVE.has(e.receipt.state))) throw new AiError('capture_busy','Another held capture or transcription is active.',409);
    if (this.entries.size >= 32) this.entries.delete(this.entries.keys().next().value!);
    const e: Entry = { fingerprint, sequence: 0, conversationRequestId: randomUUID(), config: this.configuration(), receipt: { ...target, id: randomUUID(), requestId, state:'starting', createdAt:this.iso(), startedAt:null, updatedAt:this.iso(), finishedAt:null, leaseExpiresAt:this.iso(this.now()+1000), maxDurationMs:Math.max(2000,Math.min(30000,settingNumber(this.options.getSettings,'audio.micMaxSeconds',20)*1000)), elapsedMs:0, deviceId:settingString(this.options.getSettings,'audio.micDeviceId','default'), deviceName:'', jobId:null } };
    this.entries.set(e.receipt.id,e);
    void this.options.host.start({ id:e.receipt.id, deviceId:e.receipt.deviceId, maxDurationMs:e.receipt.maxDurationMs, sensitivity:settingNumber(this.options.getSettings,'audio.micSensitivity',1), silenceThreshold:settingNumber(this.options.getSettings,'audio.micSilenceThreshold',.015) }).then(device => {
      if (e.receipt.state !== 'starting') { void this.options.host.cancel(e.receipt.id); return; }
      try { this.guard(e.receipt); if (Date.parse(e.receipt.leaseExpiresAt!) <= this.now()) throw new AiError('lease_expired','Held input expired.',409); this.captureAvailable=true; e.receipt.deviceId=device.deviceId; e.receipt.deviceName=device.deviceName; e.receipt.startedAt=this.iso(); this.change(e,'capturing'); }
      catch (error) { this.cancelEntry(e,error instanceof AiError?error.code:'scope_changed'); }
    }).catch(error => { if (ACTIVE.has(e.receipt.state)) { this.change(e,'failed',error instanceof AiError?error.code:'capture_unavailable'); void this.options.host.cancel(e.receipt.id); } });
    return this.copy(e);
  }
  async lease(id: string,value: unknown) {
    const e=this.entry(id), v=record(value,'held lease'); onlyKeys(v,['sequence','held'],'held lease'); if(v.held!==true)throw new AiError('invalid_payload','Held lease must explicitly be true.'); const sequence=boundedInteger(v.sequence,1,2147483647,'sequence');
    this.validateActive(); if(!['starting','capturing'].includes(e.receipt.state))return this.copy(e); this.guard(e.receipt);
    if(sequence<=e.sequence)return this.copy(e); e.sequence=sequence;
    try { const host=await this.options.host.lease(id,sequence); if(!['starting','capturing'].includes(e.receipt.state))return this.copy(e); if(!['starting','capturing'].includes(host.state)){this.cancelEntry(e,host.reasonCode||'capture_cancelled');return this.copy(e);} if(Date.parse(e.receipt.leaseExpiresAt!)<=this.now()){this.cancelEntry(e,'lease_expired');return this.copy(e);} e.receipt.leaseExpiresAt=this.iso(this.now()+1000); e.receipt.updatedAt=this.iso(); }
    catch { this.cancelEntry(e,'capture_unavailable'); } return this.copy(e);
  }
  stop(id:string,value:unknown) {
    const e=this.entry(id),v=record(value,'capture stop');onlyKeys(v,['requestId'],'capture stop');const requestId=uuid(v.requestId);
    if(e.stopRequestId){if(e.stopRequestId!==requestId)throw new AiError('request_conflict','Capture was committed by another request.',409);return this.copy(e);}
    this.validateActive(); if(e.receipt.state==='starting'){e.stopRequestId=requestId;this.cancelEntry(e,'released_before_ready');return this.copy(e);}if(e.receipt.state!=='capturing')return this.copy(e);this.guard(e.receipt);e.stopRequestId=requestId;this.change(e,'stopping');e.receipt.leaseExpiresAt=null;
    void this.transcribe(e);return this.copy(e);
  }
  private async transcribe(e:Entry) {
    let pcm:Buffer|undefined;
    try {
      const clip=await this.options.host.stop(e.receipt.id);pcm=clip.pcm;
      if(e.receipt.state!=='stopping')return;this.guard(e.receipt);
      if(pcm.length<8000||pcm.length>960000||pcm.length%2||Math.abs(clip.durationMs-pcm.length/32)>1||!Number.isFinite(clip.rms)||clip.rms<settingNumber(this.options.getSettings,'audio.micSilenceThreshold',.015))throw new AiError('no_speech','No usable speech was captured.',422);
      if(this.options.provider.model!==TRANSCRIPTION_MODEL)throw new AiError('unpriced_model','This transcription model has no verified audio price.',409);
      const jobId=randomUUID();e.receipt.jobId=jobId;this.change(e,'transcribing');const scope=this.guard(e.receipt).scope;
      const result=await this.options.scheduler.submit({id:jobId,lane:'A',priority:100,scope,run:async signal=>{
        this.guard(e.receipt);if(signal.aborted)throw signal.reason;this.options.scheduler.admitProvider();let reserved=false,started=false;const start=this.now();
        try {this.options.budget.reserve({id:jobId,model:this.options.provider.model,lane:'A',category:'transcription',...transcriptionReservation(clip.durationMs)});reserved=true;
          this.guard(e.receipt);if(signal.aborted)throw signal.reason;this.options.budget.markStarted(jobId);started=true;
          const r=await this.options.provider.transcribe({pcm:pcm!,durationMs:clip.durationMs,language:settingString(this.options.getSettings,'conversation.language','English'),signal});
          this.options.budget.record(jobId,r.usage,{outcome:signal.aborted?'cancelled':'completed',durationMs:r.durationMs});this.options.scheduler.providerSucceeded();return r;
        }catch(error){if(reserved){if(started)this.options.budget.record(jobId,error instanceof AiError?error.usage||null:null,{outcome:signal.aborted?'cancelled':'failed',durationMs:Math.max(0,this.now()-start)});else this.options.budget.release(jobId);}this.options.scheduler.providerFailed(error instanceof AiError&&error.retryable);throw error;}
      }});
      if(!(['transcribing'] as string[]).includes(e.receipt.state))return;this.guard(e.receipt);await this.checkFocus(e);if(!(['transcribing'] as string[]).includes(e.receipt.state))return;if(!result.text.trim())throw new AiError('no_speech','No intelligible speech was found.',422);e.result=result;this.change(e,'ready');
    }catch(error){if(ACTIVE.has(e.receipt.state))this.change(e,'failed',error instanceof AiError?error.code:'capture_failed');}
    finally{pcm?.fill(0);void this.options.host.cancel(e.receipt.id);}
  }
  private cancelEntry(e:Entry,reason:string){if(!ACTIVE.has(e.receipt.state)&&e.receipt.state!=='ready')return;e.result=undefined;this.change(e,'cancelled',reason);if(e.receipt.jobId)this.options.scheduler.cancel(e.receipt.jobId,reason);void this.options.host.cancel(e.receipt.id);}
  cancel(id:string){const e=this.entry(id);this.cancelEntry(e,'cancelled');return this.copy(e);}
  get(id:string){this.validateActive();return this.copy(this.entry(id));}
  async result(id:string){this.validateActive();const e=this.entry(id);await this.checkFocus(e);if(e.receipt.state!=='ready'||!e.result)throw new AiError('capture_not_ready','Transcription is not ready.',409);try{this.guard(e.receipt);}catch(error){this.cancelEntry(e,'scope_changed');throw error;}return{success:true,captureId:id,conversationRequestId:e.conversationRequestId,text:e.result.text,language:e.result.language,source:'gemini' as const,model:e.result.model};}
  private async checkFocus(e:Entry){if(!['stopping','transcribing','ready'].includes(e.receipt.state))return;try{const result=await this.options.host.focus(e.receipt.id);e.focusAt=this.now();if(!result.valid)this.cancelEntry(e,result.reasonCode||'focus_lost');}catch{this.cancelEntry(e,'capture_unavailable');}}
  validateActive(){this.prune();for(const e of this.entries.values())if(ACTIVE.has(e.receipt.state)||e.receipt.state==='ready'){try{this.guard(e.receipt);if(this.configuration()!==e.config)throw new AiError('settings_changed','Input settings changed.',409);if(e.receipt.leaseExpiresAt&&Date.parse(e.receipt.leaseExpiresAt)<=this.now())throw new AiError('lease_expired','Held input expired.',409);if(['starting','capturing'].includes(e.receipt.state)&&this.now()-Date.parse(e.receipt.startedAt||e.receipt.createdAt)>=e.receipt.maxDurationMs)throw new AiError('max_duration','Maximum capture duration reached.',409);if(['stopping','transcribing','ready'].includes(e.receipt.state)&&!e.checkingFocus&&this.now()-(e.focusAt||0)>=250){e.checkingFocus=true;void this.checkFocus(e).finally(()=>{e.checkingFocus=false;});}}catch(error){this.cancelEntry(e,error instanceof AiError?error.code:'scope_changed');}}}
  /** Local microphone level check (~2 s). No transcription, no provider call, nothing saved; the buffer is zero-filled. */
  async micTest() {
    const get=this.options.getSettings;
    if(this.closed||!settingBoolean(get,'general.enabled',true)||settingBoolean(get,'general.safeMode',false))throw new AiError('disabled','Living Los Santos is disabled.',409);
    if(this.micTesting||[...this.entries.values()].some(e=>ACTIVE.has(e.receipt.state)))throw new AiError('capture_busy','Another capture is active.',409);
    this.micTesting=true;const id=randomUUID(),steps=Math.max(1,Math.round((this.options.micTestMs??2000)/250));let pcm:Buffer|undefined;
    try{
      const threshold=settingNumber(get,'audio.micSilenceThreshold',.015);
      const device=await this.options.host.start({id,deviceId:settingString(get,'audio.micDeviceId','default'),maxDurationMs:Math.max(2000,steps*250+1500),sensitivity:settingNumber(get,'audio.micSensitivity',1),silenceThreshold:threshold});
      for(let sequence=1;sequence<=steps;sequence++){
        const held=await this.options.host.lease(id,sequence);
        if(!['starting','capturing'].includes(held.state))throw new AiError(held.reasonCode&&/^[a-z_]{1,40}$/.test(held.reasonCode)?held.reasonCode:'capture_cancelled','The microphone test was interrupted.',409);
        await new Promise<void>(resolve=>setTimeout(resolve,(this.options.micTestMs??2000)/steps));
        if(this.closed)throw new AiError('shutdown','The companion is closing.',409);
      }
      const clip=await this.options.host.stop(id);pcm=clip.pcm;
      const level=Number.isFinite(clip.rms)?Math.max(0,Math.min(1,clip.rms)):0;
      this.captureAvailable=true;
      return{success:true,deviceName:device.deviceName,durationMs:Math.max(0,Math.round(clip.durationMs)),level:Math.round(level*10000)/10000,threshold,verdict:level<threshold?'silent':level<threshold*3?'quiet':'ok',transcribed:false,saved:false};
    }catch(error){if(error instanceof AiError)throw error;this.captureAvailable=false;throw new AiError('capture_unavailable','No microphone could be opened.',503);}
    finally{pcm?.fill(0);this.micTesting=false;void this.options.host.cancel(id).catch(()=>{});}
  }
  async close(){this.closed=true;if(this.timer)clearInterval(this.timer);for(const e of this.entries.values())this.cancelEntry(e,'shutdown');await this.options.host.close();}
}
