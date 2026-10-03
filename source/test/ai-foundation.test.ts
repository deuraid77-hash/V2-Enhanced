import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { AiBudget, budgetDay, estimateUsd } from '../server-lib/ai-budget.ts';
import { AiScheduler } from '../server-lib/ai-scheduler.ts';
import { GeminiProvider, SpeechSentenceExtractor, normalizeUsage } from '../server-lib/ai-provider.ts';
import { AiService, validateAiFrame, validateConversation } from '../server-lib/ai-service.ts';
import { AiError, type AiProvider, type AiSettings, type StructuredRequest, type StructuredResult, ZERO_USAGE } from '../server-lib/ai-types.ts';
import { installAiRoutes } from '../server-lib/ai-routes.ts';
import { WorldState, DEFAULT_SETTINGS } from '../server-lib/world.ts';
import { SettingsStore } from '../server-lib/settings-store.ts';
import { DEFAULT_NPC_SETTINGS } from '../shared/settings.ts';
import { meteredLegacyClient } from '../server-lib/ai-legacy.ts';

const settings = () => ({ ...DEFAULT_NPC_SETTINGS });
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'llai-ai-test-'));
function clean(directory: string) { const resolved = path.resolve(directory); assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('llai-ai-test-')); fs.rmSync(resolved, { recursive: true, force: true }); }
const usage = { inputTokens: 100, outputTokens: 80, cachedTokens: 20, thoughtTokens: 5, totalTokens: 185, estimated: false };
const reservation = (id = randomUUID()) => ({ id, model: 'gemini-3.8-flash', lane: 'A' as const, category: 'conversation', maxInputTokens: 1000, maxOutputTokens: 512 });
const scope = { runtimeId: 'runtime-1', sceneEpoch: 'scene-1', npcIds: ['npc-1'] };
const position = { x: 100, y: -1900, z: 20 };
const frame = () => ({ protocol: 4, ...scope, gameVersion: '1.0.1158.16', sdkGameVersion: '1.0.1013.33', pluginVersion: '4.0.0', appliedRevision: 0, appliedNpcRevision: 0,
  npcs: [{ id: 'npc-1', handle: 123, modelHash: -123456, name: 'Pedestrian', faction: 'Civilian/Unknown', archetype: 'Street resident', position, health: 150, alive: true, weapon: 'Unarmed', distance: 3, mind: { fear: 0, aggression: 0, morale: 70, trust: 50, respect: 50, mood: 'calm' }, recentDamage: 5, recentEvents: ['Observed health loss: 5'] }],
  player: { position, wantedLevel: 0, stance: 'Aiming', weaponDrawn: true, weaponDrawnName: 'Pistol', factionStandings: { Ballas: -5 }, districtStandings: { Davis: 10 } }, environment: { district: 'Davis', weather: 'CLEAR', timeOfDay: '12:00', nearbyGunfire: false },
  director: { enabled: true, settings: { ...DEFAULT_SETTINGS }, territories: [], activeEvents: [], ownedPedCount: 0, pausedReason: null }, events: [], acknowledgements: [], aiReceipts: [] as string[], aiOutcomes: [] as unknown[], tickMetrics: { lastMs: 0.4, maxMs: 1.5, p95Ms: 0.9, sampleCount: 100, deferred: 0 } });
const response = () => ({ speech: 'Hello there. What do you need?', voiceTone: 'friendly', action: 'TALK_CASUAL', mindDelta: { fear: -2, aggression: 1, morale: 2, trust: 3, respect: 4, factionRepDelta: 1, districtRepDelta: 0, mood: 'friendly' }, memoryEvents: [{ type: 'conversation', text: 'The player spoke to me.' }] });
const jobInput = (requestId = randomUUID()) => ({ requestId, ...scope, kind: 'conversation', lane: 'A', context: { playerUtterance: 'PRIVATE PLAYER WORDS' } });
class FixtureProvider implements AiProvider {
  id = 'fixture'; calls = 0; prompts: StructuredRequest[] = []; available = true;
  handler: (r: StructuredRequest) => Promise<StructuredResult> = async request => { const text = JSON.stringify(response()); request.onText?.(text.slice(0, 28)); request.onText?.(text.slice(28)); return { text, usage, firstTextMs: 1, durationMs: 4, finishReason: 'completed' }; };
  configured() { return this.available; }
  models() { return [{ id: 'gemini-3.8-flash', available: true, structuredOutput: true, streaming: true }]; }
  async listModels() { return this.models(); }
  async streamStructured(request: StructuredRequest) { this.calls++; this.prompts.push(request); return this.handler(request); }
}
async function settled(service: AiService, id: string) { for (let i = 0; i < 100; i++) { const job = service.job(id); if (!['queued', 'running', 'streaming'].includes(job.status)) return job; await new Promise(r => setTimeout(r, 5)); } throw new Error('Fixture job did not settle'); }

