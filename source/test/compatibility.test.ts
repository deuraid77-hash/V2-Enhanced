import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { audioToWav, isAllowedLocalRequest, loadMemoryStore, normalizeWarfareUpdate, persistMemoryStore, readGeminiCredential, redactError, RuntimeStatus, RUNTIME_TTL_MS, serverConfiguration, validateTelemetry } from '../server-lib/compatibility.ts';

const frame = () => ({ runtimeId: 'enhanced-test', pluginVersion: '2.4.0', gameVersion: '1.0.1158.16', npcs: [{ id: '42', name: 'Ped', position: { x: 12, y: -5, z: 4 }, health: 100, alive: true }], player: { wantedLevel: 0 }, environment: { district: 'Davis' } });

test('companion is loopback-bound and cannot take the voice bridge port', () => {
  assert.deepEqual(serverConfiguration({}), { host: '127.0.0.1', port: 3000 });
  assert.deepEqual(serverConfiguration({ PORT: '3011' }), { host: '127.0.0.1', port: 3011 });
  for (const PORT of ['8765', '0', '1023', '65536', '3000.5', 'abc']) assert.throws(() => serverConfiguration({ PORT }));
});

test('local browser and native game requests accepted; foreign origins and DNS rebinding blocked', () => {
  assert.equal(isAllowedLocalRequest('127.0.0.1:3000', undefined, undefined, 3000), true);
  assert.equal(isAllowedLocalRequest('localhost:3000', 'http://localhost:3000', 'same-origin', 3000), true);
  for (const origin of ['https://localhost:3000', 'http://evil.example:3000', 'http://localhost:3001', 'null', 'broken']) assert.equal(isAllowedLocalRequest('127.0.0.1:3000', origin, undefined, 3000), false);
  assert.equal(isAllowedLocalRequest('evil.example:3000', undefined, undefined, 3000), false);
  assert.equal(isAllowedLocalRequest('localhost:3000', undefined, 'cross-site', 3000), false);
});

test('credential loading respects offline mode and reads only the exact installed key field', () => {
  let reads = 0;
  const read = () => { reads++; return '[Keys]\r\nGeminiKey1 = \r\nVoiceModel = example\r\n'; };
  assert.equal(readGeminiCredential({ LLAI_DISABLE_GEMINI: 'true', GEMINI_API_KEY: 'fake-offline-test' }, read), null);
  assert.equal(reads, 0);
  assert.equal(readGeminiCredential({}, read), null);
  assert.equal(readGeminiCredential({}, () => 'GeminiKey1 = fake-unit-test-value\r\n'), 'fake-unit-test-value');
  assert.equal(readGeminiCredential({}, () => 'GeminiKey1=OPENAI_LOCAL_BRIDGE'), null);
  assert.equal(readGeminiCredential({ GEMINI_API_KEY: 'MY_GEMINI_API_KEY' }, () => ''), null);
  assert.equal(readGeminiCredential({ GEMINI_API_KEY: 'fake-env-value' }, () => { throw Error('should not read'); }), 'fake-env-value');
});

test('upstream errors redact supplied and URL-encoded credentials without dumping stacks', () => {
  const secret = 'fake-unit-test/value+secret';
  const redacted = redactError(new Error(`request ${secret} encoded ${encodeURIComponent(secret)} https://example.test/?key=other-secret&api_key=third-secret`), [secret]);
  assert.equal(redacted.includes(secret), false);
  assert.equal(redacted.includes(encodeURIComponent(secret)), false);
  assert.equal(redacted.includes('other-secret'), false);
  assert.equal(redacted.includes('third-secret'), false);
  assert.equal(redacted.includes(' at '), false);
});

test('telemetry validates ranges and removes unknown fields', () => {
  const valid = validateTelemetry({ ...frame(), secret: 'must-not-retain' });
  assert.equal(valid.npcs[0].position.y, -5);
  assert.equal('secret' in valid, false);
  for (const bad of [null, [], {}, { ...frame(), npcs: Array(129).fill(frame().npcs[0]) }, { ...frame(), npcs: [frame().npcs[0], frame().npcs[0]] }, { ...frame(), npcs: [{ id: '1', position: { x: 1, y: 2 } }] }, { ...frame(), player: { wantedLevel: 1.5 } }, { ...frame(), npcs: [{ id: '1', position: { x: Number.NaN, y: 2, z: 0 } }] }]) assert.throws(() => validateTelemetry(bad));
});

