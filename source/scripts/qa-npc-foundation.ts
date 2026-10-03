// Explicit isolated browser acceptance fixture. No credentials, game access or provider requests.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SettingsStore } from '../server-lib/settings-store.ts';
import { installSettingsRoutes } from '../server-lib/settings-routes.ts';
import { WorldState } from '../server-lib/world.ts';
import { installWorldRoutes } from '../server-lib/world-routes.ts';
import { isAllowedLocalRequest } from '../server-lib/compatibility.ts';

const app = express(), port = 3106, settings = new SettingsStore(), world = new WorldState();
app.use((req, res, next) => { if (!isAllowedLocalRequest(req.headers.host, req.get('origin'), req.get('sec-fetch-site'), port)) { res.status(403).json({ success: false, error: 'QA loopback origin required.' }); return; } next(); });
app.use(express.json({ limit: '256kb' }));
installSettingsRoutes(app, settings);
installWorldRoutes(app, world);
app.get('/api/health', (_req, res) => res.json({ status: 'online', version: '4.0.0 QA FIXTURE — NO GAME / NO API', geminiConfigured: false, mode: 'isolated-browser-fixture', bridge: { reachable: false } }));
app.get('/api/ai/status', (_req, res) => res.json({
  success: true, protocol: 4,
  capabilities: { jobs: false, streamingSpeech: false, lanes: [], activeJobKinds: [], provider: 'QA FIXTURE — NO API', models: [] },
  scheduler: { queued: 0, running: 0, byLane: { A: 0, B: 0, C: 0 }, breaker: { state: 'closed', failures: 0, retryAt: null } },
  budget: { currency: 'USD', day: 'QA fixture', dailyLimitUsd: 5, spentEstimateUsd: 0, reservedEstimateUsd: 0, remainingUsd: 5, sessionSpentEstimateUsd: 0, usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, thoughtTokens: 0, totalTokens: 0 }, requests: 0, unknownUsageRequests: 0, priceVersion: 'QA fixture — no billed usage' },
  recentJobs: [],
}));
app.post('/__qa/external-setting', (req, res) => { try { res.json(settings.configure(req.body.settings, 'game')); } catch { res.status(400).json({ success: false, error: 'Invalid QA settings.' }); } });
app.get('/__qa/settings', (_req, res) => res.json(settings.snapshot()));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portalDirectory = path.join(root, '..', 'verification', 'npc-overhaul', 'foundation-portal-dist');
app.use(express.static(portalDirectory));
app.get('*', (_req, res) => res.sendFile(path.join(portalDirectory, 'index.html')));
const server = app.listen(port, '127.0.0.1', () => console.log('Isolated NPC foundation QA on 127.0.0.1:3106; in-memory data only; no game or provider access.'));
process.once('SIGINT', () => server.close());
process.once('SIGTERM', () => server.close());
