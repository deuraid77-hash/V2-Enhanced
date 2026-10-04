import React, { useEffect, useState } from 'react';
import { AlertCircle, Mic, RotateCcw, X } from 'lucide-react';
import { CONTROLLER_BINDINGS, type SettingDefinition, type SettingValue } from '../../shared/settings';
import { CITY_PRESETS, CITY_PRESET_NAMES, MENU_PAGES, matchCityPreset, type MenuItem } from '../../shared/menu-layout';
import { api, humanize, type WorldSnapshot } from '../lib/world';
import { errorText, type AiStatus, type CompanionResource, type SettingsSnapshot } from '../lib/npc-companion';
import { PanelHeading } from './WorldControl';
import { controllerLabels } from './NpcFoundation';
import './simple-settings.css';

type Device = { id: string; name: string; isDefault: boolean; available: boolean };
type Props = { npc: CompanionResource<SettingsSnapshot>; ai: CompanionResource<AiStatus>; world: WorldSnapshot | null; setWorld: (value: WorldSnapshot) => void; companionFresh: boolean; onAdvanced: () => void };

function RangeControl({ def, value, disabled, onCommit }: { def: SettingDefinition; value: number; disabled: boolean; onCommit: (value: number) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const commit = () => { if (local !== value) onCommit(local); };
  return <span className="simple-range"><input type="range" min={def.min} max={def.max} step={def.step} value={local} disabled={disabled} onChange={e => setLocal(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} /><output>{def.key.endsWith('Volume') ? Math.round(local * 100) + '%' : String(local)}</output></span>;
}

/** The same six pages as the in-game menu (shared/menu-layout.ts). Every change saves immediately. */
export function SimpleSettings({ npc, ai, world, setWorld, companionFresh, onAdvanced }: Props) {
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [devices, setDevices] = useState<Device[]>([]), [mic, setMic] = useState<string>('');
  const snap = npc.data, catalog = snap?.catalog ?? [], npcValues = snap?.settings ?? {}, worldValues = (world?.config.settings ?? {}) as unknown as Record<string, SettingValue>;
  const worldCatalog = snap?.worldCatalog ?? [];
  useEffect(() => { api<{ devices: Device[] }>('/api/ptt/devices').then(r => setDevices(r.devices.filter(d => d.available && d.id !== 'default'))).catch(() => setDevices([])); }, []);

  const definition = (key: string): SettingDefinition | undefined => key.startsWith('world.') ? worldCatalog.find(d => d.key === key.slice(6)) : catalog.find(d => d.key === key);
  const valueOf = (key: string): SettingValue | undefined => key.startsWith('world.') ? worldValues[key.slice(6)] : npcValues[key];

  async function save(changes: Record<string, SettingValue>, done?: string) {
    if (!snap || busy) return;
    const npcPatch = Object.fromEntries(Object.entries(changes).filter(([k]) => !k.startsWith('world.')));
    const worldPatch = Object.fromEntries(Object.entries(changes).filter(([k]) => k.startsWith('world.')).map(([k, v]) => [k.slice(6), v]));
    setBusy(true); setNotice(null);
    try {
      if (Object.keys(npcPatch).length) { const result = await api<SettingsSnapshot>('/api/settings', { method: 'PATCH', body: JSON.stringify({ settings: npcPatch, source: 'portal', expectedRevision: snap.revision }) }); npc.setData({ ...snap, ...result }); }
      if (Object.keys(worldPatch).length) setWorld(await api<WorldSnapshot>('/api/world/config', { method: 'PATCH', body: JSON.stringify({ settings: worldPatch }) }));
      if (done) setNotice({ error: false, text: done });
    } catch (e) { setNotice({ error: true, text: errorText(e) }); void npc.refresh(); }
    finally { setBusy(false); }
  }
  async function action(id: string) {
    if (id === 'micTest') { setMic('Listening…'); try { const r = await api<{ verdict: string; level: number; deviceName: string }>('/api/ptt/mic-test', { method: 'POST', body: '{}' }); setMic(r.verdict === 'ok' ? `Working (${r.deviceName})` : r.verdict === 'quiet' ? 'Too quiet — move closer or raise the Windows mic level' : 'Heard nothing — check the microphone and Windows privacy settings'); } catch (e) { setMic('No microphone: ' + errorText(e)); } return; }
    if (id === 'restoreDefaults') { if (!snap || !world || !window.confirm('Restore every setting to its default, including keys?')) return; setBusy(true); try { await api('/api/profiles/Realistic/apply', { method: 'POST', body: JSON.stringify({ expectedRevision: snap.revision, expectedWorldRevision: world.config.revision }) }); await npc.refresh(); setNotice({ error: false, text: 'Defaults restored.' }); } catch (e) { setNotice({ error: true, text: errorText(e) }); } finally { setBusy(false); } return; }
    if (id === 'testConnection' || id === 'allSettings' || id === 'profiles' || id === 'diagnostics' || id === 'panic') onAdvanced();
  }
  function cityRow() {
    const current = matchCityPreset(npcValues, worldValues);
    return <label className="simple-row"><div><strong>City mood</strong><p>Quiet, Normal or Busy. Sets encounter rate, aggression and chatter together.</p></div>
      <select value={current} disabled={busy || !companionFresh} onChange={e => { const p = CITY_PRESETS[e.target.value as 'Quiet' | 'Normal' | 'Busy']; if (p) void save({ ...p.npc, ...Object.fromEntries(Object.entries(p.world).map(([k, v]) => ['world.' + k, v])) }, `City mood: ${e.target.value}.`); }}>
        {current === 'Custom' && <option value="Custom">Custom</option>}{CITY_PRESET_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
      </select></label>;
  }
  function settingRow(item: Extract<MenuItem, { kind: 'setting' }>) {
    const defs = item.keys.map(definition);
    if (defs.some(d => !d)) return null;
    const values = item.keys.map(valueOf), first = defs[0]!, value = values[0];
    const disabled = busy || !companionFresh;
    let control: React.ReactNode;
    if (item.keys.length > 1) { const same = values.every(v => v === value); control = <input type="checkbox" checked={same && Boolean(value)} ref={el => { if (el) el.indeterminate = !same; }} disabled={disabled} onChange={e => void save(Object.fromEntries(item.keys.map(k => [k, e.target.checked])))} />; }
    else if (first.key === 'audio.micDeviceId') control = <select value={String(value)} disabled={disabled} onChange={e => void save({ [item.keys[0]]: e.target.value })}><option value="default">Windows default</option>{devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}{value !== 'default' && !devices.some(d => d.id === value) && <option value={String(value)}>Saved device</option>}</select>;
    else if (first.type === 'boolean') control = <input type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={e => void save({ [item.keys[0]]: e.target.checked })} />;
    else if (item.keys[0].startsWith('controls.controller')) control = <select value={Number(value)} disabled={disabled} onChange={e => void save({ [item.keys[0]]: Number(e.target.value) })}>{CONTROLLER_BINDINGS.map(c => <option key={c} value={c}>{controllerLabels[c] || String(c)}</option>)}</select>;
    else if (first.type === 'select') control = <select value={String(value)} disabled={disabled} onChange={e => void save({ [item.keys[0]]: e.target.value })}>{first.options?.map(o => <option key={o} value={o}>{humanize(o)}</option>)}</select>;
    else if (first.type === 'number') control = <RangeControl def={first} value={Number(value)} disabled={disabled} onCommit={v => void save({ [item.keys[0]]: v })} />;
    else control = <input type="text" defaultValue={String(value)} key={String(value)} maxLength={40} disabled={disabled} spellCheck={false} onBlur={e => { if (e.target.value !== value) void save({ [item.keys[0]]: e.target.value.trim() }); }} />;
    return <label className="simple-row" key={item.keys.join('+')}><div><strong>{item.label}</strong><p>{item.help}</p></div>{control}</label>;
  }
  function infoValue(id: string) {
    const s = ai.data; if (!s) return 'Checking…';
    if (id === 'connection') return s.capabilities.configured === false ? 'No API key' : s.runtime?.connected ? 'Connected' : 'Game not linked';
    if (id === 'model') return npcValues['ai.enabled'] ? String(npcValues['ai.liveModel'] ?? '') : 'Offline lines';
    if (id === 'spend') return `$${s.budget.spentEstimateUsd.toFixed(2)} of $${s.budget.dailyLimitUsd.toFixed(2)}`;
    return '';
  }
  return <div className="simple-settings">
    {notice && <div className={`notice ${notice.error ? 'error' : 'success'}`} role="status"><AlertCircle size={17} /><span>{notice.text}</span><button aria-label="Dismiss" onClick={() => setNotice(null)}><X size={16} /></button></div>}
    {!snap && <div className="notice" role="status"><span>Waiting for the companion…</span></div>}
    <div className="simple-grid">
      {snap && MENU_PAGES.filter(p => p.id !== 'advanced').map(page => <section className="panel simple-card" key={page.id} id={`simple-${page.id}`}>
        <PanelHeading eyebrow={page.label.toUpperCase()} title={page.help} />
        {page.items.map(item => item.kind === 'setting' ? settingRow(item)
          : item.kind === 'info' ? <div className="simple-row" key={item.id}><div><strong>{item.label}</strong><p>{item.help}</p></div><output>{infoValue(item.id)}</output></div>
          : item.id === 'cityPreset' ? <React.Fragment key={item.id}>{cityRow()}</React.Fragment>
          : <div className="simple-row" key={item.id}><div><strong>{item.label}</strong><p>{item.id === 'micTest' && mic ? mic : item.help}</p></div><button className="button subtle" id={`simple-action-${item.id}`} disabled={busy || !companionFresh} onClick={() => void action(item.id)}>{item.id === 'micTest' ? <><Mic size={14} />Test</> : item.id === 'testConnection' ? 'Open' : 'Go'}</button></div>)}
      </section>)}
    </div>
    <div className="simple-footer"><button className="button subtle" id="simple-restore-defaults" disabled={busy || !companionFresh || !snap} onClick={() => void action('restoreDefaults')}><RotateCcw size={14} />Restore defaults</button><button className="button subtle" id="simple-open-advanced" onClick={onAdvanced}>Advanced: every setting, profiles, advisor, usage</button></div>
  </div>;
}
