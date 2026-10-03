// Explicit contract fixture: no credential reader, Gemini client or paid call.
import express from 'express';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { AiService } from '../../server-lib/ai-service.ts';
import { installAiRoutes } from '../../server-lib/ai-routes.ts';
import { WorldState } from '../../server-lib/world.ts';
import { SettingsStore } from '../../server-lib/settings-store.ts';
import { installSettingsRoutes } from '../../server-lib/settings-routes.ts';
import { MenuAiService } from '../../server-lib/ai-menu.ts';
import { installMenuAiRoutes } from '../../server-lib/ai-menu-routes.ts';
import { installWorldRoutes } from '../../server-lib/world-routes.ts';
import { createDiagnosticReport } from '../../server-lib/diagnostics.ts';
import { installDiagnosticRoutes } from '../../server-lib/diagnostic-routes.ts';
import type { AiProvider } from '../../server-lib/ai-types.ts';
import { menuFixtureResponse } from './menu-provider-response.ts';
const port = Number(process.env.LLAI_FIXTURE_PORT || 3112);
if (!Number.isSafeInteger(port) || port < 3101 || port > 3199) throw new Error('Fixture port must be 3101-3199.');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'llai-ai-contract-'));
const settings = new SettingsStore(path.join(directory, 'npc-settings.json'));
const world = new WorldState(); settings.bindWorld(world);
let promptObservation = { historyPresent: false, longTermMemoryPresent: false };
const provider: AiProvider = { id: 'offline-contract-fixture', configured: () => true, models: () => [], listModels: async () => [], streamStructured: async request => {
  const schema = request.schema as any;
  if (!schema.properties?.speech) {
    request.signal.throwIfAborted();
    const value = menuFixtureResponse(request);
    await new Promise(resolve => setTimeout(resolve, 100)); request.signal.throwIfAborted();
    return { text: JSON.stringify(value), usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, thoughtTokens: 0, totalTokens: 0, estimated: false }, firstTextMs: 1, durationMs: 100, finishReason: 'completed' };
  }
  const context = JSON.parse(request.prompt); promptObservation = { historyPresent: Array.isArray(context.history) && context.history.length > 0, longTermMemoryPresent: typeof context.npc?.longTermMemory === 'string' && context.npc.longTermMemory.length > 0 };
  const value = { speech: 'Fixture greeting. This is a deterministic contract test.', voiceTone: 'plain', action: 'TALK_CASUAL', mindDelta: { fear: -5, aggression: 3, morale: 2, trust: 4, respect: 3, factionRepDelta: 1, districtRepDelta: 0, mood: 'friendly' }, memoryEvents: [{ type: 'conversation', text: 'Fixture conversation only.' }] };
  const text = JSON.stringify(value);
  for (const chunk of [text.slice(0, 30), text.slice(30)]) { request.signal.throwIfAborted(); request.onText?.(chunk); await new Promise(resolve => setTimeout(resolve, 50)); }
  return { text, usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, thoughtTokens: 0, totalTokens: 0, estimated: false }, firstTextMs: 1, durationMs: 100, finishReason: 'completed' };
} };
const app = express(); app.use(express.json({ limit: '128kb' }));
const ai = new AiService({ provider, getSettings: () => settings.snapshot().settings, directory });
const diagnosticReport = () => createDiagnosticReport({ settings: settings.snapshot(), world: world.snapshot(), ai: ai.status(), audio: { available: false } });
const menu = new MenuAiService({ provider, getSettings: () => settings.snapshot().settings, budget: ai.budget, scheduler: ai.scheduler, directory, snapshot: () => settings.snapshot(), previewBundle: (npc, director) => { settings.previewBundle(npc, director); }, applyBundle: (npc, director, revision, worldRevision) => settings.configureBundle(npc, director, 'advisor', revision, worldRevision), diagnosticReport });
settings.subscribe(() => ai.settingsChanged());
installSettingsRoutes(app, settings);
installAiRoutes(app, ai, world, settings, () => {}, () => menu.status());
installMenuAiRoutes(app, menu);
installWorldRoutes(app, world);
installDiagnosticRoutes(app,path.join(directory,'diagnostics'),diagnosticReport);
app.get('/api/health', (_req, res) => res.json({ success: true, fixture: 'ai-foundation-contract', protocol: 4, realProviderCalls: false, port }));
app.get('/__qa/prompt-observation', (_req, res) => res.json({ fixture: true, realProviderCalls: false, ...promptObservation }));
const server = app.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ fixture: 'ai-foundation-contract', protocol: 4, realProviderCalls: false, port })));
const close = () => { menu.close(); ai.close(); server.close(() => process.exit(0)); };
process.on('SIGTERM', close); process.on('SIGINT', close);
