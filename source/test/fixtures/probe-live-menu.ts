// Explicit paid evaluation only. Settings are isolated; budget is the real shared ledger.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { readGeminiCredential } from '../../server-lib/compatibility.ts';
import { GeminiProvider } from '../../server-lib/ai-provider.ts';
import { AiBudget } from '../../server-lib/ai-budget.ts';
import { AiScheduler } from '../../server-lib/ai-scheduler.ts';
import { MenuAiService, type AdvisorProposal, type MenuKind } from '../../server-lib/ai-menu.ts';
import { SettingsStore } from '../../server-lib/settings-store.ts';
import { WorldState } from '../../server-lib/world.ts';
import { createDiagnosticReport } from '../../server-lib/diagnostics.ts';
if (process.env.LLAI_RUN_LIVE_AI_EVALUATION !== 'true') throw new Error('Live provider evaluation requires the explicit run flag.');
const key = readGeminiCredential(); if (!key) throw new Error('No private Gemini credential is configured.');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'llai-menu-evaluation-'));
const store = new SettingsStore(path.join(directory, 'settings.json')), world = new WorldState(); store.bindWorld(world);
store.configure({ 'ai.maxRetries': 0 }, 'game');
const getSettings = () => store.snapshot().settings;
const provider = new GeminiProvider(() => new GoogleGenAI({ apiKey: key, httpOptions: { timeout: 18000 } }), () => true);
const models = await provider.listModels(); const model = String(getSettings()['ai.directorModel']);
if (!models.some(m => m.id === model && m.available)) throw new Error('The selected menu model was not available in authenticated model listing.');
const budget = new AiBudget(path.join(process.env.LOCALAPPDATA!, 'LivingLosSantos', 'Enhanced', 'ai-usage.json'), getSettings), scheduler = new AiScheduler(getSettings);
const service = new MenuAiService({ provider, budget, scheduler, getSettings, directory, snapshot: () => store.snapshot(), previewBundle: (npc, director) => { store.previewBundle(npc, director); }, applyBundle: () => { throw new Error('Evaluation must never accept settings changes.'); }, diagnosticReport: () => createDiagnosticReport({ settings: store.snapshot(), world: world.snapshot(), ai: { budget: budget.snapshot() } }) });
const before = budget.snapshot(), initialSettings = JSON.stringify(store.snapshot()), evaluations: Record<string, unknown>[] = [];
try {
  for (const kind of ['advisor', 'explain'] as MenuKind[]) {
    const entryBudget = budget.snapshot();
    const job = service.enqueue({ requestId: randomUUID(), kind, context: kind === 'advisor' ? { intent: 'Keep frequent street fights and gang turf battles, but reduce crowd pressure and unnecessary AI spending.' } : { settingKey: 'world.eventIntervalSeconds' } });
    let result = service.job(job.id);
    for (let i = 0; i < 240 && ['queued', 'running'].includes(result.status); i++) { await new Promise(resolve => setTimeout(resolve, 100)); result = service.job(job.id); }
    const proposal = result.result?.proposal as AdvisorProposal | undefined;
    evaluations.push({ kind, status: result.status, model: result.model, source: result.source, reasonCode: result.reasonCode ?? null, firstTextMs: result.firstTextMs ?? null, durationMs: result.durationMs ?? null, proposalChangeCount: proposal?.changes.length ?? null, proposalKeys: proposal?.changes.map(c => c.key) ?? null, explanationGroundedInCatalog: result.result?.grounding === 'catalog+current-settings', settingsUnchanged: JSON.stringify(store.snapshot()) === initialSettings, estimatedUsd: budget.snapshot().spentEstimateUsd - entryBudget.spentEstimateUsd });
    if (proposal) service.reject(proposal.id);
  }
} finally { service.close(); scheduler.cancelAll(); }
const after = budget.snapshot();
const report = { status: evaluations.length === 2 && evaluations.every(e => e.status === 'completed' && e.settingsUnchanged) ? 'VERIFIED' : 'FAILED', evaluationOnly: true, gameActionsExecuted: false, acceptedSettings: false, paidRequestCount: after.requests - before.requests, evaluations, usageDelta: Object.fromEntries(['inputTokens', 'outputTokens', 'cachedTokens', 'thoughtTokens', 'totalTokens'].map(k => [k, Number(after.usage[k as keyof typeof after.usage]) - Number(before.usage[k as keyof typeof before.usage])])), estimatedUsdDelta: after.spentEstimateUsd - before.spentEstimateUsd, dailyRemainingUsd: after.remainingUsd, dayTimezone: after.dayTimezone, priceVersion: after.priceVersion, measuredAt: new Date().toISOString(), modelSource: 'authenticated models.list' };
const output = path.resolve('..', 'verification', 'ai-menu-provider.json'); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
if (!directory.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(directory).startsWith('llai-menu-evaluation-')) throw new Error('Unsafe fixture cleanup path.'); fs.rmSync(directory, { recursive: true, force: true });
if (report.status !== 'VERIFIED') process.exitCode = 1;
