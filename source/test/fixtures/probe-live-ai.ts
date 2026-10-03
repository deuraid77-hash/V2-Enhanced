// Deliberate paid evaluation; normal test discovery never executes this file.
// Every provider request uses the same persisted $5/day ledger as the companion.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { readGeminiCredential, redactError } from '../../server-lib/compatibility.ts';
import { GeminiProvider } from '../../server-lib/ai-provider.ts';
import { AiService, validateAiFrame } from '../../server-lib/ai-service.ts';
import { SettingsStore } from '../../server-lib/settings-store.ts';
if (process.env.LLAI_RUN_LIVE_AI_EVALUATION !== 'true') throw new Error('Live provider evaluation requires the explicit run flag.');
const key = readGeminiCredential(); if (!key) throw new Error('No private Gemini credential is configured.');
const data = path.join(process.env.LOCALAPPDATA!, 'LivingLosSantos', 'Enhanced');
const settings = new SettingsStore(path.join(data, 'npc-settings-v4.json'));
const providerFailures: unknown[] = [];
const provider = new GeminiProvider(() => new GoogleGenAI({ apiKey: key, httpOptions: { timeout: 18000 } }), () => true, error => providerFailures.push({ name: (error as any)?.name, status: (error as any)?.status ?? (error as any)?.statusCode, message: redactError(error, [key]).slice(0, 700) }));
const models = await provider.listModels();
const evaluationModel = process.env.LLAI_EVALUATION_MODEL || String(settings.snapshot().settings['ai.liveModel']);
if (!models.some(m => m.id === evaluationModel && m.available)) throw new Error('Evaluation model must appear in authenticated model list.');
const service = new AiService({ provider, getSettings: () => ({ ...settings.snapshot().settings, 'ai.liveModel': evaluationModel, 'ai.maxRetries': 0 }), directory: data });
const runtimeId = `evaluation-${randomUUID()}`, sceneEpoch = randomUUID(), position = { x: 100, y: -1900, z: 20 };
const frame = validateAiFrame({ runtimeId, sceneEpoch, gameVersion: '1.0.1158.16', sdkGameVersion: '1.0.1013.33', appliedNpcRevision: 0,
  npcs: [{ id: 'evaluation-npc', handle: 123, modelHash: 123, name: 'Fictional street resident', faction: 'Civilian/Unknown', archetype: 'Neighbour', position, health: 150, alive: true, weapon: 'Unarmed', distance: 3, mind: { fear: 0, aggression: 10, morale: 70, trust: 50, respect: 50, mood: 'calm' }, recentDamage: 0, recentEvents: [] }],
  player: { position, wantedLevel: 0, weaponDrawn: false, weaponDrawnName: 'Unarmed', stance: 'Casual', factionStandings: {} }, environment: { district: 'Davis', weather: 'CLEAR', timeOfDay: '12:00', nearbyGunfire: false }, aiReceipts: [], aiOutcomes: [] });
service.observe(frame);
const before = service.budget.snapshot();
const job = service.enqueue({ requestId: randomUUID(), runtimeId, sceneEpoch, kind: 'conversation', lane: 'A', npcIds: ['evaluation-npc'], context: { playerUtterance: 'Good morning. Any interesting places around here?' } });
let result = service.job(job.id);
for (let i = 0; i < 250 && ['queued', 'running', 'streaming'].includes(result.status); i++) { await new Promise(resolve => setTimeout(resolve, 100)); service.observe(frame); result = service.job(job.id); }
const after = service.budget.snapshot();
const report = { status: result.status === 'completed' ? 'VERIFIED' : 'FAILED', evaluationOnly: true, gameActionsExecuted: false, paidProviderCalled: after.requests > before.requests, models, job: { status: result.status, source: result.source, reasonCode: result.reasonCode ?? null, firstTextMs: result.firstTextMs ?? null, durationMs: result.durationMs ?? null, validActionEnvelope: Array.isArray(result.result?.actions), streamedSentences: service.deliveries().filter(d => d.kind === 'speech').length }, usageDelta: Object.fromEntries(['inputTokens', 'outputTokens', 'cachedTokens', 'thoughtTokens', 'totalTokens'].map(k => [k, Number(after.usage[k as keyof typeof after.usage]) - Number(before.usage[k as keyof typeof before.usage])])), estimatedUsdDelta: after.spentEstimateUsd - before.spentEstimateUsd, dailyRemainingUsd: after.remainingUsd, dayTimezone: after.dayTimezone, priceVersion: after.priceVersion, measuredAt: new Date().toISOString(), modelSource: 'authenticated models.list', documentation: ['https://ai.google.dev/gemini-api/docs/structured-output','https://ai.google.dev/gemini-api/docs/pricing','https://ai.google.dev/gemini-api/docs/caching'] };
service.close();
if (providerFailures.length) console.log(JSON.stringify({ publicEvaluationOnlyProviderFailures: providerFailures }));
const output = path.resolve('..', 'verification', 'ai-foundation-provider.json'); fs.mkdirSync(path.dirname(output), { recursive: true });
const historyFile = path.resolve('..', 'verification', 'ai-foundation-provider-attempts.json');
const history = fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : [];
history.push({ evaluationModel, ...report }); fs.writeFileSync(historyFile, JSON.stringify(history.slice(-20), null, 2)); fs.writeFileSync(output, JSON.stringify({ evaluationModel, ...report }, null, 2)); console.log(JSON.stringify({ evaluationModel, ...report }));
if (result.status !== 'completed') process.exitCode = 1;
