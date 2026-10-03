import React, { useState, useEffect } from 'react';
import { 
  Crosshair, 
  Eye, 
  MessageSquare, 
  Volume2, 
  ShieldAlert, 
  AlertTriangle, 
  Navigation as NavIcon, 
  Sparkles, 
  Flame, 
  DollarSign,
  Heart,
  Skull,
  Radio,
  Zap
} from 'lucide-react';
import { DistrictInfo, Faction, NPCEntity } from '../types';
import { NPCBodyLanguageVisualizer, getNPCBodyLanguage } from './NPCBodyLanguageVisualizer';

interface WorldSimulatorProps {
  npcs: NPCEntity[];
  setNpcs: React.Dispatch<React.SetStateAction<NPCEntity[]>>;
  factions: Faction[];
  districts: DistrictInfo[];
  weather: string;
  timeOfDay: string;
  wantedLevel: number;
  isArmed: boolean;
  onSelectNpcForDialogue: (npc: NPCEntity) => void;
  onTriggerGunshot: (x: number, y: number) => void;
  playerPos: { x: number; y: number };
  setPlayerPos: (pos: { x: number; y: number }) => void;
  recentSimEvents: string[];
  addSimEvent: (event: string) => void;
}

export const WorldSimulator: React.FC<WorldSimulatorProps> = ({
  npcs,
  setNpcs,
  factions,
  districts,
  weather,
  timeOfDay,
  wantedLevel,
  isArmed,
  onSelectNpcForDialogue,
  onTriggerGunshot,
  playerPos,
  setPlayerPos,
  recentSimEvents,
  addSimEvent,
}) => {
  const [selectedNpcId, setSelectedNpcId] = useState<string>(npcs[0]?.id || '');
  const [acousticPulses, setAcousticPulses] = useState<{ id: string; x: number; y: number; radius: number }[]>([]);
  const [isSimRunning, setIsSimRunning] = useState<boolean>(true);

  const selectedNpc = npcs.find((n) => n.id === selectedNpcId) || npcs[0];

  // Helper to get faction color
  const getFactionColor = (factionId: string) => {
    const f = factions.find((item) => item.id === factionId);
    return f?.color || '#94a3b8';
  };

  // Acoustic gunshot simulation
  const handleMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
    setPlayerPos({ x, y });
    addSimEvent(`Player repositioned to [${x}, ${y}]`);
  };

  const handleShootWarning = () => {
    const pulseId = 'pulse_' + Date.now();
    setAcousticPulses((prev) => [...prev, { id: pulseId, x: playerPos.x, y: playerPos.y, radius: 25 }]);
    onTriggerGunshot(playerPos.x, playerPos.y);

    // Weather attenuation check: Rain dampens sound distance
    const hearingRange = weather === 'Rain' || weather === 'Thunderstorm' ? 22 : 36;

    // Trigger NPC panic / alert based on proximity and personality matrix
    setNpcs((prev) =>
      prev.map((npc) => {
        const dist = Math.hypot(npc.x - playerPos.x, npc.y - playerPos.y);
        if (dist <= hearingRange) {
          const isCowardly = npc.personality.bravery < 40;
          const isAggressive = npc.personality.aggression > 65;
          const isCopOrMerc = npc.faction === 'LSPD' || npc.faction === 'Merryweather';

          let nextAction = npc.currentAction;
          let nextAlertness = npc.alertness;
          let nextFear = npc.fear;

          if (isCopOrMerc) {
            nextAction = 'Raising weapon, scanning for shooter position';
            nextAlertness = 'COMBAT';
            nextFear = Math.max(0, npc.fear - 5);
          } else if (isCowardly) {
            nextAction = 'Diving behind nearest concrete barrier in sheer terror!';
            nextAlertness = 'PANICKED';
            nextFear = Math.min(100, npc.fear + 45);
          } else if (isAggressive) {
            nextAction = 'Cocked weapon, shouting obscenities towards gunshot vector';
            nextAlertness = 'COMBAT';
            nextFear = Math.min(100, npc.fear + 10);
          } else {
            nextAction = 'Crouching low and fleeing into side alley';
            nextAlertness = 'SUSPICIOUS';
            nextFear = Math.min(100, npc.fear + 25);
          }

          return {
            ...npc,
            currentAction: nextAction,
            alertness: nextAlertness,
            fear: nextFear,
            hasWeaponDrawn: npc.weapon !== 'Unarmed' && (isAggressive || isCopOrMerc),
          };
        }
        return npc;
      })
    );

    setTimeout(() => {
      setAcousticPulses((prev) => prev.filter((p) => p.id !== pulseId));
    }, 2000);
  };

  // Spontaneous NPC Life simulation loop (every 3.5s)
  useEffect(() => {
    if (!isSimRunning) return;

    const interval = setInterval(() => {
      setNpcs((prev) =>
        prev.map((npc) => {
          // Weather reaction: seek shelter or complain if heavy rain
          if ((weather === 'Rain' || weather === 'Thunderstorm') && Math.random() < 0.25) {
            if (npc.personality.caution > 60) {
              return {
                ...npc,
                currentAction: 'Huddling under awning away from downpour',
                spontaneousQuirk: 'Pulls jacket hood tight and shakes rain droplets',
              };
            }
          }

          // Random slight wandering if not in combat
          if (npc.alertness === 'CALM' && Math.random() < 0.4) {
            const dx = (Math.random() - 0.5) * 3;
            const dy = (Math.random() - 0.5) * 3;
            const newX = Math.max(5, Math.min(95, npc.x + dx));
            const newY = Math.max(5, Math.min(95, npc.y + dy));
            return {
              ...npc,
              x: Number(newX.toFixed(1)),
              y: Number(newY.toFixed(1)),
            };
          }

          // Check if player is armed and within sight cone
          const distToPlayer = Math.hypot(npc.x - playerPos.x, npc.y - playerPos.y);
          const sightRadius = weather === 'Fog' ? 14 : 26;

          if (distToPlayer < sightRadius && isArmed && npc.alertness !== 'COMBAT' && npc.alertness !== 'PANICKED') {
            if (npc.personality.bravery < 40) {
              return {
                ...npc,
                alertness: 'PANICKED',
                fear: Math.min(100, npc.fear + 30),
                currentAction: 'Backing away with trembling hands raised',
                spontaneousQuirk: 'Eyes fixed on player firearm',
              };
            } else if (npc.personality.aggression > 60) {
              return {
                ...npc,
                alertness: 'COMBAT',
                hasWeaponDrawn: true,
                currentAction: 'Square-facing player, hand gripping holster',
                spontaneousQuirk: 'Hisses warning: "Drop that piece or get smoked!"',
              };
            }
          }

          return npc;
        })
      );
    }, 3500);

    return () => clearInterval(interval);
  }, [isSimRunning, weather, playerPos, isArmed]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 p-4 max-w-7xl mx-auto">
      {/* LEFT / CENTER: Interactive Map & Simulation Canvas (8 Cols) */}
      <div className="lg:col-span-8 flex flex-col space-y-4">
        {/* Map Header HUD */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 flex items-center justify-between shadow-lg">
          <div className="flex items-center space-x-3">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></div>
            <div>
              <h2 className="font-chakra font-bold text-slate-100 text-sm tracking-wider uppercase">
                LOS SANTOS TACTICAL OVERWATCH MATRIX
              </h2>
              <p className="text-[11px] text-slate-400">
                Click map to move Player. Click NPC blips to inspect personality matrix and initiate neural dialogue.
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsSimRunning(!isSimRunning)}
              className={`px-2.5 py-1 text-xs font-chakra font-bold rounded border ${
                isSimRunning
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                  : 'bg-amber-500/20 border-amber-500 text-amber-300'
              }`}
            >
              {isSimRunning ? 'SIMULATION: ACTIVE' : 'SIMULATION: PAUSED'}
            </button>
            <button
              onClick={handleShootWarning}
              className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white font-chakra font-bold text-xs rounded shadow-lg shadow-rose-600/30 flex items-center space-x-1.5 transition-transform active:scale-95"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>TEST GUNSHOT (ACOUSTIC)</span>
            </button>
          </div>
        </div>

        {/* 2D Interactive Tactical Map Canvas */}
        <div 
          onClick={handleMapClick}
          className="relative w-full h-[540px] bg-[#0c121e] rounded-xl border border-slate-800 shadow-2xl overflow-hidden cursor-crosshair select-none group"
        >
          {/* Subtle Grid Lines */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#162032_1px,transparent_1px),linear-gradient(to_bottom,#162032_1px,transparent_1px)] bg-[size:40px_40px] opacity-40"></div>

          {/* Weather Visual Overlays */}
          {weather === 'Rain' && (
            <div className="absolute inset-0 pointer-events-none bg-blue-950/15 animate-pulse">
              <div className="absolute inset-0 opacity-40 bg-[radial-gradient(#38bdf8_1px,transparent_1px)] [background-size:16px_16px]"></div>
            </div>
          )}
          {weather === 'Thunderstorm' && (
            <div className="absolute inset-0 pointer-events-none bg-indigo-950/25">
              <div className="w-full h-full animate-ping opacity-10 bg-white"></div>
            </div>
          )}
          {weather === 'Fog' && (
            <div className="absolute inset-0 pointer-events-none bg-slate-400/20 backdrop-blur-[2px]"></div>
          )}
          {timeOfDay === 'Midnight' && (
            <div className="absolute inset-0 pointer-events-none bg-black/40"></div>
          )}

          {/* District Boundary Blocks */}
          {districts.map((d) => (
            <div
              key={d.id}
              style={{
                left: `${d.x}%`,
                top: `${d.y}%`,
                width: `${d.width}%`,
                height: `${d.height}%`,
                borderColor: `${getFactionColor(d.dominantFaction)}44`,
              }}
              className="absolute border border-dashed rounded-lg p-2 pointer-events-none flex flex-col justify-between bg-slate-900/10"
            >
              <div className="flex items-center justify-between text-[10px] font-chakra font-bold">
                <span style={{ color: getFactionColor(d.dominantFaction) }}>
                  {d.name.toUpperCase()}
                </span>
                <span className="text-slate-500 font-mono">{d.dominantFaction}</span>
              </div>
              <div className="text-[9px] font-mono text-slate-500 text-right">
                Contested: {d.contestedPercent}%
              </div>
            </div>
          ))}

          {/* Acoustic Sound Waves (when gunshots are fired) */}
          {acousticPulses.map((pulse) => (
            <div
              key={pulse.id}
              style={{
                left: `${pulse.x}%`,
                top: `${pulse.y}%`,
              }}
              className="absolute w-44 h-44 -ml-22 -mt-22 rounded-full border-2 border-rose-500 bg-rose-500/10 animate-ping pointer-events-none"
            ></div>
          ))}

          {/* Player Node */}
          <div
            style={{
              left: `${playerPos.x}%`,
              top: `${playerPos.y}%`,
            }}
            className="absolute transform -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none"
          >
            {/* Visual Awareness Cone */}
            <div className="w-24 h-24 -ml-12 -mt-12 rounded-full border border-emerald-400/30 bg-emerald-400/5 animate-pulse"></div>
            <div className="w-6 h-6 rounded-full bg-emerald-400 border-2 border-white shadow-[0_0_15px_rgba(52,211,153,0.8)] flex items-center justify-center font-bold text-[10px] text-black">
              P
            </div>
            <div className="absolute top-7 left-1/2 transform -translate-x-1/2 whitespace-nowrap bg-black/85 text-emerald-400 font-mono text-[9px] px-1.5 py-0.5 rounded border border-emerald-500/50 shadow">
              PLAYER {isArmed ? '⚠️ ARMED' : 'HOLSTERED'}
            </div>
          </div>

          {/* NPC Nodes on Map */}
          {npcs.map((npc) => {
            const isSelected = npc.id === selectedNpcId;
            const factionColor = getFactionColor(npc.faction);
            const bodyLang = getNPCBodyLanguage(npc);

            return (
              <div
                key={npc.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedNpcId(npc.id);
                  addSimEvent(`Targeted ${npc.name} (${npc.faction})`);
                }}
                style={{
                  left: `${npc.x}%`,
                  top: `${npc.y}%`,
                }}
                className={`absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer z-20 transition-transform duration-300 hover:scale-125 ${
                  isSelected ? 'scale-125 z-40' : ''
                }`}
              >
                {/* Optical Perception Cone */}
                <div 
                  style={{
                    borderColor: `${factionColor}33`,
                    backgroundColor: `${factionColor}0a`
                  }}
                  className="w-16 h-16 -ml-8 -mt-8 rounded-full border border-dotted pointer-events-none"
                ></div>

                {/* Emotional State Indicator Emoji Pin */}
                <div className="absolute -top-3.5 left-1/2 transform -translate-x-1/2 text-xs select-none filter drop-shadow">
                  {bodyLang.icon}
                </div>

                {/* NPC Icon Blip */}
                <div
                  style={{
                    backgroundColor: factionColor,
                    boxShadow: isSelected ? `0 0 16px ${factionColor}` : 'none'
                  }}
                  className={`w-5 h-5 rounded-full border-2 border-slate-900 flex items-center justify-center text-[9px] font-black text-slate-950 font-chakra ${
                    npc.alertness === 'COMBAT' ? 'animate-bounce' : ''
                  }`}
                >
                  {npc.name.charAt(0)}
                </div>

                {/* Status Badge */}
                <div className="absolute top-6 left-1/2 transform -translate-x-1/2 whitespace-nowrap bg-slate-950/90 text-white font-mono text-[9px] px-1.5 py-0.5 rounded border border-slate-800 shadow flex items-center space-x-1 pointer-events-none">
                  {npc.longTermMemory?.grudge?.active && (
                    <span className="text-rose-400 font-bold" title="Holds Grudge!">💀</span>
                  )}
                  {npc.longTermMemory?.alliance?.active && (
                    <span className="text-emerald-400 font-bold" title="Sworn Ally!">🛡️</span>
                  )}
                  <span style={{ color: factionColor }} className="font-bold">
                    {npc.alias || npc.name.split(' ')[0]}
                  </span>
                  {npc.hasWeaponDrawn && <span className="text-rose-400">🔫</span>}
                  <span className={`text-[8px] px-1 rounded ${
                    npc.alertness === 'COMBAT' ? 'bg-rose-500/20 text-rose-300 font-bold' :
                    npc.alertness === 'PANICKED' ? 'bg-amber-500/20 text-amber-300' :
                    'text-slate-400'
                  }`}>
                    {bodyLang.state}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Map Compass HUD */}
          <div className="absolute top-3 right-3 bg-slate-900/80 border border-slate-800 rounded p-2 text-slate-400 font-mono text-[10px] pointer-events-none flex flex-col items-center">
            <span className="text-emerald-400 font-bold">N</span>
            <div className="w-4 h-4 border-t-2 border-emerald-400 rotate-45 mt-0.5"></div>
            <span>LOS SANTOS</span>
          </div>

          {/* Quick Teleport Hotspots */}
          <div className="absolute bottom-3 left-3 flex flex-wrap gap-1.5 pointer-events-auto">
            <span className="text-[10px] font-mono text-slate-400 self-center mr-1">FAST TRAVEL:</span>
            {[
              { name: 'Davis', x: 28, y: 66 },
              { name: 'Strawberry', x: 52, y: 64 },
              { name: 'Rancho', x: 74, y: 76 },
              { name: 'Pillbox', x: 48, y: 42 },
              { name: 'Vinewood', x: 32, y: 20 },
              { name: 'Port LS', x: 42, y: 86 },
            ].map((spot) => (
              <button
                key={spot.name}
                onClick={(e) => {
                  e.stopPropagation();
                  setPlayerPos({ x: spot.x, y: spot.y });
                  addSimEvent(`Fast traveled to ${spot.name}`);
                }}
                className="px-2 py-0.5 bg-slate-900/90 hover:bg-slate-800 text-slate-300 font-mono text-[10px] rounded border border-slate-700 transition-colors"
              >
                {spot.name}
              </button>
            ))}
          </div>
        </div>

        {/* Live Simulation Events Ticker */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3">
          <div className="flex items-center space-x-2 text-xs font-chakra font-bold text-slate-300 mb-1.5">
            <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span>REAL-TIME WORLD & AI ACTIVITY LOG</span>
          </div>
          <div className="font-mono text-[11px] text-slate-400 space-y-1 max-h-24 overflow-y-auto pr-1">
            {recentSimEvents.slice(0, 5).map((evt, idx) => (
              <div key={idx} className="flex items-start space-x-2">
                <span className="text-slate-600">[{new Date().toLocaleTimeString()}]</span>
                <span className="text-slate-300">{evt}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT: Targeted NPC Personality Matrix & Neural Interaction Hub (4 Cols) */}
      <div className="lg:col-span-4 flex flex-col space-y-4">
        {selectedNpc ? (
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col space-y-4">
            {/* NPC Header */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-3">
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="font-chakra font-bold text-white text-base">
                    {selectedNpc.name}
                  </h3>
                  {selectedNpc.alias && (
                    <span className="text-xs text-amber-400 font-mono">
                      "{selectedNpc.alias}"
                    </span>
                  )}
                </div>
                <div className="flex items-center space-x-2 mt-0.5">
                  <span
                    style={{ color: getFactionColor(selectedNpc.faction) }}
                    className="font-chakra font-bold text-xs"
                  >
                    {selectedNpc.faction.toUpperCase()}
                  </span>
                  <span className="text-slate-600">•</span>
                  <span className="text-xs text-slate-400">{selectedNpc.archetype}</span>
                </div>
              </div>
              <div 
                style={{ backgroundColor: `${getFactionColor(selectedNpc.faction)}22`, borderColor: getFactionColor(selectedNpc.faction) }}
                className="px-2 py-1 rounded border font-mono text-[10px] font-bold text-white uppercase"
              >
                {selectedNpc.personality.primaryTrait}
              </div>
            </div>

            {/* Dynamic Personality Matrix Visualizer */}
            <div className="bg-slate-950/60 rounded-lg p-3 border border-slate-800/80">
              <div className="flex items-center justify-between text-xs font-chakra font-bold text-slate-300 mb-2">
                <span>DYNAMIC PERSONALITY MATRIX</span>
                <span className="text-[10px] text-amber-400 font-mono">v2 UTILITY RULES</span>
              </div>
              <div className="space-y-2 text-[11px] font-mono">
                {/* Bravery */}
                <div>
                  <div className="flex justify-between text-slate-400 mb-0.5">
                    <span>Bravery (Fearlessness):</span>
                    <span className="text-emerald-400">{selectedNpc.personality.bravery}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className="bg-emerald-500 h-1.5 rounded-full" 
                      style={{ width: `${selectedNpc.personality.bravery}%` }}
                    ></div>
                  </div>
                </div>

                {/* Aggression */}
                <div>
                  <div className="flex justify-between text-slate-400 mb-0.5">
                    <span>Aggression (Volatility):</span>
                    <span className="text-rose-400">{selectedNpc.personality.aggression}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className="bg-rose-500 h-1.5 rounded-full" 
                      style={{ width: `${selectedNpc.personality.aggression}%` }}
                    ></div>
                  </div>
                </div>

                {/* Caution */}
                <div>
                  <div className="flex justify-between text-slate-400 mb-0.5">
                    <span>Caution (Tactical Defense):</span>
                    <span className="text-sky-400">{selectedNpc.personality.caution}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className="bg-sky-500 h-1.5 rounded-full" 
                      style={{ width: `${selectedNpc.personality.caution}%` }}
                    ></div>
                  </div>
                </div>

                {/* Friendliness */}
                <div>
                  <div className="flex justify-between text-slate-400 mb-0.5">
                    <span>Friendliness (Sociability):</span>
                    <span className="text-amber-400">{selectedNpc.personality.friendliness}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className="bg-amber-500 h-1.5 rounded-full" 
                      style={{ width: `${selectedNpc.personality.friendliness}%` }}
                    ></div>
                  </div>
                </div>

                {/* Greed */}
                <div>
                  <div className="flex justify-between text-slate-400 mb-0.5">
                    <span>Greed (Bribability):</span>
                    <span className="text-purple-400">{selectedNpc.personality.greed}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className="bg-purple-500 h-1.5 rounded-full" 
                      style={{ width: `${selectedNpc.personality.greed}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Observable Body Language & Emotional Animation System */}
            <NPCBodyLanguageVisualizer npc={selectedNpc} variant="full" />

            {/* Current Real-Time Tactical Status */}
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between bg-slate-950/40 p-2 rounded border border-slate-800/60">
                <span className="text-slate-400 font-chakra">CURRENT BEHAVIOR:</span>
                <span className="text-slate-200 font-mono text-[11px] text-right max-w-[190px] truncate">
                  {selectedNpc.currentAction}
                </span>
              </div>
              <div className="flex items-center justify-between bg-slate-950/40 p-2 rounded border border-slate-800/60">
                <span className="text-slate-400 font-chakra">SPONTANEOUS QUIRK:</span>
                <span className="text-amber-300 font-mono text-[11px] text-right max-w-[190px] truncate">
                  {selectedNpc.spontaneousQuirk || 'None'}
                </span>
              </div>
              <div className="flex items-center justify-between bg-slate-950/40 p-2 rounded border border-slate-800/60">
                <span className="text-slate-400 font-chakra">EQUIPPED WEAPON:</span>
                <span className="text-emerald-300 font-mono text-[11px]">
                  {selectedNpc.weapon} {selectedNpc.hasWeaponDrawn ? '(DRAWN)' : '(HOLSTERED)'}
                </span>
              </div>
              <div className="flex items-center justify-between bg-slate-950/40 p-2 rounded border border-slate-800/60">
                <span className="text-slate-400 font-chakra">OPINION OF PLAYER:</span>
                <span className="text-purple-300 font-mono text-[11px]">
                  {selectedNpc.opinionOfPlayer.label} (Trust: {selectedNpc.opinionOfPlayer.trust}%)
                </span>
              </div>

              {/* Long-Term Memory Overview */}
              {selectedNpc.longTermMemory && (
                <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800/80 space-y-1">
                  <div className="flex justify-between items-center text-[10px] font-chakra font-bold">
                    <span className="text-slate-400">LONG-TERM MEMORY STORE:</span>
                    <span className="text-emerald-400 font-mono">
                      {selectedNpc.longTermMemory.incidents.length} Encounters
                    </span>
                  </div>
                  {selectedNpc.longTermMemory.grudge.active && (
                    <div className="text-[10px] font-mono text-rose-400">
                      💀 {selectedNpc.longTermMemory.grudge.severity} GRUDGE: {selectedNpc.longTermMemory.grudge.reason}
                    </div>
                  )}
                  {selectedNpc.longTermMemory.alliance.active && (
                    <div className="text-[10px] font-mono text-emerald-400">
                      🛡️ {selectedNpc.longTermMemory.alliance.level} ALLY: {selectedNpc.longTermMemory.alliance.reason}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => onSelectNpcForDialogue(selectedNpc)}
                className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-chakra font-bold text-xs rounded-lg shadow-lg shadow-emerald-600/20 flex items-center justify-center space-x-2 transition-transform active:scale-98"
              >
                <MessageSquare className="w-4 h-4" />
                <span>INITIATE GEMINI NEURAL DIALOGUE (v2)</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    const bribeAmount = 500;
                    if (selectedNpc.personality.greed > 50) {
                      addSimEvent(`Bribed ${selectedNpc.name} with $${bribeAmount}! Greed accepted. Respect +15.`);
                      setNpcs((prev) =>
                        prev.map((n) =>
                          n.id === selectedNpc.id
                            ? {
                                ...n,
                                currentAction: 'Pocketing crisp cash and nodding in agreement',
                                opinionOfPlayer: {
                                  ...n.opinionOfPlayer,
                                  respect: Math.min(100, n.opinionOfPlayer.respect + 15),
                                  trust: Math.min(100, n.opinionOfPlayer.trust + 20),
                                  label: 'Paid Off',
                                },
                              }
                            : n
                        )
                      );
                    } else {
                      addSimEvent(`${selectedNpc.name} rejected the bribe! "You can't buy me, fool."`);
                    }
                  }}
                  className="py-2 px-2 bg-slate-800 hover:bg-slate-700 text-amber-300 font-chakra font-semibold text-[11px] rounded border border-slate-700 flex items-center justify-center space-x-1"
                >
                  <DollarSign className="w-3.5 h-3.5" />
                  <span>OFFER $500 BRIBE</span>
                </button>

                <button
                  onClick={() => {
                    addSimEvent(`Intimidated ${selectedNpc.name}. Evaluating courage vs fear...`);
                    const coward = selectedNpc.personality.bravery < 50;
                    setNpcs((prev) =>
                      prev.map((n) =>
                        n.id === selectedNpc.id
                          ? {
                              ...n,
                              fear: Math.min(100, n.fear + 25),
                              currentAction: coward ? 'Trembling, stepping backward onto curb' : 'Glares without blinking, clenching fists',
                              alertness: coward ? 'PANICKED' : 'COMBAT',
                            }
                          : n
                      )
                    );
                  }}
                  className="py-2 px-2 bg-slate-800 hover:bg-slate-700 text-rose-300 font-chakra font-semibold text-[11px] rounded border border-slate-700 flex items-center justify-center space-x-1"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>INTIMIDATE</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center text-slate-500 font-chakra">
            Click any NPC on the tactical map to inspect their neural personality matrix.
          </div>
        )}
      </div>
    </div>
  );
};
