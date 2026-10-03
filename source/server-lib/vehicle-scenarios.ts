// Step 4: AI-selected vehicle scenarios (Lane B, Lane D fallback).
// The game detects observed opportunities locally; the companion admits at most
// one by settings weight, asks the provider for short beats (speech + one allowed
// action per beat), validates the plan, and delivers it as a guarded update.
// Nothing here touches the game; the client re-validates every beat on Tick.
import { NPC_ACTIONS, VEHICLE_SCENARIOS } from '../shared/settings.ts';
import { AiError, boundedText, onlyKeys, record, settingBoolean, settingNumber, type SettingsGetter } from './ai-types.ts';
import { STREET_BRIEFS, STREET_FALLBACK, isStreetScenario, streetWeight, type DirectorEnvironment, type StreetScenario } from './street-scenarios.ts';

export type VehicleScenario = typeof VEHICLE_SCENARIOS[number];
// Step 6: street scenarios share this opportunity/plan pipeline (one primary NPC).
export type AnyScenario = VehicleScenario | StreetScenario;
export type NpcAction = typeof NPC_ACTIONS[number];
export type VehicleFacts = { playerInVehicle: boolean; playerSpeed: number; npcSpeed: number; wantedLevel: number; contact: boolean; npcFaction: string };
export type VehicleOpportunity = { id: string; scenario: AnyScenario; npcIds: string[]; detectedAt: string; facts: VehicleFacts };
export type ScenarioBeat = { npcId: string; speech: string; voiceTone: string; action: NpcAction };
export type ScenarioPlan = { title: string; beats: ScenarioBeat[] };

export const MAX_OPPORTUNITIES = 4;
export const MAX_BEATS = 4;
export const MAX_BEAT_SPEECH = 240;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

// What each scenario means, in words the provider receives. Kept factual so the
// model does not invent outcomes the game will not perform.
export const SCENARIO_BRIEFS: Record<AnyScenario, string> = {
  windowTalk: 'The player is on foot beside a stopped NPC vehicle and can speak through the window.',
  carToCar: 'The player and an NPC driver are side by side, stopped or crawling in traffic.',
  passengerChat: 'An NPC shares a vehicle with the player as driver or passenger.',
  lifts: 'The player stopped a vehicle with a free passenger seat near a pedestrian who may want a ride.',
  roadRage: 'The player vehicle just made contact with or cut off an NPC vehicle.',
  carjack: 'The player is taking a vehicle from its NPC occupant; the victim and nearby witnesses react.',
  pedestrianImpact: 'The player vehicle just hit a pedestrian who is still alive; nearby witnesses react.',
  trafficStop: 'A police officer is close to the player while the player has a low wanted level.',
  driveBy: 'An occupied gang vehicle is cruising slowly near the player on its turf.',
  breakdown: 'An NPC is beside a badly damaged or undriveable vehicle near the player.',
  ...STREET_BRIEFS,
};
const isVehicleScenario = (value: unknown): value is VehicleScenario => (VEHICLE_SCENARIOS as readonly unknown[]).includes(value);

const uuid = (value: unknown, name: string) => { const s = boundedText(value, 36, name); if (!UUID.test(s)) throw new AiError('invalid_payload', `${name} must be a UUID.`); return s.toLowerCase(); };
const finite = (value: unknown, min: number, max: number, name: string) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new AiError('invalid_payload', `${name} is outside its allowed range.`); return value; };

