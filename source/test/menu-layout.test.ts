import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_NPC_SETTINGS, SETTINGS_CATALOG, SIMPLIFY_ADDED_SETTINGS, STEP3_ADDED_SETTINGS, migrateSavedNpcSettings, validateNpcSettings, type NpcSettings } from '../shared/settings.ts';
import { WORLD_DEFAULT_SETTINGS, WORLD_SETTING_RANGES } from '../shared/world-settings.ts';
import { CITY_PRESETS, CITY_PRESET_NAMES, DORMANT_SETTING_KEYS, MENU_PAGES, MERGED_INTO, allKnownKeys, matchCityPreset, menuSettingKeys, visibleSettingKeys } from '../shared/menu-layout.ts';

const typeOf = (key: string) => key.startsWith('world.') ? typeof (WORLD_DEFAULT_SETTINGS as Record<string, unknown>)[key.slice(6)] : SETTINGS_CATALOG.find(s => s.key === key)?.type;

test('simplified menu meets the brief targets: <=6 pages, <=8 items per page, <=20 visible controls', () => {
  assert.ok(MENU_PAGES.length <= 6, `pages ${MENU_PAGES.length}`);
  for (const page of MENU_PAGES) assert.ok(page.items.length <= 8, `${page.id} has ${page.items.length}`);
  const visibleControls = MENU_PAGES.filter(p => p.id !== 'advanced').flatMap(p => p.items).filter(i => i.kind !== 'info').length;
  assert.ok(visibleControls <= 20, `visible controls ${visibleControls}`);
  assert.ok(MENU_PAGES.some(p => p.id === 'advanced' && p.items.some(i => i.kind === 'action' && i.id === 'restoreDefaults') && p.items.some(i => i.kind === 'action' && i.id === 'panic')));
  const ids = MENU_PAGES.map(p => p.id); assert.equal(new Set(ids).size, ids.length);
});

test('every menu key exists, composites share one boolean type, and nothing is dormant or duplicated', () => {
  const known = allKnownKeys();
  const keys = menuSettingKeys();
  for (const key of keys) assert.ok(known.has(key), `unknown ${key}`);
  assert.equal(new Set(keys).size, keys.length, 'a key appears twice');
  for (const page of MENU_PAGES) for (const item of page.items) if (item.kind === 'setting' && item.keys.length > 1) {
    for (const key of item.keys) assert.equal(typeOf(key), 'boolean', `${item.label}: ${key}`);
  }
  for (const key of DORMANT_SETTING_KEYS) { assert.ok(known.has(key)); assert.ok(!keys.includes(key)); }
  for (const key of Object.keys(MERGED_INTO)) { assert.ok(known.has(key), key); assert.ok(!visibleSettingKeys().includes(key), key); }
});

test('city presets validate in both scopes and Normal equals the defaults', () => {
  for (const name of CITY_PRESET_NAMES) {
    const p = CITY_PRESETS[name];
    assert.doesNotThrow(() => validateNpcSettings(p.npc, true), name);
    for (const [k, v] of Object.entries(p.world)) {
      const range = WORLD_SETTING_RANGES[k]; assert.ok(range, `${name}.${k} has no range`);
      assert.equal(typeof v, 'number'); assert.ok((v as number) >= range[0] && (v as number) <= range[1], `${name}.${k}=${v}`);
    }
  }
  assert.equal(matchCityPreset(DEFAULT_NPC_SETTINGS, WORLD_DEFAULT_SETTINGS), 'Normal');
  assert.equal(matchCityPreset({ ...DEFAULT_NPC_SETTINGS, ...CITY_PRESETS.Busy.npc }, { ...WORLD_DEFAULT_SETTINGS, ...CITY_PRESETS.Busy.world }), 'Busy');
  assert.equal(matchCityPreset({ ...DEFAULT_NPC_SETTINGS, ...CITY_PRESETS.Busy.npc }, WORLD_DEFAULT_SETTINGS), 'Custom');
});

test('voice-first migration: a pre-simplify document gains the new keys and push-to-talk once; partial groups are refused', () => {
  const old: NpcSettings = { ...DEFAULT_NPC_SETTINGS, 'conversation.pushToTalk': false, 'audio.masterVolume': 0.3 };
  for (const key of SIMPLIFY_ADDED_SETTINGS) delete old[key];
  const upgraded = migrateSavedNpcSettings(old);
  assert.equal(upgraded['conversation.pushToTalk'], true);
  assert.equal(upgraded['audio.masterVolume'], 0.3);
  assert.equal(upgraded['general.subtitles'], true); assert.equal(upgraded['conversation.tapToTalk'], false); assert.equal(upgraded['conversation.typedFallback'], false);
  const current = migrateSavedNpcSettings({ ...DEFAULT_NPC_SETTINGS, 'conversation.pushToTalk': false });
  assert.equal(current['conversation.pushToTalk'], false, 'a current document keeps the player choice');
  const both: NpcSettings = { ...old }; for (const key of STEP3_ADDED_SETTINGS) delete both[key];
  assert.equal(migrateSavedNpcSettings(both)['conversation.pushToTalk'], true);
  const partial: NpcSettings = { ...DEFAULT_NPC_SETTINGS }; delete partial['general.subtitles'];
  assert.throws(() => migrateSavedNpcSettings(partial), /Incomplete/);
});

test('docs/MENU-INVENTORY.md matches the shipped catalogs and layout', async () => {
  const { execFileSync } = await import('node:child_process');
  assert.doesNotThrow(() => execFileSync(process.execPath, ['--import', 'tsx', 'scripts/menu-inventory.ts', '--check'], { stdio: 'pipe' }));
});
