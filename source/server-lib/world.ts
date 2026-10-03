import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateTelemetry } from './compatibility.ts';
import {WORLD_DEFAULT_SETTINGS as DEFAULT_SETTINGS,WORLD_SETTING_RANGES as ranges} from '../shared/world-settings.ts';
export {DEFAULT_SETTINGS};

export const WORLD_PROTOCOL = 3;
export const WORLD_FRESH_MS = 5_000;
export const COMMAND_TTL_MS = 30_000;
export const MAX_QUEUED_COMMANDS = 16;
export const MAX_CONFIG_REVISION = 2_147_483_647; // The .NET Framework client uses Int32 revisions.
export const GANGS = ['Families', 'Ballas', 'Vagos'] as const;
export const DISTRICTS = ['grove', 'forum', 'rancho', 'chamberlain', 'davis', 'cypress'] as const;
export const WEATHER = ['CLEAR', 'EXTRASUNNY', 'CLOUDS', 'OVERCAST', 'RAIN', 'THUNDER', 'FOGGY', 'SMOG'] as const;
export type Settings = { -readonly [K in keyof typeof DEFAULT_SETTINGS]: typeof DEFAULT_SETTINGS[K] extends boolean ? boolean : number };
export interface WorldConfigurationAuthority {
  read(): { revision: number; settings: Settings };
  write(value: { revision: number; settings: Settings }, source: string): void;
  subscribe(listener: () => void): () => unknown;
}
export type CommandType = 'start_turf_war' | 'start_street_fight' | 'clear_events' | 'set_weather' | 'set_time' | 'set_wanted' | 'talk';
export type WorldCommand = {
  id: string; requestId: string; runtimeId: string; type: CommandType; payload: Record<string, string | number>;
  status: 'queued' | 'applied' | 'rejected' | 'expired'; createdAt: string; expiresAt: string; message?: string;
};
export type WorldEvent = { id: string; at: string; type: string; message: string; districtId?: string; faction?: string };
type RequestReceipt = Pick<WorldCommand, 'id' | 'requestId' | 'runtimeId' | 'type' | 'status' | 'createdAt' | 'expiresAt'> & { fingerprint: string };
export class WorldError extends Error { constructor(message: string, public status = 400) { super(message); } }

function obj(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorldError(`${name} must be an object.`);
  return value as Record<string, unknown>;
}
function str(value: unknown, name: string, max = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) throw new WorldError(`${name} must be non-empty text of at most ${max} characters.`);
  return value;
}
function integer(value: unknown, name: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new WorldError(`${name} must be an integer from ${min} to ${max}.`);
  return value as number;
}
function flag(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new WorldError(`${name} must be boolean.`);
  return value;
}
function oneOf<T extends string>(value: unknown, values: readonly T[], name: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new WorldError(`${name} is not supported.`);
  return value as T;
}
function date(value: unknown, name: string): string {
  const result = str(value, name, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(result) || !Number.isFinite(Date.parse(result))) throw new WorldError(`${name} must be an ISO UTC timestamp.`);
  return result;
}
function vector(value: unknown, name: string) {
  const input = obj(value, name);
  const coords = ['x', 'y', 'z'].map(key => {
    if (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || Math.abs(input[key] as number) > 100_000) throw new WorldError(`${name} requires bounded x, y and z coordinates.`);
    return input[key] as number;
  });
  return { x: coords[0], y: coords[1], z: coords[2] };
}
function list(value: unknown, name: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new WorldError(`${name} must contain at most ${max} entries.`);
  return value;
}
function uniqueIds<T extends { id: string }>(values: T[], name: string): T[] {
  if (new Set(values.map(v => v.id)).size !== values.length) throw new WorldError(`${name} IDs must be unique.`);
  return values;
}
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], name: string) {
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new WorldError(`${name} contains an unsupported field.`);
}

