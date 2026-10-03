import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('real HTTP companion routes: telemetry, origin protection, offline transparency and private state', async t => {
  // Isolated data and a disabled provider: no installed credential reads, no live Gemini calls.
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'llai-http-test-'));
  const probe = net.createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  Object.assign(process.env, { PORT: String(port), LLAI_DISABLE_GEMINI: 'true', LLAI_NO_AUTOSTART: 'true', LLAI_DATA_DIR: data, GEMINI_API_KEY: 'fake-test-credential-must-never-appear' });
  const { app } = await import('../server.ts');
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const s = app.listen(port, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${port}`;
  const post = (route: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    await t.test('health is honest before any game heartbeat and leaks no configured value', async () => {
      const response = await fetch(base + '/api/health');
      assert.equal(response.status, 200);
      const raw = await response.text();
      assert.equal(raw.includes('fake-test-credential'), false);
      const body = JSON.parse(raw);
      assert.equal(body.geminiConfigured, false);
      assert.equal(body.gameRuntime.connected, false);
      assert.equal(body.cloudSyncEnabled, false);
      assert.equal(body.bridge.port, 8765);
    });
    await t.test('valid telemetry reaches status, while invalid frames cannot overwrite it', async () => {
      const frame = { runtimeId: 'http-test', pluginVersion: '2.4.0', gameVersion: '1.0.1158.16', npcs: [{ id: '11', position: { x: 1, y: 2, z: 3 }, name: 'Ped', alive: true }], environment: { district: 'Davis' }, secret: 'discard-me' };
      const accepted = await post('/api/runtime/telemetry', frame);
      assert.equal(accepted.status, 200);
      assert.equal((await accepted.json()).gameRuntime.connected, true);
      const bad = await post('/api/runtime/telemetry', { ...frame, npcs: [{ id: '11', position: { x: 'wrong', y: 2, z: 3 } }] });
      assert.equal(bad.status, 400);
      const state = await (await fetch(base + '/api/runtime/status')).json();
      assert.equal(state.connected, true);
      assert.equal(state.telemetry.npcs[0].position.x, 1);
      assert.equal('secret' in state.telemetry, false);
    });
    await t.test('foreign browser origins and malformed request bodies are rejected', async () => {
      assert.equal((await post('/api/runtime/telemetry', {}, { origin: 'https://foreign.example' })).status, 403);
      assert.equal((await post('/api/runtime/telemetry', {}, { 'sec-fetch-site': 'cross-site' })).status, 403);
      assert.equal((await post('/api/runtime/telemetry', [])).status, 400);
      const invalid = await fetch(base + '/api/runtime/telemetry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"unfinished":' });
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).error, 'Invalid JSON body.');
      assert.equal((await fetch(base + '/api/does-not-exist')).status, 404);
    });
    await t.test('offline dialogue remains labelled as heuristic', async () => {
      const result = await (await post('/api/dialogue', { npc: { faction: 'Civilians' }, playerUtterance: 'hello' })).json();
      assert.equal(result.success, true);
      assert.equal(result.source, 'heuristic-ml-engine');
      assert.equal(typeof result.result.speech, 'string');
    });
    await t.test('offline faction simulation emits only canonical UI diplomacy and valid IDs', async () => {
      const ids = ['Families', 'Ballas', 'Vagos', 'Madrazo Cartel', 'LSPD', 'Merryweather', 'Civilians'];
      const response = await post('/api/factions/warfare-tick', { factions: ids.map(id => ({ id })) });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.success, true);
      assert.equal(result.source, 'heuristic-warfare-engine');
      const { diplomaticShift: shift, territoryClash: clash } = result.warfareUpdate;
      assert.equal(shift.newStatus, 'TENSE_TRUCE');
      for (const status of [shift.oldStatus, shift.newStatus]) assert.ok(['WAR', 'HOSTILE', 'TENSE_TRUCE', 'STRATEGIC_ALLIANCE', 'NEUTRAL'].includes(status));
      for (const id of [shift.initiatorFaction, shift.targetFaction, clash.attackingFaction, clash.defendingFaction]) assert.ok(ids.includes(id));
      assert.notEqual(shift.initiatorFaction, shift.targetFaction);
      assert.notEqual(clash.attackingFaction, clash.defendingFaction);
      assert.ok(Number.isInteger(clash.contestedPercent) && clash.contestedPercent >= 0 && clash.contestedPercent <= 100);
    });
    await t.test('recordings, speech synthesis and chat fail explicitly offline without invented output', async () => {
      const transcription = await post('/api/transcribe', { base64Audio: 'AAABAA==', mimeType: 'audio/wav' });
      assert.equal(transcription.status, 503);
      const body = await transcription.json();
      assert.equal(body.success, false);
      assert.equal(body.text, undefined);
      assert.equal((await post('/api/transcribe', { base64Audio: 'invalid!' })).status, 400);
      const speech = await post('/api/voice-converse', { text: 'Hello' });
      assert.equal(speech.status, 503);
      assert.equal((await speech.json()).audioBase64, undefined);
      const chat = await post('/api/chatbot', { messages: [{ role: 'user', text: 'Hello' }] });
      assert.equal(chat.status, 503);
      assert.equal((await chat.json()).text, undefined);
      assert.equal((await post('/api/chatbot', { messages: 'invalid' })).status, 400);
    });
    await t.test('memory persistence is local to the configured companion directory', async () => {
      const recorded = await post('/api/memory/record', { npcId: 'npc-42', incident: { summary: 'test encounter' } });
      assert.equal(recorded.status, 200);
      const all = await (await fetch(base + '/api/memory/all')).json();
      assert.equal(all.memories['npc-42'].totalEncounters, 1);
      const contents = fs.readFileSync(path.join(data, 'npc-memories.json'), 'utf8');
      assert.equal(contents.includes('test encounter'), true);
      assert.equal(contents.includes('fake-test-credential'), false);
      assert.equal((await post('/api/memory/record', { npcId: '../escape' })).status, 400);
      assert.equal((await fetch(base + '/api/memory/clear', { method: 'DELETE' })).status, 200);
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    assert.equal(path.dirname(path.resolve(data)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(data).startsWith('llai-http-test-'));
    fs.rmSync(data, { recursive: true, force: true });
  }
});
