import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeAcknowledgement, profileChanges, readProfileImport, type AiStatus, type SettingsSnapshot } from '../src/lib/npc-companion.ts';
import type { WorldSnapshot } from '../src/lib/world.ts';
import { DEFAULT_NPC_SETTINGS, SETTINGS_CATALOG } from '../shared/settings.ts';
import { DEFAULT_SETTINGS } from '../server-lib/world.ts';

const now = 10000;
const ai = { runtime: { protocol: 4, runtimeId: 'qa-current', connected: true, appliedNpcRevision: 4 } } as AiStatus;
const world = { runtimeId: 'qa-current' } as WorldSnapshot;
test('native received status requires fresh matching protocol4 runtime, not only matching revisions', () => {
  assert.equal(nativeAcknowledgement(4, ai, now, now, world, true).acknowledged, true);
  assert.equal(nativeAcknowledgement(4, ai, now, now, world, false).acknowledged, false);
  assert.equal(nativeAcknowledgement(4, ai, 1000, now, world, true).acknowledged, false);
  assert.equal(nativeAcknowledgement(4, ai, now, now, { runtimeId: 'old-session' } as WorldSnapshot, true).acknowledged, false);
  assert.equal(nativeAcknowledgement(4, ai, now, now, world, true, 'unavailable').acknowledged, false);
  assert.equal(nativeAcknowledgement(5, ai, now, now, world, true).pending, true);
});
test('profile review includes changed NPC and world values without inventing unchanged edits', () => {
  const current: SettingsSnapshot = { revision: 3, settings: { ...DEFAULT_NPC_SETTINGS }, source: 'portal', updatedAt: '', catalog: SETTINGS_CATALOG, world: { revision: 2, settings: { ...DEFAULT_SETTINGS }, source: 'portal', updatedAt: '' } };
  const profile = { format: 'LivingLosSantos.profile' as const, version: 4 as const, name: 'QA', settings: { ...current.settings, 'audio.masterVolume': 0.1 }, worldSettings: { ...DEFAULT_SETTINGS, gangAggression: 42 } };
  const changes = profileChanges(profile, current);
  assert.equal(changes.length, 2);
  assert.deepEqual(changes.map(c => [c.scope, c.key, c.before, c.after]), [['npc', 'audio.masterVolume', current.settings['audio.masterVolume'], 0.1], ['world', 'gangAggression', 75, 42]]);
});
test('profile file review rejects unsupported containers and retains explicit legacy migration boundary', () => {
  const old = JSON.stringify({ format: 'LivingLosSantos.profile', version: 4, name: 'QA', settings: DEFAULT_NPC_SETTINGS });
  assert.equal(readProfileImport(old).worldSettings, undefined);
  assert.throws(() => readProfileImport('[]'), /version 4/);
  assert.throws(() => readProfileImport(JSON.stringify({ ...JSON.parse(old), credential: 'fixture' })), /unsupported/);
  assert.throws(() => readProfileImport(' '.repeat(256 * 1024 + 1)), /256/);
});
