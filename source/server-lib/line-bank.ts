import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { AiBudget } from './ai-budget.ts';
import type { AiScheduler } from './ai-scheduler.ts';
import { AiError, type AiProvider, type SettingsGetter, settingBoolean, settingNumber, settingString } from './ai-types.ts';

/** Lane C reusable lines. Groups follow spec section 6.1. */
export const BANK_GROUPS = ['casual', 'reaction', 'vehicle', 'hurt', 'combat', 'group'] as const;
export type BankGroup = typeof BANK_GROUPS[number];
export const BANK_SITUATIONS: Record<BankGroup, readonly string[]> = {
  casual: ['greeting', 'smalltalk', 'weather', 'timeofday', 'district', 'phone', 'complaint', 'tourist', 'worker', 'jogger', 'homeless', 'nightlife', 'hustler', 'gang_turf', 'fan'],
  reaction: ['weapon_drawn', 'running', 'bumped', 'too_close', 'car_theft', 'wanted', 'explosion', 'outfit', 'vehicle_admire', 'dancing', 'helped', 'rude'],
  vehicle: ['horn_rage', 'near_miss', 'passenger_chat', 'lift', 'traffic_stop', 'breakdown', 'siren'],
  hurt: ['shoved', 'punched', 'shot', 'run_over', 'tased', 'grabbed', 'gunpoint', 'pain', 'begging', 'threat_back'],
  combat: ['start', 'taunt', 'call_target', 'cover', 'reload', 'flank', 'suppress', 'retreat', 'surrender', 'backup', 'hit', 'wounded', 'last_words', 'victory', 'aftermath'],
  group: ['banter', 'warning', 'orders', 'rumour'],
};
export const BANK_ARCHETYPES = ['local', 'tourist', 'worker', 'jogger', 'homeless', 'clubber', 'hustler', 'gang', 'cop', 'driver', 'fan'] as const;
const MOODS = ['calm', 'friendly', 'annoyed', 'angry', 'scared', 'urgent', 'sad', 'amused', 'nervous', 'sarcastic', 'tired', 'excited', 'hurt'] as const;
export type BankLine = { id: string; group: BankGroup; text: string; archetype: string; tags: string[]; mood: string; intensity: number; cooldownSeconds: number; source: 'gemini' | 'fallback'; createdAt: number; lastUsedAt: number };
type BankFile = { version: 1; lines: BankLine[] };

