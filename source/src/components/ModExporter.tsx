import React, { useState } from 'react';
import { FileCode2, Copy, Check, Download, Activity, ShieldCheck, RefreshCw } from 'lucide-react';
import { CompanionHealth } from '../lib/runtime';

interface ModExporterProps { health: CompanionHealth | null; healthError: string | null }

const companionConfig = JSON.stringify({
  format: 'llai-v2-companion-profile', version: '2.4.0-enhanced-adapter',
  scope: 'Dashboard simulation profile; not a LivingLSAIs.ini replacement',
  dashboardUrl: 'http://127.0.0.1:3000', gameClient: 'LivingLSAIsV2.Enhanced.dll', storyModeOnly: true,
  gameHotkeys: { dialogue: 'F7', tacticalPreview: 'F8' },
  dashboardHotkey: 'F6 (while this browser page has focus)',
  existingVoiceBridge: { host: '127.0.0.1', port: 8765, keepExistingFiles: true },
  simulation: { hearingRadiusMeters: 45, rainAcousticDampening: 0.45, fogOpticalReduction: 0.55, retreatMoraleThreshold: 35 },
  cloudSync: false,
}, null, 2);

const guide = `Living Los Santos AI v2 — GTA V Enhanced adapter

This dashboard provides a world simulator, NPC conversations, memory tools,
faction simulations, and an Enhanced game-client companion.

1. Start the local companion server at http://127.0.0.1:3000.
2. Launch GTA V Enhanced Story Mode.
3. Open the ScriptHookVDotNet console with F4 and enter:
   Start("LivingLSAIsV2.Enhanced.dll")
4. F7 starts text dialogue with a nearby real game pedestrian.
5. F8 runs bounded utility-rule tactics on nearby game pedestrians.
6. This page shows game-client telemetry when the client connects.

The original LivingLSAIs.dll uses the existing voice bridge on port 8765.
Keep its private LivingLSAIs.ini, bridge server.js, and API settings intact.
For original voice controls: E interacts, T enters text, hold Y speaks,
and Backspace ends the conversation. Avoid controlling the same pedestrian
with both scripts during a conversation.

F6 opens this dashboard's simulation settings when the browser has focus.
Those browser settings do not change the game's INI or world weather.
Faction maps and squad plans on the dashboard are simulations. F8 game-client
tactics use explicit utility rules; no trained machine-learning model is supplied.
The companion profile JSON is an export of reference defaults. It does not
install itself or replace game configuration files.

Gemini 'configured' means a server-side credential is present, not that a live
request has succeeded. Bridge 'reachable' indicates local socket availability.
In-game execution, audio playback and response latency require runtime testing.
Cloud services are disabled by default; browser NPC memories remain local.
`;

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: filename.endsWith('.json') ? 'application/json' : 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const ModExporter: React.FC<ModExporterProps> = ({ health, healthError }) => {
  const [activeFile, setActiveFile] = useState<'profile' | 'guide'>('guide');
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const activeContent = activeFile === 'profile' ? companionConfig : guide;
  const game = health?.gameRuntime;
  const copyToClipboard = async () => {
    try { await navigator.clipboard.writeText(activeContent); setCopiedFile(activeFile); setCopyError(null); }
    catch { setCopyError('Clipboard access is unavailable. Download the file or select its text below.'); }
  };
  return (
    <div className="max-w-7xl mx-auto p-4 space-y-6">
      <div className="bg-gradient-to-r from-purple-950/60 via-slate-900 to-indigo-950/50 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="font-chakra font-bold text-lg text-white tracking-wider flex items-center gap-2"><FileCode2 className="w-5 h-5 text-purple-400" /> GTA V ENHANCED COMPANION & GAME CLIENT</h2>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">Runtime status, safe companion exports, and startup instructions for the Enhanced adapter. The existing voice integration keeps its own settings and bridge.</p>
        </div>
        <button onClick={() => download(activeFile === 'profile' ? 'LLAI-V2-Companion.profile.json' : 'LLAI-V2-Enhanced-Startup.txt', activeContent)} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-chakra font-bold text-xs rounded-lg shadow-lg flex items-center gap-1.5"><Download className="w-4 h-4" /> DOWNLOAD {activeFile === 'profile' ? 'PROFILE' : 'GUIDE'}</button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            <div className="flex flex-wrap gap-2 items-center justify-between bg-slate-950 px-4 py-2.5 border-b border-slate-800">
              <div className="flex gap-1">{[{ id: 'guide', label: 'Enhanced startup guide' }, { id: 'profile', label: 'Companion profile JSON' }].map(file => <button key={file.id} onClick={() => { setActiveFile(file.id as 'profile' | 'guide'); setCopiedFile(null); }} className={`px-3 py-1.5 rounded font-mono text-xs font-bold ${activeFile === file.id ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40' : 'text-slate-400 hover:text-white'}`}>{file.label}</button>)}</div>
              <button onClick={copyToClipboard} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs rounded border border-slate-700 flex items-center gap-1.5">{copiedFile === activeFile ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}{copiedFile === activeFile ? 'COPIED' : 'COPY TEXT'}</button>
            </div>
            {copyError && <p role="alert" className="px-4 py-2 text-xs text-amber-300">{copyError}</p>}
            <pre className="p-4 bg-[#090d16] text-slate-300 font-mono text-xs leading-relaxed overflow-x-auto max-h-[550px] select-text"><code>{activeContent}</code></pre>
          </div>
          <div className="bg-purple-950/30 border border-purple-700/40 rounded-xl p-4 text-xs text-slate-300 leading-relaxed"><strong className="text-purple-300">Integration scope:</strong> F7 dialogue and F8 tactics act on game pedestrians through the new Enhanced DLL. Dashboard weather, faction turf, NPC blips and F6 settings affect the browser simulation. Browser memories are separate from the game client's memory store.</div>
        </div>
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl space-y-3">
            <h3 className="font-chakra font-bold text-slate-200 text-sm flex items-center gap-2"><Activity className="w-4 h-4 text-emerald-400" /> OBSERVED RUNTIME STATUS</h3>
            <div className="space-y-2 text-xs font-mono">{[
              ['Dashboard server', health ? 'Online · port 3000' : healthError || 'Checking…'],
              ['Gemini credential', health ? (health.geminiConfigured ? 'Configured on server' : 'Not configured · local simulation') : 'Unknown'],
              ['Text model', health?.model || 'Unknown'],
              ['Enhanced client', game?.connected ? 'Telemetry connected' : 'No recent game telemetry'],
              ['Game version', game?.gameVersion || 'Not reported'],
              ['Client version', game?.pluginVersion || 'Not reported'],
              ['Nearby game NPCs', game?.connected ? String(game.npcCount) : 'Not reported'],
              ['Last telemetry', game?.lastSeenAt ? new Date(game.lastSeenAt).toLocaleTimeString() : 'Not received'],
              ['Original voice bridge', health ? `${health.bridge.reachable ? 'Reachable' : 'Not running'} · port ${health.bridge.port}` : 'Unknown'],
              ['Bridge provider', health?.bridge.provider || 'Not reported'],
            ].map(([label, value]) => <div key={label} className="flex justify-between gap-3 bg-slate-950/70 p-2 rounded border border-slate-800"><span className="text-slate-400">{label}:</span><span className="text-slate-200 text-right break-words">{value}</span></div>)}</div>
            <p className="text-[10px] text-slate-500 font-mono flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Refreshes every 5 seconds. Latency has not been measured.</p>
          </div>
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl space-y-3">
            <h3 className="font-chakra font-bold text-slate-200 text-sm flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-400" /> ENHANCED STORY MODE STARTUP</h3>
            <ol className="list-decimal list-inside space-y-2 text-xs text-slate-300 leading-relaxed font-mono">
              <li>Start the local companion server on <strong>127.0.0.1:3000</strong>.</li>
              <li>Launch GTA V Enhanced Story Mode.</li>
              <li>Open the <strong>F4</strong> console and enter <code className="text-emerald-300 break-all">Start("LivingLSAIsV2.Enhanced.dll")</code>.</li>
              <li>Use <strong className="text-cyan-300">F7</strong> for text dialogue and <strong className="text-amber-300">F8</strong> for nearby utility tactics.</li>
              <li>Check telemetry above. The original voice DLL retains <strong>E / T / hold Y / Backspace</strong>.</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
};
