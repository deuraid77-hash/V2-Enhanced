import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { COMMAND_TTL_MS, DEFAULT_SETTINGS, MAX_QUEUED_COMMANDS, WorldError, WorldState, validateCommand, validateSettings, validateWorldTelemetry } from '../server-lib/world.ts';

const position = { x: 105, y: -1940, z: 20 };
function frame(runtimeId = 'test-runtime') {
  return { protocol: 3, runtimeId, gameVersion: '1.0.1158.16', pluginVersion: '3.0.0', appliedRevision: 0,
    player: { wantedLevel: 0, position }, environment: { weather: 'CLEAR', district: 'Davis' },
    npcs: [{ id: 'npc:111:123', name: 'Gang member', faction: 'Ballas', position, health: 100, alive: true, inCombat: false, owned: true, modelHash: 123, memory: 'Earlier encounter' }],
    director: { enabled: true, pausedReason: null, settings: { ...DEFAULT_SETTINGS }, activeEvents: [], ownedPedCount: 0,
      territories: [{ id: 'grove', name: 'Grove Street', owner: 'Ballas', challenger: null, heat: 0, position, radius: 180, wins: 0 }] },
    acknowledgements: [] as unknown[], events: [] as unknown[] };
}
function command(type = 'set_time', payload: object = { hour: 22 }, requestId = randomUUID()) { return { type, payload, requestId }; }
const hasStatus = (status: number) => (error: unknown) => error instanceof WorldError && error.status === status;

test('world starts disconnected with frequent encounters desired and no invented observations', () => {
  const state = new WorldState().snapshot();
  assert.equal(state.connected, false); assert.equal(state.telemetry, null); assert.equal(state.runtimeId, null);
  assert.equal(state.config.settings.eventIntervalSeconds, 75); assert.equal(state.config.settings.turfWars, true);
  assert.equal(state.appliedRevision, 0); assert.deepEqual(state.commands, []); assert.deepEqual(state.events, []);
});

