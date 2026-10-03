// Step 6 companion soak harness. Drives the real AiService (scheduler, budget,
// memory, scenario director) with simulated game frames on a simulated clock and
// an isolated fixture provider. It measures whether long sessions stay bounded.
// It does NOT exercise the game, the C# client, audio devices or a real provider.
//   npx tsx scripts/soak-companion.ts --hours 4 --out <file.json>
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { randomUUID } from 'node:crypto';
import { AiService, validateAiFrame } from '../server-lib/ai-service.ts';
import { AiBudget } from '../server-lib/ai-budget.ts';
import type { AiProvider, StructuredRequest, StructuredResult } from '../server-lib/ai-types.ts';
import { DEFAULT_NPC_SETTINGS, EXTRA_SCENARIOS } from '../shared/settings.ts';

export type SoakResult = {
  simulatedHours: number; frames: number; frameIntervalMs: number; providerCalls: number; scenarioUpdates: number; fallbackUpdates: number;
  sceneChanges: number; errors: string[]; max: Record<string, number>; final: Record<string, number>;
  heapUsedStartMb: number; heapUsedEndMb: number; wallSeconds: number;
};

const usage = { inputTokens: 300, outputTokens: 60, cachedTokens: 0, thoughtTokens: 0, totalTokens: 360, estimated: false };
class SoakProvider implements AiProvider {
  id = 'soak-fixture'; calls = 0; configured() { return true; } models() { return []; } async listModels() { return []; }
  async streamStructured(r: StructuredRequest): Promise<StructuredResult> {
    this.calls++; const p = (r.schema as any).properties;
    let body: unknown = { text: 'A quiet rumour.' };
    if (p.beats) { const b = p.beats.items.properties; body = { title: 'Soak scene', beats: [{ npcId: b.npcId.enum[0], speech: 'Soak line.', voiceTone: 'plain', action: b.action.enum[0] }] }; }
    else if (p.summary) body = { summary: 'Soak summary.' };
    return { text: JSON.stringify(body), usage, firstTextMs: 1, durationMs: 2, finishReason: 'completed' };
  }
}

const SCENARIOS = ['tourist', 'argument', 'roadRage', 'fan', 'breakdown', 'aftermath'] as const;
const sizeOf = (service: AiService, field: string) => { const v = (service as any)[field]; return v instanceof Map || v instanceof Set ? v.size : Array.isArray(v) ? v.length : 0; };
const FIELDS = ['jobs', 'updates', 'receipts', 'outcomes', 'handledOpportunities', 'background', 'backgroundAttempts', 'sentMemory', 'quickOptions'];

