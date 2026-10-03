import React, { useState } from 'react';
import { 
  Database, 
  Skull, 
  ShieldAlert, 
  HeartHandshake, 
  Calendar, 
  AlertTriangle, 
  PlusCircle, 
  RotateCcw, 
  Download, 
  Trash2, 
  Sparkles,
  Award,
  Clock,
  CheckCircle2,
  Quote
} from 'lucide-react';
import { LongTermMemory, MemoryIncident, NPCEntity } from '../types';

interface LongTermMemoryStoreProps {
  npcs: NPCEntity[];
  setNpcs: React.Dispatch<React.SetStateAction<NPCEntity[]>>;
  onOpenDialogue: (npc: NPCEntity) => void;
  addSimEvent: (msg: string) => void;
}

export const LongTermMemoryStore: React.FC<LongTermMemoryStoreProps> = ({
  npcs,
  setNpcs,
  onOpenDialogue,
  addSimEvent,
}) => {
  const [selectedNpcId, setSelectedNpcId] = useState<string>(npcs[0]?.id || '');
  const [isAddingIncident, setIsAddingIncident] = useState<boolean>(false);

  // New incident form state
  const [newIncidentType, setNewIncidentType] = useState<MemoryIncident['incidentType']>('SAVED_LIFE');
  const [newSeverity, setNewSeverity] = useState<MemoryIncident['severity']>('SEVERE');
  const [newSummary, setNewSummary] = useState<string>('');
  const [newQuote, setNewQuote] = useState<string>('');

  const selectedNpc = npcs.find((n) => n.id === selectedNpcId) || npcs[0];
  const memory = selectedNpc.longTermMemory;

  // Add a new discrete incident to long-term memory
  const handleAddIncident = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSummary.trim()) return;

    const isPositive = ['SAVED_LIFE', 'HONORED_CONTRACT', 'FRIENDLY_DEAL', 'BRIBE_ACCEPTED'].includes(newIncidentType);

    const incident: MemoryIncident = {
      id: `inc_${Date.now()}`,
      timestamp: new Date().toISOString().split('T')[0],
      district: selectedNpc.district,
      incidentType: newIncidentType,
      severity: newSeverity,
      summary: newSummary,
      directQuote: newQuote || undefined,
      impactOnRespect: isPositive ? 35 : -40,
      impactOnFear: newIncidentType === 'HELD_AT_GUNPOINT' ? 45 : 0,
    };

    const updatedNpc: NPCEntity = {
      ...selectedNpc,
      longTermMemory: {
        npcId: selectedNpc.id,
        incidents: [incident, ...(memory?.incidents || [])],
        grudge: !isPositive ? {
          active: true,
          reason: newSummary,
          severity: newSeverity === 'UNFORGIVABLE' ? 'BLOOD_FEUD' : 'VENGEFUL',
          willAttackOnSight: newSeverity === 'UNFORGIVABLE',
        } : (memory?.grudge || { active: false, reason: '', severity: 'NONE', willAttackOnSight: false }),
        alliance: isPositive ? {
          active: true,
          reason: newSummary,
          level: newSeverity === 'SEVERE' ? 'RIDE_OR_DIE' : 'TRUSTED_ASSOCIATE',
          willProvideBackup: true,
        } : (memory?.alliance || { active: false, reason: '', level: 'NONE', willProvideBackup: false }),
        lastEncounterDate: new Date().toISOString(),
        totalEncounters: (memory?.totalEncounters || 0) + 1,
      },
      opinionOfPlayer: {
        ...selectedNpc.opinionOfPlayer,
        respect: Math.max(-100, Math.min(100, selectedNpc.opinionOfPlayer.respect + (isPositive ? 35 : -40))),
      }
    };

    setNpcs((prev) => prev.map((n) => (n.id === selectedNpc.id ? updatedNpc : n)));
    addSimEvent(`Recorded persistent memory for ${selectedNpc.name}: [${newIncidentType}]`);
    setNewSummary('');
    setNewQuote('');
    setIsAddingIncident(false);

    // Sync to backend persistent store
    fetch('/api/memory/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        npcId: selectedNpc.id,
        incident,
        grudge: updatedNpc.longTermMemory?.grudge,
        alliance: updatedNpc.longTermMemory?.alliance,
      }),
    }).catch(console.error);
  };

  // Toggle Grudge state
  const handleToggleGrudge = (severity: 'NONE' | 'MILD' | 'VENGEFUL' | 'BLOOD_FEUD') => {
    const isGrudgeActive = severity !== 'NONE';
    const updatedNpc: NPCEntity = {
      ...selectedNpc,
      longTermMemory: {
        ...(memory || {
          npcId: selectedNpc.id,
          incidents: [],
          alliance: { active: false, reason: '', level: 'NONE', willProvideBackup: false },
          lastEncounterDate: new Date().toISOString(),
          totalEncounters: 1,
        }),
        grudge: {
          active: isGrudgeActive,
          reason: isGrudgeActive ? 'Player executed a crew member in cold blood' : '',
          severity,
          willAttackOnSight: severity === 'BLOOD_FEUD',
        },
      },
      alertness: severity === 'BLOOD_FEUD' ? 'COMBAT' : selectedNpc.alertness,
    };

    setNpcs((prev) => prev.map((n) => (n.id === selectedNpc.id ? updatedNpc : n)));
    addSimEvent(`${selectedNpc.name} grudge status updated to [${severity}]`);
  };

  // Toggle Alliance state
  const handleToggleAlliance = (level: 'NONE' | 'CASUAL_FRIEND' | 'TRUSTED_ASSOCIATE' | 'RIDE_OR_DIE') => {
    const isAllianceActive = level !== 'NONE';
    const updatedNpc: NPCEntity = {
      ...selectedNpc,
      longTermMemory: {
        ...(memory || {
          npcId: selectedNpc.id,
          incidents: [],
          grudge: { active: false, reason: '', severity: 'NONE', willAttackOnSight: false },
          lastEncounterDate: new Date().toISOString(),
          totalEncounters: 1,
        }),
        alliance: {
          active: isAllianceActive,
          reason: isAllianceActive ? 'Player saved life during a deadly 4-star NOOSE ambush' : '',
          level,
          willProvideBackup: level === 'RIDE_OR_DIE',
        },
      },
    };

    setNpcs((prev) => prev.map((n) => (n.id === selectedNpc.id ? updatedNpc : n)));
    addSimEvent(`${selectedNpc.name} alliance status updated to [${level}]`);
  };

  // Reset / Amnesia Protocol
  const handleWipeMemory = () => {
    const updatedNpc: NPCEntity = {
      ...selectedNpc,
      longTermMemory: {
        npcId: selectedNpc.id,
        incidents: [],
        grudge: { active: false, reason: '', severity: 'NONE', willAttackOnSight: false },
        alliance: { active: false, reason: '', level: 'NONE', willProvideBackup: false },
        lastEncounterDate: new Date().toISOString(),
        totalEncounters: 0,
      },
      opinionOfPlayer: {
        respect: 0,
        fear: 10,
        trust: 0,
        label: 'Clean Slate / Stranger',
      },
    };

    setNpcs((prev) => prev.map((n) => (n.id === selectedNpc.id ? updatedNpc : n)));
    addSimEvent(`Amnesia Protocol executed: Wiped memory for ${selectedNpc.name}`);
  };

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-6">
      {/* Banner */}
      <div className="bg-gradient-to-r from-emerald-950/60 via-slate-900 to-indigo-950/50 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <Database className="w-5 h-5 text-emerald-400" />
            <h2 className="font-chakra font-bold text-lg text-white tracking-wider">
              NPC LONG-TERM MEMORY STORE & GRUDGE VAULT
            </h2>
          </div>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">
            In v2, player deeds persist across game sessions and restarts. NPCs hold generational grudges 
            (refusing service or opening fire on sight) or honor sworn alliances (providing suppressive fire and safehouses).
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsAddingIncident(true)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-chakra font-bold text-xs rounded-lg shadow-lg shadow-emerald-600/20 flex items-center space-x-1.5 transition-transform active:scale-95"
          >
            <PlusCircle className="w-4 h-4" />
            <span>RECORD ENCOUNTER INCIDENT</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT: NPC Memory Dossier Selector & Status (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl">
            <h3 className="font-chakra font-bold text-slate-200 text-sm tracking-wider mb-3 flex items-center justify-between">
              <span>SELECT NPC MEMORY ARCHIVE</span>
              <span className="text-xs font-mono text-emerald-400">Total: {npcs.length} Records</span>
            </h3>

            {/* NPC List */}
            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {npcs.map((npc) => {
                const isSelected = npc.id === selectedNpcId;
                const hasGrudge = npc.longTermMemory?.grudge?.active;
                const hasAlliance = npc.longTermMemory?.alliance?.active;

                return (
                  <button
                    key={npc.id}
                    onClick={() => setSelectedNpcId(npc.id)}
                    className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between ${
                      isSelected
                        ? 'bg-slate-800/90 border-emerald-500 shadow-md'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="font-chakra font-bold text-white text-xs flex items-center space-x-2">
                        <span>{npc.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono">({npc.faction})</span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                        {npc.longTermMemory?.incidents?.length || 0} Incident(s) Recorded
                      </div>
                    </div>

                    <div className="flex items-center space-x-1">
                      {hasGrudge && (
                        <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/40 text-[9px] font-mono font-bold flex items-center">
                          <Skull className="w-3 h-3 mr-1" /> GRUDGE
                        </span>
                      )}
                      {hasAlliance && (
                        <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[9px] font-mono font-bold flex items-center">
                          <ShieldAlert className="w-3 h-3 mr-1" /> ALLY
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick Grudge & Alliance Control Panel */}
          {selectedNpc && (
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl space-y-3">
              <h4 className="font-chakra font-bold text-slate-200 text-xs tracking-wider uppercase">
                MODIFY PERSISTENT RELATIONSHIP WITH {selectedNpc.name}
              </h4>

              <div>
                <label className="text-[10px] font-mono text-slate-400 block mb-1">
                  SET GRUDGE STATUS:
                </label>
                <div className="grid grid-cols-4 gap-1.5 font-mono text-[10px]">
                  {(['NONE', 'MILD', 'VENGEFUL', 'BLOOD_FEUD'] as const).map((sev) => (
                    <button
                      key={sev}
                      onClick={() => handleToggleGrudge(sev)}
                      className={`py-1.5 px-1 rounded border text-center font-bold ${
                        memory?.grudge?.severity === sev
                          ? 'bg-rose-500 border-rose-400 text-black'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {sev}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-mono text-slate-400 block mb-1">
                  SET ALLIANCE STATUS:
                </label>
                <div className="grid grid-cols-4 gap-1.5 font-mono text-[10px]">
                  {(['NONE', 'CASUAL_FRIEND', 'TRUSTED_ASSOCIATE', 'RIDE_OR_DIE'] as const).map((lvl) => (
                    <button
                      key={lvl}
                      onClick={() => handleToggleAlliance(lvl)}
                      className={`py-1.5 px-1 rounded border text-center font-bold ${
                        memory?.alliance?.level === lvl
                          ? 'bg-emerald-500 border-emerald-400 text-black'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {lvl === 'RIDE_OR_DIE' ? 'RIDE OR DIE' : lvl.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800 flex justify-between">
                <button
                  onClick={handleWipeMemory}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-rose-400 font-mono text-[11px] rounded border border-slate-700 flex items-center space-x-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>WIPE MEMORY (AMNESIA)</span>
                </button>

                <button
                  onClick={() => onOpenDialogue(selectedNpc)}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-chakra font-bold text-xs rounded shadow flex items-center space-x-1"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>TEST DIALOGUE</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: Memory Timeline & Incident History (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl">
            {/* Header with Grudge / Alliance summary */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-3 mb-4">
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="font-chakra font-bold text-white text-base">
                    {selectedNpc.name}
                  </h3>
                  <span className="text-slate-400 font-mono text-xs">
                    (Total Encounters: {memory?.totalEncounters || 0})
                  </span>
                </div>
                <div className="text-xs text-slate-400 font-mono mt-0.5">
                  Last Encounter: {memory?.lastEncounterDate ? new Date(memory.lastEncounterDate).toLocaleDateString() : 'Never'}
                </div>
              </div>

              {/* Status Badges */}
              <div className="flex flex-col items-end space-y-1">
                {memory?.grudge?.active ? (
                  <div className="px-2.5 py-1 rounded bg-rose-500/20 text-rose-300 border border-rose-500/50 font-mono text-xs font-bold flex items-center">
                    <Skull className="w-3.5 h-3.5 mr-1 text-rose-400" />
                    <span>GRUDGE: {memory.grudge.severity}</span>
                  </div>
                ) : (
                  <div className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-[10px]">
                    No Active Grudge
                  </div>
                )}

                {memory?.alliance?.active ? (
                  <div className="px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 font-mono text-xs font-bold flex items-center">
                    <ShieldAlert className="w-3.5 h-3.5 mr-1 text-emerald-400" />
                    <span>ALLIANCE: {memory.alliance.level}</span>
                  </div>
                ) : (
                  <div className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-[10px]">
                    No Active Alliance
                  </div>
                )}
              </div>
            </div>

            {/* Incident Timeline */}
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
              {memory?.incidents && memory.incidents.length > 0 ? (
                memory.incidents.map((inc) => (
                  <div
                    key={inc.id}
                    className="bg-slate-950/80 border border-slate-800 rounded-lg p-3.5 space-y-2 hover:border-slate-700 transition-all"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-amber-300 font-mono text-[10px] font-bold">
                          {inc.incidentType.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          Severity: {inc.severity}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {inc.timestamp} in {inc.district}
                      </span>
                    </div>

                    <p className="text-xs text-slate-200 font-mono leading-relaxed">
                      {inc.summary}
                    </p>

                    {inc.directQuote && (
                      <div className="bg-slate-900/60 p-2 rounded border border-slate-800 text-slate-400 font-mono text-[11px] italic flex items-start space-x-1.5">
                        <Quote className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                        <span>"{inc.directQuote}"</span>
                      </div>
                    )}

                    <div className="text-[10px] font-mono text-slate-400 flex items-center space-x-3 pt-1 border-t border-slate-800/80">
                      <span>Respect Impact: <strong className={inc.impactOnRespect >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {inc.impactOnRespect > 0 ? `+${inc.impactOnRespect}` : inc.impactOnRespect}
                      </strong></span>
                      {inc.impactOnFear > 0 && (
                        <span>Fear Impact: <strong className="text-amber-400">+{inc.impactOnFear}</strong></span>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="bg-slate-950/60 p-8 rounded-lg border border-slate-800 text-center text-slate-500 font-chakra text-xs">
                  No discrete encounters recorded yet for {selectedNpc.name}. 
                  Click "RECORD ENCOUNTER INCIDENT" or engage in dialogue to form memories.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add Encounter Modal */}
      {isAddingIncident && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div 
            className="w-full max-w-lg bg-[#0c121e] border-2 border-emerald-500/80 rounded-xl p-6 shadow-2xl space-y-4 font-mono text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-chakra font-bold text-white text-base">
                RECORD NEW LONG-TERM MEMORY INCIDENT
              </h3>
              <button
                onClick={() => setIsAddingIncident(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddIncident} className="space-y-3">
              <div>
                <label className="text-slate-400 block mb-1">INCIDENT TYPE:</label>
                <select
                  value={newIncidentType}
                  onChange={(e) => setNewIncidentType(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                >
                  <option value="SAVED_LIFE">SAVED LIFE (Heroic rescue in shootout)</option>
                  <option value="HONORED_CONTRACT">HONORED CONTRACT (Delivered cargo without theft)</option>
                  <option value="BRIBE_ACCEPTED">BRIBE ACCEPTED (Accepted cash for discretion)</option>
                  <option value="BETRAYAL_WITNESSED">BETRAYAL WITNESSED (Ratted to LSPD or rival gang)</option>
                  <option value="HELD_AT_GUNPOINT">HELD AT GUNPOINT (Armed mugging or extortion)</option>
                  <option value="GANG_WAR_CASUALTY">GANG WAR CASUALTY (Killed crew/family members)</option>
                  <option value="DISRESPECT_ON_TURF">DISRESPECT ON TURF (Flashing rival colors/insults)</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">SEVERITY LEVEL:</label>
                <select
                  value={newSeverity}
                  onChange={(e) => setNewSeverity(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                >
                  <option value="TRIVIAL">TRIVIAL (Passing incident)</option>
                  <option value="NOTABLE">NOTABLE (Remembered for weeks)</option>
                  <option value="SEVERE">SEVERE (Alters life and standing)</option>
                  <option value="UNFORGIVABLE">UNFORGIVABLE (Blood feud / sworn brotherhood)</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">INCIDENT SUMMARY:</label>
                <textarea
                  value={newSummary}
                  onChange={(e) => setNewSummary(e.target.value)}
                  placeholder="e.g. Player provided suppression cover while Darnell reloaded, taking out three Ballas..."
                  rows={3}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">NPC DIRECT QUOTE (OPTIONAL):</label>
                <input
                  type="text"
                  value={newQuote}
                  onChange={(e) => setNewQuote(e.target.value)}
                  placeholder="e.g. 'I will never forget what you did on Forum Drive tonight.'"
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddingIncident(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-chakra font-bold rounded"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-chakra font-bold rounded shadow-lg shadow-emerald-600/30"
                >
                  COMMIT TO MEMORY STORE
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
