import React from 'react';
import { 
  ShieldAlert, 
  MapPin, 
  Users, 
  Flame, 
  Crosshair, 
  FileCode2, 
  CloudRain, 
  Sun, 
  CloudFog, 
  Zap, 
  Radio, 
  Sparkles,
  Volume2
} from 'lucide-react';

interface NavigationProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  weather: string;
  setWeather: (w: string) => void;
  timeOfDay: string;
  setTimeOfDay: (t: string) => void;
  wantedLevel: number;
  setWantedLevel: (level: number) => void;
  isArmed: boolean;
  setIsArmed: (a: boolean) => void;
  geminiOnline: boolean;
  activeModel: string;
  gameConnected: boolean;
  serverOnline: boolean;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  setActiveTab,
  weather,
  setWeather,
  timeOfDay,
  setTimeOfDay,
  wantedLevel,
  setWantedLevel,
  isArmed,
  setIsArmed,
  geminiOnline,
  activeModel,
  gameConnected,
  serverOnline,
}) => {
  return (
    <header className="bg-[#0b0f19] border-b border-slate-800 sticky top-0 z-50 shadow-2xl">
      {/* Top Telemetry & Control Bar */}
      <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs border-b border-slate-800/60 font-mono">
        {/* Brand / Logo */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center justify-center w-8 h-8 rounded bg-gradient-to-br from-emerald-500 via-amber-500 to-purple-600 text-black font-chakra font-black text-sm shadow-lg shadow-emerald-500/20">
            V2
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-chakra font-bold text-slate-100 text-sm tracking-wider">
                LIVING LOS SANTOS AI
              </span>
              <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-semibold px-1.5 py-0.5 rounded border border-emerald-500/40">
                v2.4 ENHANCED
              </span>
            </div>
            <div className="text-[10px] text-slate-400 flex items-center space-x-2">
              <span>GTA V ENHANCED COMPANION</span>
              <span className="text-slate-600">•</span>
              <span className={`flex items-center ${geminiOnline ? 'text-emerald-400' : 'text-amber-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full mr-1 ${geminiOnline ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                {serverOnline ? (geminiOnline ? `${activeModel} CONFIGURED` : 'LOCAL SIMULATION') : 'SERVER UNAVAILABLE'}
              </span>
            </div>
          </div>
        </div>

        {/* Global GTA Simulation Environment Controls */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Time of Day */}
          <div className="flex items-center bg-slate-900/90 rounded border border-slate-800 px-2 py-1 space-x-1.5">
            <span className="text-slate-400 text-[10px] uppercase font-semibold">Time:</span>
            <select
              value={timeOfDay}
              onChange={(e) => setTimeOfDay(e.target.value)}
              className="bg-transparent text-amber-300 font-medium cursor-pointer focus:outline-none"
            >
              <option value="Dawn" className="bg-slate-900 text-white">06:00 (Dawn)</option>
              <option value="Midday" className="bg-slate-900 text-white">12:00 (Midday)</option>
              <option value="Dusk" className="bg-slate-900 text-white">19:30 (Dusk)</option>
              <option value="Midnight" className="bg-slate-900 text-white">02:15 (Midnight)</option>
            </select>
          </div>

          {/* Weather */}
          <div className="flex items-center bg-slate-900/90 rounded border border-slate-800 px-2 py-1 space-x-1.5">
            <span className="text-slate-400 text-[10px] uppercase font-semibold">Weather:</span>
            <select
              value={weather}
              onChange={(e) => setWeather(e.target.value)}
              className="bg-transparent text-sky-300 font-medium cursor-pointer focus:outline-none"
            >
              <option value="Clear" className="bg-slate-900 text-white">☀️ Clear Sky</option>
              <option value="Rain" className="bg-slate-900 text-white">🌧️ Heavy Rain</option>
              <option value="Thunderstorm" className="bg-slate-900 text-white">⚡ Thunderstorm</option>
              <option value="Fog" className="bg-slate-900 text-white">🌫️ Dense Fog</option>
              <option value="Smog" className="bg-slate-900 text-white">🏭 Urban Smog</option>
            </select>
          </div>

          {/* Wanted Level / Stars */}
          <div className="flex items-center bg-slate-900/90 rounded border border-slate-800 px-2 py-1 space-x-1">
            <span className="text-slate-400 text-[10px] uppercase font-semibold mr-1">Wanted:</span>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => setWantedLevel(wantedLevel === star ? 0 : star)}
                title={`Set wanted level to ${star} star`}
                className={`text-sm transition-all transform hover:scale-125 ${
                  star <= wantedLevel ? 'text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]' : 'text-slate-700'
                }`}
              >
                ★
              </button>
            ))}
          </div>

          {/* Player Weapon Holster Toggle */}
          <button
            onClick={() => setIsArmed(!isArmed)}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded border font-chakra font-semibold transition-all ${
              isArmed
                ? 'bg-rose-500/20 border-rose-500 text-rose-300 shadow-md shadow-rose-500/20 animate-pulse'
                : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>{isArmed ? 'WEAPON DRAWN' : 'HOLSTERED'}</span>
          </button>
        </div>
      </div>

      {/* Main Feature Tabs */}
      <div className="max-w-7xl mx-auto px-4 flex space-x-1 overflow-x-auto scrollbar-none">
        {[
          { id: 'simulation', label: 'WORLD SIMULATOR & MAP', icon: MapPin, color: 'emerald' },
          { id: 'intelligence', label: 'AI HUB & CLOUD (MAPS/VOICE/CHAT)', icon: Sparkles, color: 'emerald' },
          { id: 'memory', label: 'LONG-TERM MEMORY & GRUDGES', icon: Radio, color: 'amber' },
          { id: 'social', label: 'SOCIAL ECOSYSTEM & GOSSIP', icon: Users, color: 'cyan' },
          { id: 'factions', label: 'FACTION WARFARE & ALLEGIES', icon: Flame, color: 'amber' },
          { id: 'tactics', label: 'TACTICAL COMBAT SIMULATOR', icon: Crosshair, color: 'rose' },
          { id: 'mod', label: 'GTA V MOD BRIDGE & EXPORT', icon: FileCode2, color: 'purple' },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center space-x-2 py-3 px-4 border-b-2 font-chakra font-bold text-xs tracking-wider transition-all whitespace-nowrap ${
                isActive
                  ? 'border-emerald-400 text-white bg-slate-800/50'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-400' : 'text-slate-500'}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </header>
  );
};
