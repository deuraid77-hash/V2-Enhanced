import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { AudioHostProcess } from '../server-lib/audio-host.ts';
import { pcmChunk, validateVoiceRequest, type VoiceRenderRequest } from '../server-lib/audio-types.ts';

function request(overrides: Partial<VoiceRenderRequest> = {}): VoiceRenderRequest {
  return { id: 'utterance-1', text: 'Move away from the car.', voiceId: 'Puck', style: 'Urgent, short.', maxDurationSeconds: 15, signal: new AbortController().signal, onAudioChunk() {}, ...overrides };
}
test('voice requests require bounded real text, voice IDs, duration and cancellation', () => {
  assert.doesNotThrow(() => validateVoiceRequest(request()));
  for (const overrides of [{ text: '' }, { text: 'x'.repeat(1201) }, { voiceId: '../../key' }, { style: 'x'.repeat(301) }, { maxDurationSeconds: 31 }, { maxDurationSeconds: NaN }]) assert.throws(() => validateVoiceRequest(request(overrides)));
  const controller = new AbortController(); controller.abort();
  assert.throws(() => validateVoiceRequest(request({ signal: controller.signal })));
});
test('PCM decoding preserves signed samples and rejects WAV, malformed, odd and oversized frames', () => {
  const bytes = Buffer.from([0, 128, 255, 127, 0, 0]);
  const chunk = pcmChunk(bytes.toString('base64'), 0, 6);
  assert.deepEqual(Buffer.from(chunk.data), bytes);
  assert.equal(chunk.sampleRate, 24000);
  for (const input of ['%%%%', 'AA==', 'UklGRgAAAAA=', bytes.toString('base64') + '\n']) assert.throws(() => pcmChunk(input, 0, 6));
  assert.throws(() => pcmChunk(bytes.toString('base64'), 0, 4));
  assert.throws(() => pcmChunk(bytes.toString('base64'), -1, 6));
});
function fakeProcess(options: { split?: boolean; noReply?: boolean; malformed?: boolean } = {}) {
  const events = new EventEmitter();
  const stdout = new PassThrough(), stderr = new PassThrough();
  const received: Record<string, unknown>[] = [];
  let killed = false;
  const stdin = new Writable({ write(chunk, _encoding, callback) {
    const input = JSON.parse(String(chunk)); received.push(input);
    callback();
    if (options.noReply) return;
    queueMicrotask(() => {
      const reply = options.malformed ? 'not-json\n' : JSON.stringify({ requestId: input.requestId, type: input.type, success: true,
        ...(input.type === 'capabilities' ? { capabilities: { protocol: 1, version: 'fixture', playback: false, capture: false, offlineSpeech: false, spatialMixing: false, stage: 'test' } } : {}) }) + '\n';
      if (options.split) { stdout.write(reply.slice(0, 7)); stdout.write(reply.slice(7)); }
      else stdout.write(reply);
    });
  } });
  const child = Object.assign(events, { stdin, stdout, stderr, kill() { killed = true; return true; } });
  return { child, received, isKilled: () => killed };
}
test('helper construction is inert; explicit launch supports fragmented IPC and bounded shutdown', async () => {
  const fake = fakeProcess({ split: true }); let launches = 0;
  const host = new AudioHostProcess({ executable: 'C:\\local\\AudioHost.exe', spawnHost: () => { launches++; return fake.child as never; } });
  assert.equal(launches, 0); assert.equal(host.running, false);
  const ready = await host.start(); assert.equal(launches, 1); assert.equal(ready.capabilities?.playback, false);
  assert.equal((await host.request('ping')).success, true);
  await host.stop(); assert.equal(fake.isKilled(), true); assert.equal(host.running, false);
  assert.deepEqual(fake.received.map(message => message.type), ['capabilities', 'ping', 'shutdown']);
});
test('helper rejects malformed protocol without echoing private output', async () => {
  const fake = fakeProcess({ malformed: true });
  const host = new AudioHostProcess({ executable: 'C:\\local\\AudioHost.exe', spawnHost: () => fake.child as never });
  await assert.rejects(host.start(), /invalid protocol data/);
  assert.equal(fake.isKilled(), true); assert.equal(host.running, false);
});
test('helper ignores stale child exit after restart', async () => {
  const first = fakeProcess(), second = fakeProcess(); let count = 0;
  const host = new AudioHostProcess({ executable: 'C:\\local\\AudioHost.exe', spawnHost: () => (++count === 1 ? first.child : second.child) as never });
  await host.start(); await host.stop(); await host.start();
  first.child.emit('exit', 0);
  assert.equal(host.running, true); assert.equal((await host.request('ping')).success, true);
  await host.stop();
});
test('helper rejects arbitrary shell command paths and queue oversize before transport', async () => {
  const invalid = new AudioHostProcess({ executable: 'AudioHost.exe && whoami' });
  await assert.rejects(invalid.start(), /absolute executable path/);
  const fake = fakeProcess(); const host = new AudioHostProcess({ executable: 'C:\\local\\AudioHost.exe', spawnHost: () => fake.child as never });
  await host.start(); await assert.rejects(host.request('play', { data: 'x'.repeat(300000) }), /too large/);
  assert.equal(fake.received.length, 1); await host.stop();
});
