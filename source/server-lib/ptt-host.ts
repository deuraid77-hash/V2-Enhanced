import { AudioHostProcess } from './audio-host.ts';
import { AiError } from './ai-types.ts';
import type { CaptureClip, CaptureDevice, CaptureHost, CaptureOptions } from './ptt-types.ts';

export class PttAudioHost implements CaptureHost {
  private starting: Promise<unknown> | null = null;
  constructor(private process: AudioHostProcess) {}
  private async ensure() { if (!this.process.running) { this.starting ??= this.process.start().finally(() => { this.starting = null; }); await this.starting; } }
  private async request(type: string, data: Record<string, unknown> = {}) { await this.ensure(); return await this.process.request(type, data) as Record<string, any>; }
  async devices(): Promise<CaptureDevice[]> { const r = await this.request('captureDevices'); if (!Array.isArray(r.devices) || r.devices.length > 128) throw new AiError('capture_unavailable', 'Capture device inventory is invalid.', 503); return r.devices; }
  async start(options: CaptureOptions) { const r = await this.request('captureStart', options); return { deviceId: String(r.deviceId), deviceName: String(r.deviceName) }; }
  async lease(id: string, sequence: number) { const r = await this.request('captureLease', { id, sequence }); return { state: String(r.state), ...(r.reasonCode ? { reasonCode: String(r.reasonCode) } : {}) }; }
  async stop(id: string): Promise<CaptureClip> {
    const meta = await this.request('captureStop', { id });
    if (meta.state !== 'ready') throw new AiError(typeof meta.reasonCode === 'string' ? meta.reasonCode : 'capture_cancelled', 'Recording could not be committed.', 409);
    if (!Number.isSafeInteger(meta.bytes) || meta.bytes < 8000 || meta.bytes > 960000 || meta.bytes % 2) throw new AiError('invalid_audio', 'Recording exceeded its sample bounds.', 502);
    const pcm = Buffer.alloc(meta.bytes); let offset = 0;
    try {
      for (let sequence = 0; offset < pcm.length; sequence++) {
        const chunk = await this.request('captureChunk', { id, sequence });
        if (chunk.id !== id || chunk.sequence !== sequence || typeof chunk.data !== 'string' || chunk.data.length > 43692 || !/^[A-Za-z0-9+/]*={0,2}$/.test(chunk.data)) throw new AiError('invalid_audio', 'Recording chunk identity was invalid.', 502);
        const data = Buffer.from(chunk.data, 'base64');
        if (!data.length || data.length > 32768 || data.length % 2 || offset + data.length > pcm.length) throw new AiError('invalid_audio', 'Recording chunk size was invalid.', 502);
        data.copy(pcm, offset); offset += data.length; data.fill(0);
      }
      return { pcm, durationMs: pcm.length / 32, rms: Number(meta.rms) };
    } catch (e) { pcm.fill(0); throw e; }
    finally { await this.cancel(id); }
  }
  async cancel(id: string) { if (this.process.running) await this.process.request('captureCancel', { id }).catch(() => {}); }
  async focus(id: string) { if(!this.process.running)return{valid:false,reasonCode:'capture_unavailable'};const r=await this.process.request('captureFocus',{id}) as Record<string,unknown>;return{valid:r.valid===true,...(typeof r.reasonCode==='string'?{reasonCode:r.reasonCode}:{})}; }
  async close() { await this.process.stop(); }
}