export function validateOpportunities(value: unknown, observedNpcIds: readonly string[]): VehicleOpportunity[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_OPPORTUNITIES) throw new AiError('invalid_payload', 'vehicleOpportunities exceeds its bounded list size.');
  const seen = new Set<string>();
  return value.map(item => {
    const o = record(item, 'vehicle opportunity'); onlyKeys(o, ['id', 'scenario', 'npcIds', 'detectedAt', 'facts'], 'vehicle opportunity');
    const id = uuid(o.id, 'opportunity id'); if (seen.has(id)) throw new AiError('invalid_payload', 'Duplicate vehicle opportunity.'); seen.add(id);
    if (!isVehicleScenario(o.scenario) && !isStreetScenario(o.scenario)) throw new AiError('invalid_payload', 'Unknown vehicle scenario.');
    if (!Array.isArray(o.npcIds) || o.npcIds.length < 1 || o.npcIds.length > 3) throw new AiError('invalid_payload', 'A vehicle scenario needs one to three NPCs.');
    const npcIds = o.npcIds.map(v => boundedText(v, 128, 'scenario npcId'));
    if (new Set(npcIds).size !== npcIds.length || npcIds.some(n => !observedNpcIds.includes(n))) throw new AiError('invalid_payload', 'Scenario NPCs must be distinct observed NPCs.');
    if (typeof o.detectedAt !== 'string' || !Number.isFinite(Date.parse(o.detectedAt))) throw new AiError('invalid_payload', 'Invalid opportunity timestamp.');
    const f = record(o.facts, 'opportunity facts'); onlyKeys(f, ['playerInVehicle', 'playerSpeed', 'npcSpeed', 'wantedLevel', 'contact', 'npcFaction'], 'opportunity facts');
    if (typeof f.playerInVehicle !== 'boolean' || typeof f.contact !== 'boolean') throw new AiError('invalid_payload', 'Opportunity flags must be boolean.');
    const wanted = finite(f.wantedLevel, 0, 5, 'wantedLevel'); if (!Number.isInteger(wanted)) throw new AiError('invalid_payload', 'wantedLevel must be an integer.');
    return { id, scenario: o.scenario as AnyScenario, npcIds, detectedAt: o.detectedAt, facts: { playerInVehicle: f.playerInVehicle, playerSpeed: finite(f.playerSpeed, 0, 200, 'playerSpeed'), npcSpeed: finite(f.npcSpeed, 0, 200, 'npcSpeed'), wantedLevel: wanted, contact: f.contact, npcFaction: boundedText(f.npcFaction, 64, 'npcFaction') } };
  });
}

// Weighted admission. Disabled or zero-weight scenarios never start; already
// handled opportunity IDs are skipped. Vehicle scenarios use vehicles.<id>.*;
// street scenarios use director weights and multipliers. `random` is injected for tests.
export function scenarioWeight(o: VehicleOpportunity, get: SettingsGetter, environment?: DirectorEnvironment): number {
  if (isStreetScenario(o.scenario)) return streetWeight(o.scenario, get, environment);
  return settingBoolean(get, `vehicles.${o.scenario}.enabled`, true) ? Math.max(0, settingNumber(get, `vehicles.${o.scenario}.weight`, 50)) : 0;
}
export function admitOpportunity(opportunities: readonly VehicleOpportunity[], get: SettingsGetter, handled: ReadonlySet<string>, random: () => number = Math.random, environment?: DirectorEnvironment): VehicleOpportunity | null {
  const weighted = opportunities.filter(o => !handled.has(o.id)).map(o => ({ o, w: scenarioWeight(o, get, environment) })).filter(x => x.w > 0);
  const total = weighted.reduce((sum, x) => sum + x.w, 0);
  if (!weighted.length || total <= 0) return null;
  let roll = Math.min(0.999999, Math.max(0, random())) * total;
  for (const x of weighted) { roll -= x.w; if (roll < 0) return x.o; }
  return weighted[weighted.length - 1].o;
}

export function scenarioSchema(npcIds: readonly string[], actions: readonly NpcAction[]) {
  return { type: 'object', additionalProperties: false, properties: {
    title: { type: 'string', maxLength: 80 },
    beats: { type: 'array', minItems: 1, maxItems: MAX_BEATS, items: { type: 'object', additionalProperties: false, properties: {
      npcId: { type: 'string', enum: [...npcIds] }, speech: { type: 'string', maxLength: MAX_BEAT_SPEECH }, voiceTone: { type: 'string', maxLength: 40 }, action: { type: 'string', enum: [...actions] } }, required: ['npcId', 'speech', 'voiceTone', 'action'] } },
  }, required: ['title', 'beats'] };
}

