// Isolated acceptance fixture: no credentials are read and no network provider is instantiated.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SettingsStore } from '../server-lib/settings-store.ts';
import { installSettingsRoutes } from '../server-lib/settings-routes.ts';
import { WorldState } from '../server-lib/world.ts';
import { installWorldRoutes } from '../server-lib/world-routes.ts';
import { AiBudget } from '../server-lib/ai-budget.ts';
import { AiScheduler } from '../server-lib/ai-scheduler.ts';
import { MenuAiService } from '../server-lib/ai-menu.ts';
import { installMenuAiRoutes } from '../server-lib/ai-menu-routes.ts';
import { createDiagnosticReport, writeDiagnosticReport } from '../server-lib/diagnostics.ts';
import { isAllowedLocalRequest } from '../server-lib/compatibility.ts';
import type { AiProvider } from '../server-lib/ai-types.ts';

const app = express(), port = 3107, settings = new SettingsStore(), world = new WorldState();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), verification = path.join(root, '..', 'verification', 'npc-overhaul');
settings.bindWorld(world);
settings.configure({ 'ai.maxInputTokensPerMinute': 64000, 'ai.maxRequestsPerMinute': 60, 'ai.maxOutputTokensPerMinute': 32000 }, 'portal');
const getSettings = () => settings.snapshot().settings, budget = new AiBudget(undefined, getSettings), scheduler = new AiScheduler(getSettings);
let fixtureConnected = true, acknowledged = 0;
const runtimeId = 'QA-MENU-FIXTURE-NOT-GTA';
const provider: AiProvider = {
  id: 'QA FIXTURE — NO API', configured: () => true, models: () => [{ id: 'gemini-3.5-flash-lite', available: true, streaming: true, structuredOutput: true }], listModels: async () => [],
  streamStructured: async request => {
    let prompt: Record<string, any> = {}; try { prompt = JSON.parse(request.prompt); } catch {}
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, String(prompt.intent).includes('slow') ? 4000 : 500); request.signal.addEventListener('abort', () => { clearTimeout(timer); reject(request.signal.reason); }, { once: true }); });
    let output: unknown;
    if (String(prompt.task).startsWith('Propose')) output = { summary: 'QA fixture proposal: a louder gang presence with a smaller provider budget. No game or API was used.', changes: [{ key: 'world.gangAggression', value: 82, reason: 'QA fixture world value for combined revision testing.' }, { key: 'ai.dailyBudgetUsd', value: 3.75, reason: 'QA fixture NPC value for combined revision testing.' }] };
    else if (prompt.option) output = { text: `QA fixture explanation of ${prompt.option.key}. Its saved value is ${prompt.current}. This is an isolated test response, not provider output.` };
    else if (prompt.diagnostic) output = { summary: 'QA fixture diagnostic response. No game or provider is connected.', findings: [{ severity: 'info', message: 'Fixture reports are sanitized and contain no private dialogue.' }], suggestedSettingKeys: [] };
    else output = { ok: true };
    return { text: JSON.stringify(output), firstTextMs: 10, durationMs: 500, finishReason: 'completed', usage: { inputTokens: 100, outputTokens: 100, cachedTokens: 0, thoughtTokens: 0, totalTokens: 200, estimated: false } };
  },
};
const aiStatus = () => ({ success: true, protocol: 4, capabilities: { jobs: false, streamingSpeech: false, lanes: [], activeJobKinds: ['advisor', 'explain', 'diagnose', 'connection'], provider: provider.id, configured: false, models: [] }, scheduler: scheduler.snapshot(), budget: { ...budget.snapshot(), priceVersion: 'QA simulation — no billed usage' }, runtime: { protocol: 4, runtimeId, sceneEpoch: 'QA-menu', connected: fixtureConnected, appliedNpcRevision: acknowledged, gameFileVersion: '1.0.1', sdkGameVersion: '1.0.1', tickMetrics: { sampleCount: 0 } }, recentJobs: [] });
const diagnosticReport = () => createDiagnosticReport({ settings: settings.snapshot(), world: world.snapshot(), ai: aiStatus(), audio: { available: false } });
const menu = new MenuAiService({ provider, budget, scheduler, getSettings, snapshot: () => settings.snapshot(), previewBundle: (npc, worldPatch) => { settings.previewBundle(npc, worldPatch); }, applyBundle: (npc, worldPatch, revision, worldRevision) => settings.configureBundle(npc, worldPatch, 'advisor', revision, worldRevision), diagnosticReport });
app.use((req, res, next) => { if (!isAllowedLocalRequest(req.headers.host, req.get('origin'), req.get('sec-fetch-site'), port)) { res.status(403).json({ success: false, error: 'QA loopback origin required.' }); return; } next(); });
app.use(express.json({ limit: '256kb' }));
installSettingsRoutes(app, settings); installWorldRoutes(app, world); installMenuAiRoutes(app, menu);
app.get('/api/health', (_req, res) => res.json({ status: 'online', version: '4.0.0 QA FIXTURE — NO GAME / NO API', geminiConfigured: false, bridge: { reachable: false } }));
app.get('/api/ai/status', (_req, res) => res.json({ ...aiStatus(), menu: menu.status() }));
app.get('/api/diagnostics', (_req, res) => res.json({ success: true, report: diagnosticReport() }));
app.post('/api/diagnostics/export', (_req, res) => res.json({ success: true, ...writeDiagnosticReport(path.join(verification, 'menu-qa-diagnostics'), diagnosticReport()) }));
app.post('/__qa/external-setting', (req, res) => { try { res.json(settings.configure(req.body.settings, 'game')); } catch { res.status(400).json({ success: false, error: 'Invalid QA settings.' }); } });
app.post('/__qa/runtime', (req, res) => { fixtureConnected = req.body.connected !== false; acknowledged = Number(req.body.appliedRevision ?? settings.snapshot().revision); res.json({ success: true }); });
app.get('/__qa/settings', (_req, res) => res.json(settings.snapshot()));
function tick() { if (!fixtureConnected) return; const config = world.snapshot().config; world.exchange({ protocol: 3, runtimeId, pluginVersion: '4.0.0 QA FIXTURE', gameVersion: 'QA fixture — no game', appliedRevision: config.revision, player: null, environment: null, npcs: [], director: { enabled: true, pausedReason: 'QA fixture — no game', settings: config.settings, territories: [], activeEvents: [], ownedPedCount: 0 }, events: [], acknowledgements: [] }); }
tick(); const timer = setInterval(tick, 1000);
const portalDirectory = path.join(verification, 'menu-portal-dist');
app.get('/', (_req, res) => res.type('html').send(fs.readFileSync(path.join(portalDirectory, 'index.html'), 'utf8').replace('</body>', '<div style="position:fixed;bottom:6px;right:10px;z-index:9999;background:#412600;color:#ffe0a4;padding:6px 10px;font:10px sans-serif;border:1px solid #b88734">ISOLATED QA — NO GAME / NO PAID API</div></body>')));
app.use(express.static(portalDirectory));
const server = app.listen(port, '127.0.0.1', () => console.log('Isolated menu QA on 127.0.0.1:3107; in-memory settings and fake provider only.'));
function close() { clearInterval(timer); menu.close(); scheduler.cancelAll(); server.close(); }
process.once('SIGINT', close); process.once('SIGTERM', close);
