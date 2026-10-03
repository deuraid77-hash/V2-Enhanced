import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { audioIdentifier, type AudioHostResponse } from './audio-types.ts';

type HostProcess = Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout' | 'stderr' | 'kill' | 'on' | 'once'>;
export type AudioHostOptions = {
  executable: string;
  spawnHost?: (executable: string) => HostProcess;
  requestTimeoutMs?: number;
};
/** Explicitly started by the companion only. Construction never opens an audio device. */
export class AudioHostProcess extends EventEmitter {
  private child: HostProcess | null = null;
  private buffer = '';
  private serial = 0;
  private pending = new Map<string, { resolve: (value: AudioHostResponse) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private failed = false;
  constructor(private options: AudioHostOptions) { super(); }

  get running() { return this.child !== null; }
  async start(): Promise<AudioHostResponse> {
    if (this.child) return this.request('capabilities');
    if (!path.isAbsolute(this.options.executable) || path.extname(this.options.executable).toLowerCase() !== '.exe') throw new Error('Audio helper requires an absolute executable path.');
    this.failed = false; this.buffer = '';
    const child = (this.options.spawnHost ?? (executable => spawn(executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false })))(this.options.executable);
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { if (this.child === child) this.receive(String(chunk)); });
    // Never copy helper stderr into logs: errors may contain private spoken text.
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => { if (this.child === child) { this.fail('Audio helper transport is unavailable.'); child.kill(); } });
    child.once('error', () => { if (this.child === child) this.fail('Audio helper failed to start.'); });
    child.once('exit', () => { if (this.child === child) this.fail('Audio helper exited.'); });
    return this.request('capabilities');
  }

  request(type: string, data: Record<string, unknown> = {}): Promise<AudioHostResponse> {
    if (!this.child || this.failed) return Promise.reject(new Error('Audio helper is not running.'));
    if (this.pending.size >= 64) return Promise.reject(new Error('Audio helper request queue is full.'));
    audioIdentifier(type, 'Audio command');
    const requestId = `audio-${++this.serial}`;
    const line = JSON.stringify({ ...data, type, requestId }) + '\n';
    if (Buffer.byteLength(line) > 256 * 1024) return Promise.reject(new Error('Audio helper message is too large.'));
    const child = this.child;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('Audio helper request timed out.')); }, this.options.requestTimeoutMs ?? 5000);
      timer.unref?.();
      this.pending.set(requestId, { resolve, reject, timer });
      child.stdin.write(line, error => {
        if (error) { this.pending.delete(requestId); clearTimeout(timer); reject(new Error('Audio helper transport is unavailable.')); }
      });
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    try { await this.request('shutdown'); } catch { /* Bounded shutdown always kills only our child. */ }
    this.fail('Audio helper stopped.');
    child.stdin.end(); child.kill();
  }

  private receive(chunk: string) {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > 1024 * 1024) { const child = this.child; this.fail('Audio helper response exceeded the limit.'); child?.kill(); return; }
    for (;;) {
      const end = this.buffer.indexOf('\n');
      if (end < 0) return;
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
      let result: AudioHostResponse;
      try {
        result = JSON.parse(line);
        if (!result || typeof result !== 'object' || typeof result.success !== 'boolean' || typeof result.requestId !== 'string' || typeof result.type !== 'string') throw new Error();
      } catch { const child = this.child; this.fail('Audio helper returned invalid protocol data.'); child?.kill(); return; }
      const pending = this.pending.get(result.requestId);
      if (!pending) continue;
      this.pending.delete(result.requestId); clearTimeout(pending.timer);
      if (result.success) pending.resolve(result);
      else pending.reject(new Error('Audio helper rejected ' + result.type.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 64) + '.'));
    }
  }

  private fail(reason: string) {
    if (this.failed) return;
    this.failed = true; this.child = null; this.buffer = '';
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(reason)); }
    this.pending.clear(); this.emit('unavailable', reason);
  }
}
