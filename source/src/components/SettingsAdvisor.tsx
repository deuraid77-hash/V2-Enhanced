import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, CircleHelp, FileCheck2, Send, Sparkles, Square, X } from 'lucide-react';
import { api, humanize } from '../lib/world';
import { errorText, type CompanionResource, type SettingsChange, type SettingsSnapshot } from '../lib/npc-companion';
import { Badge, PanelHeading } from './WorldControl';
import { ChangeTable } from './ProfilesPanel';

type Proposal = { id: string; status: string; summary: string; settingsPatch: Record<string, unknown>; worldPatch: Record<string, unknown>; changes: SettingsChange[]; expectedRevision: number; expectedWorldRevision: number; createdAt: string; expiresAt: string };
type MenuResult = { proposal?: Proposal; text?: string; settingKey?: string; grounding?: string; summary?: string; findings?: { severity: string; message: string }[]; suggestedSettingKeys?: string[]; connected?: boolean; model?: string; latencyMs?: number };
type MenuJob = { id: string; kind: string; status: string; source?: string; model?: string; reasonCode?: string; createdAt: string; result?: MenuResult };
const terminal = (status: string) => ['completed', 'failed', 'cancelled', 'rejected', 'fallback'].includes(status);

export function SettingsAdvisor({ settings, companionFresh, now, requestedSetting }: { settings: CompanionResource<SettingsSnapshot>; companionFresh: boolean; now: number; requestedSetting: { key: string; sequence: number } | null }) {
  const [intent, setIntent] = useState(''), [settingKey, setSettingKey] = useState('general.enabled');
  const [job, setJob] = useState<MenuJob | null>(null), [proposal, setProposal] = useState<Proposal | null>(null), [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null), [pollError, setPollError] = useState('');
  const mounted = useRef(true), current = settings.data;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (requestedSetting) setSettingKey(requestedSetting.key); }, [requestedSetting]);
  const pending = Boolean(job && !terminal(job.status)), fresh = companionFresh && !settings.error;
  const catalog = [...(current?.catalog || []), ...(current?.worldCatalog || [])];
  const descriptor = catalog.find(item => item.key === settingKey);
  const savedValue = settingKey.startsWith('world.') ? current?.world?.settings[settingKey.slice(6) as keyof NonNullable<SettingsSnapshot['world']>['settings']] : current?.settings[settingKey];
  useEffect(() => {
    if (!job || terminal(job.status)) return;
    let active = true, inFlight = false; const abort = new AbortController();
    async function poll() {
      if (inFlight) return; inFlight = true;
      try { const response = await api<{ job: MenuJob }>(`/api/ai/menu/jobs/${encodeURIComponent(job!.id)}`, { signal: abort.signal }); if (active) { setJob(response.job); setPollError(''); if (response.job.result?.proposal) setProposal(response.job.result.proposal); } }
      catch (error) { if (active && !abort.signal.aborted) setPollError(errorText(error)); }
      finally { inFlight = false; }
    }
    void poll(); const interval = setInterval(poll, 1000);
    return () => { active = false; abort.abort(); clearInterval(interval); };
  }, [job?.id, pending]);
  async function run(kind: 'advisor' | 'explain' | 'diagnose' | 'connection') {
    if (!fresh || busy || pending) return; setBusy('request'); setMessage(null); setPollError('');
    try { const response = await api<{ job: MenuJob }>('/api/ai/menu/jobs', { method: 'POST', body: JSON.stringify({ requestId: crypto.randomUUID(), kind, context: kind === 'advisor' ? { intent: intent.trim() } : kind === 'explain' ? { settingKey } : {} }) }); if (mounted.current) { setJob(response.job); if (kind === 'advisor') setProposal(response.job.result?.proposal || null); } }
    catch (error) { if (mounted.current) setMessage({ error: true, text: errorText(error) }); }
    finally { if (mounted.current) setBusy(''); }
  }
  async function cancel() {
    if (!job || busy) return; setBusy('cancel');
    try { const response = await api<{ job: MenuJob }>(`/api/ai/menu/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' }); setJob(response.job); setMessage({ error: false, text: 'Request cancelled. Any provider work already started remains accounted for in the usage ledger.' }); }
    catch (error) { setMessage({ error: true, text: errorText(error) }); } finally { setBusy(''); }
  }
  const stale = Boolean(proposal && current && (proposal.expectedRevision !== current.revision || proposal.expectedWorldRevision !== current.world?.revision));
  const expired = Boolean(proposal && Date.parse(proposal.expiresAt) <= now), preview = proposal?.status === 'preview';
  async function decide(accept: boolean) {
    if (!proposal || busy) return; setBusy(accept ? 'accept' : 'reject'); setMessage(null);
    try {
      const result = await api<{ proposal: Proposal; npcSettings?: SettingsSnapshot; worldConfig?: SettingsSnapshot['world'] }>(`/api/ai/advisor/proposals/${encodeURIComponent(proposal.id)}/${accept ? 'accept' : 'reject'}`, { method: 'POST', body: JSON.stringify(accept ? { expectedRevision: proposal.expectedRevision, expectedWorldRevision: proposal.expectedWorldRevision } : {}) });
      setProposal(result.proposal);
      if (result.npcSettings) settings.setData(previous => ({ ...previous!, ...result.npcSettings!, ...(result.worldConfig ? { world: result.worldConfig } : {}) }));
      setMessage({ error: false, text: accept ? 'Accepted changes were saved. The game confirms its received revision separately.' : 'Proposal rejected. No settings were changed.' }); void settings.refresh();
    } catch (error) { setMessage({ error: true, text: errorText(error) }); void settings.refresh(); } finally { setBusy(''); }
  }
  return <>
    <div className="availability-note"><Sparkles size={18} /><p>Describe the city you want. The advisor uses the current catalogue and saved settings to propose changes. <strong>Nothing changes until you accept a reviewed proposal.</strong> Requests share your configured AI budget.</p></div>
    {message && <div className={`notice ${message.error ? 'error' : 'success'}`} role="status"><AlertCircle size={17} /><span>{message.text}</span><button onClick={() => setMessage(null)} aria-label="Dismiss advisor message"><X size={16} /></button></div>}
    <div className="two-columns advisor-controls"><section className="panel"><PanelHeading eyebrow="SETTINGS ADVISOR" title="Tell the city what you want" /><form className="control-body" onSubmit={e => { e.preventDefault(); void run('advisor'); }}><label className="field-label" htmlFor="advisor-intent">Your wish for Los Santos</label><textarea id="advisor-intent" value={intent} onChange={e => setIntent(e.target.value)} maxLength={600} placeholder="Frequent street fights and turf battles, with space between encounters…" disabled={Boolean(busy) || pending} rows={5} /><div className="form-counter">{intent.length} / 600</div><button className="button primary" disabled={!fresh || Boolean(busy) || pending || !intent.trim()}><Sparkles size={15} />Propose settings</button><p className="helper">The result shows every proposed value and a plain-language reason. It does not start encounters or issue game actions.</p></form></section>
      <section className="panel"><PanelHeading eyebrow="UNDERSTAND A CONTROL" title="Make an informed change" /><div className="control-body"><label className="field-label" htmlFor="explain-setting">Setting to explain</label><select id="explain-setting" value={settingKey} onChange={e => setSettingKey(e.target.value)} disabled={Boolean(busy) || pending}>{catalog.map(item => <option key={item.key} value={item.key}>{item.group} · {item.label}</option>)}</select><p className="option-grounding">{descriptor?.tooltip || 'Waiting for the companion catalogue.'}</p><div className="setting-current"><code>{settingKey}</code><Badge>{current ? `Saved: ${String(savedValue)}` : 'Unavailable'}</Badge></div><button className="button" disabled={!fresh || !descriptor || Boolean(busy) || pending} onClick={() => void run('explain')}><CircleHelp size={15} />Ask AI to explain</button></div></section></div>
    <div className="advisor-utilities"><button className="button subtle" disabled={!fresh || Boolean(busy) || pending} onClick={() => void run('diagnose')}><FileCheck2 size={16} />Analyze sanitized diagnostics</button><button className="button subtle" disabled={!fresh || Boolean(busy) || pending} onClick={() => void run('connection')}><Send size={15} />Test an AI reply</button><span>These actions use the same metered provider queue.</span></div>
    {job && <section className="panel advisor-result"><PanelHeading eyebrow="PROVIDER REQUEST" title={humanize(job.kind)}><Badge tone={job.status === 'completed' ? 'green' : 'orange'}>{humanize(job.status)}</Badge></PanelHeading><div className="control-body"><div className="request-caption"><code>{job.id}</code><span>{job.model || job.source || 'Waiting for provider source'}</span></div>{pollError && <div className="notice error" role="status">{pollError} Request status is unconfirmed; this portal is still checking.</div>}{pending ? <div className="pending-advice" role="status"><span className="live-dot on" /><p>The companion is {job.status === 'queued' ? 'waiting for an AI slot' : 'preparing a grounded response'}. Settings remain unchanged.</p><button className="button" disabled={!fresh || Boolean(busy)} onClick={() => void cancel()}><Square size={13} />Cancel request</button></div> : ['failed', 'rejected', 'cancelled'].includes(job.status) ? <p className="job-failure" role="status">{job.reasonCode ? humanize(job.reasonCode) : humanize(job.status)}. No proposal was applied.</p> : <>{job.result?.text && <div className="explanation-text"><CircleHelp size={20} /><p>{job.result.text}</p><small>{job.result.grounding || 'Companion-provided explanation'}</small></div>}{job.result?.summary && <p className="advisor-summary">{job.result.summary}</p>}{job.result?.findings && <ul className="diagnostic-findings">{job.result.findings.map((finding, index) => <li key={index}><Badge tone={finding.severity === 'warning' ? 'orange' : undefined}>{finding.severity}</Badge><span>{finding.message}</span></li>)}</ul>}{job.result?.connected && <p className="advisor-summary">Provider reply received from {job.result.model || job.model}. {typeof job.result.latencyMs === 'number' && `Measured response ${(job.result.latencyMs / 1000).toFixed(2)} seconds.`}</p>}</>}</div></section>}
    {proposal && <section className="panel advisor-proposal"><PanelHeading eyebrow="REVIEW EACH CHANGE" title="Your proposed configuration"><Badge tone={preview ? 'orange' : 'green'}>{expired && preview ? 'Expired' : humanize(proposal.status)}</Badge></PanelHeading><div className="control-body"><p className="advisor-summary">{proposal.summary}</p><p className="helper">Based on NPC revision {proposal.expectedRevision} and world revision {proposal.expectedWorldRevision}. Expires {new Date(proposal.expiresAt).toLocaleTimeString()}.</p>{preview && (stale || expired) && <div className="notice error" role="status"><AlertCircle size={17} /><span>{expired ? 'This proposal expired.' : 'The saved configuration changed after this proposal was prepared.'} Request a new proposal using the current settings.</span></div>}</div><ChangeTable changes={proposal.changes} />{preview && <div className="proposal-actions"><button className="button primary" onClick={() => void decide(true)} disabled={!fresh || Boolean(busy) || stale || expired || !proposal.changes.length}><Check size={15} />{busy === 'accept' ? 'Accepting…' : 'Accept these changes'}</button><button className="button" onClick={() => void decide(false)} disabled={!fresh || Boolean(busy)}><X size={15} />Reject proposal</button><span>Acceptance saves both settings revisions. It does not discard existing portal drafts.</span></div>}</section>}
  </>;
}