test('settings merge, persist atomically, retain revision on no-op and reload without observed state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llai-world-settings-'));
  try {
    const file = path.join(dir, 'world-settings.json'); const world = new WorldState(file);
    const changed = world.configure({ settings: { gangAggression: 88, ambientTaunts: false } });
    assert.equal(changed.config.revision, 2); assert.equal(changed.config.settings.civilianPanic, 70);
    assert.equal(world.configure({ settings: { gangAggression: 88 } }).config.revision, 2);
    const restored = new WorldState(file).snapshot();
    assert.deepEqual(restored.config, changed.config); assert.equal(restored.appliedRevision, 0); assert.equal(restored.telemetry, null);
    assert.deepEqual(fs.readdirSync(dir), ['world-settings.json']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('invalid settings and failed disk save never change desired state', () => {
  for (const settings of [{ ambientHostility: 101 }, { eventIntervalSeconds: 29 }, { maxSpawnedPeds: 25 }, { maxActiveEvents: 1.5 }, { enabled: 'true' }, { unknown: 1 }, {}]) {
    const world = new WorldState(); assert.throws(() => world.configure({ settings }), hasStatus(400)); assert.equal(world.snapshot().config.revision, 1);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llai-world-save-failure-'));
  try {
    const file = path.join(dir, 'settings.json'); const world = new WorldState(file);
    fs.mkdirSync(file); // Make atomic rename impossible without touching the real data directory.
    assert.throws(() => world.configure({ settings: { enabled: false } }), hasStatus(500));
    assert.equal(world.snapshot().config.settings.enabled, true); assert.equal(world.snapshot().config.revision, 1);
    assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('invalid persisted settings are preserved and reported instead of silently reset', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llai-world-invalid-'));
  try {
    const file = path.join(dir, 'settings.json'); fs.writeFileSync(file, '{broken');
    assert.throws(() => new WorldState(file), /could not be validated/); assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('telemetry round-trips observed NPC fields and omits unknown fields', () => {
  const value = validateWorldTelemetry({ ...frame(), secret: 'must-not-leak' });
  assert.equal(value.npcs[0].owned, true); assert.equal(value.npcs[0].inCombat, false); assert.equal(value.npcs[0].modelHash, 123);
  assert.equal(value.npcs[0].memory, 'Earlier encounter'); assert.equal('secret' in value, false);
  assert.equal(value.director.territories[0].owner, 'Ballas');
});

test('casualties with negative API health remain valid observed game telemetry', () => {
  const original = frame();
  const telemetry = validateWorldTelemetry({ ...original, npcs: [{ ...original.npcs[0], health: -100, alive: false }] });
  assert.equal(telemetry.npcs[0].health, -100); assert.equal(telemetry.npcs[0].alive, false);
});

test('full settings and bounded unique director state are mandatory', () => {
  assert.throws(() => validateSettings({ enabled: true }));
  for (const change of [
    { ownedPedCount: 25 }, { activeEvents: Array(4).fill({}) },
    { territories: [frame().director.territories[0], frame().director.territories[0]] },
    { territories: [{ ...frame().director.territories[0], owner: 'Invented gang' }] },
    { territories: [{ ...frame().director.territories[0], challenger: 'Ballas' }] },
  ]) assert.throws(() => validateWorldTelemetry({ ...frame(), director: { ...frame().director, ...change } }));
  assert.throws(() => validateWorldTelemetry({ ...frame(), protocol: 2 }), hasStatus(409));
});

test('freshness expires at five seconds and rejects new commands while stale', () => {
  let time = 1_000_000; const world = new WorldState(undefined, () => time);
  assert.throws(() => world.enqueue(command()), hasStatus(409));
  world.exchange(frame()); time += 4999; assert.equal(world.snapshot().connected, true);
  time++; assert.equal(world.snapshot().connected, false); assert.throws(() => world.enqueue(command()), hasStatus(409));
  assert.notEqual(world.snapshot().telemetry, null); // Last-known state remains clearly stale.
});

test('desired config remains pending until an actual game revision acknowledgement', () => {
  const world = new WorldState(); world.exchange(frame());
  const state = world.configure({ settings: { enabled: false } });
  assert.equal(state.config.revision, 2); assert.equal(state.appliedRevision, 0); assert.equal(state.telemetry!.director.enabled, true);
  world.exchange({ ...frame(), appliedRevision: 2, director: { ...frame().director, enabled: false, settings: { ...DEFAULT_SETTINGS, enabled: false } } });
  assert.equal(world.snapshot().appliedRevision, 2); assert.equal(world.snapshot().telemetry!.director.enabled, false);
  assert.throws(() => world.exchange({ ...frame(), appliedRevision: 999 }), hasStatus(409));
});

test('command requests deduplicate exactly; different payload with same UUID is rejected', () => {
  const world = new WorldState(); world.exchange(frame()); const input = command();
  const first = world.enqueue(input); const second = world.enqueue(input);
  assert.deepEqual(first, second); assert.equal(world.snapshot().commands.length, 1);
  assert.throws(() => world.enqueue({ ...input, payload: { hour: 23 } }), hasStatus(409));
  assert.equal(world.exchange(frame()).commands.length, 1);
});

test('only matching-session command acknowledgements change dispatch status; duplicate terminal ACK is harmless', () => {
  const world = new WorldState(); world.exchange(frame()); const created = world.enqueue(command());
  const ack = { id: created.id, status: 'applied', message: 'Clock changed to 22:00.' };
  const reply = world.exchange({ ...frame(), acknowledgements: [ack, { ...ack, id: randomUUID() }] });
  assert.deepEqual(reply.commands, []); assert.equal(world.snapshot().commands[0].status, 'applied');
  world.exchange({ ...frame(), acknowledgements: [{ ...ack, status: 'rejected', message: 'Late duplicate' }] });
  assert.equal(world.snapshot().commands[0].status, 'applied'); assert.equal(world.snapshot().commands[0].message, ack.message);
});

test('queue is bounded, expires after thirty seconds, and does not resurrect expired ACKs', () => {
  let time = 1_000_000; const world = new WorldState(undefined, () => time); world.exchange(frame());
  for (let i = 0; i < MAX_QUEUED_COMMANDS; i++) world.enqueue(command());
  assert.throws(() => world.enqueue(command()), hasStatus(429));
  const created = world.snapshot().commands[0]; time += COMMAND_TTL_MS;
  const reply = world.exchange({ ...frame(), acknowledgements: [{ id: created.id, status: 'applied', message: 'Too late' }] });
  assert.deepEqual(reply.commands, []); assert.equal(world.snapshot().commands.every(c => c.status === 'expired'), true);
  assert.equal(world.enqueue(command()).status, 'queued');
});

test('session replacement expires pending commands, rejects late prior runtime and prevents replay of prior requestId', () => {
  let time = 1_000_000; const world = new WorldState(undefined, () => time); world.exchange(frame('old'));
  const input = command(); const queued = world.enqueue(input);
  assert.throws(() => world.exchange(frame('new')), hasStatus(409)); time += 5000;
  const result = world.exchange({ ...frame('new'), acknowledgements: [{ id: queued.id, status: 'applied', message: 'Wrong session' }] });
  assert.deepEqual(result.commands, []); assert.equal(world.snapshot().commands[0].status, 'expired');
  assert.throws(() => world.enqueue(input), hasStatus(409)); time += 5000;
  assert.throws(() => world.exchange(frame('old')), hasStatus(409)); assert.equal(world.snapshot().runtimeId, 'new');
});

test('invalid whole exchange cannot apply its acknowledgements or replace last-known telemetry', () => {
  const world = new WorldState(); world.exchange(frame()); const queued = world.enqueue(command());
  assert.throws(() => world.exchange({ ...frame(), acknowledgements: [{ id: queued.id, status: 'applied', message: 'Done' }], events: [{ id: 'x', at: 'invalid', type: 'battle', message: 'Invalid event' }] }));
  assert.equal(world.snapshot().commands[0].status, 'queued'); assert.equal(world.snapshot().events.length, 0);
});

test('events report only runtime input, deduplicate retries and keep a bounded visible history', () => {
  const world = new WorldState(); const at = new Date().toISOString();
  const events = Array.from({ length: 50 }, (_, i) => ({ id: `e${i}`, at, type: 'battle_started', message: `Observed event ${i}` }));
  world.exchange({ ...frame(), events }); world.exchange({ ...frame(), events }); assert.equal(world.snapshot().events.length, 50);
  world.exchange({ ...frame(), events: events.map(e => ({ ...e, id: e.id + '-b' })) });
  world.exchange({ ...frame(), events: events.map(e => ({ ...e, id: e.id + '-c' })) });
  assert.equal(world.snapshot().events.length, 100); assert.equal(world.snapshot().events[0].id, 'e49-c');
  assert.throws(() => world.exchange({ ...frame(), events: [...events, events[0]] }));
});

test('invalid, unexpected, out-of-range and unstreamed commands are rejected before queueing', () => {
  for (const input of [command('set_time', { hour: 24 }), command('set_wanted', { level: -1 }), command('set_weather', { weather: 'SNOW' }), command('spawn_anything', {}), command('clear_events', { deleteAllPeds: true }), command('talk', { npcId: 'x', text: 'x'.repeat(241) }), { ...command(), requestId: 'not-uuid' }]) assert.throws(() => validateCommand(input));
  const world = new WorldState(); world.exchange(frame());
  assert.throws(() => world.enqueue(command('talk', { npcId: 'stale-handle', text: 'Hello' })), hasStatus(409));
  assert.throws(() => world.enqueue(command('start_turf_war', { districtId: 'grove', attacker: 'Ballas' })), hasStatus(409));
  assert.equal(world.enqueue(command('talk', { npcId: 'npc:111:123', text: 'Hello' })).status, 'queued');
  assert.equal(world.enqueue(command('start_turf_war', { districtId: 'grove', attacker: 'Families' })).status, 'queued');
});

test('clear_events remains available while director disabled or mission-paused', () => {
  const world = new WorldState(); world.exchange({ ...frame(), director: { ...frame().director, enabled: false, pausedReason: 'Mission protection' } });
  assert.equal(world.enqueue(command('clear_events', {})).status, 'queued');
});

test('resaving desired settings overrides an observed F8 local toggle with a new revision', () => {
  const world = new WorldState();
  world.exchange({ ...frame(), appliedRevision: 1, director: { ...frame().director, enabled: false, settings: { ...DEFAULT_SETTINGS, enabled: false } } });
  const result = world.configure({ settings: { enabled: true } });
  assert.equal(result.config.revision, 2); assert.equal(result.appliedRevision, 1); assert.equal(result.telemetry!.director.enabled, false);
  const exchange = world.exchange({ ...frame(), appliedRevision: 1 });
  assert.equal(exchange.config.settings.enabled, true); assert.equal(exchange.config.revision, 2);
});

test('callers cannot mutate snapshots or returned commands to alter world authority', () => {
  const world = new WorldState(); world.exchange(frame()); const queued = world.enqueue(command());
  queued.status = 'applied'; const snapshot = world.snapshot(); snapshot.config.settings.enabled = false; snapshot.telemetry!.npcs.length = 0;
  assert.equal(world.snapshot().commands[0].status, 'queued'); assert.equal(world.snapshot().config.settings.enabled, true); assert.equal(world.snapshot().telemetry!.npcs.length, 1);
});

test('persisted request fingerprints prevent replay after companion restart without saving dialogue or NPC state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llai-world-receipts-'));
  try {
    const file = path.join(dir, 'settings.json'); const world = new WorldState(file); world.exchange(frame());
    const input = command('talk', { npcId: 'npc:111:123', text: 'Private test utterance that must not be stored' });
    const queued = world.enqueue(input);
    world.exchange({ ...frame(), acknowledgements: [{ id: queued.id, status: 'applied', message: 'Private reply must not be stored either' }] });
    const ledger = fs.readFileSync(path.join(dir, 'world-requests.json'), 'utf8');
    assert.equal(ledger.includes('Private'), false); assert.equal(ledger.includes('npc:111:123'), false); assert.equal(ledger.includes('Earlier encounter'), false);
    assert.equal(JSON.parse(ledger).receipts[0].status, 'applied');
    assert.match(JSON.parse(ledger).receipts[0].fingerprint, /^[0-9a-f]{64}$/);
    const restored = new WorldState(file); assert.equal(restored.snapshot().connected, false); assert.deepEqual(restored.snapshot().commands, []);
    assert.deepEqual(restored.exchange(frame()).commands, []);
    const repeated = restored.enqueue(input); assert.equal(repeated.id, queued.id); assert.equal(repeated.status, 'expired'); assert.match(repeated.message!, /last receipt: applied/);
    assert.deepEqual(restored.exchange(frame()).commands, []);
    assert.throws(() => restored.enqueue({ ...input, payload: { npcId: 'npc:111:123', text: 'Different text' } }), hasStatus(409));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('queued receipt restart never restores executable commands and a new runtime cannot reuse its request ID', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llai-world-restart-'));
  try {
    const file = path.join(dir, 'settings.json'); const world = new WorldState(file); world.exchange(frame());
    const input = command(); world.enqueue(input);
    const restarted = new WorldState(file); assert.deepEqual(restarted.exchange(frame()).commands, []); assert.equal(restarted.enqueue(input).status, 'expired');
    const another = new WorldState(file); another.exchange(frame('different-runtime'));
    assert.throws(() => another.enqueue(input), hasStatus(409));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('receipt write failure accepts no queue item and failed terminal receipt remains retryable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llai-world-receipt-failure-'));
  try {
    const file = path.join(dir, 'settings.json'); const ledger = path.join(dir, 'world-requests.json');
    const world = new WorldState(file); world.exchange(frame()); fs.mkdirSync(ledger);
    const input = command(); assert.throws(() => world.enqueue(input), hasStatus(500)); assert.equal(world.snapshot().commands.length, 0);
    fs.rmdirSync(ledger); const queued = world.enqueue(input); assert.equal(queued.status, 'queued');
    fs.renameSync(ledger, ledger + '.saved'); fs.mkdirSync(ledger);
    const ack = { ...frame(), acknowledgements: [{ id: queued.id, status: 'applied', message: 'Applied' }] };
    assert.throws(() => world.exchange(ack), hasStatus(500)); assert.equal(world.snapshot().commands[0].status, 'queued');
    fs.rmdirSync(ledger); fs.renameSync(ledger + '.saved', ledger);
    world.exchange(ack); assert.equal(world.snapshot().commands[0].status, 'applied');
    assert.deepEqual(fs.readdirSync(dir), ['world-requests.json']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('routine telemetry and duplicate acknowledgements do not rewrite the persisted ledger', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llai-world-no-write-'));
  try {
    const file = path.join(dir, 'settings.json'); const ledger = path.join(dir, 'world-requests.json');
    const world = new WorldState(file); world.exchange(frame()); const queued = world.enqueue(command());
    const ack = { ...frame(), acknowledgements: [{ id: queued.id, status: 'applied', message: 'Applied' }] }; world.exchange(ack);
    fs.utimesSync(ledger, new Date(1000), new Date(1000)); const before = fs.statSync(ledger).mtimeMs;
    world.exchange(frame()); world.exchange(ack); world.snapshot();
    assert.equal(fs.statSync(ledger).mtimeMs, before);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
