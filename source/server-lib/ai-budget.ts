import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AiError, type AiLane, type ProviderUsage, type SettingsGetter, ZERO_USAGE, settingNumber } from './ai-types.ts';

export type BudgetReservation = { id: string; model: string; lane: AiLane; category: string; estimatedUsd: number; started: boolean; maxInputTokens: number; maxOutputTokens: number; at: number };
type Charge = { id: string; model: string; lane: AiLane; category: string; usd: number; usage: ProviderUsage; unknown: boolean; outcome: string; durationMs: number; firstChunkMs?: number; at: number };
type Ledger = { version: 1; day: string; charges: Charge[]; reservations: BudgetReservation[] };
export const PRICE_VERSION = 'google-standard-usd-2026-10-03';
export function budgetDay(at: number) {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function estimateUsd(model: string, usage: Pick<ProviderUsage, 'inputTokens' | 'outputTokens' | 'cachedTokens' | 'thoughtTokens'>, at = Date.now()): number {
  const future = at >= Date.parse('2027-01-01T00:00:00Z') ? 2 : 1;
  const prices: Record<string, [number, number, number]> = {
    'gemini-3.8-flash': [0.75 * future, 3.75 * future, 0.075 * future],
    'gemini-3.5-flash-lite': [0.30, 2.50, 0.03],
    'gemini-3.1-flash-lite': [0.25, 1.50, 0.025],
    'gemini-3.8-flash-lite-tts': [0.50 * future, 6 * future, 0.125 * future],
    'gemini-3.8-flash-tts': [0.50 * future, 9 * future, 0.125 * future],
  };
  const price = prices[model];
  if (!price) throw new AiError('unpriced_model', 'This model has no verified price schedule; provider requests are disabled.', 409);
  const cached = Math.min(usage.inputTokens, usage.cachedTokens);
  return ((usage.inputTokens - cached) * price[0] + cached * price[2] + (usage.outputTokens + usage.thoughtTokens) * price[1]) / 1_000_000;
}
function validUsage(usage: ProviderUsage): ProviderUsage {
  for (const key of ['inputTokens', 'outputTokens', 'cachedTokens', 'thoughtTokens', 'totalTokens'] as const) if (!Number.isSafeInteger(usage[key]) || usage[key] < 0 || usage[key] > 100_000_000) throw new AiError('invalid_usage', 'Provider usage was invalid.', 502);
  if (usage.cachedTokens > usage.inputTokens) throw new AiError('invalid_usage', 'Cached token count exceeds input usage.', 502);
  if (typeof usage.estimated !== 'boolean' || usage.totalTokens !== usage.inputTokens + usage.outputTokens + usage.thoughtTokens) throw new AiError('invalid_usage', 'Provider usage totals were inconsistent.', 502);
  return { ...usage };
}
function validateLedger(saved: Ledger) {
  if (!saved || saved.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(saved.day) || !Number.isFinite(Date.parse(saved.day)) || !Array.isArray(saved.charges) || !Array.isArray(saved.reservations) || saved.charges.length > 10000 || saved.reservations.length > 128 || Object.keys(saved).some(k => !['version', 'day', 'charges', 'reservations'].includes(k))) throw new Error();
  if (new Date(saved.day + 'T00:00:00Z').toISOString().slice(0, 10) !== saved.day) throw new Error();
  const ids = new Set<string>();
  for (const entry of [...saved.charges, ...saved.reservations]) {
    if (!entry || typeof entry.id !== 'string' || !/^[\w:.-]{1,160}$/.test(entry.id) || ids.has(entry.id) || !['A', 'B', 'C', 'D'].includes(entry.lane) || typeof entry.category !== 'string' || !/^[\w-]{1,64}$/.test(entry.category) || typeof entry.model !== 'string' || !Number.isSafeInteger(entry.at) || entry.at < 0) throw new Error();
    ids.add(entry.id);
    estimateUsd(entry.model, { ...ZERO_USAGE }, entry.at);
  }
  for (const c of saved.charges) {
    if (Object.keys(c).some(k => !['id', 'model', 'lane', 'category', 'usd', 'usage', 'unknown', 'outcome', 'durationMs', 'firstChunkMs', 'at'].includes(k)) || !Number.isFinite(c.usd) || c.usd < 0 || c.usd > 1000 || typeof c.unknown !== 'boolean' || !['completed', 'failed', 'cancelled', 'interrupted'].includes(c.outcome) || !Number.isFinite(c.durationMs) || c.durationMs < 0 || (c.firstChunkMs !== undefined && (!Number.isFinite(c.firstChunkMs) || c.firstChunkMs < 0))) throw new Error();
    validUsage(c.usage);
    if (typeof c.usage.estimated !== 'boolean') throw new Error();
    if (c.unknown !== c.usage.estimated || Math.abs(c.usd - estimateUsd(c.model, c.usage, c.at)) > 1e-12) throw new Error();
  }
  for (const r of saved.reservations) {
    if (Object.keys(r).some(k => !['id', 'model', 'lane', 'category', 'estimatedUsd', 'started', 'maxInputTokens', 'maxOutputTokens', 'at'].includes(k)) || typeof r.started !== 'boolean') throw new Error();
    for (const n of [r.maxInputTokens, r.maxOutputTokens]) if (!Number.isSafeInteger(n) || n < 1 || n > 1_000_000) throw new Error();
    const expected = estimateUsd(r.model, { inputTokens: r.maxInputTokens, outputTokens: r.maxOutputTokens, cachedTokens: 0, thoughtTokens: 0 }, r.at);
    if (!Number.isFinite(r.estimatedUsd) || Math.abs(expected - r.estimatedUsd) > 1e-12) throw new Error();
  }
}

// This ledger contains counters and opaque job IDs only. Reservations reach disk
// before an upstream request is allowed, including retries and speech rendering.
export class AiBudget {
  private ledger: Ledger;
  private sessionUsd = 0;
  private blocked = false;
  private diskVersion: string | null = null;
  constructor(private file: string | undefined, private getSettings: SettingsGetter, private now = Date.now, private authorizedDailyUsd = 5) {
    this.ledger = this.empty();
    if (file && fs.existsSync(file)) {
      try {
        if (fs.statSync(file).size > 8 * 1024 * 1024) throw new Error();
        const contents = fs.readFileSync(file, 'utf8');
        this.diskVersion = createHash('sha256').update(contents).digest('hex');
        const saved = JSON.parse(contents) as Ledger;
        validateLedger(saved);
        this.ledger = saved;
        const today = budgetDay(this.now());
        if (today > saved.day) { saved.day = today; saved.charges = []; }
        // Unknown interrupted requests may have incurred charges. Never refund
        // their reservation just because the companion was restarted.
        for (const r of saved.reservations) saved.charges.push({ id: r.id, model: r.model, lane: r.lane, category: r.category, usd: r.estimatedUsd, usage: { ...ZERO_USAGE, inputTokens: r.maxInputTokens, outputTokens: r.maxOutputTokens, totalTokens: r.maxInputTokens + r.maxOutputTokens, estimated: true }, unknown: true, outcome: 'interrupted', durationMs: 0, at: r.at });
        saved.reservations = [];
        this.persist(saved);
      } catch { this.blocked = true; }
    }
    this.rollDay();
  }
  private empty(): Ledger { return { version: 1, day: budgetDay(this.now()), charges: [], reservations: [] }; }
  private persist(next: Ledger) {
    if (!this.file) { this.ledger = next; return; }
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    const lockFile = `${this.file}.writer-lock`;
    let lock: number | undefined;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      try { lock = fs.openSync(lockFile, 'wx', 0o600); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        // Reclaim only a lock whose recorded process is confirmed absent. An
        // ambiguous owner or a reused PID stays blocked rather than risking cost.
        const owner = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) throw error;
        let absent = false;
        try { process.kill(owner.pid, 0); } catch (probe) { absent = (probe as NodeJS.ErrnoException).code === 'ESRCH'; }
        if (!absent) throw error;
        fs.unlinkSync(lockFile); lock = fs.openSync(lockFile, 'wx', 0o600);
      }
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }));
      const current = fs.existsSync(this.file) ? createHash('sha256').update(fs.readFileSync(this.file, 'utf8')).digest('hex') : null;
      if (current !== this.diskVersion) throw new AiError('budget_conflict', 'AI spending ledger changed in another process. Restart this companion before making provider requests.', 503);
      const content = JSON.stringify(next);
      fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, this.file);
      this.ledger = next;
      this.diskVersion = createHash('sha256').update(content).digest('hex');
    } catch (error) {
      try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
      if (error instanceof AiError) throw error;
      throw new AiError('budget_persistence', 'AI spending ledger could not be saved. Provider requests are blocked.', 503);
    } finally { if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync(lockFile); } }
  }
  private rollDay() {
    if (this.blocked) return;
    const day = budgetDay(this.now());
    if (day > this.ledger.day) {
      // Carry pending reservations conservatively into the new day. Their
      // completion is charged there too, so midnight cannot refund active work.
      this.persist({ ...this.empty(), reservations: [...this.ledger.reservations] });
    }
  }
  reserve(input: { id: string; model: string; lane: AiLane; category: string; maxInputTokens: number; maxOutputTokens: number }): BudgetReservation {
    if (this.blocked) throw new AiError('budget_corrupt', 'AI spending ledger needs repair; provider requests are blocked.', 503);
    if (!/^[\w:.-]{1,160}$/.test(input.id) || !/^[\w-]{1,64}$/.test(input.category) || !['A', 'B', 'C', 'D'].includes(input.lane)) throw new AiError('invalid_reservation', 'Provider reservation metadata is invalid.');
    this.rollDay();
    if (this.ledger.reservations.some(r => r.id === input.id) || this.ledger.charges.some(r => r.id === input.id)) throw new AiError('duplicate_reservation', 'This provider request already has a spending receipt.', 409);
    for (const n of [input.maxInputTokens, input.maxOutputTokens]) if (!Number.isSafeInteger(n) || n < 1 || n > 1_000_000) throw new AiError('invalid_reservation', 'Token reservation exceeds the provider limit.');
    const estimate = estimateUsd(input.model, { inputTokens: input.maxInputTokens, outputTokens: input.maxOutputTokens, cachedTokens: 0, thoughtTokens: 0 }, this.now());
    const state = this.snapshot();
    if (state.remainingUsd + 1e-9 < estimate) throw new AiError('daily_budget', 'The daily AI spending cap has been reached.', 429);
    if (this.ledger.reservations.length >= 64 || this.ledger.charges.length >= 9900) throw new AiError('budget_capacity', 'AI spending receipt capacity reached for today.', 429);
    const minute = this.now() - 60_000;
    const recent = [...this.ledger.reservations.filter(r => r.at > minute).map(r => ({ input: r.maxInputTokens, output: r.maxOutputTokens })), ...this.ledger.charges.filter(r => r.at > minute).map(r => ({ input: r.usage.inputTokens, output: r.usage.outputTokens + r.usage.thoughtTokens }))];
    if (recent.length >= settingNumber(this.getSettings, 'ai.maxRequestsPerMinute', 30) || recent.reduce((n, r) => n + r.input, 0) + input.maxInputTokens > settingNumber(this.getSettings, 'ai.maxInputTokensPerMinute', 100_000) || recent.reduce((n, r) => n + r.output, 0) + input.maxOutputTokens > settingNumber(this.getSettings, 'ai.maxOutputTokensPerMinute', 30_000)) throw new AiError('rate_limit', 'AI request or token rate limit reached.', 429);
    const reservation: BudgetReservation = { ...input, estimatedUsd: estimate, started: false, at: this.now() };
    this.persist({ ...this.ledger, reservations: [...this.ledger.reservations, reservation] });
    return { ...reservation };
  }
  markStarted(id: string) {
    const found = this.ledger.reservations.find(r => r.id === id);
    if (!found) throw new AiError('unknown_reservation', 'Provider request has no persisted spending reservation.', 409);
    this.persist({ ...this.ledger, reservations: this.ledger.reservations.map(r => r.id === id ? { ...r, started: true } : r) });
  }
  record(id: string, usage: ProviderUsage | null, result: { outcome: 'completed' | 'failed' | 'cancelled'; durationMs: number; firstChunkMs?: number }) {
    const found = this.ledger.reservations.find(r => r.id === id);
    if (!found) return; // Terminal callback retries cannot charge twice.
    if (!['completed', 'failed', 'cancelled'].includes(result.outcome) || !Number.isFinite(result.durationMs) || result.durationMs < 0 || (result.firstChunkMs !== undefined && (!Number.isFinite(result.firstChunkMs) || result.firstChunkMs < 0))) throw new AiError('invalid_usage', 'Provider timing metadata was invalid.', 502);
    if (usage?.estimated) usage = null;
    const actual = usage ? validUsage(usage) : { ...ZERO_USAGE, inputTokens: found.maxInputTokens, outputTokens: found.maxOutputTokens, totalTokens: found.maxInputTokens + found.maxOutputTokens, estimated: true };
    const usd = usage ? estimateUsd(found.model, actual, found.at) : found.estimatedUsd;
    const charge: Charge = { id, model: found.model, lane: found.lane, category: found.category, usd, usage: actual, unknown: !usage, ...result, at: found.at };
    this.persist({ ...this.ledger, reservations: this.ledger.reservations.filter(r => r.id !== id), charges: [...this.ledger.charges, charge] });
    this.sessionUsd += usd;
  }
  release(id: string) {
    if (this.ledger.reservations.some(r => r.id === id && r.started)) throw new AiError('started_reservation', 'Started provider requests must retain a spending receipt.', 409);
    this.persist({ ...this.ledger, reservations: this.ledger.reservations.filter(r => r.id !== id) });
  }
  snapshot() {
    this.rollDay();
    const dailyLimitUsd = Math.min(this.authorizedDailyUsd, Math.max(0, settingNumber(this.getSettings, 'ai.dailyBudgetUsd', 5)));
    const spentEstimateUsd = this.ledger.charges.reduce((n, c) => n + c.usd, 0);
    const reservedEstimateUsd = this.ledger.reservations.reduce((n, r) => n + r.estimatedUsd, 0);
    const usage = this.ledger.charges.reduce((total, c) => { for (const key of ['inputTokens', 'outputTokens', 'cachedTokens', 'thoughtTokens', 'totalTokens'] as const) total[key] += c.usage?.[key] || 0; total.estimated ||= c.unknown; return total; }, { ...ZERO_USAGE });
    return { currency: 'USD', day: this.ledger.day, dayTimezone: 'Australia/Sydney', dailyLimitUsd, spentEstimateUsd, reservedEstimateUsd, remainingUsd: Math.max(0, dailyLimitUsd - spentEstimateUsd - reservedEstimateUsd), sessionSpentEstimateUsd: this.sessionUsd, usage, requests: this.ledger.charges.length, unknownUsageRequests: this.ledger.charges.filter(c => c.unknown).length, priceVersion: PRICE_VERSION, blocked: this.blocked };
  }
}