const lineId = (group: string, text: string) => createHash('sha256').update(group + '\u0001' + text.toLowerCase()).digest('hex').slice(0, 20);
function fallbackLine(group: BankGroup, text: string, tags: string[], mood: string, intensity: number, cooldownSeconds: number): BankLine {
  return { id: lineId(group, text), group, text, archetype: 'local', tags, mood, intensity, cooldownSeconds, source: 'fallback', createdAt: 0, lastUsedAt: 0 };
}
/** Labelled fallback seed lines so a bank is never empty offline. */
export const SEED_LINES: BankLine[] = [
  fallbackLine('casual', 'Another beautiful day in Los Santos. Smog included.', ['weather', 'smalltalk'], 'sarcastic', 0.3, 120),
  fallbackLine('casual', "Hey. Don't mind me, just minding my business.", ['greeting'], 'calm', 0.2, 90),
  fallbackLine('casual', 'Traffic on the freeway was murder again.', ['complaint', 'smalltalk'], 'tired', 0.3, 120),
  fallbackLine('casual', 'You lost? This part of town eats tourists.', ['tourist', 'district'], 'amused', 0.4, 120),
  fallbackLine('reaction', 'Whoa, whoa! Put that thing away!', ['weapon_drawn'], 'scared', 0.8, 30),
  fallbackLine('reaction', 'Watch where you are going, man!', ['bumped', 'running'], 'annoyed', 0.5, 30),
  fallbackLine('reaction', 'Personal space, buddy. Look it up.', ['too_close'], 'annoyed', 0.4, 45),
  fallbackLine('reaction', 'Somebody call the cops, he is taking that car!', ['car_theft'], 'urgent', 0.8, 40),
  fallbackLine('vehicle', 'Learn to drive, idiot!', ['horn_rage', 'near_miss'], 'angry', 0.7, 25),
  fallbackLine('vehicle', 'Did you get your licence out of a cereal box?', ['horn_rage'], 'sarcastic', 0.6, 40),
  fallbackLine('vehicle', 'That was way too close!', ['near_miss'], 'scared', 0.6, 25),
  fallbackLine('vehicle', 'Great. Just great. It will not start.', ['breakdown'], 'annoyed', 0.5, 60),
  fallbackLine('hurt', 'Ow! What is wrong with you?', ['shoved', 'punched', 'pain'], 'hurt', 0.7, 10),
  fallbackLine('hurt', 'Please, I do not want any trouble!', ['begging', 'gunpoint'], 'scared', 0.9, 15),
  fallbackLine('hurt', 'Touch me again and see what happens.', ['threat_back', 'shoved'], 'angry', 0.7, 20),
  fallbackLine('combat', 'Get down! Get down!', ['cover', 'start'], 'urgent', 0.9, 10),
  fallbackLine('combat', 'Reloading, cover me!', ['reload'], 'urgent', 0.8, 10),
  fallbackLine('combat', 'Fall back, fall back!', ['retreat'], 'scared', 0.9, 15),
  fallbackLine('combat', 'Is that all you got?', ['taunt'], 'angry', 0.7, 15),
  fallbackLine('group', 'Heads up, trouble coming this way.', ['warning'], 'nervous', 0.6, 30),
  fallbackLine('group', 'You hear what happened down on Grove?', ['rumour', 'banter'], 'amused', 0.3, 120),
  fallbackLine('group', 'Stay sharp. Nobody moves until I say.', ['orders'], 'calm', 0.6, 45),
];

const SCHEMA = { type: 'object', properties: { lines: { type: 'array', items: { type: 'object', properties: {
  text: { type: 'string' }, archetype: { type: 'string', enum: [...BANK_ARCHETYPES] }, tags: { type: 'array', items: { type: 'string' } },
  mood: { type: 'string', enum: [...MOODS] }, intensity: { type: 'number' }, cooldownSeconds: { type: 'integer' } },
  required: ['text', 'archetype', 'tags', 'mood', 'intensity', 'cooldownSeconds'] } } }, required: ['lines'] } as const;

