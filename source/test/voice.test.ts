import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AiBudget } from '../server-lib/ai-budget.ts';
import { AiScheduler } from '../server-lib/ai-scheduler.ts';
import type { AiProvider } from '../server-lib/ai-types.ts';
import { LineBank, SEED_LINES, validateGenerated } from '../server-lib/line-bank.ts';
import { TranscriptLog } from '../server-lib/transcripts.ts';
import { GEMINI_VOICES, VoiceCache, castVoice, stylePrompt } from '../server-lib/voice.ts';
import { VoiceService, type PlaybackHost } from '../server-lib/voice-service.ts';
import { DEFAULT_NPC_SETTINGS } from '../shared/settings.ts';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lls-voice-'));
const settings = (overrides: Record<string, boolean | number | string> = {}) => { const s = { ...DEFAULT_NPC_SETTINGS, ...overrides }; return () => s; };
const tick = () => new Promise(resolve => setTimeout(resolve, 15));

test('voice casting is stable per persona, uses documented voices and stays inside the spreads', () => {
  const get = settings();
  const a = castVoice('npc-1', get), b = castVoice('npc-1', get), c = castVoice('npc-2', get);
  assert.deepEqual(a, b);
  assert.ok((GEMINI_VOICES as readonly string[]).includes(a.geminiVoice));
  const voices = new Set(Array.from({ length: 200 }, (_, i) => castVoice('npc-' + i, get).geminiVoice));
  assert.ok(voices.size > 20, 'crowd uses many voices');
  for (const v of [a, c]) { assert.ok(Math.abs(v.pitch - 1) <= 0.08 + 1e-9); assert.ok(Math.abs(v.speed - 1) <= 0.12 + 1e-9); assert.ok(v.windowsRate >= -3 && v.windowsRate <= 3); assert.ok(Number.isSafeInteger(v.windowsVoiceIndex) && v.windowsVoiceIndex >= 0); }
  const flat = castVoice('npc-1', settings({ 'audio.pitchSpread': 0, 'audio.speedSpread': 0 }));
  assert.equal(flat.pitch, 1); assert.equal(flat.speed, 1); assert.equal(flat.windowsRate, 0);
});
test('style prompt follows the "Say <style>: text" form and maps tone and intensity', () => {
  const cast = { geminiVoice: 'Kore', windowsVoiceIndex: 0, windowsRate: 0, pitch: 1, speed: 1 };
  assert.equal(stylePrompt('Back off.', 'angry', cast, 0.9), 'Say clearly angry: Back off.');
  assert.equal(stylePrompt('Hi.', 'natural', cast, 0.9), 'Say naturally, like a Los Santos local: Hi.');
  assert.match(stylePrompt('Hi.', 'scared', { ...cast, pitch: 1.07, speed: 0.9 }, 0.2), /^Say barely scared, with a slightly higher voice, a little slowly: Hi\.$/);
});
test('voice cache evicts oldest owned files only and never touches foreign files', () => {
  const dir = temp(); const cache = new VoiceCache(dir, settings({ 'audio.cacheMegabytes': 32 }));
  const foreign = path.join(dir, 'keep-me.txt'); fs.writeFileSync(foreign, 'x');
  const k1 = cache.key(['a']), size = 2_800_000;
  cache.write(k1, Buffer.alloc(size)); fs.utimesSync(path.join(dir, cache.file(k1)), new Date(1000), new Date(1000));
  const later = Array.from({ length: 11 }, (_, i) => cache.key(['b' + i]));
  for (const k of later) cache.write(k, Buffer.alloc(size));
  const k2 = later.at(-1)!;
  assert.equal(cache.has(k1), false, 'oldest evicted past cap'); assert.equal(cache.has(k2), true); assert.equal(fs.existsSync(foreign), true);
  assert.throws(() => cache.write(cache.key(['odd']), Buffer.alloc(3)));
  assert.throws(() => cache.file('../evil'));
});
test('transcripts append generated lines, respect the toggle and cap retained entries', () => {
  const dir = temp(), file = path.join(dir, 't.jsonl');
  const entry = { runtimeId: 'r', sceneEpoch: 's', npcId: 'n', speaker: 'Bob', text: 'Hello.', source: 'fallback', lane: 'C', category: 'casual', voice: 'windows:1' };
  const off = new TranscriptLog(file, settings({ 'audio.transcriptsEnabled': false }));
  assert.equal(off.append(entry), false); assert.equal(fs.existsSync(file), false);
  const log = new TranscriptLog(file, settings({ 'audio.transcriptMaxEntries': 100 }));
  for (let i = 0; i < 125; i++) log.append({ ...entry, text: 'Line ' + i });
  assert.ok(log.count() <= 110); assert.equal(log.list(1)[0].text, 'Line 124');
  const reloaded = new TranscriptLog(file, settings({ 'audio.transcriptMaxEntries': 100 }));
  assert.equal(reloaded.list(1)[0].text, 'Line 124'); assert.ok(reloaded.count() <= 110);
  assert.equal(log.append({ ...entry, text: 'x'.repeat(900) }), false);
  log.clear(); assert.equal(log.count(), 0); assert.equal(fs.existsSync(file), false);
});
test('bank validation keeps only bounded, tagged, enumerated lines', () => {
  const lines = validateGenerated('combat', { lines: [
    { text: 'Cover me, I am reloading!', archetype: 'gang', tags: ['reload', 'bogus'], mood: 'urgent', intensity: 3, cooldownSeconds: 1 },
    { text: '<b>markup</b>', archetype: 'gang', tags: ['reload'], mood: 'urgent', intensity: 0.5, cooldownSeconds: 30 },
    { text: 'No tags here.', archetype: 'gang', tags: ['weather'], mood: 'urgent', intensity: 0.5, cooldownSeconds: 30 },
    { text: 'Wrong mood.', archetype: 'gang', tags: ['taunt'], mood: 'ecstatic', intensity: 0.5, cooldownSeconds: 30 },
  ] }, 5);
  assert.equal(lines.length, 1); assert.deepEqual(lines[0].tags, ['reload']); assert.equal(lines[0].intensity, 1); assert.equal(lines[0].cooldownSeconds, 5); assert.equal(lines[0].source, 'gemini');
  assert.throws(() => validateGenerated('combat', { lines: 'nope' }, 0));
});