export async function runSoak(options: { hours: number; frameIntervalMs?: number }): Promise<SoakResult> {
  const frameIntervalMs = options.frameIntervalMs ?? 500, frames = Math.round(options.hours * 3_600_000 / frameIntervalMs);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'llai-soak-'));
  const settings: Record<string, unknown> = { ...DEFAULT_NPC_SETTINGS, 'memory.enabled': false };
  const provider = new SoakProvider(); let now = Date.parse('2026-10-03T00:00:00Z');
  const budget = new AiBudget(path.join(directory, 'ledger.json'), () => settings as any, () => now);
  const service = new AiService({ provider, getSettings: () => settings as any, directory, budget, automaticBackground: true, now: () => now });
  const errors: string[] = [], max: Record<string, number> = {}; let scenarioUpdates = 0, fallbackUpdates = 0, sceneChanges = 0;
  const seenUpdates = new Set<string>(); let pendingReceipts: string[] = [], pendingOutcomes: any[] = [];
  let sceneEpoch = randomUUID(), handle = 1000, npcId = `npc-${handle}`, opportunity: any = null;
  const heapStart = process.memoryUsage().heapUsed, wallStart = performance.now();
  try {
    for (let i = 0; i < frames; i++) {
      now += frameIntervalMs; const t = i * frameIntervalMs;
      if (t > 0 && t % 900_000 === 0) { sceneEpoch = randomUUID(); sceneChanges++; }        // scene change every 15 min
      if (t % 60_000 === 0) { handle++; npcId = `npc-${handle}`; }                           // NPC churn every minute
      if (t % 10_000 === 0) { const scenario = SCENARIOS[(t / 10_000) % SCENARIOS.length]; opportunity = { id: randomUUID(), scenario, npcIds: [npcId], detectedAt: new Date(now).toISOString(), facts: { playerInVehicle: false, playerSpeed: 0, npcSpeed: 0, wantedLevel: 0, contact: false, npcFaction: 'Civilian/Unknown' } }; }
      else if (t % 10_000 >= 5_000) opportunity = null;                                        // client TTL: advertised for 5 s
      const hour = new Date(now).getUTCHours();
      const frame = { runtimeId: 'soak-runtime', sceneEpoch, gameVersion: '1.0.1158.16', sdkGameVersion: '2.0.1158.16', player: { position: { x: 0, y: 0, z: 0 }, wantedLevel: 0 },
        environment: { district: 'Davis', weather: hour % 6 === 0 ? 'Raining' : 'Clear', timeOfDay: `${hour}:00` }, director: { pausedReason: null },
        npcs: [{ id: npcId, handle, modelHash: 654, name: 'Walker', faction: 'Civilian/Unknown', archetype: 'Tourist', position: { x: 3, y: 0, z: 0 }, health: 150, alive: true, weapon: 'Unarmed', mind: { fear: 20, aggression: 20, morale: 60, trust: 50, respect: 50, mood: 'calm', revision: 0 }, availableActions: ['TALK_CASUAL', 'WAVE_OFF'], distance: 5 }],
        aiReceipts: pendingReceipts, aiOutcomes: pendingOutcomes, aiMindOutcomes: [], witnessedEvents: [], vehicleOpportunities: opportunity ? [opportunity] : [] };
      pendingReceipts = []; pendingOutcomes = [];
      try { service.observe(validateAiFrame(frame)); } catch (error) { if (errors.length < 20) errors.push(String((error as Error)?.message ?? error)); }
      await new Promise(r => setImmediate(r));
      for (const u of service.deliveries()) {                                                  // behave like the client: receipt + outcome
        if (seenUpdates.has(u.id)) continue; seenUpdates.add(u.id); pendingReceipts.push(u.id);
        if (u.kind === 'scenario') { scenarioUpdates++; if (u.source === 'fallback') fallbackUpdates++; for (const b of (u.payload.beats as any[]) ?? []) pendingOutcomes.push({ actionId: b.action.actionId, jobId: u.jobId, status: 'applied', message: 'Soak applied.' }); }
      }
      if (seenUpdates.size > 4096) seenUpdates.clear();
      for (const f of FIELDS) max[f] = Math.max(max[f] ?? 0, sizeOf(service, f));
    }
  } finally {
    service.close();
    if (path.basename(directory).startsWith('llai-soak-')) fs.rmSync(directory, { recursive: true, force: true });
  }
  const final: Record<string, number> = {}; for (const f of FIELDS) final[f] = sizeOf(service, f);
  return { simulatedHours: options.hours, frames, frameIntervalMs, providerCalls: provider.calls, scenarioUpdates, fallbackUpdates, sceneChanges, errors, max, final,
    heapUsedStartMb: +(heapStart / 1048576).toFixed(1), heapUsedEndMb: +(process.memoryUsage().heapUsed / 1048576).toFixed(1), wallSeconds: +((performance.now() - wallStart) / 1000).toFixed(1) };
}

const invoked = /soak-companion\.ts$/i.test(process.argv[1] ?? '');
if (invoked) {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const hours = Number(arg('--hours') ?? 4), out = arg('--out');
  if (!Number.isFinite(hours) || hours <= 0 || hours > 48) { console.error('--hours must be in (0, 48]'); process.exit(2); }
  runSoak({ hours }).then(result => { const json = JSON.stringify({ checkedAt: new Date().toISOString(), scope: 'companion only; fixture provider; simulated clock; no game, client, audio device or real provider', streetScenarios: EXTRA_SCENARIOS.length, ...result }, null, 2); if (out) fs.writeFileSync(out, json); console.log(json); process.exit(result.errors.length ? 1 : 0); })
    .catch(error => { console.error(error); process.exit(1); });
}
