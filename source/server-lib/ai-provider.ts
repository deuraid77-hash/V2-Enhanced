import { GoogleGenAI } from '@google/genai';
import { AiError, type AiProvider, type ProviderModel, type ProviderUsage, type StructuredRequest, type StructuredResult, ZERO_USAGE } from './ai-types.ts';
export const TEXT_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'] as const;
export function normalizeUsage(raw: Record<string, unknown> | undefined): ProviderUsage {
  if (!raw) return { ...ZERO_USAGE, estimated: true };
  for (const key of ['total_input_tokens', 'total_output_tokens', 'total_tokens']) if (!Number.isSafeInteger(raw[key]) || Number(raw[key]) < 0 || Number(raw[key]) > 100_000_000) return { ...ZERO_USAGE, estimated: true };
  for (const key of ['total_cached_tokens', 'total_thought_tokens']) if (raw[key] !== undefined && (!Number.isSafeInteger(raw[key]) || Number(raw[key]) < 0 || Number(raw[key]) > 100_000_000)) return { ...ZERO_USAGE, estimated: true };
  const number = (key: string) => raw[key] === undefined ? 0 : Number(raw[key]);
  if (number('total_cached_tokens') > number('total_input_tokens') || number('total_tokens') !== number('total_input_tokens') + number('total_output_tokens') + number('total_thought_tokens')) return { ...ZERO_USAGE, estimated: true };
  return { inputTokens: number('total_input_tokens'), outputTokens: number('total_output_tokens'), cachedTokens: number('total_cached_tokens'), thoughtTokens: number('total_thought_tokens'), totalTokens: number('total_tokens'), estimated: false };
}
export function providerError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  const status = Number((error as { status?: unknown; statusCode?: unknown })?.status ?? (error as { statusCode?: unknown })?.statusCode ?? 0);
  if (status === 429) return new AiError('provider_rate_limit', 'AI provider rate limit reached.', 503, true);
  if (status === 401 || status === 403) return new AiError('provider_permission', 'AI provider credentials or model permissions need attention.', 503, false);
  if (status === 400) return new AiError('provider_request_invalid', 'AI provider rejected this generation configuration.', 502, false);
  return new AiError('provider_unavailable', 'AI provider could not complete this request.', 503, status >= 500 || status === 0);
}
export class GeminiProvider implements AiProvider {
  readonly id = 'gemini';
  private availability = new Map<string, boolean>();
  constructor(private getClient: () => GoogleGenAI, private hasCredential: () => boolean, private onFailure?: (error: unknown) => void) {}
  configured() { return this.hasCredential(); }
  models(): ProviderModel[] { return TEXT_MODELS.map(id => ({ id, available: this.availability.get(id) ?? null, structuredOutput: true, streaming: true })); }
  async listModels(signal?: AbortSignal) {
    if (!this.configured()) throw new AiError('provider_unconfigured', 'Gemini is not configured.', 503);
    try {
      const listed = await this.getClient().models.list({ config: { pageSize: 100, httpOptions: { timeout: 8000 } } });
      const found = new Set<string>();
      for await (const model of listed) { if (signal?.aborted) throw signal.reason; if (model.name) found.add(model.name.replace(/^models\//, '')); }
      for (const id of TEXT_MODELS) this.availability.set(id, found.has(id));
      return this.models();
    } catch (error) { if (signal?.aborted) throw signal.reason; throw providerError(error); }
  }
  async streamStructured(request: StructuredRequest): Promise<StructuredResult> {
    if (!this.configured()) throw new AiError('provider_unconfigured', 'Gemini is not configured.', 503);
    if (!(TEXT_MODELS as readonly string[]).includes(request.model) || this.availability.get(request.model) === false) throw new AiError('model_unavailable', 'The selected model is unavailable for structured NPC requests.', 409);
    const start = performance.now();
    let firstTextMs: number | null = null;
    let text = '', usage = { ...ZERO_USAGE, estimated: true }, finishReason = 'incomplete';
    try {
      const stream = await this.getClient().interactions.create({
        model: request.model, system_instruction: request.system, input: request.prompt, store: false, stream: true,
        response_format: { type: 'text', mime_type: 'application/json', schema: request.schema },
        generation_config: { max_output_tokens: request.maxOutputTokens, thinking_level: request.model === 'gemini-3.8-flash' ? 'low' : 'minimal', thinking_summaries: 'none' },
      }, { signal: request.signal, retries: { strategy: 'none' } });
      for await (const event of stream) {
        if (request.signal.aborted) throw request.signal.reason;
        if (event.event_type === 'step.delta' && event.delta.type === 'text' && event.delta.text) {
          if (firstTextMs === null) firstTextMs = performance.now() - start;
          text += event.delta.text;
          if (text.length > 32_768) throw new AiError('provider_output_limit', 'AI response exceeded its validated size limit.', 502);
          request.onText?.(event.delta.text);
        }
        if ('interaction' in event && event.interaction) {
          const interaction = event.interaction as { usage?: Record<string, unknown>; status?: string };
          if (interaction.usage) usage = normalizeUsage(interaction.usage);
          if (interaction.status) finishReason = interaction.status;
        }
        if (event.event_type === 'error') throw new AiError('provider_stream_error', 'AI provider interrupted its response.', 503, true);
      }
      if (finishReason !== 'completed' || !text.trim()) throw new AiError('provider_incomplete', 'AI response did not complete.', 502, true);
      return { text, usage, firstTextMs, durationMs: performance.now() - start, finishReason };
    } catch (error) { this.onFailure?.(error); const typed = request.signal.aborted && request.signal.reason instanceof AiError ? request.signal.reason : providerError(error); if (!usage.estimated) typed.usage = usage; typed.durationMs = performance.now() - start; typed.firstTextMs = firstTextMs ?? undefined; throw typed; }
  }
}

// Only complete sentence text from the first top-level speech string can be
// streamed early. Partial JSON can never become an executable action.
export class SpeechSentenceExtractor {
  private buffer = '';
  private emitted = 0;
  private complete = false;
  constructor(private maximumCharacters = 800) {}
  push(chunk: string): string[] {
    this.buffer += chunk;
    if (this.buffer.length > 32_768) throw new AiError('provider_output_limit', 'AI response exceeded its validated size limit.', 502);
    const match = /^\s*\{\s*"speech"\s*:\s*"/.exec(this.buffer);
    if (!match) return [];
    let decoded = '';
    for (let i = match[0].length; i < this.buffer.length; i++) {
      const c = this.buffer[i];
      if (c === '"') { this.complete = true; break; }
      if (c !== '\\') decoded += c;
      else {
        const next = this.buffer[++i];
        if (next === undefined) break;
        if (next === 'u') {
          const hex = this.buffer.slice(i + 1, i + 5);
          if (!/^[\da-f]{4}$/i.test(hex)) break;
          decoded += String.fromCharCode(parseInt(hex, 16)); i += 4;
        } else if ('"\\/bfnrt'.includes(next)) decoded += ({ b: '', f: '', n: ' ', r: ' ', t: ' ' } as Record<string, string>)[next] ?? next;
        else throw new AiError('invalid_speech', 'AI speech escape was invalid.', 502);
      }
      if (decoded.length > this.maximumCharacters) throw new AiError('invalid_speech', 'AI speech exceeded its bounded length.', 502);
    }
    if (/[\u0000-\u001f<>~]/.test(decoded)) throw new AiError('invalid_speech', 'AI speech contains unsupported control content.', 502);
    const boundary = this.complete ? decoded.length : Math.max(decoded.lastIndexOf('. '), decoded.lastIndexOf('! '), decoded.lastIndexOf('? ')) + 1;
    if (boundary <= this.emitted) return [];
    const sentence = decoded.slice(this.emitted, boundary).trim();
    this.emitted = boundary;
    return sentence ? [sentence] : [];
  }
}