function fakeProvider(text: string, configured = true) {
  const calls: string[] = [];
  const provider: AiProvider = { id: 'gemini', configured: () => configured, models: () => [], listModels: async () => [],
    streamStructured: async request => { calls.push(request.model); return { text, usage: { inputTokens: 100, outputTokens: 50, cachedTokens: 0, thoughtTokens: 0, totalTokens: 150, estimated: false }, firstTextMs: 5, durationMs: 10, finishReason: 'completed' }; } };
  return { provider, calls };
}
function bankFor(dir: string, get: ReturnType<typeof settings>, text = '{"lines":[]}', configured = true, now = () => 1_000_000) {
  const { provider, calls } = fakeProvider(text, configured);
  const budget = new AiBudget(undefined, get, now), scheduler = new AiScheduler(get, now);
  return { bank: new LineBank({ file: path.join(dir, 'bank.json'), provider, budget, scheduler, getSettings: get, now }), calls, budget };
}
test('bank picks seeds offline with cooldowns and never calls an unconfigured provider', () => {
  let clock = 1_000_000; const get = settings();
  const { bank, calls } = bankFor(temp(), get, '{}', false, () => clock);
  const first = bank.pick('combat', { tags: ['reload'] });
  assert.equal(first?.text, 'Reloading, cover me!'); assert.equal(first?.source, 'fallback');
  assert.notEqual(bank.pick('combat', { tags: ['reload'] })?.id, first?.id, 'cooldown excludes the same line');
  clock += 11_000; assert.equal(bank.pick('combat', { tags: ['reload'] })?.id, first?.id, 'line returns after its cooldown');
  assert.equal(calls.length, 0);
  assert.equal(bankFor(temp(), settings({ 'bank.enabled': false })).bank.pick('casual'), null);
  assert.equal(SEED_LINES.every(l => l.source === 'fallback'), true);
});
test('bank refill goes through budget and scheduler, persists AI lines and dedupes', async () => {
  const dir = temp(), get = settings({ 'bank.refillThreshold': 20, 'bank.maxLinesPerBucket': 24 });
  const generated = JSON.stringify({ lines: [{ text: 'You picked the wrong block, homie.', archetype: 'gang', tags: ['taunt'], mood: 'angry', intensity: 0.8, cooldownSeconds: 30 }, { text: 'You picked the wrong block, homie.', archetype: 'gang', tags: ['taunt'], mood: 'angry', intensity: 0.8, cooldownSeconds: 30 }] });
  const { bank, calls, budget } = bankFor(dir, get, generated);
  assert.equal(await bank.generate('combat'), 1);
  assert.deepEqual(calls, ['gemini-3.5-flash-lite']);
  assert.ok(budget.snapshot().spentEstimateUsd > 0, 'usage was charged');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'bank.json'), 'utf8'));
  assert.equal(saved.lines.length, 1); assert.equal(saved.lines[0].source, 'gemini');
  const reloaded = bankFor(dir, get).bank;
  assert.equal(reloaded.status().groups.combat.ai, 1);
});

