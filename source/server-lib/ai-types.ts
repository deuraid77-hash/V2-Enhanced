export type AiLane = 'A' | 'B' | 'C' | 'D';
export type AiSource = 'gemini' | 'bank' | 'fallback';
export type AiSettings = Record<string, boolean | number | string>;
export type SettingsGetter = () => AiSettings;
export type ProviderUsage = { inputTokens: number; outputTokens: number; cachedTokens: number; thoughtTokens: number; totalTokens: number; estimated: boolean };
export const ZERO_USAGE: ProviderUsage = Object.freeze({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, thoughtTokens: 0, totalTokens: 0, estimated: false });
export type AiScope = { runtimeId: string; sceneEpoch: string; npcIds: string[] };
export type AiJobKind = 'conversation' | 'director' | 'bank' | 'summary' | 'advice' | 'persona' | 'quickReplies' | 'explain';
export type AiStatus = 'queued' | 'running' | 'streaming' | 'completed' | 'cancelled' | 'rejected' | 'failed' | 'fallback';
export type ProviderModel = { id: string; available: boolean | null; structuredOutput: boolean; streaming: boolean };
export type StructuredRequest = { model: string; system: string; prompt: string; schema: Record<string, unknown>; maxOutputTokens: number; signal: AbortSignal; onText?: (text: string) => void };
export type StructuredResult = { text: string; usage: ProviderUsage; firstTextMs: number | null; durationMs: number; finishReason: string };
export interface AiProvider {
  readonly id: string;
  configured(): boolean;
  models(): ProviderModel[];
  listModels(signal?: AbortSignal): Promise<ProviderModel[]>;
  streamStructured(request: StructuredRequest): Promise<StructuredResult>;
}
export class AiError extends Error {
  usage?: ProviderUsage;
  durationMs?: number;
  firstTextMs?: number;
  constructor(public code: string, message: string, public status = 400, public retryable = false) { super(message); }
}
export const settingNumber = (get: SettingsGetter, key: string, fallback: number) => typeof get()[key] === 'number' ? get()[key] as number : fallback;
export const settingBoolean = (get: SettingsGetter, key: string, fallback: boolean) => typeof get()[key] === 'boolean' ? get()[key] as boolean : fallback;
export const settingString = (get: SettingsGetter, key: string, fallback: string) => typeof get()[key] === 'string' ? get()[key] as string : fallback;
export function boundedInteger(value: unknown, min: number, max: number, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new AiError('invalid_payload', `${name} is outside its allowed range.`);
  return value as number;
}
export function boundedText(value: unknown, max: number, name: string, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max || /[\u0000-\u0008\u000b-\u001f]/.test(value)) throw new AiError('invalid_payload', `${name} must be bounded text.`);
  return value.trim();
}
export function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AiError('invalid_payload', `${name} must be an object.`);
  return value as Record<string, unknown>;
}
export function onlyKeys(value: Record<string, unknown>, keys: readonly string[], name: string) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new AiError('invalid_payload', `${name} contains an unsupported field.`);
}
