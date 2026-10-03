import { responseSource, errorMessage } from '../lib/api';
import React, { useState } from 'react';
import { 
  Flame, 
  ShieldAlert, 
  Handshake, 
  Skull, 
  Swords, 
  Globe2, 
  Sparkles, 
  ChevronRight, 
  AlertTriangle,
  Award,
  Zap,
  TrendingUp,
  Map
} from 'lucide-react';
import { DiplomaticStatus, EmergentWarfareEvent, Faction, FactionId } from '../types';

interface FactionWarfareProps {
  factions: Faction[];
  setFactions: React.Dispatch<React.SetStateAction<Faction[]>>;
  warfareHistory: EmergentWarfareEvent[];
  setWarfareHistory: React.Dispatch<React.SetStateAction<EmergentWarfareEvent[]>>;
  playerAllegiance: FactionId;
  setPlayerAllegiance: (f: FactionId) => void;
  addSimEvent: (event: string) => void;
}

export const FactionWarfare: React.FC<FactionWarfareProps> = ({
  factions,
  setFactions,
  warfareHistory,
  setWarfareHistory,
  playerAllegiance,
  setPlayerAllegiance,
  addSimEvent,
}) => {
  const [isSimulatingWarTick, setIsSimulatingWarTick] = useState<boolean>(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [lastSource, setLastSource] = useState('');
  const [selectedFactionId, setSelectedFactionId] = useState<FactionId>('Families');

  const selectedFaction = factions.find((f) => f.id === selectedFactionId) || factions[0];

  // Helper for diplomacy status styles
  const getDiplomacyBadge = (status: DiplomaticStatus) => {
    switch (status) {
      case 'WAR':
        return <span className="bg-rose-500/20 text-rose-400 border border-rose-500/40 px-2 py-0.5 rounded text-[10px] font-mono font-bold flex items-center"><Skull className="w-3 h-3 mr-1" /> AT WAR</span>;
      case 'HOSTILE':
        return <span className="bg-amber-500/20 text-amber-400 border border-amber-500/40 px-2 py-0.5 rounded text-[10px] font-mono font-bold flex items-center"><Swords className="w-3 h-3 mr-1" /> HOSTILE</span>;
      case 'TENSE_TRUCE':
        return <span className="bg-yellow-500/20 text-yellow-300 border border-yellow-500/40 px-2 py-0.5 rounded text-[10px] font-mono font-bold flex items-center"><Handshake className="w-3 h-3 mr-1" /> TRUCE</span>;
      case 'STRATEGIC_ALLIANCE':
        return <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 rounded text-[10px] font-mono font-bold flex items-center"><ShieldAlert className="w-3 h-3 mr-1" /> ALLIED</span>;
      default:
        return <span className="bg-slate-800 text-slate-400 px-2 py-0.5 rounded text-[10px] font-mono">NEUTRAL</span>;
    }
  };

  // Run Emergent Faction Warfare Cycle via Gemini
  const handleRunWarfareCycle = async () => {
    setIsSimulatingWarTick(true); setRequestError(null);
    try {
      const res = await fetch('/api/factions/warfare-tick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          factions: factions.map((f) => ({
            id: f.id,
            turf: f.turfPercent,
            strength: f.militaryStrength,
            leader: f.leader,
            diplomacy: f.diplomacy,
          })),
          recentEvents: warfareHistory.slice(0, 3),
          playerAllegiance,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `Request failed (${res.status})`);
      setLastSource(responseSource(data));
      if (data.success && data.warfareUpdate) {
        const update = data.warfareUpdate;
        const knownFaction = (id: unknown) => factions.some(faction => faction.id === id);
        const allowedStatuses = ['WAR', 'HOSTILE', 'TENSE_TRUCE', 'STRATEGIC_ALLIANCE', 'NEUTRAL'];
        if (update.diplomaticShift && (!knownFaction(update.diplomaticShift.initiatorFaction) || !knownFaction(update.diplomaticShift.targetFaction) || update.diplomaticShift.initiatorFaction === update.diplomaticShift.targetFaction || !allowedStatuses.includes(update.diplomaticShift.newStatus))) throw new Error('The faction response contained an invalid diplomatic change. No change was applied.');
        if (update.territoryClash && (!knownFaction(update.territoryClash.attackingFaction) || !knownFaction(update.territoryClash.defendingFaction) || update.territoryClash.attackingFaction === update.territoryClash.defendingFaction || !Number.isFinite(update.territoryClash.contestedPercent))) throw new Error('The faction response contained an invalid territory change. No change was applied.');

        // Apply diplomatic shift to factions state
        if (update.diplomaticShift) {
          const { initiatorFaction, targetFaction, newStatus } = update.diplomaticShift;
          setFactions((prev) =>
            prev.map((f) => {
              if (f.id === initiatorFaction) {
                return {
                  ...f,
                  diplomacy: { ...f.diplomacy, [targetFaction as FactionId]: newStatus as DiplomaticStatus },
                };
              }
              if (f.id === targetFaction) {
                return {
                  ...f,
                  diplomacy: { ...f.diplomacy, [initiatorFaction as FactionId]: newStatus as DiplomaticStatus },
                };
              }
              return f;
            })
          );
        }

        // Apply territory shift
        if (update.territoryClash) {
          const { attackingFaction, defendingFaction, contestedPercent } = update.territoryClash;
          setFactions(prev => {
            const attacker = prev.find(f => f.id === attackingFaction)!;
            const defender = prev.find(f => f.id === defendingFaction)!;
            const shift = Math.max(0, Math.min(4, Math.round(contestedPercent / 5), defender.turfPercent, 100 - attacker.turfPercent));
            return prev.map(f => f.id === attackingFaction ? { ...f, turfPercent: f.turfPercent + shift } : f.id === defendingFaction ? { ...f, turfPercent: f.turfPercent - shift } : f);
          });
        }

        // Record history event
        const newEvent: EmergentWarfareEvent = {
          id: `war_${Date.now()}`,
          eventHeadline: update.eventHeadline,
          diplomaticShift: update.diplomaticShift,
          territoryClash: update.territoryClash,
          worldAtmosphereNote: update.worldAtmosphereNote,
          timestamp: 'Just now',
        };

        setWarfareHistory((prev) => [newEvent, ...prev]);
        addSimEvent(`${responseSource(data)} — warfare cycle: ${update.eventHeadline}`);
      }
    } catch (err) {
      setRequestError(errorMessage(err));
    } finally {
      setIsSimulatingWarTick(false);
    }
  };

  // Stage a False-Flag Attack
  const handleStageFalseFlag = (attacker: FactionId, framed: FactionId) => {
    addSimEvent(`Player staged a false-flag strike wearing ${framed} colors against ${attacker} stash house!`);
    setFactions((prev) =>
      prev.map((f) => {
        if (f.id === attacker) {
          return {
            ...f,
            diplomacy: { ...f.diplomacy, [framed]: 'WAR' },
          };
        }
        if (f.id === framed) {
          return {
            ...f,
            diplomacy: { ...f.diplomacy, [attacker]: 'WAR' },
          };
        }
        return f;
      })
    );
    const event: EmergentWarfareEvent = {
      id: `ff_${Date.now()}`,
      eventHeadline: `${attacker} Declares Full War on ${framed} After Provocation`,
      timestamp: 'Just now',
      diplomaticShift: {
        initiatorFaction: attacker,
        targetFaction: framed,
        oldStatus: 'TENSE_TRUCE',
        newStatus: 'WAR',
        reason: 'Violent ambush on high-value stash house framed with rival insignia.',
      },
      territoryClash: {
        district: 'Border Zone',
        attackingFaction: attacker,
        defendingFaction: framed,
        contestedPercent: 25,
        flashpointDescription: 'Drive-by skirmishes erupted within minutes across neighborhood borders.',
      },
      worldAtmosphereNote: 'Heavily armed gang patrols roaming the streets; sirens and automatic gunfire frequent.',
    };
    setWarfareHistory((prev) => [event, ...prev]);
  };

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-6">
      {requestError && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-3 text-sm text-rose-300">{requestError}</p>}
      {lastSource && <p role="status" className="text-xs text-amber-300 font-mono">Response source: {lastSource}</p>}
      {/* Warfare Engine Banner */}
      <div className="bg-gradient-to-r from-amber-950/60 via-slate-900 to-rose-950/50 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <Flame className="w-5 h-5 text-amber-500 animate-pulse" />
            <h2 className="font-chakra font-bold text-lg text-white tracking-wider">
              EMERGENT FACTIONAL ALLEGIANCES & TERRITORIAL WARFARE
            </h2>
          </div>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">
            Los Santos factions form, break, and betray alliances based on shifting power balances, police pressure, and player intervention. 
            Territorial control shifts dynamically through street clashes.
          </p>
        </div>
        <button
          onClick={handleRunWarfareCycle}
          disabled={isSimulatingWarTick}
          className="px-5 py-2.5 bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-500 hover:to-rose-500 disabled:opacity-50 text-white font-chakra font-bold text-xs rounded-lg shadow-lg shadow-amber-600/20 flex items-center space-x-2 transition-transform active:scale-95"
        >
          <Sparkles className="w-4 h-4 animate-spin" />
          <span>{isSimulatingWarTick ? 'CALCULATING FACTION MOVES...' : 'ADVANCE WARFARE CYCLE (GEMINI LLM)'}</span>
        </button>
      </div>

      {/* Turf Control Bar Chart */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-chakra font-bold text-xs text-slate-300 tracking-wider flex items-center space-x-2">
            <Map className="w-4 h-4 text-emerald-400" />
            <span>LOS SANTOS TERRITORIAL TURF CONTROL</span>
          </h3>
          <span className="text-[10px] font-mono text-slate-400">Total City Coverage: 100%</span>
        </div>
        {/* Visual Stacked Progress Bar */}
        <div className="w-full h-4 bg-slate-950 rounded-lg overflow-hidden flex shadow-inner border border-slate-800">
          {factions.filter((f) => f.turfPercent > 0).map((f) => (
            <div
              key={f.id}
              style={{
                width: `${f.turfPercent}%`,
                backgroundColor: f.color,
              }}
              title={`${f.name}: ${f.turfPercent}%`}
              className="h-full relative group transition-all duration-500"
            ></div>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mt-3 text-xs font-mono">
          {factions.filter((f) => f.turfPercent > 0).map((f) => (
            <div key={f.id} className="flex items-center space-x-2 bg-slate-950/60 p-2 rounded border border-slate-800/80">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: f.color }}></span>
              <span className="text-white font-bold">{f.shortName}:</span>
              <span style={{ color: f.color }}>{f.turfPercent}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT: Living Diplomacy Matrix & Roster (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl">
            <h3 className="font-chakra font-bold text-slate-200 text-sm tracking-wider mb-3 flex items-center justify-between">
              <span>FACTION DOSSIER & ALLIANCE GRAPH</span>
              <span className="text-xs font-mono text-amber-400">Select faction to inspect</span>
            </h3>

            {/* Faction Selector Badges */}
            <div className="flex flex-wrap gap-2 mb-4">
              {factions.map((f) => {
                const isSelected = f.id === selectedFactionId;
                return (
                  <button
                    key={f.id}
                    onClick={() => setSelectedFactionId(f.id)}
                    style={{
                      borderColor: isSelected ? f.color : '#334155',
                      backgroundColor: isSelected ? `${f.color}22` : '#0f172a',
                    }}
                    className="px-3 py-1.5 rounded-lg border font-chakra font-bold text-xs text-white transition-all flex items-center space-x-1.5"
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: f.color }}></span>
                    <span>{f.shortName}</span>
                  </button>
                );
              })}
            </div>

            {/* Selected Faction Intel */}
            <div className="bg-slate-950/80 rounded-lg p-4 border border-slate-800 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-chakra font-bold text-white text-base">
                    {selectedFaction.name}
                  </h4>
                  <div className="text-xs text-slate-400 font-mono mt-0.5">
                    Leader: <span className="text-amber-300 font-semibold">{selectedFaction.leader}</span> • HQ: {selectedFaction.headquarters}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-400 font-mono">Military Power: {selectedFaction.militaryStrength}/100</div>
                  <div className="text-xs text-slate-400 font-mono">Treasury: {selectedFaction.wealth}/100</div>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                {selectedFaction.description}
              </p>

              <div className="text-xs font-mono text-slate-400 bg-slate-900/60 p-2.5 rounded border border-slate-800">
                <span className="text-amber-400 font-bold">Tactical Combat Doctrine:</span> {selectedFaction.tacticalStyle}
              </div>

              {/* Diplomatic Standing with Other Factions */}
              <div>
                <h5 className="font-chakra font-bold text-xs text-slate-300 mb-2 uppercase">
                  DIPLOMATIC STANDINGS TOWARD OTHER FACTIONS
                </h5>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
                  {Object.entries(selectedFaction.diplomacy).map(([targetId, status]) => {
                    if (targetId === selectedFaction.id) return null;
                    return (
                      <div key={targetId} className="flex items-center justify-between bg-slate-900/70 px-2.5 py-1.5 rounded border border-slate-800">
                        <span className="text-slate-300">{targetId}:</span>
                        {getDiplomacyBadge(status)}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Player Alignment & Diplomatic Interference */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl">
            <h3 className="font-chakra font-bold text-slate-200 text-sm tracking-wider mb-3 flex items-center space-x-2">
              <Award className="w-4 h-4 text-amber-400" />
              <span>PLAYER FACTION ALIGNMENT & INTERFERENCE</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-chakra text-slate-400 block mb-1">
                  CURRENT PLEDGED ALLEGIANCE:
                </label>
                <select
                  value={playerAllegiance}
                  onChange={(e) => {
                    const chosen = e.target.value as FactionId;
                    setPlayerAllegiance(chosen);
                    addSimEvent(`Player officially aligned with ${chosen}!`);
                  }}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs text-white font-chakra font-bold"
                >
                  {factions.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  Aligning with a faction grants safe passage, weapon discounts, and reinforcements, but turns rival factions permanently hostile.
                </p>
              </div>

              {/* Stage False-Flag Attack */}
              <div>
                <label className="text-xs font-chakra text-slate-400 block mb-1">
                  STAGE FALSE-FLAG GANG ATTACK:
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleStageFalseFlag('Families', 'Ballas')}
                    className="flex-1 py-2 px-2 bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 font-chakra font-bold text-xs rounded transition-all"
                  >
                    Ignite Families vs Ballas
                  </button>
                  <button
                    onClick={() => handleStageFalseFlag('Madrazo Cartel', 'Merryweather')}
                    className="flex-1 py-2 px-2 bg-purple-950/80 hover:bg-purple-900 border border-purple-800 text-purple-300 font-chakra font-bold text-xs rounded transition-all"
                  >
                    Ignite Cartel vs Mercs
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Disguised hit to spark total gang warfare between two factions.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: Emergent Warfare Event Feed (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl">
            <h3 className="font-chakra font-bold text-slate-200 text-sm tracking-wider mb-3 flex items-center space-x-2">
              <Flame className="w-4 h-4 text-rose-400" />
              <span>EMERGENT WARFARE DISPATCH & TREATY LOG</span>
            </h3>

            <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
              {warfareHistory.map((event) => (
                <div
                  key={event.id}
                  className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 space-y-2 hover:border-slate-700 transition-all"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-chakra font-bold text-white text-xs">
                      {event.eventHeadline}
                    </h4>
                    <span className="text-[9px] font-mono text-slate-500 whitespace-nowrap">
                      {event.timestamp}
                    </span>
                  </div>

                  {event.diplomaticShift && (
                    <div className="bg-slate-900/60 p-2 rounded text-[11px] font-mono text-amber-300 border border-slate-800/80">
                      <div className="font-bold flex items-center space-x-1">
                        <span>{event.diplomaticShift.initiatorFaction}</span>
                        <span className="text-slate-500">→</span>
                        <span>{event.diplomaticShift.targetFaction}</span>
                        <span className="text-rose-400">[{event.diplomaticShift.newStatus}]</span>
                      </div>
                      <div className="text-slate-400 text-[10px] mt-0.5">
                        Reason: {event.diplomaticShift.reason}
                      </div>
                    </div>
                  )}

                  {event.territoryClash && (
                    <div className="bg-slate-900/60 p-2 rounded text-[11px] font-mono text-slate-300 border border-slate-800/80">
                      <div className="text-rose-400 font-bold flex items-center space-x-1">
                        <Swords className="w-3 h-3 mr-1" />
                        <span>Clash in {event.territoryClash.district}</span>
                      </div>
                      <div className="text-slate-400 text-[10px] mt-0.5">
                        {event.territoryClash.flashpointDescription}
                      </div>
                    </div>
                  )}

                  <div className="text-[10px] text-slate-400 italic pt-1 border-t border-slate-800/60">
                    City Atmosphere: {event.worldAtmosphereNote}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
