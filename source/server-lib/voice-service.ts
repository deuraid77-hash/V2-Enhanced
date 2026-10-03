import path from 'node:path';
import type { AiBudget } from './ai-budget.ts';
import type { AiScheduler } from './ai-scheduler.ts';
import { AiError, type SettingsGetter, boundedText, onlyKeys, record, settingBoolean, settingNumber, settingString } from './ai-types.ts';
import { audioIdentifier, type AudioCategory, type AudioHostResponse } from './audio-types.ts';
import { BANK_GROUPS, type BankGroup, type LineBank } from './line-bank.ts';
import { TranscriptLog } from './transcripts.ts';
import { GeminiVoiceProvider, VoiceCache, castVoice, safeTone, stylePrompt } from './voice.ts';

export interface PlaybackHost { readonly running: boolean; start(): Promise<AudioHostResponse>; request(type: string, data?: Record<string, unknown>): Promise<AudioHostResponse> }
type Point = { x: number; y: number; z: number };
type Speaker = { npcId: string; position: Point; alive: boolean; interior: number; inPlayerVehicle: boolean };
type Cue = { cueId: string; npcId: string; speaker: string; text: string; tone: string; category: AudioCategory; source: string; lane: string; receivedAt: number; runtimeId: string; sceneEpoch: string };
const CATEGORIES: AudioCategory[] = ['conversation', 'casual', 'combat', 'vehicle', 'phone', 'narrator', 'hurt'];
const GROUP_CATEGORY: Record<BankGroup, AudioCategory> = { casual: 'casual', reaction: 'casual', group: 'casual', vehicle: 'vehicle', hurt: 'hurt', combat: 'combat' };
const GROUP_COOLDOWN: Record<BankGroup, string> = { casual: 'audio.ambientCooldownSeconds', reaction: 'audio.ambientCooldownSeconds', group: 'audio.ambientCooldownSeconds', vehicle: 'audio.vehicleCooldownSeconds', hurt: 'audio.hurtCooldownSeconds', combat: 'audio.combatCooldownSeconds' };

function point(value: unknown, name: string): Point {
  const p = record(value, name); onlyKeys(p, ['x', 'y', 'z'], name);
  for (const k of ['x', 'y', 'z'] as const) if (typeof p[k] !== 'number' || !Number.isFinite(p[k]) || Math.abs(p[k] as number) > 100000) throw new AiError('invalid_payload', `${name} must contain finite coordinates.`);
  return { x: p.x as number, y: p.y as number, z: p.z as number };
}
const id = (value: unknown, name: string) => { try { return audioIdentifier(value, name); } catch { throw new AiError('invalid_payload', `${name} must be a bounded identifier.`); } };
const list = (value: unknown, max: number, name: string) => { if (value === undefined) return []; if (!Array.isArray(value) || value.length > max) throw new AiError('invalid_payload', `${name} must be a list of at most ${max}.`); return value; };
const speechText = (value: unknown, max: number) => { const t = boundedText(value, max, 'Speech text'); if (/[<>~]/.test(t)) throw new AiError('invalid_payload', 'Speech text contains unsupported markup.'); return t; };

export type VoiceServiceOptions = { host: PlaybackHost; getSettings: SettingsGetter; directory: string; bank: LineBank; transcripts: TranscriptLog; gemini?: GeminiVoiceProvider; budget?: AiBudget; scheduler?: AiScheduler; now?: () => number };
/** Companion-side voice pipeline. The game posts one bounded frame at audio.positionHz. */
export class VoiceService {
  private now: () => number;
  private cache: VoiceCache;
  private runtimeId = ''; private sceneEpoch = ''; private paused = false;
  private speakers = new Map<string, Speaker>();
  private queue: Cue[] = [];
  private draining = false;
  private configuredSignature = '';
  private activeByNpc = new Map<string, { cueId: string; category: AudioCategory; until: number }>();
  private lastBark = new Map<string, number>();
  private seenCues = new Map<string, number>();
  private pose: { listener: Point; right: Point; playerInVehicle: boolean; playerInterior: number } | null = null;
  private metrics = { frames: 0, cues: 0, played: 0, barks: 0, dropped: {} as Record<string, number>, latencies: [] as { cueId: string; source: string; receivedToHostAckMs: number; hostRenderMs: number }[], lastError: null as string | null };
  constructor(private options: VoiceServiceOptions) {
    this.now = options.now ?? Date.now;
    this.cache = new VoiceCache(path.join(options.directory, 'voice-cache'), options.getSettings);
  }
  private get get() { return this.options.getSettings; }
  private drop(reason: string) { this.metrics.dropped[reason] = (this.metrics.dropped[reason] ?? 0) + 1; }

