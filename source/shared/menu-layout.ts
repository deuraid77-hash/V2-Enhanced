/** Simplified player-facing menu (Simplify-and-Voice brief, 2026-10-04).
 * One source of truth for the in-game menu (generated into C#) and the portal.
 * Keys prefixed `world.` belong to the 14 original director settings; every other
 * key is an NPC setting from SETTINGS_CATALOG. Settings that are not listed here
 * remain active on their saved values and are reachable from Advanced / All settings.
 */
import { DEFAULT_NPC_SETTINGS, SETTINGS_CATALOG, type SettingValue } from './settings.ts';
import { WORLD_DEFAULT_SETTINGS } from './world-settings.ts';

export type MenuItem =
  | { kind: 'setting'; keys: string[]; label: string; help: string }
  | { kind: 'action'; id: string; label: string; help: string }
  | { kind: 'info'; id: string; label: string; help: string };
export interface MenuPage { id: string; label: string; help: string; items: MenuItem[] }

const s = (keys: string | string[], label: string, help: string): MenuItem => ({ kind: 'setting', keys: Array.isArray(keys) ? keys : [keys], label, help });
const a = (id: string, label: string, help: string): MenuItem => ({ kind: 'action', id, label, help });
const i = (id: string, label: string, help: string): MenuItem => ({ kind: 'info', id, label, help });

export const MENU_PAGES: readonly MenuPage[] = Object.freeze([
  { id: 'talk', label: 'Talk', help: 'Hold the talk button near someone and speak.', items: [
    a('micTest', 'Mic test', 'Records about two seconds and reports the level. Nothing is sent online or saved.'),
    s('audio.micDeviceId', 'Microphone', 'Which microphone to use. Default follows Windows.'),
    s('controls.pttKey', 'Talk key (hold)', 'Hold this key, speak, then let go.'),
    s('controls.controllerPtt', 'Talk button (hold)', 'Controller button to hold while you speak.'),
    s('conversation.language', 'Language', 'The language you speak and NPCs answer in.'),
  ] },
  { id: 'voices', label: 'NPC Voices', help: 'How NPCs sound.', items: [
    s('audio.enabled', 'NPC voices', 'NPCs answer out loud. Subtitles still work when this is off.'),
    s('audio.masterVolume', 'Voice volume', 'One volume for every NPC voice.'),
    s(['general.subtitles', 'world.subtitles'], 'Subtitles', 'Show what NPCs say on screen.'),
  ] },
  { id: 'city', label: 'City Life', help: 'How busy the streets feel.', items: [
    a('cityPreset', 'City mood', 'Quiet, Normal or Busy. Sets encounter rate, aggression and chatter together.'),
    s('world.enabled', 'Street encounters', 'Street events and gang activity near you.'),
    s(['world.streetFights', 'world.turfWars'], 'Fights', 'Street fights and gang turf wars.'),
    s('conversation.vehicleEnabled', 'Vehicle conversations', 'Talk to drivers and passengers through the window.'),
    s('conversation.approachEnabled', 'NPCs approach you', 'Let NPCs start a conversation. You can ignore them.'),
  ] },
  { id: 'controls', label: 'Controls', help: 'Keys and buttons.', items: [
    s('controls.menuKey', 'Menu key', 'Opens this menu.'),
    s('controls.controllerMenu', 'Menu button (hold with RB)', 'Controller button held together with the modifier.'),
    s('controls.panicKey', 'Panic key', 'Stops every mod scene, voice and AI request at once.'),
    s('general.hints', 'Button hints', 'Show who you can talk to and which button to hold.'),
    s('controls.promptStyle', 'Button style', 'Xbox, PlayStation or keyboard labels. Auto follows your last input.'),
  ] },
  { id: 'status', label: 'AI & Status', help: 'Is everything connected?', items: [
    i('connection', 'Connection', 'Green when the companion and game are talking to each other.'),
    i('model', 'AI in use', 'The AI model answering NPC conversations.'),
    i('spend', 'AI spend today', 'Estimated spend against the daily cap.'),
    a('testConnection', 'Test connection', 'Sends one small paid AI request within the daily cap.'),
    s('ai.enabled', 'Online AI', 'Off uses offline fallback lines, clearly labelled.'),
  ] },
  { id: 'advanced', label: 'Advanced', help: 'Everything else. The defaults are fine.', items: [
    a('restoreDefaults', 'Restore defaults', 'Puts every setting back to its default, including keys.'),
    a('panic', 'Panic: stop everything', 'Cancels owned scenes, voices and AI. Also on the panic key.'),
    s('conversation.pushToTalk', 'Voice talk', 'Talk with your microphone. Audio is captured only while the button is held.'),
    s('conversation.tapToTalk', 'Tap to talk', 'Tap once to start listening; it stops after a short silence.'),
    s('conversation.typedFallback', 'Typed talk (no mic)', 'Typed text and the reply wheel for players without a microphone.'),
    a('allSettings', 'All settings', 'Every setting, searchable, plus the AI settings advisor.'),
    a('profiles', 'Profiles', 'Save or apply a full set of settings.'),
    a('diagnostics', 'Diagnostics', 'Self-tests, voice test, NPC inspector and a sanitized report.'),
  ] },
] as MenuPage[]);