test('runtime never reports connected before telemetry and expires at fifteen seconds', () => {
  const runtime = new RuntimeStatus();
  assert.equal(runtime.summary().connected, false);
  const now = 1_000_000;
  assert.equal(runtime.record(frame(), now).connected, true);
  assert.equal(runtime.summary(now + RUNTIME_TTL_MS - 1).connected, true);
  assert.equal(runtime.summary(now + RUNTIME_TTL_MS).connected, false);
  assert.equal(runtime.summary(now - 1).connected, false);
  assert.equal(runtime.snapshot(now).telemetry?.npcs.length, 1);
  assert.throws(() => runtime.record({ invalid: true }, now + 1));
  assert.equal(runtime.summary(now).lastSeenAt, new Date(now).toISOString());
});

test('faction aliases normalize to UI enums and territory percentages stay bounded', () => {
  const update = { eventHeadline: 'Test event', diplomaticShift: { initiatorFaction: 'ballas', targetFaction: 'Vagos', oldStatus: 'TRUCE', newStatus: 'ALLIANCE', reason: 'test' }, territoryClash: { district: 'Davis', attackingFaction: 'Families', defendingFaction: 'Ballas', contestedPercent: 140, flashpointDescription: 'test' }, worldAtmosphereNote: 'test' };
  const normalized = normalizeWarfareUpdate(update);
  assert.equal(normalized.diplomaticShift.initiatorFaction, 'Ballas');
  assert.equal(normalized.diplomaticShift.oldStatus, 'TENSE_TRUCE');
  assert.equal(normalized.diplomaticShift.newStatus, 'STRATEGIC_ALLIANCE');
  assert.equal(normalized.territoryClash.contestedPercent, 100);
  update.diplomaticShift.newStatus = 'BETRAYAL';
  update.territoryClash.contestedPercent = -4;
  assert.equal(normalizeWarfareUpdate(update).diplomaticShift.newStatus, 'HOSTILE');
  assert.equal(normalizeWarfareUpdate(update).territoryClash.contestedPercent, 0);
  update.diplomaticShift.newStatus = 'unsupported-state';
  assert.throws(() => normalizeWarfareUpdate(update), /unknown diplomatic status/);
  update.diplomaticShift.newStatus = 'NEUTRAL';
  assert.throws(() => normalizeWarfareUpdate(update, [{ id: 'Families' }]), /unknown faction ID/);
  update.diplomaticShift.targetFaction = 'Ballas';
  assert.throws(() => normalizeWarfareUpdate(update), /distinct factions/);
});

test('PCM audio gets a valid WAV header and WAV output is not wrapped twice', () => {
  const pcm = Buffer.from([0, 0, 255, 127, 0, 128]);
  const wav = audioToWav(pcm.toString('base64'), 'audio/L16;codec=pcm;rate=24000');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(4), 42);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt32LE(28), 48000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.deepEqual(wav.subarray(44), pcm);
  assert.deepEqual(audioToWav(wav.toString('base64'), 'audio/wav'), wav);
});

test('invalid audio, partial PCM samples and unsupported formats do not become fake WAVs', () => {
  for (const [data, mime] of [['not-base64!', 'audio/pcm'], ['A', 'audio/pcm'], ['AQID', 'audio/pcm'], ['AAABAA==', 'audio/mp3'], ['AAABAA==', 'audio/l16;rate=192000'], ['AAABAA==', 'audio/l16;channels=2']] as const) assert.throws(() => audioToWav(data, mime));
  assert.throws(() => audioToWav(Buffer.from('RIFF0000WAVE').toString('base64'), 'audio/wav'));
});

test('local memory survives reload in an isolated directory without prototype keys', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'llai-memory-test-'));
  try {
    const file = path.join(temp, 'memories.json');
    const store = loadMemoryStore(file);
    assert.equal(Object.getPrototypeOf(store), null);
    store.ped1 = { incidents: ['helped'], totalEncounters: 1 };
    persistMemoryStore(file, store);
    assert.deepEqual(loadMemoryStore(file).ped1, store.ped1);
    fs.writeFileSync(file, 'invalid-json');
    assert.equal(Object.keys(loadMemoryStore(file)).length, 0);
  } finally {
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('llai-memory-test-'));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