  frame(body: unknown) {
    const b = record(body, 'Audio frame');
    onlyKeys(b, ['runtimeId', 'sceneEpoch', 'paused', 'listener', 'right', 'playerInVehicle', 'playerInterior', 'speakers', 'cues', 'barks'], 'Audio frame');
    const runtimeId = id(b.runtimeId, 'Runtime ID'), sceneEpoch = id(b.sceneEpoch, 'Scene epoch');
    if (typeof b.paused !== 'boolean' || typeof b.playerInVehicle !== 'boolean') throw new AiError('invalid_payload', 'Audio frame flags must be boolean.');
    const listener = point(b.listener, 'Listener'), right = point(b.right, 'Listener right vector');
    const playerInterior = Number.isSafeInteger(b.playerInterior) ? b.playerInterior as number : 0;
    const speakers: Speaker[] = list(b.speakers, 8, 'Speakers').map(raw => { const s = record(raw, 'Speaker'); onlyKeys(s, ['npcId', 'position', 'alive', 'interior', 'inPlayerVehicle'], 'Speaker'); if (typeof s.alive !== 'boolean' || typeof s.inPlayerVehicle !== 'boolean') throw new AiError('invalid_payload', 'Speaker flags must be boolean.'); return { npcId: id(s.npcId, 'Speaker NPC ID'), position: point(s.position, 'Speaker position'), alive: s.alive, interior: Number.isSafeInteger(s.interior) ? s.interior as number : 0, inPlayerVehicle: s.inPlayerVehicle }; });
    const maxChars = Math.max(80, Math.min(600, settingNumber(this.get, 'ai.maxSpeechCharacters', 320)));
    const cueInputs = list(b.cues, 4, 'Cues').map(raw => { const c = record(raw, 'Cue'); onlyKeys(c, ['cueId', 'npcId', 'speaker', 'text', 'tone', 'category', 'source', 'lane'], 'Cue');
      if (!CATEGORIES.includes(c.category as AudioCategory) || !['gemini', 'bank', 'fallback'].includes(c.source as string) || !['A', 'B', 'C', 'D'].includes(c.lane as string)) throw new AiError('invalid_payload', 'Cue category, source or lane is invalid.');
      return { cueId: id(c.cueId, 'Cue ID'), npcId: id(c.npcId, 'Cue NPC ID'), speaker: boundedText(c.speaker ?? 'NPC', 60, 'Speaker name'), text: speechText(c.text, maxChars), tone: safeTone(c.tone), category: c.category as AudioCategory, source: c.source as string, lane: c.lane as string }; });
    const barkInputs = list(b.barks, 4, 'Barks').map(raw => { const r = record(raw, 'Bark'); onlyKeys(r, ['requestId', 'npcId', 'speaker', 'group', 'tags', 'archetype'], 'Bark');
      if (!(BANK_GROUPS as readonly string[]).includes(r.group as string)) throw new AiError('invalid_payload', 'Bark group is invalid.');
      const tags = list(r.tags, 4, 'Bark tags').map(t => id(t, 'Bark tag'));
      return { requestId: id(r.requestId, 'Bark request ID'), npcId: id(r.npcId, 'Bark NPC ID'), speaker: boundedText(r.speaker ?? 'NPC', 60, 'Speaker name'), group: r.group as BankGroup, tags, archetype: typeof r.archetype === 'string' ? r.archetype.slice(0, 24) : undefined }; });

    const now = this.now(); this.metrics.frames++;
    if (runtimeId !== this.runtimeId || sceneEpoch !== this.sceneEpoch) { if (this.runtimeId) this.stopAll('scene_changed'); this.runtimeId = runtimeId; this.sceneEpoch = sceneEpoch; this.lastBark.clear(); }
    if (b.paused && !this.paused) this.stopAll('paused');
    this.paused = b.paused;
    this.speakers = new Map(speakers.map(s => [s.npcId, s]));
    for (const [npcId, active] of this.activeByNpc) { const s = this.speakers.get(npcId); if (active.until < now) this.activeByNpc.delete(npcId); else if (s && !s.alive) { this.activeByNpc.delete(npcId); void this.hostCall('playStop', { id: active.cueId }); this.drop('speaker_dead'); } }
    for (const [cue, at] of this.seenCues) if (now - at > 120_000) this.seenCues.delete(cue);

    const accepted: string[] = [];
    if (!this.paused) for (const c of cueInputs) { if (this.seenCues.has(c.cueId)) continue; this.seenCues.set(c.cueId, now); accepted.push(c.cueId); this.enqueue({ ...c, receivedAt: now, runtimeId, sceneEpoch }); }
    const barks: { requestId: string; npcId: string; text: string; source: 'bank' | 'fallback'; mood: string; cueId: string }[] = [];
    if (!this.paused) for (const r of barkInputs) {
      const key = r.npcId + '|' + GROUP_COOLDOWN[r.group];
      if (now - (this.lastBark.get(key) ?? 0) < settingNumber(this.get, GROUP_COOLDOWN[r.group], 10) * 1000) { this.drop('bark_cooldown'); continue; }
      const line = this.options.bank.pick(r.group, { tags: r.tags, archetype: r.archetype });
      if (!line) { this.drop('bark_empty'); continue; }
      this.lastBark.set(key, now); this.metrics.barks++;
      const cueId = 'bark-' + r.requestId.slice(0, 100);
      const source = line.source === 'gemini' ? 'bank' : 'fallback';
      barks.push({ requestId: r.requestId, npcId: r.npcId, text: line.text, source, mood: line.mood, cueId });
      this.seenCues.set(cueId, now);
      this.enqueue({ cueId, npcId: r.npcId, speaker: r.speaker, text: line.text, tone: safeTone(line.mood), category: GROUP_CATEGORY[r.group], source, lane: 'C', receivedAt: now, runtimeId, sceneEpoch });
    }
    this.pose = { listener, right, playerInVehicle: b.playerInVehicle, playerInterior };
    if (!this.paused) void this.sendPositions();
    return { success: true, accepted, barks, audio: { enabled: settingBoolean(this.get, 'audio.enabled', true), hostRunning: this.options.host.running } };
  }

