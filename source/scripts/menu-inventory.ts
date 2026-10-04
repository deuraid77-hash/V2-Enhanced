/** Generates docs/MENU-INVENTORY.md from the live catalogs and shared/menu-layout.ts.
 * Run: node --import tsx scripts/menu-inventory.ts   (add --check to fail when the doc is stale) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETTINGS_CATALOG, SIMPLIFY_ADDED_SETTINGS } from '../shared/settings.ts';
import { WORLD_DEFAULT_SETTINGS } from '../shared/world-settings.ts';
import { DORMANT_SETTING_KEYS, MENU_PAGES, MERGED_INTO, CITY_PRESETS } from '../shared/menu-layout.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'MENU-INVENTORY.md');

// Home rows of the in-game menu before this change (NativeMenu.BuildRows at tag pre-simplify-voice).
const npcGroupsBefore = [...new Set(SETTINGS_CATALOG.filter(s => !(SIMPLIFY_ADDED_SETTINGS as readonly string[]).includes(s.key)).map(s => s.group))];
const OLD_HOME: [string, string, string][] = [
  ['Search all settings', 'HIDE', 'Advanced → All settings → Search.'],
  ['Review pending edits (conditional)', 'KEEP', 'Now shown only when a save failed and needs a decision.'],
  ...npcGroupsBefore.map(g => [`${g} (settings group)`, 'HIDE', 'Advanced → All settings → group. Common items are on the six pages.'] as [string, string, string]),
  ['World director (14 settings)', 'HIDE', 'Advanced → All settings → World director. Enabled/fights/subtitles/mood are on City Life and NPC Voices.'],
  ['Profiles and presets', 'MERGE', 'Advanced → Profiles (save and apply). City mood replaces the common preset use.'],
  ['AI Settings Advisor', 'HIDE', 'Advanced → All settings → AI Settings Advisor.'],
  ['NPC inspector', 'HIDE', 'Advanced → Diagnostics → NPC inspector.'],
  ['AI usage and connection (flattened status dump)', 'REMOVE', 'Replaced by three plain rows on AI & Status; the full usage view stays in the portal.'],
  ['Diagnostics and self-test', 'HIDE', 'Advanced → Diagnostics.'],
  ['Panic stop', 'KEEP', 'Advanced → Panic, and the panic key/button at any time.'],
  ['Close menu', 'REMOVE', 'Back / Esc / B already closes; the row was redundant.'],
];
const OLD_SUBPAGE_REMOVED: [string, string][] = [
  ['Profile → Rename / Delete / Export JSON / Import local profile', 'Portal only (Profiles tab). In-game keeps Save and Apply.'],
  ['Status → per-model rows and raw status fields', 'Portal only (AI usage tab). In-game shows connection, model in use and spend.'],
  ['Diagnostics → raw values inline on the diagnostics page', 'Moved one level down to Diagnostics → Live diagnostic values.'],
];

const visible = new Map<string, { page: string; label: string }>();
const advanced = new Map<string, { page: string; label: string }>();
for (const page of MENU_PAGES) for (const item of page.items) if (item.kind === 'setting') for (const key of item.keys) (page.id === 'advanced' ? advanced : visible).set(key, { page: page.label, label: item.label });
const presetKeys = new Set([...Object.keys(CITY_PRESETS.Normal.npc), ...Object.keys(CITY_PRESETS.Normal.world).map(k => `world.${k}`)]);

const GROUP_REASON: Record<string, string> = {
  'General': 'Master switches and safe mode; defaults are correct for play.',
  'AI': 'Model, retry and budget tuning; Online AI and spend are on AI & Status.',
  'AI banks': 'Background bark-bank tuning; no player-facing effect worth a menu row.',
  'Conversation': 'Ranges and timing for talk; defaults tested in the gate.',
  'Mind and memory': 'NPC memory/mood internals; defaults are the designed behaviour.',
  'Reputation': 'Reputation maths; tuning only.',
  'Vehicles': 'Vehicle scenario weights; City mood covers road rage.',
  'Audio': 'Voice/mic internals; Voice volume and Microphone are on the pages.',
  'Combat': 'Combat bark/reaction tuning; City mood covers chatter density.',
  'World director': 'NPC-side director tuning; City mood covers the common case.',
  'Allowed actions': 'Per-action permissions for AI-driven NPC actions; defaults are the safe set.',
  'Controls': 'Menu geometry, deadzone and extra bindings; main keys are on Controls/Talk.',
  'Safety and performance': 'Budgets and guards; changing them can hurt stability.',
};

type Row = { key: string; scope: 'NPC' | 'World'; bin: 'KEEP' | 'HIDE' | 'MERGE' | 'REMOVE'; where: string; reason: string };
const rows: Row[] = [];
const all = [...SETTINGS_CATALOG.map(s => ({ key: s.key, scope: 'NPC' as const, group: s.group, label: s.label })), ...Object.keys(WORLD_DEFAULT_SETTINGS).map(k => ({ key: `world.${k}`, scope: 'World' as const, group: 'World director (original)', label: k }))];
for (const s of all) {
  const v = visible.get(s.key), a = advanced.get(s.key);
  if ((DORMANT_SETTING_KEYS as readonly string[]).includes(s.key)) rows.push({ key: s.key, scope: s.scope, bin: 'REMOVE', where: 'Not shown', reason: 'No runtime consumer (source search 2026-10-04). Key kept so saved files still load.' });
  else if (v) {
    const composite = MENU_PAGES.flatMap(p => p.items).find(i => i.kind === 'setting' && i.keys.includes(s.key) && i.keys.length > 1);
    rows.push({ key: s.key, scope: s.scope, bin: composite ? 'MERGE' : 'KEEP', where: `${v.page} → ${v.label}`, reason: composite ? `One row switches ${composite.kind === 'setting' ? composite.keys.join(' + ') : ''} together.` : 'Players change this often or need it to start talking.' });
  } else if (a) rows.push({ key: s.key, scope: s.scope, bin: 'KEEP', where: `Advanced → ${a.label}`, reason: 'Input mode choice; voice is the default, typed is the no-mic fallback.' });
  else if (MERGED_INTO[s.key]) rows.push({ key: s.key, scope: s.scope, bin: 'MERGE', where: MERGED_INTO[s.key] === 'City mood' ? 'City Life → City mood' : `NPC Voices → ${MERGED_INTO[s.key]}`, reason: presetKeys.has(s.key) ? 'Set by the Quiet/Normal/Busy preset; still editable in All settings.' : 'Category volume scales under the single Voice volume; still editable in All settings.' });
  else rows.push({ key: s.key, scope: s.scope, bin: 'HIDE', where: 'Advanced → All settings', reason: GROUP_REASON[s.group] ?? 'Tuning only; default is fine.' });
}
const count = (b: Row['bin']) => rows.filter(r => r.bin === b).length;
const visibleControls = MENU_PAGES.filter(p => p.id !== 'advanced').flatMap(p => p.items).filter(i => i.kind !== 'info').length;
const settingsBefore = SETTINGS_CATALOG.length - SIMPLIFY_ADDED_SETTINGS.length + Object.keys(WORLD_DEFAULT_SETTINGS).length;

const md = `# Menu inventory (Simplify-and-Voice)

Generated by \`scripts/menu-inventory.ts\` from \`shared/settings.ts\`, \`shared/world-settings.ts\` and \`shared/menu-layout.ts\`. Do not edit by hand.

## Counts

| | Before | After |
|---|---|---|
| In-game home rows | ${OLD_HOME.length - 1} (+1 conditional) | ${MENU_PAGES.length} (+1 conditional, only after a failed save) |
| Max rows on a main page | ${npcGroupsBefore.length + 9} (home) | ${Math.max(...MENU_PAGES.map(p => p.items.length))} |
| Settings a player sees without opening Advanced | ${settingsBefore} (every group is one press from home) | ${visibleControls} controls (${visible.size} keys; composites and City mood count once) |
| Settings in the catalogs | ${settingsBefore} | ${all.length} (+${SIMPLIFY_ADDED_SETTINGS.length}: ${SIMPLIFY_ADDED_SETTINGS.join(', ')}) |
| Depth to change a common setting | 2 | 2 |

Bins over all ${all.length} settings: KEEP ${count('KEEP')}, MERGE ${count('MERGE')}, HIDE ${count('HIDE')}, REMOVE ${count('REMOVE')}.

Depth exceptions (Advanced only): All settings → group → setting is depth 4; Diagnostics → NPC inspector → NPC → transcript is depth 5. The All settings index has ${npcGroupsBefore.length + 3} rows, the one page over 8; it exists so nothing becomes unreachable.

## New pages

${MENU_PAGES.map(p => `### ${p.label}\n${p.help}\n\n${p.items.map(i => `- **${i.label}** (${i.kind}${i.kind === 'setting' ? `: \`${i.keys.join('` + `')}\`` : ''}) — ${i.help}`).join('\n')}`).join('\n\n')}

City mood presets (Normal equals the shipped defaults):

| Key | Quiet | Normal | Busy |
|---|---|---|---|
${[...Object.keys(CITY_PRESETS.Normal.npc).map(k => `| \`${k}\` | ${CITY_PRESETS.Quiet.npc[k]} | ${CITY_PRESETS.Normal.npc[k]} | ${CITY_PRESETS.Busy.npc[k]} |`), ...Object.keys(CITY_PRESETS.Normal.world).map(k => `| \`world.${k}\` | ${CITY_PRESETS.Quiet.world[k]} | ${CITY_PRESETS.Normal.world[k]} | ${CITY_PRESETS.Busy.world[k]} |`)].join('\n')}

## Old home rows

| Old row | Bin | Where it went |
|---|---|---|
${OLD_HOME.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} |`).join('\n')}

Removed from in-game sub-pages:

${OLD_SUBPAGE_REMOVED.map(r => `- ${r[0]}: ${r[1]}`).join('\n')}

## Every setting

| Key | Scope | Bin | Where | Reason |
|---|---|---|---|---|
${rows.map(r => `| \`${r.key}\` | ${r.scope} | ${r.bin} | ${r.where} | ${r.reason} |`).join('\n')}
`;
if (process.argv.includes('--check')) { if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8').replace(/\r\n/g, '\n') !== md) throw new Error('docs/MENU-INVENTORY.md is stale. Run scripts/menu-inventory.ts.'); }
else fs.writeFileSync(out, md, 'utf8');
console.log(JSON.stringify({ settings: all.length, keep: count('KEEP'), merge: count('MERGE'), hide: count('HIDE'), remove: count('REMOVE'), homeBefore: OLD_HOME.length - 1, homeAfter: MENU_PAGES.length, visibleControls, checked: process.argv.includes('--check') }));