// `allowed` maps each participant to the actions the server already filtered
// for that NPC (settings, vehicle state, observed capabilities).
export function validatePlan(value: unknown, opportunity: VehicleOpportunity, allowed: ReadonlyMap<string, readonly NpcAction[]>): ScenarioPlan {
  const o = record(value, 'scenario plan'); onlyKeys(o, ['title', 'beats'], 'scenario plan');
  const title = boundedText(o.title, 80, 'scenario title');
  if (!Array.isArray(o.beats) || o.beats.length < 1 || o.beats.length > MAX_BEATS) throw new AiError('invalid_scenario', 'Scenario beat count is outside its bound.', 502);
  const beats = o.beats.map(item => {
    const b = record(item, 'scenario beat'); onlyKeys(b, ['npcId', 'speech', 'voiceTone', 'action'], 'scenario beat');
    const npcId = boundedText(b.npcId, 128, 'beat npcId'); if (!opportunity.npcIds.includes(npcId)) throw new AiError('invalid_scenario', 'Beat speaker is not a scenario participant.', 502);
    const speech = boundedText(b.speech, MAX_BEAT_SPEECH, 'beat speech'); if (/[<>~]/.test(speech)) throw new AiError('invalid_speech', 'Beat speech contains unsupported markup.', 502);
    const action = b.action as NpcAction; if (!(allowed.get(npcId) ?? []).includes(action)) throw new AiError('invalid_action', 'Beat selected an action that is not allowed for this NPC.', 502);
    return { npcId, speech, voiceTone: boundedText(b.voiceTone, 40, 'beat voiceTone'), action };
  });
  return { title, beats };
}

// Lane D: deterministic, always labelled fallback by the caller. Picks the first
// allowed action from a short preference list, so it never exceeds what AI could pick.
const FALLBACK: Record<VehicleScenario, { speech: string; prefer: NpcAction[] }> = {
  windowTalk: { speech: 'Can I help you with something?', prefer: ['TALK_CASUAL', 'WAVE_OFF'] },
  carToCar: { speech: 'Nice ride. Light is about to change.', prefer: ['TALK_CASUAL', 'WAVE_OFF'] },
  passengerChat: { speech: 'So, where are we headed?', prefer: ['TALK_CASUAL'] },
  lifts: { speech: 'Hey, any chance of a ride?', prefer: ['ASK_FOR_RIDE', 'TALK_CASUAL'] },
  roadRage: { speech: 'Watch where you are going!', prefer: ['HONK_AT_PLAYER', 'THREATEN_FROM_CAR', 'INTIMIDATE', 'TALK_CASUAL'] },
  carjack: { speech: 'Hey! That is my car!', prefer: ['FLEE_PANICKED', 'CALL_911', 'PLEAD'] },
  pedestrianImpact: { speech: 'Are you crazy? You hit me!', prefer: ['CALL_911', 'FLEE_PANICKED', 'TALK_CASUAL'] },
  trafficStop: { speech: 'Keep your hands where I can see them.', prefer: ['INTIMIDATE', 'TALK_CASUAL'] },
  driveBy: { speech: 'You lost? This is our block.', prefer: ['THREATEN_FROM_CAR', 'HONK_AT_PLAYER', 'INTIMIDATE', 'TALK_CASUAL'] },
  breakdown: { speech: 'Car just died on me. Know anything about engines?', prefer: ['TALK_CASUAL', 'USE_PHONE'] },
};
export function fallbackPlan(opportunity: VehicleOpportunity, allowed: ReadonlyMap<string, readonly NpcAction[]>): ScenarioPlan | null {
  const npcId = opportunity.npcIds[0], actions = allowed.get(npcId) ?? [], spec = isStreetScenario(opportunity.scenario) ? STREET_FALLBACK[opportunity.scenario] : FALLBACK[opportunity.scenario];
  const action = spec.prefer.find(a => actions.includes(a)); if (!action) return null;
  return { title: `Local fallback: ${opportunity.scenario}`, beats: [{ npcId, speech: spec.speech, voiceTone: 'plain', action }] };
}
