import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS } from '../server-lib/world.ts';

test('real HTTP world control, settings persistence, SSE updates and session acknowledgement', async t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'llai-world-http-'));
  const probe = net.createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  Object.assign(process.env, { PORT: String(port), LLAI_DISABLE_GEMINI: 'true', LLAI_NO_AUTOSTART: 'true', LLAI_DATA_DIR: data });
  const { app } = await import('../server.ts');
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const s = app.listen(port, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${port}`;
  const send = (route: string, body: unknown, method = 'POST', headers: Record<string, string> = {}) => fetch(base + route, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const getWorld = async () => (await fetch(base + '/api/world')).json();
  const position = { x: 105, y: -1940, z: 20 };
  const frame = { protocol: 3, runtimeId: 'http-world-runtime', pluginVersion: '3.0.0', gameVersion: '1.0.1158.16', appliedRevision: 0,
    player: { position }, environment: { district: 'Davis' },
    npcs: [{ id: 'npc-123', name: 'Ballas member', faction: 'Ballas', position, health: 120, alive: true, owned: true, inCombat: false, modelHash: 123 }],
    director: { enabled: true, pausedReason: null, settings: { ...DEFAULT_SETTINGS }, activeEvents: [], ownedPedCount: 1,
      territories: [{ id: 'grove', name: 'Grove Street', owner: 'Ballas', challenger: null, heat: 10, position, radius: 180, wins: 0 }] },
    acknowledgements: [] as unknown[], events: [] as unknown[] };
  const request = { type: 'set_weather', payload: { weather: 'RAIN' }, requestId: randomUUID() };
  const abort = new AbortController();
  let stream: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let streamBuffer = '';
  async function nextWorld() {
    while (true) {
      const index = streamBuffer.indexOf('\n\n');
      if (index >= 0) {
        const message = streamBuffer.slice(0, index); streamBuffer = streamBuffer.slice(index + 2);
        const line = message.split('\n').find(line => line.startsWith('data: '));
        if (message.includes('event: world') && line) return JSON.parse(line.slice(6));
      }
      const read = await stream!.read(); if (read.done) throw new Error('SSE ended unexpectedly');
      streamBuffer += new TextDecoder().decode(read.value);
    }
  }
  try {
    await t.test('legacy heartbeat cannot falsely connect protocol 3 controls', async () => {
      assert.equal((await getWorld()).connected, false);
      const legacy = await send('/api/runtime/telemetry', { ...frame, protocol: undefined, director: undefined });
      assert.equal(legacy.status, 200); assert.equal((await getWorld()).connected, false);
      assert.equal((await send('/api/world/commands', request)).status, 409);
      const state = await getWorld(); assert.deepEqual(state.events, []); assert.equal(state.telemetry, null);
    });
    await t.test('SSE begins with honest disconnected state and config changes broadcast immediately', async () => {
      const response = await fetch(base + '/api/world/events', { signal: abort.signal });
      assert.equal(response.status, 200); assert.match(response.headers.get('content-type')!, /text\/event-stream/);
      stream = response.body!.getReader(); assert.equal((await nextWorld()).connected, false);
      const saved = await send('/api/world/config', { settings: { gangAggression: 90, ambientTaunts: false } }, 'PATCH');
      assert.equal(saved.status, 200); const result = await saved.json(); assert.equal(result.config.revision, 2); assert.equal(result.appliedRevision, 0);
      const broadcast = await nextWorld(); assert.equal(broadcast.config.settings.gangAggression, 90);
      assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'world-settings.json'), 'utf8')).settings.ambientTaunts, false);
    });
    await t.test('exchange carries desired config and only game observations appear in live snapshot', async () => {
      const response = await send('/api/runtime/exchange', frame); assert.equal(response.status, 200);
      const reply = await response.json(); assert.equal(reply.protocol, 3); assert.equal(reply.config.revision, 2); assert.deepEqual(reply.commands, []);
      const live = await nextWorld(); assert.equal(live.connected, true); assert.equal(live.telemetry.npcs[0].owned, true);
      assert.equal(live.telemetry.director.territories[0].owner, 'Ballas'); assert.equal(live.appliedRevision, 0);
    });
    await t.test('command is queued once, delivered to the game, and changes only after explicit acknowledgement', async () => {
      const first = await (await send('/api/world/commands', request)).json();
      const second = await (await send('/api/world/commands', request)).json();
      assert.equal(first.command.id, second.command.id); assert.equal(first.command.status, 'queued');
      const queued = await nextWorld(); assert.equal(queued.commands[0].status, 'queued');
      const exchange = await (await send('/api/runtime/exchange', frame)).json(); assert.equal(exchange.commands.length, 1); assert.equal(exchange.commands[0].runtimeId, frame.runtimeId);
      const applied = { ...frame, appliedRevision: 2, acknowledgements: [{ id: first.command.id, status: 'applied', message: 'Rain applied in Story Mode.' }],
        events: [{ id: 'weather-confirmed', at: new Date().toISOString(), type: 'weather_changed', message: 'Rain applied.' }] };
      assert.equal((await send('/api/runtime/exchange', applied)).status, 200);
      const observed = await getWorld(); assert.equal(observed.commands[0].status, 'applied'); assert.equal(observed.appliedRevision, 2); assert.equal(observed.events[0].message, 'Rain applied.');
      assert.equal((await send('/api/runtime/exchange', applied)).status, 200); assert.equal((await getWorld()).events.length, 1);
    });
    await t.test('invalid frames, commands, settings and cross-site controls fail explicitly', async () => {
      assert.equal((await send('/api/runtime/exchange', { ...frame, protocol: 2 })).status, 409);
      assert.equal((await send('/api/runtime/exchange', { ...frame, director: { ...frame.director, ownedPedCount: 100 } })).status, 400);
      assert.equal((await send('/api/world/config', { settings: { maxSpawnedPeds: 100 } }, 'PATCH')).status, 400);
      assert.equal((await send('/api/world/commands', { ...request, requestId: randomUUID(), payload: { weather: 'INVALID' } })).status, 400);
      assert.equal((await send('/api/world/config', { settings: { enabled: false } }, 'PATCH', { origin: 'https://example.com' })).status, 403);
      assert.equal((await send('/api/world/commands', { ...request, requestId: randomUUID() }, 'POST', { 'sec-fetch-site': 'cross-site' })).status, 403);
      assert.equal((await getWorld()).config.revision, 2);
      assert.equal((await send('/api/runtime/exchange', { ...frame, excess: 'x'.repeat(129 * 1024) })).status, 413);
    });
    await t.test('paused/loading exchange has null player, no stale NPCs and cleanup commands remain usable', async () => {
      const paused = { ...frame, player: null, environment: null, npcs: [], director: { ...frame.director, enabled: false, pausedReason: 'Loading or player unavailable' } };
      assert.equal((await send('/api/runtime/exchange', paused)).status, 200);
      const snapshot = await getWorld(); assert.equal(snapshot.telemetry.player, null); assert.equal(snapshot.telemetry.environment, null); assert.deepEqual(snapshot.telemetry.npcs, []);
      assert.equal((await send('/api/world/commands', { type: 'clear_events', payload: {}, requestId: randomUUID() })).status, 200);
    });
    await t.test('SSE heartbeat marks session stale after five seconds without runtime traffic', async () => {
      const deadline = Date.now() + 7500; let snapshot;
      do { snapshot = await nextWorld(); } while (snapshot.connected && Date.now() < deadline);
      assert.equal(snapshot.connected, false); assert.equal(snapshot.runtimeId, frame.runtimeId); assert.notEqual(snapshot.lastSeenAt, null);
      assert.equal((await send('/api/world/commands', { ...request, requestId: randomUUID() })).status, 409);
    });
    await t.test('HTTP config rate limit returns a retry time without losing last accepted settings', async () => {
      let limited: Response | undefined;
      for (let i = 0; i < 35; i++) { const response = await send('/api/world/config', { settings: { ambientHostility: 60 + i % 2 } }, 'PATCH'); if (response.status === 429) { limited = response; break; } }
      assert.ok(limited); assert.ok(Number(limited.headers.get('retry-after')) > 0);
      assert.equal((await limited.json()).success, false);
      const saved = JSON.parse(fs.readFileSync(path.join(data, 'world-settings.json'), 'utf8'));
      assert.deepEqual(saved, (await getWorld()).config);
    });
  } finally {
    abort.abort(); await stream?.cancel().catch(() => {});
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    assert.equal(path.dirname(path.resolve(data)), path.resolve(os.tmpdir())); assert.ok(path.basename(data).startsWith('llai-world-http-'));
    fs.rmSync(data, { recursive: true, force: true });
  }
});
