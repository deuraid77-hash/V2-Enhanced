import type { AiScope, ProviderUsage } from './ai-types.ts';
export type PttTarget = { runtimeId: string; sceneEpoch: string; npcId: string; expectedHandle: number; expectedModelHash: number };
export type PttState = 'starting' | 'capturing' | 'stopping' | 'transcribing' | 'ready' | 'cancelled' | 'failed';
export type CaptureReceipt = PttTarget & { id: string; requestId: string; state: PttState; createdAt: string; startedAt: string | null; updatedAt: string; finishedAt: string | null; leaseExpiresAt: string | null; maxDurationMs: number; elapsedMs: number; deviceId: string; deviceName: string; jobId: string | null; reasonCode?: string };
export type CaptureDevice = { id: string; name: string; isDefault: boolean; available: boolean };
export type CaptureOptions = { id: string; deviceId: string; maxDurationMs: number; sensitivity: number; silenceThreshold: number };
export type CaptureClip = { pcm: Buffer; durationMs: number; rms: number };
export interface CaptureHost {
  devices(): Promise<CaptureDevice[]>;
  start(options: CaptureOptions): Promise<{ deviceId: string; deviceName: string }>;
  lease(id: string, sequence: number): Promise<{ state: string; reasonCode?: string }>;
  stop(id: string): Promise<CaptureClip>;
  cancel(id: string): Promise<void>;
  focus(id: string): Promise<{valid: boolean; reasonCode?: string}>;
  close(): Promise<void>;
}
export type TranscriptionResult = { text: string; language: string; model: string; usage: ProviderUsage; durationMs: number };
export interface TranscriptionProvider {
  readonly model: string;
  configured(): boolean;
  transcribe(input: { pcm: Buffer; durationMs: number; language: string; signal: AbortSignal }): Promise<TranscriptionResult>;
}
export type ValidatedPttTarget = { scope: AiScope };