  private enqueue(cue: Cue) {
    this.metrics.cues++;
    const cast = castVoice(cue.npcId, this.get);
    this.options.transcripts.append({ runtimeId: cue.runtimeId, sceneEpoch: cue.sceneEpoch, npcId: cue.npcId, speaker: cue.speaker, text: cue.text, source: cue.source, lane: cue.lane, category: cue.category, voice: this.voiceLabel(cast) });
    if (!settingBoolean(this.get, 'audio.enabled', true)) { this.drop('audio_disabled'); return; }
    if (this.queue.length >= 8) { this.queue.shift(); this.drop('queue_full'); }
    this.queue.push(cue);
    if (!this.draining) void this.drain();
  }
  private voiceLabel(cast: ReturnType<typeof castVoice>) { const p = settingString(this.get, 'audio.provider', 'auto'); return p === 'gemini' ? 'gemini:' + cast.geminiVoice : 'windows:' + cast.windowsVoiceIndex; }

  private async drain() {
    this.draining = true;
    try {
      while (this.queue.length) {
        const cue = this.queue.shift()!;
        try { await this.play(cue); } catch (error) { this.drop('play_failed'); this.metrics.lastError = error instanceof AiError ? error.code : error instanceof Error ? error.message.slice(0, 120) : 'play_failed'; }
      }
    } finally { this.draining = false; }
  }
  private fresh(cue: Cue) {
    if (cue.runtimeId !== this.runtimeId || cue.sceneEpoch !== this.sceneEpoch) return 'scene_changed';
    if (this.paused) return 'paused';
    if (this.now() - cue.receivedAt > settingNumber(this.get, 'audio.queueMaxAgeMs', 3000)) return 'stale';
    const s = this.speakers.get(cue.npcId); if (s && !s.alive) return 'speaker_dead';
    return null;
  }
  private async play(cue: Cue) {
    let stale = this.fresh(cue); if (stale) { this.drop(stale); return; }
    await this.ensureHost();
    const cast = castVoice(cue.npcId, this.get), provider = settingString(this.get, 'audio.provider', 'auto');
    const gemini = this.options.gemini, intensity = settingNumber(this.get, 'audio.emotionIntensity', 0.8);
    const style = stylePrompt(cue.text, cue.tone, cast, intensity);
    const key = gemini ? this.cache.key([gemini.model, cast.geminiVoice, style]) : '';
    let payload: Record<string, unknown> | null = null, source = 'windows';
    if (gemini && key && this.cache.has(key) && provider !== 'windows') { payload = { source: 'file', file: this.cache.file(key) }; source = 'gemini-cache'; }
    else if (gemini && provider === 'gemini') {
      try { await this.renderGemini(cue, cast.geminiVoice, style, key); payload = { source: 'file', file: this.cache.file(key) }; source = 'gemini'; }
      catch (error) { this.metrics.lastError = error instanceof AiError ? error.code : 'voice_render_failed'; this.drop('gemini_fallback'); }
      stale = this.fresh(cue); if (stale) { this.drop(stale); return; }
    }
    // 'auto' uses already-cached Gemini audio, otherwise labelled Windows speech; it never starts a metered render.
    payload ??= { source: 'windows', text: cue.text, voiceIndex: cast.windowsVoiceIndex, rate: cast.windowsRate };
    const result = await this.options.host.request('play', { id: cue.cueId, npcId: cue.npcId, category: cue.category, left: 0, right: 0, ...payload });
    const durationMs = Number(result.durationMs);
    this.activeByNpc.set(cue.npcId, { cueId: cue.cueId, category: cue.category, until: this.now() + (Number.isFinite(durationMs) ? durationMs : 10000) + 500 });
    this.metrics.played++;
    this.metrics.latencies.push({ cueId: cue.cueId, source, receivedToHostAckMs: this.now() - cue.receivedAt, hostRenderMs: Number(result.renderMs) || 0 });
    if (this.metrics.latencies.length > 20) this.metrics.latencies.shift();
    await this.sendPositions();
  }
  private async renderGemini(cue: Cue, voiceId: string, style: string, key: string) {
    const { gemini, budget, scheduler } = this.options;
    if (!gemini || !budget || !scheduler) throw new AiError('capability_unavailable', 'Gemini voice is not wired.', 503);
    if (!settingBoolean(this.get, 'ai.enabled', true)) throw new AiError('ai_disabled', 'AI is disabled.', 409);
    const jobId = 'voice-' + cue.cueId.slice(0, 100), lane = cue.lane === 'A' ? 'A' : 'B';
    const maxDurationSeconds = Math.min(30, Math.ceil(cue.text.length / 10) + 3);
    await scheduler.submit({ id: jobId, lane, priority: cue.category === 'conversation' ? 90 : 10, scope: { runtimeId: cue.runtimeId, sceneEpoch: cue.sceneEpoch, npcIds: [cue.npcId] }, run: async signal => {
      scheduler.admitProvider();
      let reserved = false, started = false; const start = this.now();
      try {
        // Output reservation assumes at most 32 audio tokens per second of speech (not verified for TTS); recorded usage replaces it.
        budget.reserve({ id: jobId, model: gemini.model, lane, category: 'voice', maxInputTokens: Math.ceil(style.length / 2) + 64, maxOutputTokens: 32 * maxDurationSeconds }); reserved = true;
        if (signal.aborted) throw signal.reason;
        budget.markStarted(jobId); started = true;
        let pcm: Buffer | null = null;
        const r = await gemini.render({ id: jobId, text: cue.text, voiceId, style, maxDurationSeconds, signal, onAudioChunk: chunk => { pcm = Buffer.from(chunk.data); } });
        budget.record(jobId, r.usage, { outcome: 'completed', durationMs: r.durationMs, firstChunkMs: r.firstChunkMs ?? undefined }); scheduler.providerSucceeded();
        if (!pcm) throw new AiError('invalid_audio', 'Voice provider returned no audio.', 502);
        this.cache.write(key, pcm);
      } catch (error) {
        if (reserved) { if (started) budget.record(jobId, error instanceof AiError ? error.usage || null : null, { outcome: signal.aborted ? 'cancelled' : 'failed', durationMs: Math.max(0, this.now() - start) }); else budget.release(jobId); }
        scheduler.providerFailed(error instanceof AiError && error.retryable);
        throw error;
      }
    } });
  }
  private configuration() {
    const g = (k: string, d: number) => settingNumber(this.get, k, d);
    return { cacheRoot: this.cache.ensure(), maxVoices: g('audio.maxVoices', 4), masterVolume: g('audio.masterVolume', 0.85), smoothingMs: g('audio.smoothingMs', 40), preemptFadeMs: g('audio.preemptFadeMs', 60), positionStaleMs: g('audio.positionStaleMs', 500), deviceId: settingString(this.get, 'audio.outputDeviceId', 'default').slice(0, 400) || 'default' };
  }
  private async ensureHost() {
    if (!this.options.host.running) { this.configuredSignature = ''; await this.options.host.start(); }
    const config = this.configuration(), signature = JSON.stringify(config);
    if (signature !== this.configuredSignature) { await this.options.host.request('playConfigure', config); this.configuredSignature = signature; }
  }
  private categoryGain(category: AudioCategory) {
    const key = category === 'combat' || category === 'hurt' ? 'audio.combatVolume' : category === 'vehicle' ? 'audio.vehicleVolume' : category === 'phone' ? 'audio.phoneVolume' : category === 'narrator' ? 'audio.narratorVolume' : 'audio.casualVolume';
    return settingNumber(this.get, key, 0.8);
  }
  private async sendPositions() {
    if (!this.pose || this.paused || !this.options.host.running || !this.configuredSignature || !this.activeByNpc.size) return;
    const { listener, right, playerInVehicle, playerInterior } = this.pose;
    const g = (k: string, d: number) => settingNumber(this.get, k, d);
    const speakers = [...this.activeByNpc.entries()].map(([npcId, active]) => {
      const s = this.speakers.get(npcId); if (!s) return null;
      let gain = this.categoryGain(active.category), lowPassHz = 20000;
      if (s.interior !== playerInterior) { gain *= g('audio.interiorMuffleGain', 0.65); lowPassHz = Math.min(lowPassHz, g('audio.interiorLowPassHz', 2800)); }
      if (playerInVehicle && !s.inPlayerVehicle) { gain *= g('audio.playerVehicleGain', 0.8); lowPassHz = Math.min(lowPassHz, g('audio.windowLowPassHz', 1800)); }
      return { npcId, position: s.position, gain, lowPassHz };
    }).filter(Boolean).slice(0, 8);
    if (!speakers.length) return;
    await this.hostCall('playPositions', { listener, right, referenceDistance: g('audio.referenceDistanceMeters', 3), maxDistance: g('audio.maxDistanceMeters', 45), rolloff: g('audio.distanceRolloff', 1.2), spatialStrength: g('audio.spatialStrength', 1), speakers });
  }
  private async hostCall(type: string, data: Record<string, unknown> = {}) { if (!this.options.host.running) return null; try { return await this.options.host.request(type, data); } catch (error) { this.metrics.lastError = error instanceof Error ? error.message.slice(0, 120) : type; return null; } }
  stopAll(reason: string) { const dropped = this.queue.length; this.queue = []; for (let i = 0; i < dropped; i++) this.drop(reason); this.activeByNpc.clear(); void this.hostCall('playStopAll'); }
  async status() {
    const host = this.options.host.running ? await this.hostCall('playStatus') : null;
    return { success: true, enabled: settingBoolean(this.get, 'audio.enabled', true), provider: settingString(this.get, 'audio.provider', 'auto'), geminiVoice: this.options.gemini ? { model: this.options.gemini.model, configured: this.options.gemini.configured() } : null,
      hostRunning: this.options.host.running, host: host ? { deviceOpen: host.deviceOpen, deviceId: host.deviceId, lastError: host.lastError, mixer: host.mixer } : null,
      queue: this.queue.length, activeSpeakers: this.activeByNpc.size, cache: this.cache.enforce(), transcripts: this.options.transcripts.count(), metrics: { ...this.metrics, dropped: { ...this.metrics.dropped }, latencies: [...this.metrics.latencies] } };
  }
}
