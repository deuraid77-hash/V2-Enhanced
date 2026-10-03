import { responseSource, errorMessage } from '../lib/api';
import React, { useState } from 'react';
import { 
  Crosshair, 
  Shield, 
  Sparkles, 
  Zap, 
  Radio, 
  Activity, 
  ChevronRight, 
  RotateCcw,
  Target,
  Swords,
  Layers
} from 'lucide-react';
import { Faction } from '../types';

interface TacticalCombatDirectorProps {
  factions: Faction[];
  weather: string;
  addSimEvent: (msg: string) => void;
}

export const TacticalCombatDirector: React.FC<TacticalCombatDirectorProps> = ({
  factions,
  weather,
  addSimEvent,
}) => {
  const [squadFaction, setSquadFaction] = useState<string>('LSPD');
  const [tacticalPlan, setTacticalPlan] = useState<any>(null);
  const [isCalculating, setIsCalculating] = useState<boolean>(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [lastSource, setLastSource] = useState('');
  const [activeManeuverStep, setActiveManeuverStep] = useState<number>(0);
  const [suppressionActive, setSuppressionActive] = useState<boolean>(false);

  // Cover nodes in tactical arena
  const coverNodes = [
    { id: 'Node-Alpha', type: 'Concrete Barrier (Heavy)', x: 25, y: 35, defenseRating: 95 },
    { id: 'Node-Bravo', type: 'Dumpster Corner (Medium)', x: 45, y: 25, defenseRating: 75 },
    { id: 'Node-Charlie', type: 'Abandoned Sedan (Destructible)', x: 65, y: 40, defenseRating: 60 },
    { id: 'Node-Delta', type: 'Brick Pillar (High Ground)', x: 75, y: 65, defenseRating: 90 },
  ];

  // Request ML Tactical Decision
  const handleComputeTactics = async () => {
    setIsCalculating(true); setRequestError(null);
    try {
      const res = await fetch('/api/tactical-decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          squad: [
            { id: 'unit_1', name: `${squadFaction} Pointman`, weapon: 'Carbine Rifle' },
            { id: 'unit_2', name: `${squadFaction} Heavy Gunner`, weapon: 'Combat MG' },
            { id: 'unit_3', name: `${squadFaction} Flanker`, weapon: 'Assault Shotgun' },
          ],
          targets: [{ id: 'target_player', name: 'Hostile Suspect', weapon: 'Heavy Pistol' }],
          coverPositions: coverNodes,
          environment: { weather },
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `Request failed (${res.status})`);
      setLastSource(responseSource(data));
      if (data.success && data.tactics) {
        setTacticalPlan(data.tactics);
        setActiveManeuverStep(1);
        setSuppressionActive(true);
        addSimEvent(`${responseSource(data)} computed plan: "${data.tactics.tacticalPlanName}"`);
      }
    } catch (err) {
      setRequestError(errorMessage(err));
    } finally {
      setIsCalculating(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-6">
      {requestError && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-3 text-sm text-rose-300">{requestError}</p>}
      {lastSource && <p role="status" className="text-xs text-amber-300 font-mono">Response source: {lastSource}</p>}
      {/* Banner */}
      <div className="bg-gradient-to-r from-rose-950/60 via-slate-900 to-amber-950/50 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <Crosshair className="w-5 h-5 text-rose-500 animate-pulse" />
            <h2 className="font-chakra font-bold text-lg text-white tracking-wider">
              SQUAD TACTICS SIMULATOR & BOUNDING OVERWATCH
            </h2>
          </div>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">
            Preview generated squad plans and utility-rule fallback tactics on this browser arena. The Enhanced game client uses its separate bounded F8 rules on nearby pedestrians; no trained machine-learning model is included.
          </p>
        </div>
        <button
          onClick={handleComputeTactics}
          disabled={isCalculating}
          className="px-5 py-2.5 bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 disabled:opacity-50 text-white font-chakra font-bold text-xs rounded-lg shadow-lg shadow-rose-600/30 flex items-center space-x-2 transition-transform active:scale-95"
        >
          <Sparkles className="w-4 h-4 animate-spin" />
          <span>{isCalculating ? 'EVALUATING COVER NODES...' : 'SIMULATE COMBAT PLAN'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT: Tactical Arena Sandbox (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-chakra font-bold text-slate-200 text-sm tracking-wider flex items-center space-x-2">
                <Target className="w-4 h-4 text-emerald-400" />
                <span>DYNAMIC COVER & FLANKING GEOMETRY ARENA</span>
              </h3>
              <div className="flex items-center space-x-2 text-xs font-mono">
                <span className="text-slate-400">Squad Faction:</span>
                <select
                  value={squadFaction}
                  onChange={(e) => setSquadFaction(e.target.value)}
                  className="bg-slate-950 border border-slate-700 text-amber-300 rounded px-2 py-0.5"
                >
                  <option value="LSPD">LSPD SWAT</option>
                  <option value="Ballas">Ballas Syndicate</option>
                  <option value="Vagos">Vagos Hit Squad</option>
                  <option value="Madrazo Cartel">Madrazo Cartel</option>
                  <option value="Merryweather">Merryweather Mercenaries</option>
                </select>
              </div>
            </div>

            {/* Tactical Grid Visualization */}
            <div className="relative w-full h-[380px] bg-[#0b101c] rounded-xl border border-slate-800 overflow-hidden p-4 select-none">
              {/* Grid Lines */}
              <div className="absolute inset-0 bg-[linear-gradient(to_right,#131d2e_1px,transparent_1px),linear-gradient(to_bottom,#131d2e_1px,transparent_1px)] bg-[size:30px_30px] opacity-40"></div>

              {/* Suppressive Fire Arc (Vector from Gunner to Player) */}
              {suppressionActive && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
                  {/* Flank Vector Line */}
                  <line
                    x1="25%"
                    y1="35%"
                    x2="75%"
                    y2="65%"
                    stroke="#f59e0b"
                    strokeWidth="2"
                    strokeDasharray="4 4"
                    className="animate-pulse"
                  />
                  {/* Heavy Suppression Beam */}
                  <line
                    x1="45%"
                    y1="25%"
                    x2="50%"
                    y2="80%"
                    stroke="#f43f5e"
                    strokeWidth="3"
                    opacity="0.75"
                    className="animate-pulse"
                  />
                  <polygon
                    points="50%,80% 48%,76% 52%,76%"
                    fill="#f43f5e"
                  />
                </svg>
              )}

              {/* Target / Player Node */}
              <div className="absolute left-1/2 top-[80%] transform -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-emerald-500 border-2 border-white shadow-[0_0_20px_rgba(16,185,129,0.8)] flex items-center justify-center font-chakra font-black text-black text-xs">
                  P
                </div>
                <span className="mt-1 bg-black/80 text-emerald-400 font-mono text-[9px] px-1.5 py-0.5 rounded border border-emerald-500/40">
                  PLAYER COVER
                </span>
              </div>

              {/* Cover Nodes */}
              {coverNodes.map((node) => (
                <div
                  key={node.id}
                  style={{ left: `${node.x}%`, top: `${node.y}%` }}
                  className="absolute transform -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center"
                >
                  <div className="w-6 h-6 rounded bg-slate-800 border-2 border-slate-600 flex items-center justify-center text-slate-300">
                    <Shield className="w-3.5 h-3.5 text-cyan-400" />
                  </div>
                  <div className="mt-1 whitespace-nowrap bg-slate-950/90 text-white font-mono text-[9px] px-1.5 py-0.5 rounded border border-slate-800 text-center">
                    <div>{node.id}</div>
                    <div className="text-[8px] text-cyan-400">{node.defenseRating}% Defense</div>
                  </div>
                </div>
              ))}

              {/* Squad Units */}
              <div className="absolute left-[25%] top-[25%] transform -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center">
                <div className="w-6 h-6 rounded-full bg-rose-500 border-2 border-white text-black font-black text-[9px] flex items-center justify-center shadow-lg shadow-rose-500/50">
                  1
                </div>
                <span className="bg-black/80 text-rose-300 font-mono text-[8px] px-1 rounded mt-0.5 whitespace-nowrap">
                  Overwatch Leader
                </span>
              </div>

              <div className="absolute left-[45%] top-[15%] transform -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center">
                <div className="w-6 h-6 rounded-full bg-rose-500 border-2 border-white text-black font-black text-[9px] flex items-center justify-center shadow-lg shadow-rose-500/50">
                  2
                </div>
                <span className="bg-black/80 text-rose-300 font-mono text-[8px] px-1 rounded mt-0.5 whitespace-nowrap">
                  Suppressor (Combat MG)
                </span>
              </div>

              <div className="absolute left-[75%] top-[55%] transform -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center">
                <div className="w-6 h-6 rounded-full bg-amber-400 border-2 border-white text-black font-black text-[9px] flex items-center justify-center shadow-lg shadow-amber-400/50 animate-bounce">
                  3
                </div>
                <span className="bg-black/80 text-amber-300 font-mono text-[8px] px-1 rounded mt-0.5 whitespace-nowrap">
                  Flanker (Enveloping)
                </span>
              </div>
            </div>

            {/* Arena Legend */}
            <div className="grid grid-cols-3 gap-2 mt-3 text-xs font-mono text-slate-400 border-t border-slate-800 pt-2">
              <div className="flex items-center space-x-1.5">
                <div className="w-3 h-0.5 bg-rose-500"></div>
                <span>Red Line: Suppressive Fire</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <div className="w-3 h-0.5 bg-amber-400 border-t border-dashed border-amber-400"></div>
                <span>Dashed: Flanking Vector</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <Shield className="w-3 h-3 text-cyan-400" />
                <span>Shield: Hard Cover Node</span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: ML Tactical Strategy Breakdown (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl space-y-4">
            <h3 className="font-chakra font-bold text-slate-200 text-sm tracking-wider flex items-center space-x-2">
              <Activity className="w-4 h-4 text-rose-400" />
              <span>SIMULATED TACTICAL ORDERS</span>
            </h3>

            {tacticalPlan ? (
              <div className="space-y-3 font-mono text-xs">
                <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[10px]">COORDINATED MANEUVER:</div>
                  <div className="font-chakra font-bold text-amber-300 text-base">
                    {tacticalPlan.tacticalPlanName}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Posture: <strong className="text-rose-400">{tacticalPlan.posture}</strong> • Retreat Morale: {tacticalPlan.retreatThresholdMorale}%
                  </div>
                </div>

                {/* Radio Callout Audio Simulation */}
                <div className="bg-rose-950/40 p-3 rounded-lg border border-rose-800/60 text-rose-200">
                  <div className="flex items-center space-x-2 text-[10px] text-rose-400 font-bold mb-1">
                    <Radio className="w-3 h-3 animate-pulse" />
                    <span>RADIO CALLOUT (TTS / IN-GAME AUDIO):</span>
                  </div>
                  <div className="italic">"{tacticalPlan.radioCallout}"</div>
                </div>

                {/* Squad Orders */}
                <div className="space-y-2">
                  <div className="text-[10px] font-chakra font-bold text-slate-400 uppercase">
                    INDIVIDUAL SQUAD ASSIGNMENTS:
                  </div>
                  {tacticalPlan.squadOrders?.map((order: any, i: number) => (
                    <div
                      key={i}
                      className="bg-slate-950/60 p-2.5 rounded border border-slate-800 flex items-start space-x-2"
                    >
                      <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <div>
                        <div className="text-white font-bold">{order.unitName}</div>
                        <div className="text-[11px] text-slate-300">{order.order}</div>
                        <div className="text-[10px] text-cyan-400 mt-0.5">
                          Target Cover: {order.targetCoverNode}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-slate-950/60 p-6 rounded-lg border border-slate-800 text-center text-slate-500 font-chakra text-xs">
                Click "SIMULATE COMBAT PLAN" to generate a browser squad plan.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
