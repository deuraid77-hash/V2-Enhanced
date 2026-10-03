// Step 6: NPC-focused street scenarios (spec section 9) for the AI director.
// The game detects an observed opportunity with one primary NPC; the companion
// admits it by director weight and time/weather/district multipliers, then the
// shared Lane B planner in ai-service.ts writes beats (Lane D fallback below).
// Nothing here spawns or touches the game.
import { EXTRA_SCENARIOS, type NPC_ACTIONS } from '../shared/settings.ts';
import { settingNumber, type SettingsGetter } from './ai-types.ts';

export type StreetScenario = typeof EXTRA_SCENARIOS[number];
type NpcAction = typeof NPC_ACTIONS[number];
export type DirectorEnvironment = { district?: unknown; weather?: unknown; timeOfDay?: unknown } | null | undefined;

export const isStreetScenario = (value: unknown): value is StreetScenario => (EXTRA_SCENARIOS as readonly unknown[]).includes(value);

// Factual descriptions of what the game observed. They must not promise
// participants or outcomes the client will not perform: only the primary NPC acts.
export const STREET_BRIEFS: Record<StreetScenario, string> = {
  argument: 'Two pedestrians are standing close together on the street near the player. Only the listed participant speaks and acts.',
  deal: 'A gang-affiliated NPC is standing close to one other person near the player, on their turf.',
  chase: 'An NPC is running away from something near the player.',
  holdup: 'The player is aiming a weapon at this NPC at close range.',
  tourist: 'A calm civilian is standing near the player in daylight and may ask for directions or make conversation.',
  fan: 'A civilian is walking towards the player and may recognise them.',
  drunks: 'A small group of civilians is gathered close together at night near the player.',
  protest: 'Several civilians are gathered close together in daylight near the player.',
  policeCivilian: 'A police officer on foot is standing close to a civilian near the player.',
  aftermath: 'Gunfire happened nearby within the last minute and has stopped; this civilian witnessed the area.',
};

// Lane D: deterministic, labelled fallback by the caller. First allowed action wins.
export const STREET_FALLBACK: Record<StreetScenario, { speech: string; prefer: NpcAction[] }> = {
  argument: { speech: 'I told you already, I am not doing this again.', prefer: ['TALK_CASUAL', 'WAVE_OFF'] },
  deal: { speech: 'Keep walking. Nothing to see here.', prefer: ['WAVE_OFF', 'INTIMIDATE', 'TALK_CASUAL'] },
  chase: { speech: 'Get out of my way!', prefer: ['FLEE_PANICKED', 'TALK_CASUAL'] },
  holdup: { speech: 'Okay, okay! Please, do not shoot!', prefer: ['SURRENDER', 'PLEAD', 'FLEE_PANICKED'] },
  tourist: { speech: 'Excuse me, do you know the way to Vinewood?', prefer: ['TALK_CASUAL', 'GIVE_DIRECTIONS'] },
  fan: { speech: 'Wait, do I know you from somewhere?', prefer: ['TALK_CASUAL', 'HANDSHAKE_RESPECT'] },
  drunks: { speech: 'Hey buddy, come have a drink with us!', prefer: ['TALK_CASUAL', 'LEAN_AND_SMOKE'] },
  protest: { speech: 'We are not going anywhere until somebody listens!', prefer: ['TALK_CASUAL', 'WAVE_OFF'] },
  policeCivilian: { speech: 'Move along, this does not concern you.', prefer: ['WAVE_OFF', 'TALK_CASUAL', 'INTIMIDATE'] },
  aftermath: { speech: 'Did you hear that? Somebody call the cops.', prefer: ['CALL_911', 'USE_PHONE', 'TALK_CASUAL'] },
};

const DISTRICT_KEYS = ['grove', 'forum', 'rancho', 'chamberlain', 'davis', 'cypress'] as const;

// Night: game hour 20:00-05:59, matching StreetPolicy.IsNight in the client.
export function isNight(timeOfDay: unknown): boolean {
  const m = typeof timeOfDay === 'string' ? /^(\d{1,2}):\d{2}$/.exec(timeOfDay) : null;
  if (!m) return false; const hour = Number(m[1]); return hour >= 20 || hour < 6;
}
// Weather values are the SDK GTA.Weather enum names (Raining, ThunderStorm, ...).
export const isWet = (weather: unknown) => typeof weather === 'string' && /^(Raining|ThunderStorm|Clearing)$/.test(weather);

// Admission weight for a street scenario. Zero means it never starts.
// District multipliers apply when the localized zone name contains the key
// (case-insensitive); multiple matches multiply.
export function streetWeight(scenario: StreetScenario, get: SettingsGetter, environment: DirectorEnvironment): number {
  let weight = settingNumber(get, `director.${scenario}Weight`, 50);
  if (weight <= 0) return 0;
  if (isNight(environment?.timeOfDay)) weight *= settingNumber(get, 'director.nightMultiplier', 1.25);
  if (isWet(environment?.weather)) weight *= settingNumber(get, 'director.rainMultiplier', 0.8);
  const district = typeof environment?.district === 'string' ? environment.district.toLowerCase() : '';
  for (const key of DISTRICT_KEYS) if (district.includes(key)) weight *= settingNumber(get, `director.${key}Multiplier`, 1);
  return Number.isFinite(weight) && weight > 0 ? weight : 0;
}
