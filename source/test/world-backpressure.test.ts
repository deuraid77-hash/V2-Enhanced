import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { DEFAULT_SETTINGS, WorldState } from '../server-lib/world.ts';
import { installWorldRoutes } from '../server-lib/world-routes.ts';

function populatedWorld() {
  const world = new WorldState();
  const position = { x: 105, y: -1940, z: 20 };
  world.exchange({ protocol: 3, runtimeId: 'backpressure-test-runtime', pluginVersion: 'test', gameVersion: 'test', appliedRevision: 1,
    player: { position }, environment: { district: 'Test district' },
    npcs: Array.from({ length: 40 }, (_, i) => ({ id: `npc-${i}`, name: `Observed test pedestrian ${i}`, faction: 'Civilian/Unknown', position,
      health: 100, alive: true, inCombat: false, owned: false, modelHash: 1, memory: 'Previous local conversation. '.repeat(25) })),
    director: { enabled: true, pausedReason: null, settings: { ...DEFAULT_SETTINGS }, activeEvents: [], ownedPedCount: 0, territories: [] },
    acknowledgements: [], events: [] });
  return world;
}

test('SSE drain permits later updates without recursively producing new snapshots', () => {
  const world = populatedWorld();
  const frames: string[] = [];
  let route: express.RequestHandler | undefined;
  const app = { get: (path: string, ...handlers: express.RequestHandler[]) => { if (path === '/api/world/events') route = handlers.at(-1); }, patch() {}, post() {} };
  installWorldRoutes(app as unknown as express.Express, world);
  const request = new EventEmitter();
  const response = Object.assign(new EventEmitter(), {
    status() { return this; }, set() { return this; }, flushHeaders() {},
    write(frame: string) { frames.push(frame); return false; },
  });
  try {
    route!(request as unknown as express.Request, response as unknown as express.Response, () => {});
    assert.equal(frames.length, 1);
    assert.ok(Buffer.byteLength(frames[0]) > 16_384, 'fixture must exceed the Windows HTTP high-water mark');
    for (let i = 0; i < 20; i++) response.emit('drain');
    assert.equal(frames.length, 1, 'drain itself must never create another snapshot');
    world.configure({ settings: { ambientHostility: 66 } });
    assert.equal(frames.length, 2, 'a real publish sends after the transport drains');
    world.configure({ settings: { ambientHostility: 67 } });
    assert.equal(frames.length, 2, 'backpressure coalesces intermediate world changes');
    response.emit('drain');
    assert.equal(frames.length, 2);
    world.configure({ settings: { ambientHostility: 68 } });
    assert.equal(frames.length, 3);
    assert.equal(JSON.parse(frames[2].split('data: ')[1]).config.settings.ambientHostility, 68, 'next publish sends the latest state');
  } finally { request.emit('close'); }
});

test('large real HTTP SSE frame does not flood drain events or starve other requests', async () => {
  const world = populatedWorld(), app = express();
  let writes = 0, backpressuredWrites = 0, highWaterMark = 0;
  app.get('/probe-health', (_req, res) => res.json({ ok: true }));
  app.use('/api/world/events', (_req, res, next) => {
    highWaterMark = res.writableHighWaterMark;
    const write = res.write.bind(res);
    res.write = ((...args: Parameters<typeof res.write>) => {
      // Bound a broken implementation so this regression cannot lock up the test process.
      if (++writes > 8) { res.destroy(); return false; }
      const ready = write(...args);
      if (!ready) backpressuredWrites++;
      return ready;
    }) as typeof res.write;
    next();
  });
  installWorldRoutes(app, world);
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let reading: Promise<void> | undefined;
  let streamError: unknown;
  try {
    const response = await fetch(base + '/api/world/events', { signal: abort.signal });
    assert.equal(response.status, 200);
    reader = response.body!.getReader();
    reading = (async () => { while (!(await reader!.read()).done) { /* Consume the actual socket stream. */ } })().catch(error => { streamError = error; });
    await delay(150);
    const health = await fetch(base + '/probe-health', { signal: AbortSignal.timeout(1500) });
    assert.deepEqual(await health.json(), { ok: true });
    assert.ok(Buffer.byteLength(JSON.stringify(world.snapshot())) > highWaterMark);
    assert.ok(backpressuredWrites >= 1, 'the test must exercise a real write(false)');
    assert.equal(writes, 1, 'only the initial snapshot is due before the one-second heartbeat');
    assert.equal(streamError, undefined);
  } finally {
    abort.abort(); await reader?.cancel().catch(() => {}); await reading;
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