export function validateSettings(value: unknown, partial = false): Partial<Settings> {
  const input = obj(value, 'settings');
  onlyKeys(input, Object.keys(DEFAULT_SETTINGS), 'settings');
  if (!partial && Object.keys(DEFAULT_SETTINGS).some(key => !(key in input))) throw new WorldError('A complete director settings snapshot is required.');
  if (partial && Object.keys(input).length === 0) throw new WorldError('Provide at least one director setting.');
  const result: Record<string, number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    const range = ranges[key as keyof Settings];
    result[key] = range ? integer(value, key, range[0],range[1]) : flag(value, key);
  }
  return result as Partial<Settings>;
}

export function validateWorldTelemetry(value: unknown) {
  const input = obj(value, 'runtime exchange');
  if (input.protocol !== WORLD_PROTOCOL) throw new WorldError('This companion requires game runtime protocol 3.', 409);
  const telemetry = validateTelemetry({ ...input, player: input.player ?? undefined, environment: input.environment ?? undefined });
  const d = obj(input.director, 'director');
  const settings = validateSettings(d.settings) as Settings;
  const territories = uniqueIds(list(d.territories, 'territories', 6).map((value) => {
    const t = obj(value, 'territory');
    const owner = oneOf(t.owner, GANGS, 'territory owner');
    const challenger = t.challenger === null ? null : oneOf(t.challenger, GANGS, 'territory challenger');
    if (owner === challenger) throw new WorldError('A territory challenger must differ from its owner.');
    return { id: oneOf(t.id, DISTRICTS, 'district'), name: str(t.name, 'territory name', 64), owner, challenger,
      heat: integer(t.heat, 'territory heat', 0, 100), position: vector(t.position, 'territory position'),
      radius: integer(t.radius, 'territory radius', 1, 1000), wins: integer(t.wins, 'territory wins', 0, 1_000_000) };
  }), 'territory');
  const activeEvents = uniqueIds(list(d.activeEvents, 'activeEvents', 3).map(value => {
    const b = obj(value, 'battle');
    const type = oneOf(b.type, ['turf_war', 'street_fight'], 'battle type');
    return { id: str(b.id, 'battle id'), type,
      districtId: b.districtId === '' || b.districtId === null ? '' : oneOf(b.districtId, DISTRICTS, 'battle district'),
      attacker: str(b.attacker, 'battle attacker', 64), defender: str(b.defender, 'battle defender', 64), state: str(b.state, 'battle state', 48),
      attackerAlive: integer(b.attackerAlive, 'attackerAlive', 0, 24), defenderAlive: integer(b.defenderAlive, 'defenderAlive', 0, 24),
      startedAt: date(b.startedAt, 'battle startedAt') };
  }), 'battle');
  return { ...telemetry, player: input.player === null ? null : telemetry.player, environment: input.environment === null ? null : telemetry.environment,
    protocol: WORLD_PROTOCOL, appliedRevision: integer(input.appliedRevision, 'appliedRevision', 0, MAX_CONFIG_REVISION),
    director: { enabled: flag(d.enabled, 'director.enabled'), pausedReason: d.pausedReason === null ? null : str(d.pausedReason, 'pausedReason', 240),
      settings, activeEvents, territories, ownedPedCount: integer(d.ownedPedCount, 'ownedPedCount', 0, 24) } };
}
export type WorldTelemetry = ReturnType<typeof validateWorldTelemetry>;

function validateEvents(value: unknown): WorldEvent[] {
  return uniqueIds(list(value ?? [], 'events', 50).map(value => {
    const e = obj(value, 'event');
    return { id: str(e.id, 'event id'), at: date(e.at, 'event at'), type: str(e.type, 'event type', 64), message: str(e.message, 'event message', 240),
      ...(e.districtId === undefined || e.districtId === null || e.districtId === '' ? {} : { districtId: oneOf(e.districtId, DISTRICTS, 'event district') }),
      ...(e.faction === undefined || e.faction === null || e.faction === '' ? {} : { faction: str(e.faction, 'event faction', 64) }) };
  }), 'event');
}
function validateAcks(value: unknown) {
  return uniqueIds(list(value ?? [], 'acknowledgements', 50).map(value => {
    const a = obj(value, 'acknowledgement');
    return { id: str(a.id, 'acknowledgement id'), status: oneOf(a.status, ['applied', 'rejected'], 'acknowledgement status'), message: str(a.message, 'acknowledgement message', 240) };
  }), 'acknowledgement');
}