function fakeHost() {
  const calls: { type: string; data: Record<string, any> }[] = []; let running = false;
  const host: PlaybackHost = { get running() { return running; }, start: async () => { running = true; return { requestId: 'x', success: true, type: 'capabilities' }; },
    request: async (type, data = {}) => { calls.push({ type, data }); return { requestId: 'x', success: true, type, durationMs: 1500, renderMs: 80 }; } };
  return { host, calls };
}
const frame = (o: Record<string, unknown> = {}) => ({ runtimeId: 'run1', sceneEpoch: 'ep1', paused: false, listener: { x: 0, y: 0, z: 0 }, right: { x: 1, y: 0, z: 0 }, playerInVehicle: false, playerInterior: 0,
  speakers: [{ npcId: 'npc-1', position: { x: 3, y: 4, z: 0 }, alive: true, interior: 0, inPlayerVehicle: false }], ...o });
const cue = (o: Record<string, unknown> = {}) => ({ cueId: 'cue-1', npcId: 'npc-1', speaker: 'Bob', text: 'Get out of my face.', tone: 'angry', category: 'conversation', source: 'gemini', lane: 'A', ...o });
function service(get = settings(), gemini?: unknown, clock = { t: 5_000_000 }) {
  const dir = temp(), { host, calls } = fakeHost();
  const now = () => clock.t, budget = new AiBudget(undefined, get, now), scheduler = new AiScheduler(get, now);
  const bank = new LineBank({ file: path.join(dir, 'bank.json'), provider: fakeProvider('{}', false).provider, budget, scheduler, getSettings: get, now });
  const transcripts = new TranscriptLog(path.join(dir, 't.jsonl'), get, now);
  return { voice: new VoiceService({ host, getSettings: get, directory: dir, bank, transcripts, gemini: gemini as never, budget, scheduler, now }), calls, transcripts, dir, clock, budget };
}
test('audio frames are strictly validated', () => {
  const { voice } = service();
  for (const bad of [frame({ extra: 1 }), frame({ listener: { x: NaN, y: 0, z: 0 } }), frame({ cues: [cue({ category: 'opera' })] }), frame({ cues: [cue({ text: 'x'.repeat(700) })] }), frame({ cues: [cue({ text: '<speak>' })] }), frame({ speakers: Array(9).fill(frame().speakers[0]) }), frame({ runtimeId: '../x' }), frame({ barks: [{ requestId: 'b', npcId: 'n', group: 'opera' }] })])
    assert.throws(() => voice.frame(bad));
});
test('a cue is transcribed, played once through Windows speech and spatialised with category gain', async () => {
  const { voice, calls, transcripts } = service();
  const r = voice.frame(frame({ cues: [cue()] }));
  assert.deepEqual(r.accepted, ['cue-1']);
  await tick();
  const types = calls.map(c => c.type);
  assert.deepEqual(types.slice(0, 2), ['playConfigure', 'play']);
  const play = calls[1].data; assert.equal(play.source, 'windows'); assert.equal(play.text, 'Get out of my face.'); assert.equal(play.npcId, 'npc-1'); assert.equal(play.category, 'conversation');
  const pos = calls.find(c => c.type === 'playPositions')!.data; assert.equal(pos.speakers[0].gain, 0.8); assert.equal(pos.speakers[0].lowPassHz, 20000); assert.equal(pos.maxDistance, 45);
  assert.equal(transcripts.list(1)[0].text, 'Get out of my face.'); assert.equal(transcripts.list(1)[0].lane, 'A');
  voice.frame(frame({ cues: [cue()] })); await tick();
  assert.equal(calls.filter(c => c.type === 'play').length, 1, 'duplicate cue ID ignored');
  const status = await voice.status(); assert.equal(status.metrics.played, 1); assert.equal(status.metrics.latencies[0].hostRenderMs, 80);
});
test('vehicle and interior separation muffle speakers; dead speakers are stopped', async () => {
  const { voice, calls } = service();
  voice.frame(frame({ cues: [cue()] })); await tick();
  voice.frame(frame({ playerInVehicle: true, playerInterior: 7 }));
  await tick();
  const pos = calls.filter(c => c.type === 'playPositions').at(-1)!.data.speakers[0];
  assert.ok(Math.abs(pos.gain - 0.8 * 0.65 * 0.8) < 1e-9); assert.equal(pos.lowPassHz, 1800);
  voice.frame(frame({ speakers: [{ ...frame().speakers[0], alive: false }] })); await tick();
  assert.equal(calls.filter(c => c.type === 'playStop').at(-1)!.data.id, 'cue-1');
});
test('pause and scene change stop all audio; stale cues and disabled audio are dropped but transcribed', async () => {
  const s = service();
  s.voice.frame(frame({ cues: [cue()] })); await tick();
  s.voice.frame(frame({ paused: true })); await tick();
  assert.ok(s.calls.some(c => c.type === 'playStopAll'));
  const before = s.calls.filter(c => c.type === 'playStopAll').length;
  s.voice.frame(frame({ sceneEpoch: 'ep2' })); await tick();
  assert.equal(s.calls.filter(c => c.type === 'playStopAll').length, before + 1);
  const off = service(settings({ 'audio.enabled': false }));
  off.voice.frame(frame({ cues: [cue()] })); await tick();
  assert.equal(off.calls.length, 0); assert.equal(off.transcripts.count(), 1);
  assert.equal((await off.voice.status()).metrics.dropped.audio_disabled, 1);
});
test('barks pick bank lines with per-speaker cooldowns and return subtitle text', async () => {
  const s = service();
  const r = s.voice.frame(frame({ barks: [{ requestId: 'b1', npcId: 'npc-1', speaker: 'Bob', group: 'combat', tags: ['reload'] }] }));
  assert.equal(r.barks.length, 1); assert.equal(r.barks[0].text, 'Reloading, cover me!'); assert.equal(r.barks[0].source, 'fallback');
  const again = s.voice.frame(frame({ barks: [{ requestId: 'b2', npcId: 'npc-1', speaker: 'Bob', group: 'combat', tags: ['taunt'] }] }));
  assert.equal(again.barks.length, 0, 'combat cooldown per speaker');
  s.clock.t += 6000;
  assert.equal(s.voice.frame(frame({ barks: [{ requestId: 'b3', npcId: 'npc-1', speaker: 'Bob', group: 'combat', tags: ['taunt'] }] })).barks.length, 1);
  await tick();
  assert.equal(s.transcripts.list(5).filter(e => e.lane === 'C').length, 2);
});
test('auto provider never starts a metered render; gemini provider renders through the budget and plays the cached file', async () => {
  const renders: string[] = [];
  const gemini = { model: 'gemini-3.8-flash-lite-tts', configured: () => true, render: async (req: any) => { renders.push(req.style); await req.onAudioChunk({ data: Buffer.alloc(4800), encoding: 'pcm_s16le', sampleRate: 24000, channels: 1, sequence: 0, final: true }); return { usage: { inputTokens: 20, outputTokens: 40, cachedTokens: 0, thoughtTokens: 0, totalTokens: 60, estimated: false }, durationMs: 50, firstChunkMs: 40 }; } };
  const auto = service(settings(), gemini);
  auto.voice.frame(frame({ cues: [cue()] })); await tick();
  assert.equal(renders.length, 0); assert.equal(auto.calls.find(c => c.type === 'play')!.data.source, 'windows');
  const metered = service(settings({ 'audio.provider': 'gemini' }), gemini);
  metered.voice.frame(frame({ cues: [cue()] })); await tick(); await tick();
  assert.equal(renders.length, 1); assert.match(renders[0], /^Say clearly angry(, [a-z ]+)*: Get out of my face\.$/);
  const play = metered.calls.find(c => c.type === 'play')!.data; assert.equal(play.source, 'file'); assert.match(play.file, /^[a-f0-9]{64}\.pcm$/);
  assert.ok(fs.existsSync(path.join(metered.dir, 'voice-cache', play.file)));
  assert.ok(metered.budget.snapshot().spentEstimateUsd > 0);
  metered.voice.frame(frame({ cues: [cue({ cueId: 'cue-2' })] })); await tick();
  assert.equal(renders.length, 1, 'second identical line served from cache');
});
