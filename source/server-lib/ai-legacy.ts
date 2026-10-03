import { randomUUID } from 'node:crypto';
import type { GoogleGenAI } from '@google/genai';
import { AiBudget } from './ai-budget.ts';
import { AiError, type ProviderUsage } from './ai-types.ts';
import { normalizeUsage } from './ai-provider.ts';
import { providerError } from './ai-provider.ts';
import type { AiScheduler } from './ai-scheduler.ts';
import { type AiScope, type SettingsGetter, settingBoolean, settingString } from './ai-types.ts';

// Older endpoints retain their response formats, but share the same hard budget
// as protocol 4. Grounding/tool calls have separate prices and are refused until
// they have a verified reservation schedule.
export function meteredLegacyClient(client: GoogleGenAI, budget: AiBudget, scheduler: AiScheduler, getScope: () => AiScope, getSettings: SettingsGetter): GoogleGenAI {
  const guard = () => { if (!settingBoolean(getSettings, 'general.enabled', true) || settingBoolean(getSettings, 'general.safeMode', false) || !settingBoolean(getSettings, 'ai.enabled', true) || settingString(getSettings, 'ai.provider', 'gemini') === 'offline') throw new AiError('ai_disabled', 'AI provider work is disabled by current settings.', 409); };
  async function invoke(kind: 'generate' | 'interaction', raw: Record<string, any>) {
    guard();
    const id = `legacy-${randomUUID()}`;
    return scheduler.submit({ id, lane: 'A', scope: getScope(), run: async signal => {
    guard();
    if (raw.tools?.length || raw.config?.tools?.length) throw new AiError('unpriced_tools', 'This legacy tool call has no verified price reservation.', 409);
    if (raw.stream) throw new AiError('legacy_stream', 'Use protocol 4 for metered streaming.', 409);
    const model = String(raw.model ?? '');
    const output = Math.min(4096, Math.max(64, Number(raw.config?.maxOutputTokens ?? raw.generation_config?.max_output_tokens ?? (model.includes('tts') ? 2048 : 2048))));
    const input = Buffer.byteLength(JSON.stringify(raw), 'utf8') + 1024;
    const started = performance.now();
    let usage: ProviderUsage | null = null;
    try {
      scheduler.admitProvider();
      budget.reserve({ id, model, lane: 'A', category: model.includes('tts') ? 'voice' : 'legacy', maxInputTokens: input, maxOutputTokens: output });
      budget.markStarted(id);
      const result = kind === 'generate'
        ? await client.models.generateContent({ ...raw, config: { ...raw.config, maxOutputTokens: output, abortSignal: signal, httpOptions: { ...raw.config?.httpOptions, retryOptions: { attempts: 1 } } } } as any)
        : await client.interactions.create({ ...raw, generation_config: { ...raw.generation_config, max_output_tokens: output }, store: false } as any, { signal, retries: { strategy: 'none' } });
      const response = result as any;
      if (kind === 'interaction' && response.usage) usage = normalizeUsage(response.usage);
      if (kind === 'generate' && response.usageMetadata) { const u = response.usageMetadata; usage = normalizeUsage({ total_input_tokens: u.promptTokenCount, total_output_tokens: u.candidatesTokenCount, total_cached_tokens: u.cachedContentTokenCount, total_thought_tokens: u.thoughtsTokenCount, total_tokens: u.totalTokenCount }); }
      budget.record(id, usage?.estimated ? null : usage, { outcome: 'completed', durationMs: performance.now() - started });
      scheduler.providerSucceeded();
      return result;
    } catch (error) { budget.record(id, usage, { outcome: signal.aborted ? 'cancelled' : 'failed', durationMs: performance.now() - started }); scheduler.providerFailed(providerError(error).retryable); throw error; }
    } });
  }
  return new Proxy(client, { get(target, name) {
    if (name === 'models') return new Proxy(target.models, { get(models, key) { if (key === 'generateContent') return (input: Record<string, any>) => invoke('generate', input); const value = Reflect.get(models, key); return typeof value === 'function' ? value.bind(models) : value; } });
    if (name === 'interactions') return new Proxy(target.interactions, { get(interactions, key) { if (key === 'create') return (input: Record<string, any>) => invoke('interaction', input); const value = Reflect.get(interactions, key); return typeof value === 'function' ? value.bind(interactions) : value; } });
    const value = Reflect.get(target, name); return typeof value === 'function' ? value.bind(target) : value;
  } });
}
