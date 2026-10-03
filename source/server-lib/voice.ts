import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { GoogleGenAI } from '@google/genai';
import { AiError, type SettingsGetter, settingNumber } from './ai-types.ts';
import { normalizeUsage, providerError } from './ai-provider.ts';
import { validateVoiceRequest, type VoiceRenderRequest, type VoiceRenderResult } from './audio-types.ts';

/** Prebuilt voice names listed in the Gemini speech-generation guide. Genders are not documented, so none are assumed. */
export const GEMINI_VOICES = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'] as const;
export type VoiceCast = { geminiVoice: string; windowsVoiceIndex: number; windowsRate: number; pitch: number; speed: number };

const unit = (digest: Buffer, offset: number) => digest.readUInt32BE(offset) / 0x1_0000_0000;
/** Stable per-persona casting: the same persona key always maps to the same voice and spread. */
export function castVoice(personaKey: string, get: SettingsGetter): VoiceCast {
  const digest = createHash('sha256').update('voice-cast:v1:' + personaKey).digest();
  const pitchSpread = settingNumber(get, 'audio.pitchSpread', 0.08), speedSpread = settingNumber(get, 'audio.speedSpread', 0.12);
  const pitch = 1 + (unit(digest, 8) * 2 - 1) * pitchSpread, speed = 1 + (unit(digest, 12) * 2 - 1) * speedSpread;
  // SpeechSynthesizer.Rate is an integer in [-10, 10]; one step is coarse, so the spread is mapped and clamped to [-3, 3].
  const windowsRate = Math.max(-3, Math.min(3, Math.round((speed - 1) * 10)));
  return { geminiVoice: GEMINI_VOICES[digest.readUInt32BE(0) % GEMINI_VOICES.length], windowsVoiceIndex: digest.readUInt32BE(4) & 0x7fffffff, windowsRate, pitch, speed };
}

const TONES = new Set(['calm', 'friendly', 'annoyed', 'angry', 'scared', 'urgent', 'sad', 'amused', 'nervous', 'sarcastic', 'tired', 'excited', 'hurt']);
export function safeTone(tone: unknown) { return typeof tone === 'string' && TONES.has(tone) ? tone : 'natural'; }
/** Natural-language style prefix, following the guide's "Say <style>: text" form. */
export function stylePrompt(text: string, tone: string, cast: VoiceCast, intensity: number) {
  const strength = intensity >= 0.75 ? 'clearly' : intensity >= 0.35 ? 'slightly' : 'barely';
  const parts = [tone === 'natural' ? 'naturally, like a Los Santos local' : `${strength} ${tone}`];
  if (cast.pitch > 1.04) parts.push('with a slightly higher voice'); else if (cast.pitch < 0.96) parts.push('with a slightly lower voice');
  if (cast.speed > 1.05) parts.push('a little quickly'); else if (cast.speed < 0.95) parts.push('a little slowly');
  return `Say ${parts.join(', ')}: ${text}`;
}

const CACHE_FILE = /^[a-f0-9]{64}\.pcm$/;
/** Bounded PCM cache. It only ever deletes files matching its own name pattern inside its own directory. */
export class VoiceCache {
  constructor(readonly directory: string, private get: SettingsGetter) { if (!path.isAbsolute(directory)) throw new Error('Voice cache requires an absolute directory.'); }
  key(parts: string[]) { return createHash('sha256').update(parts.join('\u0001')).digest('hex'); }
  file(key: string) { if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid cache key.'); return key + '.pcm'; }
  ensure() { fs.mkdirSync(this.directory, { recursive: true }); return this.directory; }
  has(key: string) {
    const full = path.join(this.directory, this.file(key));
    try { const now = new Date(); fs.utimesSync(full, now, now); return fs.statSync(full).size > 0; } catch { return false; }
  }
  write(key: string, pcm: Buffer) {
    if (!pcm.length || pcm.length % 2 || pcm.length > 24000 * 2 * 60) throw new AiError('invalid_audio', 'Rendered voice exceeded its bounds.', 502);
    this.ensure();
    const full = path.join(this.directory, this.file(key)), temp = full + '.' + process.pid + '.tmp';
    fs.writeFileSync(temp, pcm); fs.renameSync(temp, full);
    this.enforce();
  }
  enforce() {
    const cap = settingNumber(this.get, 'audio.cacheMegabytes', 256) * 1024 * 1024;
    let entries: { name: string; size: number; mtime: number }[] = [];
    try { entries = fs.readdirSync(this.directory).filter(name => CACHE_FILE.test(name)).map(name => { const s = fs.statSync(path.join(this.directory, name)); return { name, size: s.size, mtime: s.mtimeMs }; }); } catch { return { files: 0, bytes: 0, removed: 0 }; }
    let bytes = entries.reduce((sum, e) => sum + e.size, 0), removed = 0;
    for (const e of entries.sort((a, b) => a.mtime - b.mtime)) { if (bytes <= cap) break; try { fs.unlinkSync(path.join(this.directory, e.name)); bytes -= e.size; removed++; } catch { /* in use; retry next write */ } }
    return { files: entries.length - removed, bytes, removed };
  }
}

/** Gemini TTS through the Interactions API. Callers own budget reservation and scheduling. */
export class GeminiVoiceProvider {
  readonly id = 'gemini' as const;
  constructor(private getClient: () => GoogleGenAI, private hasCredential: () => boolean, private getModel: () => string) {}
  get model() { return this.getModel(); }
  configured() { return this.hasCredential(); }
  async render(request: VoiceRenderRequest): Promise<VoiceRenderResult> {
    validateVoiceRequest(request);
    if (!this.configured()) throw new AiError('provider_unconfigured', 'Gemini is not configured.', 503);
    if (!(GEMINI_VOICES as readonly string[]).includes(request.voiceId)) throw new AiError('invalid_voice', 'Voice is not a documented prebuilt voice.', 400);
    const start = performance.now();
    try {
      const interaction = await this.getClient().interactions.create({
        model: this.model, input: request.style, store: false,
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice: request.voiceId }] },
      }, { signal: request.signal, retries: { strategy: 'none' } }) as unknown as { output_audio?: { data?: unknown }; usage?: Record<string, unknown>; status?: string };
      const data = interaction.output_audio?.data;
      if (typeof data !== 'string' || !data || data.length > Math.ceil(24000 * 2 * request.maxDurationSeconds / 3) * 4) throw new AiError('invalid_audio', 'Voice provider returned no bounded audio.', 502);
      const pcm = Buffer.from(data, 'base64');
      if (!pcm.length || pcm.length % 2 || pcm.subarray(0, 4).toString('ascii') === 'RIFF') throw new AiError('invalid_audio', 'Voice provider returned non-PCM audio.', 502);
      const firstChunkMs = performance.now() - start;
      await request.onAudioChunk({ data: pcm, encoding: 'pcm_s16le', sampleRate: 24000, channels: 1, sequence: 0, final: true });
      return { provider: 'gemini', model: this.model, voiceId: request.voiceId, voiceSource: 'gemini', format: { encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 }, usage: normalizeUsage(interaction.usage), firstChunkMs, durationMs: performance.now() - start, audioDurationMs: pcm.length / 48, finishReason: 'completed' };
    } catch (error) { if (request.signal.aborted) throw request.signal.reason ?? error; throw providerError(error); }
  }
}
