import fs from 'node:fs';
import path from 'node:path';

export const RUNTIME_TTL_MS = 15_000;
export const DEFAULT_GAME_DIR = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Grand Theft Auto V Enhanced';
export const DEFAULT_TEXT_MODEL = 'gemini-3.8-flash';
export const FACTION_IDS = ['Families', 'Ballas', 'Vagos', 'Madrazo Cartel', 'LSPD', 'Merryweather', 'Civilians'] as const;
export const DIPLOMATIC_STATUSES = ['WAR', 'HOSTILE', 'TENSE_TRUCE', 'STRATEGIC_ALLIANCE', 'NEUTRAL'] as const;

export function serverConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT || env.LLAI_COMPANION_PORT || 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 8765) {
    throw new Error('Companion port must be 1024-65535 and separate from voice bridge port 8765.');
  }
  return { host: '127.0.0.1', port };
}

export function readGeminiCredential(
  env: NodeJS.ProcessEnv = process.env,
  readText: (file: string) => string = (file) => fs.readFileSync(file, 'utf8'),
): string | null {
  if (env.LLAI_DISABLE_GEMINI === 'true') return null;
  const supplied = env.GEMINI_API_KEY?.trim();
  if (supplied && !/^(?:MY_GEMINI_API_KEY|YOUR[_ -].*|OPENAI_LOCAL_BRIDGE)$/i.test(supplied)) return supplied;
  try {
    const text = readText(path.join(env.LLAI_GAME_DIR || DEFAULT_GAME_DIR, 'scripts', 'LivingLSAIs.ini'));
    const match = text.match(/^[ \t]*GeminiKey1[ \t]*=[ \t]*([^\r\n]*)/im);
    const key = match?.[1]?.trim();
    return key && !/^(?:MY_GEMINI_API_KEY|YOUR[_ -].*|OPENAI_LOCAL_BRIDGE)$/i.test(key) ? key : null;
  } catch {
    return null;
  }
}

export function redactError(error: unknown, secrets: Iterable<string> = []): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (!secret) continue;
    for (const value of [secret, encodeURIComponent(secret)]) message = message.split(value).join('[REDACTED]');
  }
  return message
    .replace(/\b(?:AIza[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{16,}|GOCSPX-[A-Za-z0-9_-]{12,}|AQ\.[A-Za-z0-9_-]{16,})\b/g, '[REDACTED]')
    .replace(/([?&](?:key|api_key|access_token)=)[^\s&"']+/gi, '$1[REDACTED]')
    .replace(/[\u0000-\u001f]/g, ' ')
    .slice(0, 1000);
}

export function isAllowedLocalRequest(host: string | undefined, origin: string | undefined, fetchSite: string | undefined, port: number): boolean {
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!host || !allowed.has(host.toLowerCase()) || fetchSite === 'cross-site') return false;
  if (!origin) return true; // The native GTA client has no browser Origin header.
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && allowed.has(parsed.host.toLowerCase());
  } catch { return false; }
}