export function validateCommand(value: unknown) {
  const input = obj(value, 'command');
  onlyKeys(input, ['type', 'payload', 'requestId'], 'command');
  const requestId = str(input.requestId, 'requestId', 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new WorldError('requestId must be a UUID.');
  const type = oneOf(input.type, ['start_turf_war', 'start_street_fight', 'clear_events', 'set_weather', 'set_time', 'set_wanted', 'talk'], 'command type');
  const p = obj(input.payload, 'command payload');
  let payload: Record<string, string | number>;
  switch (type) {
    case 'start_turf_war':
      onlyKeys(p, ['districtId', 'attacker'], 'turf war payload');
      payload = { districtId: oneOf(p.districtId, DISTRICTS, 'district'), attacker: oneOf(p.attacker, GANGS, 'attacker') }; break;
    case 'set_weather':
      onlyKeys(p, ['weather'], 'weather payload'); payload = { weather: oneOf(p.weather, WEATHER, 'weather') }; break;
    case 'set_time':
      onlyKeys(p, ['hour'], 'time payload'); payload = { hour: integer(p.hour, 'hour', 0, 23) }; break;
    case 'set_wanted':
      onlyKeys(p, ['level'], 'wanted payload'); payload = { level: integer(p.level, 'wanted level', 0, 5) }; break;
    case 'talk':
      onlyKeys(p, ['npcId', 'text'], 'talk payload'); payload = { npcId: str(p.npcId, 'npcId'), text: str(p.text, 'dialogue text', 240) }; break;
    default: onlyKeys(p, [], 'command payload'); payload = {};
  }
  return { requestId: requestId.toLowerCase(), type, payload };
}

// Desired settings and payload-free request fingerprints persist. Observations
// and queued actions stay in memory; a restart can never restore an executable queue.
export class WorldState {
  private config: { revision: number; settings: Settings } = { revision: 1, settings: { ...DEFAULT_SETTINGS } };
  private telemetry: WorldTelemetry | null = null;
  private lastSeen: number | null = null;
  private commands: WorldCommand[] = [];
  private events: WorldEvent[] = [];
  private seenEvents = new Set<string>();
  private requests = new Map<string, WorldCommand>();
  private receipts = new Map<string, RequestReceipt>();
  private receiptFile?: string;
  private retiredRuntimeIds = new Set<string>();
  private listeners = new Set<() => void>();
  private configurationAuthority?: WorldConfigurationAuthority;
  constructor(private settingsFile?: string, private now: () => number = Date.now) {
    if (!settingsFile) return;
    this.receiptFile = path.join(path.dirname(settingsFile), 'world-requests.json');
    if (fs.existsSync(settingsFile)) {
      try {
        if (fs.statSync(settingsFile).size > 16_384) throw new Error('oversized settings');
        const saved = obj(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), 'saved config');
        this.config = { revision: integer(saved.revision, 'saved revision', 1, MAX_CONFIG_REVISION), settings: validateSettings(saved.settings) as Settings };
      } catch { throw new Error('Saved director settings could not be validated. Preserve world-settings.json and repair it before starting the companion.'); }
    }
    if (fs.existsSync(this.receiptFile)) {
      try {
        if (fs.statSync(this.receiptFile).size > 8 * 1024 * 1024) throw new Error('oversized request ledger');
        const saved = obj(JSON.parse(fs.readFileSync(this.receiptFile, 'utf8')), 'saved requests');
        if (saved.version !== 1) throw new Error('unsupported request ledger');
        for (const value of list(saved.receipts, 'saved receipts', 10_000)) {
          const r = obj(value, 'receipt');
          const fingerprint = str(r.fingerprint, 'fingerprint', 64);
          if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error('invalid fingerprint');
          const receipt: RequestReceipt = {
            id: str(r.id, 'command id'), requestId: str(r.requestId, 'requestId', 36), runtimeId: str(r.runtimeId, 'runtimeId'),
            type: oneOf(r.type, ['start_turf_war', 'start_street_fight', 'clear_events', 'set_weather', 'set_time', 'set_wanted', 'talk'], 'command type'),
            status: oneOf(r.status, ['queued', 'applied', 'rejected', 'expired'], 'receipt status'), createdAt: date(r.createdAt, 'createdAt'), expiresAt: date(r.expiresAt, 'expiresAt'), fingerprint,
          };
          if (this.receipts.has(receipt.requestId)) throw new Error('duplicate request receipt');
          this.receipts.set(receipt.requestId, receipt);
        }
      } catch { throw new Error('Saved command request ledger could not be validated. Preserve world-requests.json and repair it before starting the companion.'); }
    }
  }
  private persistReceipts(receipts: Map<string, RequestReceipt>) {
    if (!this.receiptFile) return;
    let temporary: string | undefined;
    try {
      const content = JSON.stringify({ version: 1, receipts: [...receipts.values()] });
      if (Buffer.byteLength(content, 'utf8') > 8 * 1024 * 1024) throw new Error('request ledger size limit');
      fs.mkdirSync(path.dirname(this.receiptFile), { recursive: true });
      temporary = `${this.receiptFile}.${randomUUID()}.tmp`;
      fs.writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, this.receiptFile);
    } catch {
      if (temporary) try { fs.unlinkSync(temporary); } catch { /* Keep the previous complete ledger. */ }
      throw new WorldError('The command request receipt could not be saved. This request was not accepted; retry after fixing local storage.', 500);
    }
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  // V4 stores NPC and world settings in one atomic document. The original
  // V3 file remains intact for rollback. Standalone V3 instances keep their
  // original persistence path and protocol behavior.
  useConfigurationAuthority(authority: WorldConfigurationAuthority) {
    if (this.configurationAuthority) throw new WorldError('Director settings authority is already attached.',409);
    this.configurationAuthority = authority;
    this.config = structuredClone(authority.read());
    authority.subscribe(() => {
      const next = authority.read();
      if (next.revision !== this.config.revision) { this.config = structuredClone(next); this.publish(); }
    });
  }
  private publish() { for (const listener of this.listeners) { try { listener(); } catch { /* A closed browser cannot interrupt the game exchange. */ } } }
  private connected(now = this.now()) { return this.lastSeen !== null && now >= this.lastSeen && now - this.lastSeen < WORLD_FRESH_MS; }
  private expire(now: number) {
    for (const command of this.commands) if (command.status === 'queued' && Date.parse(command.expiresAt) <= now) {
      command.status = 'expired'; command.message = 'No game acknowledgement arrived before this command expired.';
    }
  }
  snapshot() {
    const now = this.now(); this.expire(now);
    return structuredClone({ success: true as const, connected: this.connected(now), lastSeenAt: this.lastSeen === null ? null : new Date(this.lastSeen).toISOString(),
      runtimeId: this.telemetry?.runtimeId ?? null, config: this.config, appliedRevision: this.telemetry?.appliedRevision ?? 0,
      telemetry: this.telemetry, commands: [...this.commands].reverse(), events: [...this.events].reverse() });
  }
  configure(value: unknown) {
    const input = obj(value, 'config request'); onlyKeys(input, ['settings','expectedRevision','source'], 'config request');
    if (input.expectedRevision !== undefined && input.expectedRevision !== this.config.revision) throw new WorldError('Director settings changed elsewhere. Refresh before applying this edit.',409);
    const source = input.source === undefined ? 'portal' : oneOf(input.source, ['portal','game','advisor','profile','defaults'], 'settings source');
    const settings = { ...this.config.settings, ...validateSettings(input.settings, true) };
    const sameSettings = (a: Settings, b: Settings) => (Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>).every(key => a[key] === b[key]);
    const observedDivergence = this.telemetry !== null && (!sameSettings(this.telemetry.director.settings, settings) || this.telemetry.director.enabled !== settings.enabled);
    // F8 can change the actual director without changing its appliedRevision.
    // Resaving desired settings must therefore issue a new revision when the
    // game reports a local override, even if the saved desired values match.
    if (sameSettings(settings, this.config.settings) && !observedDivergence) return this.snapshot();
    if (this.config.revision >= MAX_CONFIG_REVISION) throw new WorldError('Director revision limit reached.', 409);
    const next = { revision: this.config.revision + 1, settings };
    if (this.configurationAuthority) {
      try { this.configurationAuthority.write(next,source); }
      catch (error) {
        const status=error && typeof error==='object' && 'status' in error && error.status===409 ? 409 : 500;
        throw new WorldError(status===409?'Director settings changed elsewhere. Refresh before applying this edit.':'Director settings could not be saved. The previous revision is unchanged.',status);
      }
      return this.snapshot();
    }
    if (this.settingsFile) {
      let temporary: string | undefined;
      try {
        fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
        temporary = `${this.settingsFile}.${randomUUID()}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600, flag: 'wx' });
        fs.renameSync(temporary, this.settingsFile);
      } catch {
        if (temporary) try { fs.unlinkSync(temporary); } catch { /* Preserve the last valid config. */ }
        throw new WorldError('Director settings could not be saved. The previous revision is unchanged.', 500);
      }
    }
    this.config = next; this.publish(); return this.snapshot();
  }
  enqueue(value: unknown) {
    const input = validateCommand(value);
    const fingerprint = createHash('sha256').update(JSON.stringify({ type: input.type, payload: input.payload })).digest('hex');
    const now = this.now(); this.expire(now);
    const existing = this.requests.get(input.requestId);
    if (existing) {
      if (existing.runtimeId !== this.telemetry?.runtimeId || existing.type !== input.type || JSON.stringify(existing.payload) !== JSON.stringify(input.payload)) throw new WorldError('requestId has already been used for another command or game session.', 409);
      return structuredClone(existing);
    }
    const receipt = this.receipts.get(input.requestId);
    if (receipt) {
      if (receipt.runtimeId !== this.telemetry?.runtimeId || receipt.fingerprint !== fingerprint) throw new WorldError('requestId has already been used for another command or game session.', 409);
      // Fingerprints prove this request existed, but a process restart loses the
      // live queue/ACK exchange. Never reconstruct a queued action from a retry.
      const restored: WorldCommand = { id: receipt.id, requestId: receipt.requestId, runtimeId: receipt.runtimeId, type: receipt.type,
        payload: input.payload, status: 'expired', createdAt: receipt.createdAt, expiresAt: receipt.expiresAt,
        message: `Recorded before the companion restarted (last receipt: ${receipt.status}). This request will not be sent again.` };
      return restored;
    }
    if (!this.connected(now) || !this.telemetry) throw new WorldError('A fresh protocol 3 game connection is required. Open Story Mode and start the Enhanced client.', 409);
    if (this.commands.filter(c => c.status === 'queued').length >= MAX_QUEUED_COMMANDS) throw new WorldError('The game command queue is full. Wait for its acknowledgements.', 429);
    if (this.receipts.size >= 10_000) throw new WorldError('The persisted command receipt ledger is full. End the game session and archive its ledger before starting a new session.', 429);
    if (input.type === 'talk' && !this.telemetry.npcs.some(n => n.id === input.payload.npcId && n.alive !== false)) throw new WorldError('That NPC is no longer in the current game snapshot.', 409);
    if (input.type === 'start_turf_war') {
      const territory = this.telemetry.director.territories.find(t => t.id === input.payload.districtId);
      if (!territory) throw new WorldError('That territory is not reported by the game.', 409);
      if (territory.owner === input.payload.attacker) throw new WorldError('The attacker must differ from the current territory owner.', 409);
    }
    const command: WorldCommand = { ...input, id: randomUUID(), runtimeId: this.telemetry.runtimeId, status: 'queued', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + COMMAND_TTL_MS).toISOString() };
    const nextReceipts = new Map(this.receipts);
    nextReceipts.set(command.requestId, { id: command.id, requestId: command.requestId, runtimeId: command.runtimeId, type: command.type,
      status: command.status, createdAt: command.createdAt, expiresAt: command.expiresAt, fingerprint });
    this.persistReceipts(nextReceipts); // Disk success precedes queue insertion or any observable acceptance.
    this.receipts = nextReceipts;
    this.commands.push(command); this.requests.set(command.requestId, command);
    while (this.commands.length > 100) { const index = this.commands.findIndex(c => c.status !== 'queued'); if (index < 0) break; this.commands.splice(index, 1); }
    this.publish(); return structuredClone(command);
  }
  exchange(value: unknown) {
    const input = obj(value, 'runtime exchange');
    // Validate the entire frame before any observation, acknowledgement or event can change state.
    const telemetry = validateWorldTelemetry(input);
    const acknowledgements = validateAcks(input.acknowledgements);
    const events = validateEvents(input.events);
    const now = this.now();
    if (telemetry.appliedRevision > this.config.revision) throw new WorldError('The reported settings revision is newer than this companion.', 409);
    if (this.retiredRuntimeIds.has(telemetry.runtimeId)) throw new WorldError('This game session was replaced. Start a new runtime session.', 409);
    if (this.telemetry && this.telemetry.runtimeId !== telemetry.runtimeId && this.connected(now)) throw new WorldError('Another game runtime is still connected. Wait for its heartbeat to expire.', 409);
    this.expire(now);
    const acceptedAcks = acknowledgements.map(ack => ({ ack, command: this.commands.find(c => c.id === ack.id && c.runtimeId === telemetry.runtimeId && c.status === 'queued') })).filter(entry => entry.command);
    if (acceptedAcks.length) {
      const nextReceipts = new Map(this.receipts);
      for (const { ack, command } of acceptedAcks) {
        const receipt = nextReceipts.get(command!.requestId)!;
        nextReceipts.set(command!.requestId, { ...receipt, status: ack.status });
      }
      this.persistReceipts(nextReceipts);
      this.receipts = nextReceipts;
    }
    if (this.telemetry && this.telemetry.runtimeId !== telemetry.runtimeId) {
      this.retiredRuntimeIds.add(this.telemetry.runtimeId);
      for (const command of this.commands) if (command.status === 'queued') { command.status = 'expired'; command.message = 'The game session changed before this command was acknowledged.'; }
      this.events = []; this.seenEvents.clear();
    }
    for (const { ack, command } of acceptedAcks) {
      command!.status = ack.status; command!.message = ack.message;
    }
    for (const event of events) {
      if (this.seenEvents.has(event.id)) continue;
      this.seenEvents.add(event.id); this.events.push(event);
    }
    this.events = this.events.slice(-100);
    // IDs older than the 100 visible events are retained to deduplicate retransmits,
    // bounded at 10,000. At the game's bounded event rate this covers many hours.
    while (this.seenEvents.size > 10_000) this.seenEvents.delete(this.seenEvents.values().next().value!);
    this.telemetry = telemetry; this.lastSeen = now; this.publish();
    return structuredClone({ success: true as const, protocol: WORLD_PROTOCOL, config: this.config,
      commands: this.commands.filter(c => c.status === 'queued' && c.runtimeId === telemetry.runtimeId) });
  }
}