export function validateGenerated(group: BankGroup, raw: unknown, now: number): BankLine[] {
  const list = (raw as { lines?: unknown })?.lines;
  if (!Array.isArray(list) || list.length > 16) throw new AiError('invalid_output', 'Bank output was not a bounded line list.', 502);
  const allowed = new Set(BANK_SITUATIONS[group]), out: BankLine[] = [];
  for (const item of list) {
    const l = item as Record<string, unknown>;
    if (!l || typeof l !== 'object' || typeof l.text !== 'string') continue;
    const text = l.text.replace(/\s+/g, ' ').trim();
    if (text.length < 2 || text.length > 160 || /[\u0000-\u001f<>~*_#[\]{}]/.test(text)) continue;
    const tags = Array.isArray(l.tags) ? [...new Set(l.tags.filter((t): t is string => typeof t === 'string' && allowed.has(t)))].slice(0, 4) : [];
    if (!tags.length || !(BANK_ARCHETYPES as readonly string[]).includes(l.archetype as string) || !(MOODS as readonly string[]).includes(l.mood as string)) continue;
    const intensity = Number(l.intensity), cooldown = Number(l.cooldownSeconds);
    if (!Number.isFinite(intensity) || !Number.isFinite(cooldown)) continue;
    out.push({ id: lineId(group, text), group, text, archetype: l.archetype as string, tags, mood: l.mood as string, intensity: Math.max(0, Math.min(1, intensity)), cooldownSeconds: Math.round(Math.max(5, Math.min(600, cooldown))), source: 'gemini', createdAt: now, lastUsedAt: 0 });
  }
  return out;
}

export type LineBankOptions = { file: string; provider: AiProvider; budget: AiBudget; scheduler: AiScheduler; getSettings: SettingsGetter; now?: () => number };
export class LineBank {
  private lines = new Map<string, BankLine>();
  private lastGeneration = 0;
  private generating = new Set<BankGroup>();
  private stats = { generated: 0, rejected: 0, failures: 0, picks: 0, fallbackPicks: 0, lastError: null as string | null };
  private now: () => number;
  constructor(private options: LineBankOptions) {
    this.now = options.now ?? Date.now;
    if (!path.isAbsolute(options.file)) throw new Error('Line bank requires an absolute file path.');
    for (const line of SEED_LINES) this.lines.set(line.id, { ...line, tags: [...line.tags] });
    try {
      const saved = JSON.parse(fs.readFileSync(options.file, 'utf8')) as BankFile;
      if (saved?.version === 1 && Array.isArray(saved.lines) && saved.lines.length <= 6 * 80) for (const l of saved.lines) {
        if (!l || !(BANK_GROUPS as readonly string[]).includes(l.group) || l.source !== 'gemini') continue;
        const [valid] = validateGenerated(l.group, { lines: [l] }, Number(l.createdAt) || 0);
        if (valid) this.lines.set(valid.id, { ...valid, lastUsedAt: 0 });
      }
    } catch { /* first run or unreadable bank: seeds only */ }
  }
  private group(group: BankGroup) { return [...this.lines.values()].filter(l => l.group === group); }
  private usable(group: BankGroup, now: number) { return this.group(group).filter(l => now - l.lastUsedAt >= l.cooldownSeconds * 1000); }
  /** Picks a line outside its cooldown, preferring tag and archetype matches and AI-authored lines. */
  pick(group: BankGroup, options: { tags?: string[]; archetype?: string; exclude?: Set<string> } = {}): BankLine | null {
    if (!settingBoolean(this.options.getSettings, 'bank.enabled', true)) return null;
    const now = this.now(), candidates = this.usable(group, now).filter(l => !options.exclude?.has(l.id));
    this.maybeRefill(group, candidates.length);
    if (!candidates.length) return null;
    const score = (l: BankLine) => (options.tags?.some(t => l.tags.includes(t)) ? 4 : 0) + (options.archetype && l.archetype === options.archetype ? 2 : 0) + (l.source === 'gemini' ? 1 : 0) - l.lastUsedAt / 1e15;
    const best = candidates.sort((a, b) => score(b) - score(a))[0];
    best.lastUsedAt = now; this.stats.picks++; if (best.source === 'fallback') this.stats.fallbackPicks++;
    return { ...best, tags: [...best.tags] };
  }
  private maybeRefill(group: BankGroup, usable: number) {
    const get = this.options.getSettings;
    if (!settingBoolean(get, 'ai.enabled', true) || settingString(get, 'ai.provider', 'gemini') !== 'gemini' || !this.options.provider.configured()) return;
    const background = settingBoolean(get, 'bank.idlePregeneration', true);
    if (!(background ? usable < settingNumber(get, 'bank.refillThreshold', 4) : usable === 0)) return;
    if (this.generating.size || this.now() - this.lastGeneration < settingNumber(get, 'bank.minGenerationIntervalSeconds', 30) * 1000) return;
    void this.generate(group).catch(() => {});
  }
  async generate(group: BankGroup): Promise<number> {
    const get = this.options.getSettings, model = settingString(get, 'ai.bankModel', 'gemini-3.5-flash-lite');
    const count = Math.max(2, Math.min(16, settingNumber(get, 'bank.generationBatchSize', 8))), maxOutputTokens = Math.max(256, Math.min(4096, settingNumber(get, 'ai.bankMaxOutputTokens', 1536)));
    const id = `bank:${group}:${this.now().toString(36)}`;
    this.generating.add(group); this.lastGeneration = this.now();
    const existing = this.group(group).slice(-12).map(l => l.text);
    const language = settingString(get, 'general.languageIntensity', 'gta');
    const prompt = JSON.stringify({ task: `Write ${count} short, varied spoken lines for GTA V Los Santos pedestrians.`, group, situations: BANK_SITUATIONS[group], archetypes: BANK_ARCHETYPES, language, avoidRepeating: existing,
      rules: ['Each line is one breath, under 120 characters, plain spoken English.', 'Never use identity slurs or target protected groups.', 'Never mention being an AI, a game or a mod.', 'tags must come from situations.', 'cooldownSeconds is how soon the same line may repeat (5-600).'] });
    try {
      return await this.options.scheduler.submit({ id, lane: 'C', priority: 0, scope: { runtimeId: 'bank', sceneEpoch: 'bank', npcIds: [] }, sceneBound: false, run: async signal => {
        this.options.scheduler.admitProvider();
        let reserved = false, started = false; const start = this.now();
        try {
          this.options.budget.reserve({ id, model, lane: 'C', category: 'bank', maxInputTokens: 2048, maxOutputTokens }); reserved = true;
          if (signal.aborted) throw signal.reason;
          this.options.budget.markStarted(id); started = true;
          const result = await this.options.provider.streamStructured({ model, system: 'You write reusable ambient NPC dialogue lines. Output JSON only.', prompt, schema: SCHEMA as unknown as Record<string, unknown>, maxOutputTokens, signal });
          this.options.budget.record(id, result.usage, { outcome: 'completed', durationMs: result.durationMs }); this.options.scheduler.providerSucceeded();
          let parsed: unknown; try { parsed = JSON.parse(result.text); } catch { throw new AiError('invalid_output', 'Bank output was not JSON.', 502); }
          const lines = validateGenerated(group, parsed, this.now());
          this.stats.rejected += Math.max(0, ((parsed as { lines?: unknown[] }).lines?.length ?? 0) - lines.length);
          let added = 0; for (const l of lines) if (!this.lines.has(l.id)) { this.lines.set(l.id, l); added++; }
          this.trim(group); this.save(); this.stats.generated += added;
          return added;
        } catch (error) {
          if (reserved) { if (started) this.options.budget.record(id, error instanceof AiError ? error.usage || null : null, { outcome: signal.aborted ? 'cancelled' : 'failed', durationMs: Math.max(0, this.now() - start) }); else this.options.budget.release(id); }
          this.options.scheduler.providerFailed(error instanceof AiError && error.retryable);
          throw error;
        }
      } });
    } catch (error) { this.stats.failures++; this.stats.lastError = error instanceof AiError ? error.code : 'bank_failed'; throw error; }
    finally { this.generating.delete(group); }
  }
  private trim(group: BankGroup) {
    const cap = Math.max(4, Math.min(80, settingNumber(this.options.getSettings, 'bank.maxLinesPerBucket', 24)));
    const lines = this.group(group); if (lines.length <= cap) return;
    // Evict fallback seeds first, then the oldest AI lines.
    for (const l of lines.sort((a, b) => (a.source === 'fallback' ? 0 : 1) - (b.source === 'fallback' ? 0 : 1) || a.createdAt - b.createdAt).slice(0, lines.length - cap)) this.lines.delete(l.id);
  }
  private save() {
    const data: BankFile = { version: 1, lines: [...this.lines.values()].filter(l => l.source === 'gemini') };
    fs.mkdirSync(path.dirname(this.options.file), { recursive: true });
    const temp = this.options.file + '.tmp'; fs.writeFileSync(temp, JSON.stringify(data)); fs.renameSync(temp, this.options.file);
  }
  status() {
    const groups = Object.fromEntries(BANK_GROUPS.map(g => { const lines = this.group(g); return [g, { lines: lines.length, ai: lines.filter(l => l.source === 'gemini').length, fallback: lines.filter(l => l.source === 'fallback').length, usable: this.usable(g, this.now()).length }]; }));
    return { success: true, enabled: settingBoolean(this.options.getSettings, 'bank.enabled', true), generating: [...this.generating], groups, stats: { ...this.stats } };
  }
}