function text(value: unknown, field: string, max = 128, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /[\u0000-\u001f]/.test(value)) throw new Error(`${field} must be a bounded string.`);
  return value;
}
function number(value: unknown, field: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${field} must be a finite number in range.`);
  return value;
}
function boolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean.`);
  return value;
}
function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object.`);
  return value as Record<string, unknown>;
}
function position(value: unknown, field: string) {
  const p = object(value, field);
  const x = number(p.x, `${field}.x`, -100_000, 100_000);
  const y = number(p.y, `${field}.y`, -100_000, 100_000);
  const z = number(p.z, `${field}.z`, -100_000, 100_000);
  if (x === undefined || y === undefined || z === undefined) throw new Error(`${field} needs x, y and z.`);
  return { x, y, z };
}

export function validateTelemetry(value: unknown) {
  const body = object(value, 'telemetry');
  const runtimeId = text(body.runtimeId, 'runtimeId', 128, true)!;
  const gameVersion = text(body.gameVersion, 'gameVersion', 64, true)!;
  const pluginVersion = text(body.pluginVersion, 'pluginVersion', 64, true)!;
  if (!Array.isArray(body.npcs) || body.npcs.length > 128) throw new Error('npcs must be an array of at most 128 entries.');
  const ids = new Set<string>();
  const npcs = body.npcs.map((value, i) => {
    const n = object(value, `npcs[${i}]`);
    const id = text(n.id, 'npc.id', 128, true)!;
    if (ids.has(id)) throw new Error('NPC IDs must be unique in a telemetry frame.');
    ids.add(id);
    return {
      id, name: text(n.name, 'npc.name'), faction: text(n.faction, 'npc.faction', 64),
      position: position(n.position, 'npc.position'), health: number(n.health, 'npc.health', -10_000, 10_000),
      alive: boolean(n.alive, 'npc.alive'), isEnemy: boolean(n.isEnemy, 'npc.isEnemy'),
      model: text(n.model, 'npc.model'), distance: number(n.distance, 'npc.distance', 0, 100_000),
      inCombat: boolean(n.inCombat, 'npc.inCombat'), owned: boolean(n.owned, 'npc.owned'),
      modelHash: number(n.modelHash, 'npc.modelHash', -2_147_483_648, 4_294_967_295),
      memory: text(n.memory, 'npc.memory', 1000),
    };
  });
  const p = body.player === undefined ? {} : object(body.player, 'player');
  const wantedLevel = number(p.wantedLevel, 'player.wantedLevel', 0, 5);
  if (wantedLevel !== undefined && !Number.isInteger(wantedLevel)) throw new Error('player.wantedLevel must be an integer.');
  const e = body.environment === undefined ? {} : object(body.environment, 'environment');
  return {
    runtimeId, gameVersion, pluginVersion, npcs,
    player: { wantedLevel, weaponDrawn: boolean(p.weaponDrawn, 'player.weaponDrawn'), weaponDrawnName: text(p.weaponDrawnName, 'player.weaponDrawnName'), position: p.position === undefined ? undefined : position(p.position, 'player.position') },
    environment: { weather: text(e.weather, 'environment.weather', 64), timeOfDay: text(e.timeOfDay, 'environment.timeOfDay', 64), district: text(e.district, 'environment.district', 128), nearbyGunfire: boolean(e.nearbyGunfire, 'environment.nearbyGunfire') },
  };
}

export type Telemetry = ReturnType<typeof validateTelemetry>;

// Normalize the original dashboard's aliases at the backend boundary. Unknown
// factions/states remain errors instead of silently corrupting dashboard state.
export function normalizeWarfareUpdate(value: unknown, factions?: unknown) {
  const update = object(value, 'warfare update');
  const diplomacy = object(update.diplomaticShift, 'diplomaticShift');
  const territory = object(update.territoryClash, 'territoryClash');
  const requestIds = Array.isArray(factions) ? factions.map(f => f && typeof f === 'object' ? f.id : undefined) : undefined;
  function faction(value: unknown) {
    const input = text(value, 'faction ID', 64, true)!;
    const canonical = FACTION_IDS.find(id => id.toLowerCase() === input.trim().toLowerCase());
    if (!canonical || (requestIds && !requestIds.includes(canonical))) throw new Error('Warfare update contains an unknown faction ID.');
    return canonical;
  }
  function status(value: unknown) {
    const input = text(value, 'diplomatic status', 64, true)!.trim().toUpperCase().replace(/[ -]+/g, '_');
    const aliases: Record<string, string> = { ALLIANCE: 'STRATEGIC_ALLIANCE', TRUCE: 'TENSE_TRUCE', BETRAYAL: 'HOSTILE' };
    const canonical = aliases[input] || input;
    if (!(DIPLOMATIC_STATUSES as readonly string[]).includes(canonical)) throw new Error('Warfare update contains an unknown diplomatic status.');
    return canonical as typeof DIPLOMATIC_STATUSES[number];
  }
  const initiatorFaction = faction(diplomacy.initiatorFaction);
  const targetFaction = faction(diplomacy.targetFaction);
  const attackingFaction = faction(territory.attackingFaction);
  const defendingFaction = faction(territory.defendingFaction);
  if (initiatorFaction === targetFaction || attackingFaction === defendingFaction) throw new Error('Warfare updates require two distinct factions.');
  if (typeof territory.contestedPercent !== 'number' || !Number.isFinite(territory.contestedPercent)) throw new Error('contestedPercent must be finite.');
  return {
    eventHeadline: text(update.eventHeadline, 'eventHeadline', 512, true)!,
    diplomaticShift: { initiatorFaction, targetFaction, oldStatus: status(diplomacy.oldStatus), newStatus: status(diplomacy.newStatus), reason: text(diplomacy.reason, 'diplomatic reason', 4000, true)! },
    territoryClash: { district: text(territory.district, 'district', 256, true)!, attackingFaction, defendingFaction, contestedPercent: Math.max(0, Math.min(100, Math.round(territory.contestedPercent))), flashpointDescription: text(territory.flashpointDescription, 'flashpointDescription', 4000, true)! },
    worldAtmosphereNote: text(update.worldAtmosphereNote, 'worldAtmosphereNote', 4000, true)!,
  };
}

export class RuntimeStatus {
  private latest: Telemetry | null = null;
  private lastSeen: number | null = null;
  record(value: unknown, now = Date.now()) {
    this.latest = validateTelemetry(value);
    this.lastSeen = now;
    return this.summary(now);
  }
  summary(now = Date.now()) {
    return {
      connected: this.lastSeen !== null && now >= this.lastSeen && now - this.lastSeen < RUNTIME_TTL_MS,
      lastSeenAt: this.lastSeen === null ? null : new Date(this.lastSeen).toISOString(),
      gameVersion: this.latest?.gameVersion ?? null,
      pluginVersion: this.latest?.pluginVersion ?? null,
      npcCount: this.latest?.npcs.length ?? 0,
    };
  }
  snapshot(now = Date.now()) { return { ...this.summary(now), telemetry: this.latest }; }
}

export function audioToWav(data: string, mimeType: string | undefined): Buffer {
  if (!data || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error('Audio response is not valid base64.');
  const audio = Buffer.from(data, 'base64');
  if (audio.length < 2 || audio.length > 16 * 1024 * 1024) throw new Error('Audio response has an invalid size.');
  if (audio.length >= 12 && audio.toString('ascii', 0, 4) === 'RIFF' && audio.toString('ascii', 8, 12) === 'WAVE') {
    if (audio.length < 44 || audio.readUInt32LE(4) + 8 > audio.length) throw new Error('Truncated WAV response.');
    return audio;
  }
  if (!/^audio\/(?:l16|pcm)(?:;|$)/i.test(mimeType || '')) throw new Error('Unsupported audio MIME type; expected WAV or 16-bit PCM.');
  if (audio.length % 2 !== 0) throw new Error('16-bit PCM response must contain complete samples.');
  const rate = Number(mimeType?.match(/rate=(\d+)/i)?.[1] || 24000);
  if (!Number.isInteger(rate) || rate < 8000 || rate > 48000) throw new Error('Unsupported PCM sample rate.');
  const channels = Number(mimeType?.match(/channels=(\d+)/i)?.[1] || 1);
  if (channels !== 1) throw new Error('Only mono PCM is supported.');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + audio.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(audio.length, 40);
  return Buffer.concat([header, audio]);
}

export function loadMemoryStore(file: string): Record<string, any> {
  const store = Object.create(null);
  try {
    const content = fs.readFileSync(file, 'utf8');
    if (content.length > 8 * 1024 * 1024) return store;
    const parsed = object(JSON.parse(content), 'memory store');
    for (const [key, value] of Object.entries(parsed).slice(0, 2000)) {
      if (/^[A-Za-z0-9_:-]{1,128}$/.test(key) && value && typeof value === 'object' && !Array.isArray(value)) store[key] = value;
    }
  } catch { /* No prior local companion memory, or an invalid file. */ }
  return store;
}
export function persistMemoryStore(file: string, store: Record<string, any>) {
  const content = JSON.stringify(store, null, 2);
  if (content.length > 8 * 1024 * 1024) throw new Error('Companion memory store reached its 8 MB limit.');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, content, { mode: 0o600 });
  fs.renameSync(temporary, file);
}