/** Settings that have no runtime consumer (verified by source search on 2026-10-04).
 * Not shown in any menu; the keys stay in saved files so old documents still load. */
export const DORMANT_SETTING_KEYS: readonly string[] = Object.freeze([
  'audio.duckGame', 'audio.duckAmount', 'audio.followGameSessionVolume', 'audio.preRender',
  'audio.windowMuffleGain', 'safety.pauseInInteriors', 'safety.maxOwnedVehicles',
]);

/** Settings whose job is now done by one visible control. */
export const MERGED_INTO: Readonly<Record<string, string>> = Object.freeze({
  'audio.casualVolume': 'Voice volume', 'audio.combatVolume': 'Voice volume', 'audio.vehicleVolume': 'Voice volume',
  'audio.phoneVolume': 'Voice volume', 'audio.narratorVolume': 'Voice volume',
  'world.ambientHostility': 'City mood', 'world.gangAggression': 'City mood', 'world.eventIntervalSeconds': 'City mood',
  'world.maxActiveEvents': 'City mood', 'conversation.approachChance': 'City mood', 'combat.barkDensity': 'City mood',
  'ai.directorIntervalSeconds': 'City mood', 'vehicles.roadRage.weight': 'City mood',
});

type PresetValues = { npc: Record<string, SettingValue>; world: Record<string, SettingValue> };
export const CITY_PRESETS: Readonly<Record<'Quiet' | 'Normal' | 'Busy', PresetValues>> = Object.freeze({
  Quiet: { npc: { 'conversation.approachChance': 10, 'combat.barkDensity': 30, 'ai.directorIntervalSeconds': 20, 'vehicles.roadRage.weight': 20 },
    world: { ambientHostility: 40, gangAggression: 50, eventIntervalSeconds: 150, maxActiveEvents: 1 } },
  Normal: { npc: { 'conversation.approachChance': DEFAULT_NPC_SETTINGS['conversation.approachChance'], 'combat.barkDensity': DEFAULT_NPC_SETTINGS['combat.barkDensity'], 'ai.directorIntervalSeconds': DEFAULT_NPC_SETTINGS['ai.directorIntervalSeconds'], 'vehicles.roadRage.weight': DEFAULT_NPC_SETTINGS['vehicles.roadRage.weight'] },
    world: { ambientHostility: WORLD_DEFAULT_SETTINGS.ambientHostility, gangAggression: WORLD_DEFAULT_SETTINGS.gangAggression, eventIntervalSeconds: WORLD_DEFAULT_SETTINGS.eventIntervalSeconds, maxActiveEvents: WORLD_DEFAULT_SETTINGS.maxActiveEvents } },
  Busy: { npc: { 'conversation.approachChance': 50, 'combat.barkDensity': 85, 'ai.directorIntervalSeconds': 5, 'vehicles.roadRage.weight': 80 },
    world: { ambientHostility: 80, gangAggression: 85, eventIntervalSeconds: 45, maxActiveEvents: 3 } },
});
export const CITY_PRESET_NAMES = ['Quiet', 'Normal', 'Busy'] as const;
export function matchCityPreset(npc: Record<string, unknown>, world: Record<string, unknown>): string {
  for (const name of CITY_PRESET_NAMES) {
    const p = CITY_PRESETS[name];
    if (Object.entries(p.npc).every(([k, v]) => npc[k] === v) && Object.entries(p.world).every(([k, v]) => world[k] === v)) return name;
  }
  return 'Custom';
}

export function visibleSettingKeys(): string[] {
  return MENU_PAGES.filter(p => p.id !== 'advanced').flatMap(p => p.items.flatMap(item => item.kind === 'setting' ? item.keys : []));
}
export function menuSettingKeys(): string[] { return MENU_PAGES.flatMap(p => p.items.flatMap(item => item.kind === 'setting' ? item.keys : [])); }
export function allKnownKeys(): Set<string> {
  return new Set([...SETTINGS_CATALOG.map(x => x.key), ...Object.keys(WORLD_DEFAULT_SETTINGS).map(k => `world.${k}`)]);
}