test('AI budget reserves before work, records actual token components, and caps at authorized $5', () => {
  const directory = temp(); try {
    const config = { ...settings(), 'ai.dailyBudgetUsd': 99 };
    const b = new AiBudget(path.join(directory, 'usage.json'), () => config);
    const r = reservation(); b.reserve(r);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'usage.json'), 'utf8')).reservations[0].id, r.id);
    assert.equal(b.snapshot().dailyLimitUsd, 5); assert.ok(b.snapshot().reservedEstimateUsd > 0);
    b.markStarted(r.id); assert.throws(() => b.release(r.id), /retain/);
    b.record(r.id, usage, { outcome: 'completed', durationMs: 10 }); b.record(r.id, usage, { outcome: 'completed', durationMs: 10 });
    assert.equal(b.snapshot().requests, 1); assert.equal(b.snapshot().usage.thoughtTokens, 5);
    assert.equal(b.snapshot().spentEstimateUsd, (80 * 0.75 + 20 * 0.075 + 85 * 3.75) / 1e6);
    config['ai.dailyBudgetUsd'] = 0;
    assert.throws(() => b.reserve(reservation()), /daily/);
  } finally { clean(directory); }
});
test('budget restart retains interrupted token reservations and prevents request ID reuse', () => {
  const directory = temp(); try { const file = path.join(directory, 'usage.json'); const b = new AiBudget(file, settings), r = reservation(); b.reserve(r); b.markStarted(r.id);
    const restart = new AiBudget(file, settings); assert.equal(restart.snapshot().unknownUsageRequests, 1); assert.equal(restart.snapshot().usage.inputTokens, 1000); assert.equal(restart.snapshot().usage.outputTokens, 512); assert.throws(() => restart.reserve(r), /receipt/); assert.ok(restart.snapshot().spentEstimateUsd > 0);
  } finally { clean(directory); }
});
test('budget corrupt ledger is preserved and fails closed', () => {
  const directory = temp(); try { const file = path.join(directory, 'usage.json'); const bad = JSON.stringify({ version: 1, day: '2026-10-03', charges: [{ usd: 0 }], reservations: [] }); fs.writeFileSync(file, bad); const b = new AiBudget(file, settings); assert.equal(b.snapshot().blocked, true); assert.throws(() => b.reserve(reservation()), /repair/); assert.equal(fs.readFileSync(file, 'utf8'), bad); } finally { clean(directory); }
});
test('concurrent ledger owners cannot overwrite a newer spending reservation', () => {
  const directory = temp(); try { const file = path.join(directory, 'usage.json'); const first = new AiBudget(file, settings), stale = new AiBudget(file, settings); const r = reservation(); first.reserve(r); const content = fs.readFileSync(file, 'utf8'); assert.throws(() => stale.reserve(reservation()), /another process/); assert.equal(fs.readFileSync(file, 'utf8'), content); assert.equal(JSON.parse(content).reservations[0].id, r.id); assert.equal(fs.existsSync(file + '.writer-lock'), false); } finally { clean(directory); }
});
test('budget rejects poisoned usage and unknown models and fails persistence before request', () => {
  const directory = temp(); try { const b = new AiBudget(undefined, settings); assert.throws(() => b.reserve({ ...reservation(), model: 'imaginary-model' }), /price/); const r = reservation(); b.reserve(r); assert.throws(() => b.record(r.id, { ...usage, thoughtTokens: NaN }, { outcome: 'completed', durationMs: 1 }), /usage/); assert.ok(b.snapshot().reservedEstimateUsd > 0); const blocker = path.join(directory, 'file'); fs.writeFileSync(blocker, 'keep'); const broken = new AiBudget(path.join(blocker, 'usage.json'), settings); assert.throws(() => broken.reserve(reservation()), /saved/); assert.equal(fs.readFileSync(blocker, 'utf8'), 'keep'); } finally { clean(directory); }
});
test('Sydney daily reset handles daylight saving and carries active reservations', () => {
  assert.equal(budgetDay(Date.parse('2026-10-03T13:59:59Z')), '2026-10-03');
  assert.equal(budgetDay(Date.parse('2026-10-03T14:00:00Z')), '2026-10-04');
  assert.equal(budgetDay(Date.parse('2026-10-04T12:59:59Z')), '2026-10-04');
  assert.equal(budgetDay(Date.parse('2026-10-04T13:00:00Z')), '2026-10-05');
  let now = Date.parse('2026-10-04T12:59:59Z'); const b = new AiBudget(undefined, settings, () => now), r = reservation(); b.reserve(r); b.markStarted(r.id); now += 2000;
  assert.equal(b.snapshot().day, '2026-10-05'); assert.ok(b.snapshot().reservedEstimateUsd > 0); b.record(r.id, null, { outcome: 'cancelled', durationMs: 2000 }); assert.ok(b.snapshot().spentEstimateUsd > 0);
});
test('date-versioned Gemini prices include thought tokens and scheduled 2027 change', () => {
  const value = { inputTokens: 1000000, outputTokens: 500000, cachedTokens: 0, thoughtTokens: 500000 };
  assert.equal(estimateUsd('gemini-3.8-flash', value, Date.parse('2026-12-31')), 4.5);
  assert.equal(estimateUsd('gemini-3.8-flash', value, Date.parse('2027-01-01')), 9);
  assert.equal(estimateUsd('gemini-3.8-flash-lite-tts', { ...value, outputTokens: 1000000, thoughtTokens: 0 }, Date.parse('2026-10-03')), 6.5);
});
test('restart across Sydney midnight retains unknown in-flight charges in the new day', () => {
  const directory = temp(); try { let now = Date.parse('2026-10-04T12:59:59Z'); const file = path.join(directory, 'usage.json'), b = new AiBudget(file, settings, () => now), r = reservation(); b.reserve(r); b.markStarted(r.id); now += 2000; const restart = new AiBudget(file, settings, () => now); assert.equal(restart.snapshot().day, '2026-10-05'); assert.equal(restart.snapshot().unknownUsageRequests, 1); assert.ok(restart.snapshot().spentEstimateUsd > 0); } finally { clean(directory); }
});
test('ledger rejects malformed usage on reload without refunding unknown reservations', () => {
  const directory = temp(); try { const file = path.join(directory, 'usage.json'), b = new AiBudget(file, settings), r = reservation(); b.reserve(r); b.record(r.id, usage, { outcome: 'completed', durationMs: 1 }); const saved = JSON.parse(fs.readFileSync(file, 'utf8')); saved.charges[0].usage.cachedTokens = 99999; fs.writeFileSync(file, JSON.stringify(saved)); const restart = new AiBudget(file, settings); assert.equal(restart.snapshot().blocked, true); assert.throws(() => restart.reserve(reservation()), /repair/); } finally { clean(directory); }
});
test('scheduler preserves a live slot and cancels queued and running work on scene change', async () => {
  const scheduler = new AiScheduler(() => ({ ...settings(), 'ai.maxConcurrent': 2, 'ai.liveReservedSlots': 1 })); const started: string[] = [];
  const run = (id: string, lane: 'A' | 'B' | 'C') => scheduler.submit({ id, lane, scope, run: signal => { started.push(id); return new Promise<void>((_r, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); } }).catch(e => e.code);
  const low1 = run('low1', 'C'), low2 = run('low2', 'C'), live = run('live', 'A'); await new Promise(r => setImmediate(r));
  assert.deepEqual(started, ['low1', 'live']); assert.equal(scheduler.snapshot().queued, 1);
  scheduler.invalidateScope('runtime-1', 'scene-2', ['npc-1']); assert.deepEqual(await Promise.all([low1, low2, live]), ['stale_scene', 'stale_scene', 'stale_scene']);
});
test('scheduler deadlines include queue time and settle providers that ignore cancellation', async () => {
  const scheduler = new AiScheduler(() => ({ ...settings(), 'ai.maxConcurrent': 1, 'ai.liveReservedSlots': 0, 'ai.requestTimeoutMs': 25 }));
  const first = scheduler.submit({ id: 'stalled', lane: 'A', scope, run: () => new Promise(() => {}) }).catch(e => e.code);
  const second = scheduler.submit({ id: 'queued', lane: 'A', scope, run: () => new Promise(() => {}) }).catch(e => e.code);
  const keepAlive = setTimeout(() => {}, 100);
  try { assert.deepEqual(await Promise.all([first, second]), ['timeout', 'timeout']); } finally { clearTimeout(keepAlive); }
});
test('cancelled non-cooperative transport retains its physical concurrency slot until settled', async () => {
  const s = new AiScheduler(() => ({ ...settings(), 'ai.maxConcurrent': 1, 'ai.liveReservedSlots': 0 }));
  let release!: () => void, secondStarted = false;
  const first = s.submit({ id: 'physical-1', lane: 'A', scope, run: () => new Promise<void>(resolve => { release = resolve; }) }).catch(e => e.code);
  await new Promise(r => setImmediate(r)); s.cancel('physical-1'); assert.equal(await first, 'cancelled');
  const second = s.submit({ id: 'physical-2', lane: 'A', scope, run: async () => { secondStarted = true; } });
  await new Promise(r => setImmediate(r)); assert.equal(secondStarted, false); assert.equal(s.snapshot().running, 1); assert.equal(s.snapshot().queued, 1);
  release(); await second; assert.equal(secondStarted, true);
});
test('missing or inconsistent provider usage retains the full conservative reservation', () => {
  for (const raw of [{}, { total_input_tokens: 100, total_output_tokens: 0 }, { total_input_tokens: -1, total_output_tokens: 0, total_tokens: -1 }, { total_input_tokens: 2, total_output_tokens: 3, total_tokens: 99 }]) {
    const normalized = normalizeUsage(raw); assert.equal(normalized.estimated, true);
    const b = new AiBudget(undefined, settings), r = b.reserve(reservation()); b.markStarted(r.id); b.record(r.id, normalized, { outcome: 'completed', durationMs: 1 }); assert.equal(b.snapshot().spentEstimateUsd, r.estimatedUsd); assert.equal(b.snapshot().unknownUsageRequests, 1);
  }
});
test('circuit breaker opens, permits one recovery probe, and closes on success', () => {
  let now = 0; const s = new AiScheduler(() => ({ ...settings(), 'ai.breakerFailureThreshold': 2, 'ai.breakerOpenSeconds': 10 }), () => now);
  s.providerFailed(true); s.providerFailed(true); assert.equal(s.snapshot().breaker.state, 'open'); assert.throws(() => s.admitProvider(), /unavailable/); now = 11000; s.admitProvider(); assert.throws(() => s.admitProvider(), /unavailable/); s.providerSucceeded(); assert.equal(s.snapshot().breaker.state, 'closed');
});
test('stream extractor handles split JSON escapes, bounded speech, and game markup injection', () => {
  const x = new SpeechSentenceExtractor(80); assert.deepEqual(x.push('{"speech":"Hi \\u00'), []); assert.deepEqual(x.push('e9. Next sentence'), ['Hi é.']); assert.deepEqual(x.push('!","action":"ATTACK_MELEE"}'), ['Next sentence!']);
  assert.deepEqual(new SpeechSentenceExtractor().push('{"action":"ATTACK_MELEE","speech":"bad"}'), []);
  assert.throws(() => new SpeechSentenceExtractor().push('{"speech":"~r~Injected. '), /control/);
  assert.throws(() => new SpeechSentenceExtractor(5).push('{"speech":"123456"}'), /length/);
});
test('response validator rejects injected actions, fields, oversized deltas and markup', () => {
  assert.throws(() => validateConversation({ ...response(), action: 'EXECUTE_CONSOLE' }), /unavailable/);
  assert.throws(() => validateConversation({ ...response(), shell: 'not-executed' }), /unsupported/);
  assert.throws(() => validateConversation({ ...response(), mindDelta: { ...response().mindDelta, fear: -41 } }), /range/);
  assert.throws(() => validateConversation({ ...response(), speech: '~r~spoof' }), /markup/);
});
test('complete protocol 4 NPC fields preserve meaningful zeros and measured metadata', () => {
  const f = validateAiFrame(frame()); assert.equal(f.npcs[0].mind.fear, 0); assert.equal(f.npcs[0].mind.aggression, 0); assert.equal(f.player!.stance, 'Aiming'); assert.equal(f.player!.weaponDrawnName, 'Pistol'); assert.deepEqual(f.player!.factionStandings, { Ballas: -5 }); assert.equal(f.tickMetrics.lastMs, 0.4); assert.equal(f.gameFileVersion, '1.0.1158.16'); assert.equal(f.sdkGameVersion, '1.0.1013.33');
  assert.throws(() => validateAiFrame({ ...frame(), npcs: [{ ...frame().npcs[0], mind: { ...frame().npcs[0].mind, trust: -1 } }] }), /trust/);
  assert.throws(() => validateAiFrame({ ...frame(), npcs: Array(33).fill(frame().npcs[0]) }), /list/);
});
test('conversation uses observed NPC context, streams speech only, validates action, acks and deduplicates', async () => {
  const directory = temp(); const provider = new FixtureProvider(); const s = new AiService({ provider, getSettings: settings, directory });
  try { s.observe(validateAiFrame(frame())); const input = jobInput(), job = s.enqueue(input); assert.equal(s.enqueue(input).id, job.id);
    const result = await settled(s, job.id); assert.equal(result.status, 'completed'); assert.equal(provider.calls, 1);
    assert.match(provider.prompts[0].prompt, /"fear":0/); assert.match(provider.prompts[0].prompt, /"stance":"Aiming"/); assert.match(provider.prompts[0].prompt, /"weaponDrawnName":"Pistol"/);
    const deliveries = s.deliveries(); assert.ok(deliveries.some(d => d.kind === 'speech')); assert.equal(deliveries.find(d => d.kind === 'speech')!.payload.actions, undefined);
    const action = (result.result!.actions as any[])[0]; assert.equal(action.expectedHandle, 123); assert.equal(action.expectedModelHash, -123456); assert.equal(action.sceneEpoch, scope.sceneEpoch);
    assert.ok(!JSON.stringify(s.status()).includes('PRIVATE PLAYER WORDS')); assert.ok(!fs.readFileSync(path.join(directory, 'ai-jobs.json'), 'utf8').includes('PRIVATE PLAYER WORDS'));
    s.observe(validateAiFrame({ ...frame(), aiReceipts: deliveries.map(d => d.id), aiOutcomes: [{ actionId: action.actionId, jobId: job.id, status: 'applied', message: 'Fixture only task accepted' }] })); assert.equal(s.deliveries().length, 0);
    const restart = new AiService({ provider, getSettings: settings, directory }); restart.observe(validateAiFrame(frame())); assert.equal(restart.enqueue(input).status, 'cancelled'); assert.equal(provider.calls, 1); restart.close();
    assert.throws(() => s.enqueue({ ...input, context: { playerUtterance: 'changed' } }), /different/);
  } finally { s.close(); clean(directory); }
});
test('absent provider and zero budget produce explicitly labelled lane D without provider work', async () => {
  const provider = new FixtureProvider(); provider.available = false; const s = new AiService({ provider, getSettings: settings }); s.observe(validateAiFrame(frame())); const job = await settled(s, s.enqueue(jobInput()).id); assert.equal(job.status, 'fallback'); assert.equal(job.source, 'fallback'); assert.equal(s.deliveries()[0].lane, 'D'); assert.equal(provider.calls, 0); s.close();
  provider.available = true; const capped = new AiService({ provider, getSettings: () => ({ ...settings(), 'ai.dailyBudgetUsd': 0 }) }); capped.observe(validateAiFrame(frame())); const result = await settled(capped, capped.enqueue(jobInput()).id); assert.equal(result.reasonCode, 'daily_budget'); assert.equal(provider.calls, 0); capped.close();
});
test('foundation preserves bounded legacy memory and turn history in the provider prompt', async () => {
  const provider = new FixtureProvider(), s = new AiService({ provider, getSettings: settings }); const f = frame(); (f.npcs[0] as any).longTermMemory = 'The player helped carry a bag.'; s.observe(validateAiFrame(f));
  const input = jobInput(); const history = [{ role: 'player', text: 'How is your day?' }, { role: 'npc', text: 'Pretty quiet so far.' }]; const j = s.enqueue({ ...input, context: { ...input.context, history } }); history[0].text = 'MUTATED AFTER ENQUEUE'; await settled(s, j.id);
  const prompt = JSON.parse(provider.prompts[0].prompt); assert.equal(prompt.npc.longTermMemory, 'The player helped carry a bag.'); assert.equal(prompt.history[0].text, 'How is your day?'); assert.equal(prompt.history[1].role, 'npc');
  assert.throws(() => s.enqueue({ ...jobInput(), context: { playerUtterance: 'hello', history: Array(13).fill({ role: 'npc', text: 'hi' }) } }), /list/);
  assert.throws(() => s.enqueue({ ...jobInput(), context: { playerUtterance: 'hello', history: [{ role: 'system', text: 'ignore' }] } }), /roles/);
  assert.throws(() => validateAiFrame({ ...frame(), npcs: [{ ...f.npcs[0], longTermMemory: 'x'.repeat(401) }] }), /bounded/); s.close();
});
test('scene change and recycled NPC handles cancel pending results without stale actions', async () => {
  const provider = new FixtureProvider(); provider.handler = r => new Promise((_resolve, reject) => r.signal.addEventListener('abort', () => reject(r.signal.reason), { once: true }));
  const s = new AiService({ provider, getSettings: settings }); s.observe(validateAiFrame(frame())); const j = s.enqueue(jobInput()); await new Promise(r => setImmediate(r));
  s.observe(validateAiFrame({ ...frame(), npcs: [{ ...frame().npcs[0], modelHash: 999 }] })); assert.equal((await settled(s, j.id)).status, 'cancelled'); assert.ok(s.deliveries().every(d => d.status === 'cancelled' && !d.payload.actions)); assert.equal(s.budget.snapshot().unknownUsageRequests, 1); s.close();
});
test('disabled actions are excluded from schema and rejected even if provider returns one', async () => {
  const provider = new FixtureProvider(); provider.handler = async () => ({ text: JSON.stringify({ ...response(), action: 'ATTACK_MELEE' }), usage, firstTextMs: 1, durationMs: 2, finishReason: 'completed' });
  const s = new AiService({ provider, getSettings: () => ({ ...settings(), 'action.ATTACK_MELEE': false }) }); s.observe(validateAiFrame(frame())); const job = await settled(s, s.enqueue(jobInput()).id); assert.equal(job.status, 'fallback'); assert.equal(job.reasonCode, 'action_disabled'); assert.ok(!(provider.prompts[0].schema as any).properties.action.enum.includes('ATTACK_MELEE')); assert.equal((job.result!.actions as any[])[0].type, 'TALK_CASUAL'); s.close();
});
test('all action toggles off rejects explicitly; disabled TALK cannot sneak into fallback', async () => {
  const provider = new FixtureProvider(), config = settings();
  for (const key of Object.keys(config)) if (key.startsWith('action.')) config[key] = false;
  const s = new AiService({ provider, getSettings: () => config }); s.observe(validateAiFrame(frame())); const allOff = await settled(s, s.enqueue(jobInput()).id); assert.equal(allOff.status, 'failed'); assert.equal(allOff.reasonCode, 'actions_disabled'); assert.equal(provider.calls, 0); assert.ok(s.deliveries().every(d => !d.payload.actions)); s.close();
  provider.available = false; const fallback = new AiService({ provider, getSettings: () => ({ ...settings(), 'action.TALK_CASUAL': false }) }); fallback.observe(validateAiFrame(frame())); const result = await settled(fallback, fallback.enqueue(jobInput()).id); assert.equal(result.status, 'failed'); assert.equal(result.result, undefined); assert.ok(fallback.deliveries().every(d => !d.payload.actions)); fallback.close();
});
test('malformed response after streamed sentence cannot execute actions or trigger duplicate fallback', async () => {
  const provider = new FixtureProvider(); provider.handler = async request => { request.onText!('{"speech":"One valid sentence. '); return { text: '{invalid', usage, firstTextMs: 1, durationMs: 2, finishReason: 'completed' }; };
  const s = new AiService({ provider, getSettings: settings }); s.observe(validateAiFrame(frame())); const job = await settled(s, s.enqueue(jobInput()).id); assert.equal(job.status, 'failed'); assert.equal(provider.calls, 1); assert.equal(s.deliveries().length, 1); assert.equal(s.deliveries()[0].status, 'failed'); assert.equal(s.deliveries()[0].payload.actions, undefined); assert.equal(s.budget.snapshot().requests, 1); s.close();
});
test('configured speech limit is enforced before the first sentence callback', async () => {
  const provider = new FixtureProvider(); provider.handler = async request => { request.onText!('{"speech":"' + 'x'.repeat(81) + '. '); throw new Error('not reached'); }; let called = false;
  const s = new AiService({ provider, getSettings: () => ({ ...settings(), 'ai.maxSpeechCharacters': 80 }), onSentence: () => { called = true; } }); s.observe(validateAiFrame(frame())); const result = await settled(s, s.enqueue(jobInput()).id); assert.equal(result.status, 'fallback'); assert.equal(called, false); assert.equal(s.deliveries().filter(d => d.kind === 'speech').length, 0); s.close();
});
test('turning AI off cancels pending requests and delivers only a terminal cancellation', async () => {
  const config = settings(), provider = new FixtureProvider(); provider.handler = r => new Promise((_resolve, reject) => r.signal.addEventListener('abort', () => reject(r.signal.reason), { once: true }));
  const s = new AiService({ provider, getSettings: () => config }); s.observe(validateAiFrame(frame())); const job = s.enqueue(jobInput()); await new Promise(r => setImmediate(r)); config['ai.enabled'] = false; s.settingsChanged(); assert.equal((await settled(s, job.id)).status, 'cancelled'); assert.ok(s.deliveries().every(d => d.status === 'cancelled' && !d.payload.actions)); assert.throws(() => s.enqueue(jobInput()), /disabled/); s.close();
});
test('switching provider offline cancels streamed work while retaining its occupied physical slot', async () => {
  const config: AiSettings = { ...settings(), 'ai.maxConcurrent': 1, 'ai.liveReservedSlots': 0 }, provider = new FixtureProvider(); let finish!: () => void;
  provider.handler = request => new Promise(resolve => { request.onText?.('{"speech":"Started speaking. '); finish = () => resolve({ text: JSON.stringify(response()), usage, firstTextMs: 1, durationMs: 10, finishReason: 'completed' }); });
  const s = new AiService({ provider, getSettings: () => config }); s.observe(validateAiFrame(frame())); const job = s.enqueue(jobInput()); await new Promise(resolve => setImmediate(resolve));
  assert.ok(s.deliveries().some(d => d.kind === 'speech')); config['ai.provider'] = 'offline'; s.settingsChanged(); assert.equal((await settled(s, job.id)).status, 'cancelled'); assert.equal(s.scheduler.snapshot().running, 1); assert.ok(s.deliveries().every(d => d.status === 'cancelled' && !d.payload.actions));
  let nextRan = false; const next = s.scheduler.submit({ id: 'waiting-after-offline', lane: 'A', scope, run: async () => { nextRan = true; } }); await new Promise(resolve => setImmediate(resolve)); assert.equal(nextRan, false); finish(); await next;
  assert.equal(s.job(job.id).status, 'cancelled'); assert.ok(s.deliveries().every(d => d.status === 'cancelled' && !d.payload.actions)); assert.equal(s.scheduler.snapshot().running, 0); s.close();
});

test('legacy provider call shares ledger, adds output limit, and refuses unpriced tools', async () => {
  let called = 0, captured: any; const fake = { models: { generateContent: async (value: any) => { called++; captured = value; return { text: 'reply', usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, thoughtsTokenCount: 5, totalTokenCount: 35 } }; } }, interactions: {} };
  const budget = new AiBudget(undefined, settings), scheduler = new AiScheduler(settings), legacy = meteredLegacyClient(fake as any, budget, scheduler, () => scope, settings);
  await legacy.models.generateContent({ model: 'gemini-3.8-flash', contents: 'private' }); assert.equal(called, 1); assert.equal(captured.config.maxOutputTokens, 2048); assert.equal(budget.snapshot().requests, 1); assert.equal(budget.snapshot().usage.thoughtTokens, 5);
  await assert.rejects(() => legacy.models.generateContent({ model: 'gemini-3.8-flash', contents: 'private', config: { tools: [{ googleSearch: {} }] } }), /price/); assert.equal(called, 1);
});
test('legacy requests obey current master settings before enqueue and again after waiting', async () => {
  const config: AiSettings = { ...settings(), 'ai.maxConcurrent': 1, 'ai.liveReservedSlots': 0 }; let calls = 0;
  const fake = { models: { generateContent: async () => { calls++; return {}; } }, interactions: {} };
  const budget = new AiBudget(undefined, () => config), scheduler = new AiScheduler(() => config), legacy = meteredLegacyClient(fake as any, budget, scheduler, () => scope, () => config);
  for (const key of ['ai.enabled', 'general.enabled', 'general.safeMode', 'ai.provider']) { const old = config[key]; config[key] = key === 'ai.provider' ? 'offline' : key === 'general.safeMode'; await assert.rejects(() => legacy.models.generateContent({ model: 'gemini-3.8-flash', contents: 'public fixture' }), /disabled/); config[key] = old; }
  let release!: () => void; const hold = scheduler.submit({ id: 'hold', lane: 'A', scope, run: () => new Promise<void>(resolve => { release = resolve; }) }); await new Promise(r => setImmediate(r));
  const queued = legacy.models.generateContent({ model: 'gemini-3.8-flash', contents: 'public fixture' }); config['ai.enabled'] = false; release(); await hold; await assert.rejects(() => queued, /disabled/); assert.equal(calls, 0); assert.equal(budget.snapshot().requests, 0);
});
test('real HTTP v4 exchange, settings, jobs and stale targets; legacy v3 validator unchanged', async () => {
  const app = express(); app.use(express.json()); const provider = new FixtureProvider(), s = new AiService({ provider, getSettings: settings }), world = new WorldState(), store = new SettingsStore(); installAiRoutes(app, s, world, store, () => {});
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); }); const address = server.address() as { port: number }, base = `http://127.0.0.1:${address.port}`;
  const post = (route: string, body: unknown) => fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try { const rejected = await post('/api/ai/jobs', jobInput()); assert.equal(rejected.status, 409);
    const exchange = await post('/api/runtime/exchange', frame()); assert.equal(exchange.status, 200); const payload = await exchange.json(); assert.equal(payload.protocol, 4); assert.equal(payload.npcSettings.settings['ai.dailyBudgetUsd'], 5); assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 65536);
    assert.throws(() => world.exchange(frame()), /protocol 3/);
    const accepted = await post('/api/ai/jobs', jobInput()); assert.equal(accepted.status, 202); const job = (await accepted.json()).job; await settled(s, job.id);
    const received = await (await post('/api/runtime/exchange', frame())).json(); assert.ok(received.aiUpdates.some((u: any) => u.kind === 'conversation'));
    const status = await (await fetch(base + '/api/ai/status')).json(); assert.equal(status.runtime.gameFileVersion, '1.0.1158.16'); assert.ok(!JSON.stringify(status).includes('PRIVATE PLAYER WORDS'));
    const bad = await post('/api/runtime/exchange', { ...frame(), aiReceipts: Array(65).fill(randomUUID()) }); assert.equal(bad.status, 400);
  } finally { s.close(); await new Promise<void>(r => server.close(() => r())); }
});
test('Gemini adapter requests stateless structured streaming and preserves actual usage', async () => {
  let args: any, options: any;
  const client = { interactions: { create: async (a: any, o: any) => { args = a; options = o; return (async function* () { yield { event_type: 'step.delta', delta: { type: 'text', text: '{"speech":"Hello"}' } }; yield { event_type: 'interaction.completed', interaction: { status: 'completed', usage: { total_input_tokens: 7, total_output_tokens: 20, total_thought_tokens: 22, total_tokens: 49 } } }; })(); } } };
  const p = new GeminiProvider(() => client as any, () => true), signal = new AbortController().signal;
  const r = await p.streamStructured({ model: 'gemini-3.8-flash', system: 'system', prompt: 'private', schema: { type: 'object' }, maxOutputTokens: 128, signal }); assert.equal(args.store, false); assert.equal(args.stream, true); assert.equal(options.signal, signal); assert.equal(options.retries.strategy, 'none'); assert.equal(r.usage.thoughtTokens, 22); assert.equal(r.usage.totalTokens, 49);
  assert.equal(args.generation_config.thinking_level, 'low');
});
test('Gemini incomplete stream preserves reported billable thoughts on its error', async () => {
  const client = { interactions: { create: async () => (async function* () { yield { event_type: 'interaction.completed', interaction: { status: 'incomplete', usage: { total_input_tokens: 20, total_output_tokens: 0, total_thought_tokens: 128, total_tokens: 148 } } }; })() } };
  const p = new GeminiProvider(() => client as any, () => true);
  await assert.rejects(() => p.streamStructured({ model: 'gemini-3.8-flash', system: 'system', prompt: 'private', schema: {}, maxOutputTokens: 128, signal: new AbortController().signal }), (error: AiError) => error.code === 'provider_incomplete' && error.usage?.thoughtTokens === 128);
});
