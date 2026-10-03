import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { MenuAiService, type AdvisorProposal, type MenuKind } from '../server-lib/ai-menu.ts';
import { installMenuAiRoutes } from '../server-lib/ai-menu-routes.ts';
import { AiBudget } from '../server-lib/ai-budget.ts';
import { AiScheduler } from '../server-lib/ai-scheduler.ts';
import { AiError, type AiProvider, type StructuredRequest, type StructuredResult } from '../server-lib/ai-types.ts';
import { SettingsStore } from '../server-lib/settings-store.ts';
import { WorldState } from '../server-lib/world.ts';
import { createDiagnosticReport } from '../server-lib/diagnostics.ts';
import { menuFixtureResponse } from './fixtures/menu-provider-response.ts';
const measuredUsage = { inputTokens: 200, outputTokens: 80, cachedTokens: 0, thoughtTokens: 0, totalTokens: 280, estimated: false };
class MenuFixtureProvider implements AiProvider {
  id = 'fixture'; calls = 0; requests: StructuredRequest[] = []; enabled = true;
  configured() { return this.enabled; }
  models() { return [{ id: 'gemini-3.5-flash-lite', available: true, structuredOutput: true, streaming: true }]; }
  async listModels() { return this.models(); }
  response(request: StructuredRequest): unknown {
    const schema = request.schema as any;
    if (schema.properties.changes) return { summary: 'Reduce autonomous encounter frequency and background AI frequency.', changes: [{ key: 'world.eventIntervalSeconds', value: 120, reason: 'Longer gaps reduce repeated encounters.' }, { key: 'ai.directorIntervalSeconds', value: 15, reason: 'Less frequent background requests reduce cost.' }] };
    if (schema.properties.text) return { text: 'This option limits concurrent provider calls. Lower values reduce resource pressure but can increase waiting time.' };
    if (schema.properties.findings) return { summary: 'No game session is currently connected.', findings: [{ severity: 'info', message: 'The observed connection flag is false; start Story Mode to send telemetry.' }], suggestedSettingKeys: ['ai.maxConcurrent'] };
    return { ok: true };
  }
  handler?: (request: StructuredRequest) => Promise<StructuredResult>;
  async streamStructured(request: StructuredRequest) { this.calls++; this.requests.push(request); return this.handler ? this.handler(request) : { text: JSON.stringify(this.response(request)), usage: measuredUsage, firstTextMs: 3, durationMs: 10, finishReason: 'completed' }; }
}
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'llai-menu-test-'));
  let now = Date.parse('2026-10-03T08:00:00Z');
  const store = new SettingsStore(path.join(directory, 'settings.json'), () => now), world = new WorldState(); store.bindWorld(world);
  const provider = new MenuFixtureProvider(), get = () => store.snapshot().settings;
  const budget = new AiBudget(path.join(directory, 'usage.json'), get, () => now), scheduler = new AiScheduler(get, () => now);
  const options = { provider, budget, scheduler, getSettings: get, snapshot: () => store.snapshot(), previewBundle: (npc: any, director: any) => { store.previewBundle(npc, director); }, applyBundle: (npc: any, director: any, revision: number, worldRevision: number) => store.configureBundle(npc, director, 'advisor', revision, worldRevision), diagnosticReport: () => createDiagnosticReport({ settings: store.snapshot(), world: world.snapshot(), ai: { capabilities: { provider: 'gemini' }, budget: budget.snapshot() } }), directory, now: () => now };
  const service = new MenuAiService(options);
  return { directory, provider, store, world, budget, scheduler, service, options, advance: (ms: number) => { now += ms; }, clean() { service.close(); scheduler.cancelAll(); const absolute = path.resolve(directory); assert.ok(absolute.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(absolute).startsWith('llai-menu-test-')); fs.rmSync(absolute, { recursive: true, force: true }); } };
}
const input = (kind: MenuKind = 'advisor', requestId = randomUUID()) => ({ requestId, kind, context: kind === 'advisor' ? { intent: 'Reduce fights and aggression and lower AI costs.' } : kind === 'explain' ? { settingKey: 'ai.maxConcurrent' } : {} });
async function settled(service: MenuAiService, id: string) { for (let i = 0; i < 150; i++) { const job = service.job(id); if (!['queued', 'running'].includes(job.status)) return job; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('Menu fixture did not settle'); }
const revisions = (p: AdvisorProposal) => ({ expectedRevision: p.expectedRevision, expectedWorldRevision: p.expectedWorldRevision });
async function proposal(f: ReturnType<typeof fixture>): Promise<AdvisorProposal> { const job = await settled(f.service, f.service.enqueue(input()).id); assert.equal(job.status, 'completed'); return job.result!.proposal as AdvisorProposal; }

test('advisor preview has typed diffs and never changes either settings authority before accept', async () => {
  const f = fixture(); try { const before = f.store.snapshot(), p = await proposal(f); assert.equal(p.status, 'preview'); assert.equal(p.changes.length, 2); assert.deepEqual(f.store.snapshot(), before); assert.equal(p.expectedRevision, before.revision); assert.equal(p.expectedWorldRevision, before.world.revision); assert.equal(p.settingsPatch['ai.directorIntervalSeconds'], 15); assert.equal(p.worldPatch.eventIntervalSeconds, 120); assert.equal(f.budget.snapshot().requests, 1); assert.equal(f.provider.requests[0].maxOutputTokens, 1024); assert.ok(Buffer.byteLength(f.provider.requests[0].prompt + JSON.stringify(f.provider.requests[0].schema)) < 15000); } finally { f.clean(); }
});

test('native fixture advisor respects each candidate key allowlist and remains repeatable after acceptance', async () => {
  const f = fixture(); try {
    f.provider.response = menuFixtureResponse;
    for (const intent of ['Make the controls comfortable.', 'Improve sound and voices.', 'Change world.eventIntervalSeconds and ai.directorIntervalSeconds to reduce their frequencies for this isolated QA fixture.']) {
      const job = await settled(f.service, f.service.enqueue({ ...input(), context: { intent } }).id); assert.equal(job.status, 'completed');
      const p = job.result!.proposal as AdvisorProposal, request = f.provider.requests.at(-1)!;
      const allowed = (request.schema as any).properties.changes.items.properties.key.enum;
      assert.ok(p.changes.every(c => allowed.includes(c.key)));
      if (intent.startsWith('Change ')) { assert.equal(p.changes.length, 2); f.service.accept(p.id, revisions(p)); }
    }
    const repeat = await settled(f.service, f.service.enqueue({ ...input(), context: { intent: 'Change world.eventIntervalSeconds and ai.directorIntervalSeconds.' } }).id);
    assert.equal(repeat.status, 'completed'); const p = repeat.result!.proposal as AdvisorProposal; assert.equal(p.changes.length, 2); assert.equal(p.worldPatch.eventIntervalSeconds, 150); assert.equal(p.settingsPatch['ai.directorIntervalSeconds'], 12);
  } finally { f.clean(); }
});
test('explicit advisor acceptance atomically updates NPC and world values once, then replay is inert', async () => {
  const f = fixture(); try { const p = await proposal(f), accepted = f.service.accept(p.id, revisions(p)); assert.equal(accepted.proposal.status, 'accepted'); assert.equal(f.store.snapshot().revision, 2); assert.equal(f.store.snapshot().world.revision, 2); assert.equal(f.world.snapshot().config.settings.eventIntervalSeconds, 120); assert.equal(f.store.snapshot().settings['ai.directorIntervalSeconds'], 15); const again = f.service.accept(p.id, revisions(p)); assert.equal(again.npcSettings.revision, 2); assert.equal(f.provider.calls, 1); assert.throws(() => f.service.reject(p.id), /accepted/); } finally { f.clean(); }
});
test('advisor accepts no stale NPC or world revision and makes no partial edit', async () => {
  const f = fixture(); try { const p = await proposal(f); f.store.configure({ 'audio.masterVolume': 0.8 }, 'portal', 1); const snapshot = f.store.snapshot(); assert.throws(() => f.service.accept(p.id, revisions(p)), /changed/); assert.deepEqual(f.store.snapshot(), snapshot); } finally { f.clean(); }
  const g = fixture(); try { const p = await proposal(g); g.world.configure({ settings: { gangAggression: 80 } }); const snapshot = g.store.snapshot(); assert.throws(() => g.service.accept(p.id, revisions(p)), /changed/); assert.deepEqual(g.store.snapshot(), snapshot); } finally { g.clean(); }
});
test('advisor expiry, explicit rejection and acceptance-body revisions are enforced', async () => {
  const f = fixture(); try { const p = await proposal(f); assert.throws(() => f.service.accept(p.id, { expectedRevision: 2, expectedWorldRevision: 1 }), /preview revisions/); assert.equal(f.service.reject(p.id).status, 'rejected'); assert.throws(() => f.service.accept(p.id, revisions(p)), /rejected/); const expiring = await proposal(f); f.advance(300001); assert.throws(() => f.service.accept(expiring.id, revisions(expiring)), (e: AiError) => e.status === 410); assert.equal(f.store.snapshot().revision, 1); assert.equal(f.store.snapshot().world.revision, 1); } finally { f.clean(); }
});
test('advisor provider output cannot invent setting keys, duplicate keys or exceed the user budget', async () => {
  for (const changes of [[{ key: 'process.exec', value: 'bad', reason: 'bad' }], [{ key: 'ai.dailyBudgetUsd', value: 6, reason: 'bad' }], [{ key: 'world.eventIntervalSeconds', value: 120, reason: 'once' }, { key: 'world.eventIntervalSeconds', value: 130, reason: 'twice' }]]) {
    const f = fixture(); try { f.provider.response = () => ({ summary: 'Invalid fixture', changes }); const job = await settled(f.service, f.service.enqueue(input()).id); assert.equal(job.status, 'failed'); assert.equal(job.result, undefined); assert.equal(f.store.snapshot().revision, 1); assert.equal(f.store.snapshot().world.revision, 1); assert.equal(f.service.status().previewCount, 0); } finally { f.clean(); }
  }
});
test('advisor rejects cross-setting inconsistency before presenting a proposal', async () => {
  const f = fixture(); try { f.provider.response = () => ({ summary: 'Invalid concurrency fixture', changes: [{ key: 'ai.maxConcurrent', value: 1, reason: 'Invalid with one reserved slot.' }] }); const job = await settled(f.service, f.service.enqueue({ ...input(), context: { intent: 'Change ai.maxConcurrent concurrency liveReservedSlots maximum slots.' } }).id); assert.equal(job.status, 'failed'); assert.equal(f.service.status().previewCount, 0); assert.equal(f.store.snapshot().settings['ai.maxConcurrent'], 2); } finally { f.clean(); }
});
test('a no-change AI proposal is a preview and acceptance preserves revisions', async () => {
  const f = fixture(); try { f.provider.response = () => ({ summary: 'The current settings already fit this request.', changes: [] }); const p = await proposal(f); assert.equal(p.changes.length, 0); f.service.accept(p.id, revisions(p)); assert.equal(f.store.snapshot().revision, 1); assert.equal(f.store.snapshot().world.revision, 1); } finally { f.clean(); }
});
test('failed combined persistence leaves proposal unaccepted and both stores unchanged', async () => {
  const f = fixture(); try { const p = await proposal(f); const filename = path.join(f.directory, 'settings.json'); const before = f.store.snapshot(); fs.renameSync(filename, filename + '.saved'); fs.mkdirSync(filename); assert.throws(() => f.service.accept(p.id, revisions(p)), /save/); assert.deepEqual(f.store.snapshot(), before); assert.equal((f.service.job(p.jobId).result!.proposal as AdvisorProposal).status, 'preview'); } finally { f.clean(); }
});
test('menu request IDs deduplicate across runtime and restart without storing private intents', async () => {
  const f = fixture(); try { const request = { ...input(), context: { intent: 'PRIVATE ADVISOR INTENT lower costs' } }; const a = f.service.enqueue(request), b = f.service.enqueue(request); assert.equal(a.id, b.id); await settled(f.service, a.id); assert.equal(f.provider.calls, 1); assert.throws(() => f.service.enqueue({ ...request, context: { intent: 'different' } }), /different/); const stored = fs.readFileSync(path.join(f.directory, 'ai-menu-jobs.json'), 'utf8'); assert.ok(!stored.includes('PRIVATE ADVISOR INTENT')); assert.ok(!JSON.stringify(f.service.status()).includes('PRIVATE ADVISOR INTENT')); const restart = new MenuAiService(f.options); assert.equal(restart.enqueue(request).status, 'cancelled'); assert.equal(f.provider.calls, 1); restart.close(); } finally { f.clean(); }
});
test('explain uses only the exact catalog option and does not apply its generated text', async () => {
  const f = fixture(); try { const job = await settled(f.service, f.service.enqueue(input('explain')).id); assert.equal(job.status, 'completed'); assert.equal(job.result!.settingKey, 'ai.maxConcurrent'); assert.equal(job.result!.grounding, 'catalog+current-settings'); const prompt = JSON.parse(f.provider.requests[0].prompt); assert.equal(prompt.option.key, 'ai.maxConcurrent'); assert.equal(prompt.current, 2); assert.equal(f.store.snapshot().revision, 1); assert.throws(() => f.service.enqueue({ ...input('explain'), context: { settingKey: 'unknown.option' } }), /catalog/); } finally { f.clean(); }
});
test('AI diagnosis receives the sanitized report and rejects invented setting references', async () => {
  const f = fixture(); try { const marker = 'PRIVATE-DIAGNOSTIC-CANARY'; f.store.configure({ 'conversation.language': marker }, 'portal', 1); const job = await settled(f.service, f.service.enqueue(input('diagnose')).id); assert.equal(job.status, 'completed'); assert.ok(!f.provider.requests[0].prompt.includes(marker)); assert.ok(f.provider.requests[0].prompt.includes('[text omitted]')); assert.equal(f.store.snapshot().revision, 2); f.provider.response = () => ({ summary: 'bad', findings: [], suggestedSettingKeys: ['unknown.hidden'] }); const invalid = await settled(f.service, f.service.enqueue(input('diagnose')).id); assert.equal(invalid.status, 'failed'); } finally { f.clean(); }
});
test('connection test proves a metered structured provider response without a game session', async () => {
  const f = fixture(); try { const job = await settled(f.service, f.service.enqueue(input('connection')).id); assert.equal(job.status, 'completed'); assert.equal(job.result!.connected, true); assert.equal(job.result!.model, 'gemini-3.5-flash-lite'); assert.deepEqual(job.result!.usage, measuredUsage); assert.equal(f.budget.snapshot().requests, 1); assert.equal(f.world.snapshot().connected, false); } finally { f.clean(); }
});
test('menu assistance obeys master flags and daily cap, with no fabricated advice fallback', async () => {
  const f = fixture(); try { f.store.configure({ 'ai.enabled': false }, 'portal', 1); assert.throws(() => f.service.enqueue(input()), /disabled/); assert.equal(f.provider.calls, 0); f.store.configure({ 'ai.enabled': true, 'ai.dailyBudgetUsd': 0 }, 'portal', 2); const job = await settled(f.service, f.service.enqueue(input()).id); assert.equal(job.status, 'failed'); assert.equal(job.reasonCode, 'daily_budget'); assert.equal(job.result, undefined); assert.equal(f.provider.calls, 0); } finally { f.clean(); }
});
test('explicit cancel interrupts menu jobs while ordinary game scene changes do not', async () => {
  const f = fixture(); try { f.provider.handler = request => new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })); const j = f.service.enqueue(input('explain')); await new Promise(resolve => setImmediate(resolve)); f.scheduler.invalidateScope('some-game', 'different-scene', []); assert.equal(f.service.job(j.id).status, 'running'); f.service.cancel(j.id); assert.equal((await settled(f.service, j.id)).status, 'cancelled'); assert.equal(f.service.job(j.id).result, undefined); } finally { await new Promise(resolve => setImmediate(resolve)); f.clean(); }
});
test('real HTTP advisor preview, accept, rejection, invalid bodies and polling', async () => {
  const f = fixture(), app = express(); app.use(express.json()); installMenuAiRoutes(app, f.service);
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); }); const address = server.address() as { port: number }, base = `http://127.0.0.1:${address.port}`;
  const post = (url: string, body: unknown) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try { const response = await post('/api/ai/menu/jobs', input()); assert.equal(response.status, 202); const initial = (await response.json()).job; await settled(f.service, initial.id); const done = (await (await fetch(base + '/api/ai/menu/jobs/' + initial.id)).json()).job; const p = done.result.proposal; assert.equal(f.store.snapshot().revision, 1); const accepted = await post(`/api/ai/advisor/proposals/${p.id}/accept`, revisions(p)); assert.equal(accepted.status, 200); const body = await accepted.json(); assert.equal(body.npcSettings.revision, 2); assert.equal(body.worldConfig.revision, 2); assert.equal((await post(`/api/ai/advisor/proposals/${p.id}/reject`, {})).status, 409); assert.equal((await post('/api/ai/menu/jobs', { ...input(), context: { intent: 'x'.repeat(601) } })).status, 400); assert.equal((await fetch(base + '/api/ai/menu/jobs/missing')).status, 404); } finally { await new Promise<void>(resolve => server.close(() => resolve())); f.clean(); }
});
