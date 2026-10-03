/** Companion-only audio contract. Never imported by the game DLL or browser. */
export type AudioCategory = 'conversation' | 'casual' | 'combat' | 'vehicle' | 'phone' | 'narrator' | 'hurt';
export type AudioLane = 'A' | 'B' | 'C' | 'D';
export type VoiceSource = 'gemini' | 'windows';
export type AudioPosition = { x: number; y: number; z: number };
export type AudioScope = { runtimeId: string; sceneEpoch: string; npcId: string; npcFingerprint?: string };
export type Utterance = AudioScope & {
  utteranceId: string; jobId: string; category: AudioCategory; priority: number;
  textSource: 'gemini' | 'bank' | 'fallback'; textLane: AudioLane;
  position: AudioPosition;
};
export type VoiceChunk = {
  data: Uint8Array; encoding: 'pcm_s16le'; sampleRate: number; channels: 1;
  sequence: number; final: boolean;
};
export type VoiceUsage = {
  inputTokens: number; outputTokens: number; cachedTokens: number;
  thoughtTokens: number; totalTokens: number; estimated: boolean;
};
export type VoiceRenderRequest = {
  id: string; text: string; voiceId: string; style: string;
  maxDurationSeconds: number; signal: AbortSignal;
  onAudioChunk: (chunk: VoiceChunk) => Promise<void> | void;
};
export type VoiceRenderResult = {
  provider: string; model: string; voiceId: string; voiceSource: VoiceSource;
  format: { encoding: 'pcm_s16le'; sampleRate: number; channels: 1 };
  usage: VoiceUsage; firstChunkMs: number | null; durationMs: number;
  audioDurationMs: number; finishReason: 'completed' | 'cancelled';
};
export interface VoiceProvider {
  readonly id: VoiceSource;
  render(request: VoiceRenderRequest): Promise<VoiceRenderResult>;
}
export type AudioHostCapabilities = {
  protocol: 1; version: string; playback: boolean; capture: boolean;
  offlineSpeech: boolean; spatialMixing: boolean; stage: string;
};
export type AudioHostResponse = {
  requestId: string; success: boolean; type: string;
  error?: string; capabilities?: AudioHostCapabilities;
  [key: string]: unknown;
};

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
export function audioIdentifier(value: unknown, label = 'Identifier'): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new Error(`${label} must be a bounded identifier.`);
  return value;
}
export function validateVoiceRequest(request: VoiceRenderRequest): void {
  audioIdentifier(request.id, 'Voice request ID');
  if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 1200 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(request.text)) throw new Error('Voice text must contain 1–1200 printable characters.');
  if (typeof request.voiceId !== 'string' || !/^[A-Za-z][A-Za-z0-9 _.-]{0,99}$/.test(request.voiceId)) throw new Error('Voice ID is invalid.');
  if (typeof request.style !== 'string' || request.style.length > 300 || /[\u0000-\u001f]/.test(request.style)) throw new Error('Voice style must contain at most 300 printable characters.');
  if (!Number.isFinite(request.maxDurationSeconds) || request.maxDurationSeconds < 1 || request.maxDurationSeconds > 30) throw new Error('Voice duration limit must be between 1 and 30 seconds.');
  if (!request.signal || typeof request.signal.throwIfAborted !== 'function') throw new Error('Voice rendering requires a cancellation signal.');
  if (typeof request.onAudioChunk !== 'function') throw new Error('Voice rendering requires an audio sink.');
  request.signal.throwIfAborted();
}

/** Bounded PCM parser. WAV headers must be decoded separately, never played as PCM. */
export function pcmChunk(base64: unknown, sequence: number, maxBytes: number, sampleRate = 24000): VoiceChunk {
  if (typeof base64 !== 'string' || !base64 || base64.length > Math.ceil(maxBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('Invalid or oversized PCM chunk.');
  const data = Buffer.from(base64, 'base64');
  if (!data.length || data.length % 2 || data.length > maxBytes || data.subarray(0, 4).toString('ascii') === 'RIFF') throw new Error('Expected bounded signed 16-bit PCM, not a WAV container.');
  if (!Number.isInteger(sequence) || sequence < 0 || ![16000, 22050, 24000, 32000, 44100, 48000].includes(sampleRate)) throw new Error('Invalid PCM format or sequence.');
  return { data, encoding: 'pcm_s16le', sampleRate, channels: 1, sequence, final: false };
}
