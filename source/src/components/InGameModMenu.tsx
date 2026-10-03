import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Settings, 
  Cpu, 
  Sliders, 
  Volume2, 
  ShieldAlert, 
  Eye, 
  Sparkles, 
  Check, 
  Save,
  Radio,
  Crosshair
} from 'lucide-react';

interface InGameModMenuProps {
  isOpen: boolean;
  onClose: () => void;
  weather: string;
  setWeather: (w: string) => void;
  timeOfDay: string;
  setTimeOfDay: (t: string) => void;
  wantedLevel: number;
  setWantedLevel: (l: number) => void;
  addSimEvent: (msg: string) => void;
}

export const InGameModMenu: React.FC<InGameModMenuProps> = ({
  isOpen,
  onClose,
  weather,
  setWeather,
  timeOfDay,
  setTimeOfDay,
  wantedLevel,
  setWantedLevel,
  addSimEvent,
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'ml_tactics' | 'llm_social' | 'factions' | 'hotkeys'>('general');

  // Config parameters
  const [llmModel, setLlmModel] = useState<string>('gemini-3.8-flash');
  const [voiceVoiceTone, setVoiceTone] = useState<string>('Authentic GTA Slang & Regional Dialect');
  const [opticalFov, setOpticalFov] = useState<number>(85);
  const [acousticHearingRange, setAcousticHearingRange] = useState<number>(45);
  const [flankAggression, setFlankAggression] = useState<number>(75);
  const [suppressionWeight, setSuppressionWeight] = useState<number>(68);
  const [turfWarFrequency, setTurfWarFrequency] = useState<string>('High (Dynamic Events)');
  const [spontaneousReactionRate, setSpontaneousReactionRate] = useState<number>(80);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  const [saveError, setSaveError] = useState<string | null>(null);
  const closeTimer = useRef<number | null>(null);
  useEffect(() => {
    try {
      const settings = JSON.parse(localStorage.getItem('LLAI_V2_SIMULATION_SETTINGS') || 'null');
      if (!settings || settings.version !== 1) return;
      if (['Clear', 'Rain', 'Thunderstorm', 'Fog', 'Smog'].includes(settings.weather)) setWeather(settings.weather);
      if (['Dawn', 'Midday', 'Dusk', 'Midnight'].includes(settings.timeOfDay)) setTimeOfDay(settings.timeOfDay);
      if (Number.isInteger(settings.wantedLevel) && settings.wantedLevel >= 0 && settings.wantedLevel <= 5) setWantedLevel(settings.wantedLevel);
      if (typeof settings.llmModel === 'string') setLlmModel(settings.llmModel);
      if (typeof settings.voiceVoiceTone === 'string') setVoiceTone(settings.voiceVoiceTone);
      if (typeof settings.turfWarFrequency === 'string') setTurfWarFrequency(settings.turfWarFrequency);
      for (const [key, setter] of [['opticalFov', setOpticalFov], ['acousticHearingRange', setAcousticHearingRange], ['flankAggression', setFlankAggression], ['suppressionWeight', setSuppressionWeight], ['spontaneousReactionRate', setSpontaneousReactionRate]] as const) {
        if (typeof settings[key] === 'number' && Number.isFinite(settings[key])) setter(Math.max(0, Math.min(180, settings[key])));
      }
    } catch { setSaveError('Saved browser settings could not be read. Current defaults are active.'); }
    return () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); };
  }, []);

  if (!isOpen) return null;

  const handleSaveSettings = () => {
    try {
      localStorage.setItem('LLAI_V2_SIMULATION_SETTINGS', JSON.stringify({ version: 1, weather, timeOfDay, wantedLevel, llmModel, voiceVoiceTone, opticalFov, acousticHearingRange, flankAggression, suppressionWeight, turfWarFrequency, spontaneousReactionRate }));
      setSaveSuccess(true); setSaveError(null);
      addSimEvent('Browser simulation settings saved locally. Advanced values are reference presets.');
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(() => { setSaveSuccess(false); onClose(); }, 1200);
    } catch { setSaveError('Browser storage is unavailable. Settings have not been saved.'); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div 
        className="w-full max-w-2xl bg-[#0b101c] border-2 border-emerald-500/80 rounded-xl shadow-[0_0_50px_rgba(16,185,129,0.25)] overflow-hidden flex flex-col font-mono text-xs select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* LemonUI / NativeUI GTA V Style Banner */}
        <div className="bg-gradient-to-r from-emerald-600 via-teal-700 to-slate-900 px-6 py-4 border-b border-emerald-500/40 flex items-center justify-between">
          <div>
            <div className="flex items-center space-x-2">
              <span className="bg-black/40 text-emerald-300 font-chakra font-black text-xs px-2 py-0.5 rounded border border-emerald-400/40">
                [F6] BROWSER HOTKEY
              </span>
              <h2 className="font-chakra font-black text-xl text-white tracking-widest uppercase">
                LIVING LOS SANTOS AI v2
              </h2>
            </div>
            <p className="text-[11px] text-emerald-100 font-chakra font-semibold tracking-wider">
              BROWSER SIMULATION SETTINGS & REFERENCE PRESETS
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex bg-slate-950 border-b border-slate-800 text-[11px] font-chakra font-bold">
          {[
            { id: 'general', label: 'GENERAL & ENVIRONMENT', icon: Sliders },
            { id: 'ml_tactics', label: 'TACTICAL PRESETS', icon: Crosshair },
            { id: 'llm_social', label: 'GEMINI LLM & SOCIAL', icon: Sparkles },
            { id: 'factions', label: 'TURF & FACTIONS', icon: ShieldAlert },
            { id: 'hotkeys', label: 'HOTKEYS & BINDS', icon: Radio },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex-1 py-2.5 px-2 flex items-center justify-center space-x-1.5 border-b-2 transition-all ${
                  isActive
                    ? 'border-emerald-400 text-white bg-slate-900'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-emerald-400' : 'text-slate-500'}`} />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>

        <p className="px-6 pt-3 text-[11px] text-amber-300">Weather, time and wanted level update the browser simulation immediately. Advanced controls are saved reference presets; they do not alter game INIs, server models or native game tactics.</p>
        {saveError && <p role="alert" className="px-6 py-2 text-rose-300">{saveError}</p>}
        {/* Tab Content Area */}
        <div className="p-6 space-y-4 max-h-[460px] overflow-y-auto bg-slate-900/60">
          {activeTab === 'general' && (
            <div className="space-y-4">
              <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-chakra font-bold text-slate-200">WORLD WEATHER SIMULATION:</span>
                  <select
                    value={weather}
                    onChange={(e) => setWeather(e.target.value)}
                    className="bg-slate-900 border border-slate-700 text-emerald-400 rounded px-2.5 py-1 font-mono"
                  >
                    <option value="Clear">Clear Sunny</option>
                    <option value="Rain">Heavy Rain (Muffles Gunfire Acoustics)</option>
                    <option value="Thunderstorm">Thunderstorm (Panic & Cover Seeking)</option>
                    <option value="Fog">Dense Fog (Reduced Optical Line-of-Sight)</option>
                    <option value="Smog">Urban Smog</option>
                  </select>
                </div>
                <p className="text-[10px] text-slate-400">
                  Browser weather changes simulated sight distance, sound range and shelter-seeking behavior.
                </p>
              </div>

              <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-chakra font-bold text-slate-200">TIME OF DAY:</span>
                  <select
                    value={timeOfDay}
                    onChange={(e) => setTimeOfDay(e.target.value)}
                    className="bg-slate-900 border border-slate-700 text-amber-300 rounded px-2.5 py-1 font-mono"
                  >
                    <option value="Dawn">06:00 (Dawn)</option>
                    <option value="Midday">12:00 (Midday)</option>
                    <option value="Dusk">19:30 (Dusk)</option>
                    <option value="Midnight">02:15 (Midnight)</option>
                  </select>
                </div>
                <p className="text-[10px] text-slate-400">
                  Time is included in browser dialogue requests and displayed on the simulation map.
                </p>
              </div>

              <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-chakra font-bold text-slate-200">POLICE HEAT / WANTED LEVEL:</span>
                  <div className="flex space-x-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => setWantedLevel(wantedLevel === star ? 0 : star)}
                        className={`text-base font-bold ${
                          star <= wantedLevel ? 'text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.8)]' : 'text-slate-700'
                        }`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-[10px] text-slate-400">
                  Simulated wanted level is included in dialogue and police-reaction rules. It does not spawn game units.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'ml_tactics' && (
            <div className="space-y-4">
              <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-chakra font-bold text-slate-200">SQUAD FLANKING AGGRESSION:</span>
                  <span className="text-emerald-400 font-bold">{flankAggression}%</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="100"
                  value={flankAggression}
                  onChange={(e) => setFlankAggression(Number(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Higher values make enemies coordinate 45-degree angle blindspot rushes while squad mates suppress.
                </p>
              </div>

              <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-chakra font-bold text-slate-200">COVER SUPPRESSION FIRE BIAS:</span>
                  <span className="text-rose-400 font-bold">{suppressionWeight}%</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="100"
                  value={suppressionWeight}
                  onChange={(e) => setSuppressionWeight(Number(e.target.value))}
                  className="w-full accent-rose-500 cursor-pointer"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Determines how aggressively NPCs lay down sustained automatic fire to pin player behind cover.
                </p>
              </div>

              <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-chakra font-bold text-slate-200">ACOUSTIC SENSORY RADIUS:</span>
                  <span className="text-cyan-400 font-bold">{acousticHearingRange} meters</span>
                </div>
                <input
                  type="range"
                  min="15"
                  max="80"
                  value={acousticHearingRange}
                  onChange={(e) => setAcousticHearingRange(Number(e.target.value))}
                  className="w-full accent-cyan-500 cursor-pointer"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Distance gunshots, screeching tires, and explosions travel to trigger neighborhood panic cascades.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'llm_social' && (
            <div className="space-y-4">
              <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-chakra font-bold text-slate-200">NEURAL LLM ENGINE:</span>
                  <span className="bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/40 font-bold">
                    {llmModel}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400">
                  Google's latest low-latency multimodal LLM powering complex dialogue, street slang, and spontaneous social behavior.
                </p>
              </div>

              <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-chakra font-bold text-slate-200">SPONTANEOUS REACTION FREQUENCY:</span>
                  <span className="text-amber-400 font-bold">{spontaneousReactionRate}%</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={spontaneousReactionRate}
                  onChange={(e) => setSpontaneousReactionRate(Number(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Controls how frequently NPCs spontaneously approach the player, initiate side gigs, comment on clothing/cars, or challenge rival gang colors.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'factions' && (
            <div className="space-y-4">
              <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-chakra font-bold text-slate-200">TERRITORIAL TURF WAR DYNAMICS:</span>
                  <select
                    value={turfWarFrequency}
                    onChange={(e) => setTurfWarFrequency(e.target.value)}
                    className="bg-slate-900 border border-slate-700 text-purple-300 rounded px-2.5 py-1 font-mono"
                  >
                    <option value="High (Dynamic Events)">High (Frequent Emergent Skirmishes)</option>
                    <option value="Balanced">Balanced (Story & Player Driven)</option>
                    <option value="Low">Low (Frozen Borders)</option>
                  </select>
                </div>
                <p className="text-[10px] text-slate-400">
                  Controls the rate at which Families, Ballas, Vagos, and Cartels raid rival territory and declare sudden wars.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'hotkeys' && (
            <div className="space-y-2 font-mono">
              <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800 flex justify-between"><span className="text-slate-400">Enhanced V2 game text / tactics:</span><span className="text-cyan-300 font-bold">F7 / F8</span></div>
              <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800 flex justify-between">
                <span className="text-slate-400">Browser simulation settings:</span>
                <span className="text-emerald-400 font-bold">F6</span>
              </div>
              <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800 flex justify-between">
                <span className="text-slate-400">ScriptHookVDotNet Console:</span>
                <span className="text-cyan-400 font-bold">F4</span>
              </div>
              <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800 flex justify-between">
                <span className="text-slate-400">Original voice DLL interaction:</span>
                <span className="text-amber-400 font-bold">E</span>
              </div>
              <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800 flex justify-between">
                <span className="text-slate-400">Original voice DLL text:</span>
                <span className="text-white font-bold">T</span>
              </div>
              <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800 flex justify-between">
                <span className="text-slate-400">Original voice DLL microphone:</span>
                <span className="text-rose-400 font-bold">Hold Y</span>
              </div>
              <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800 flex justify-between">
                <span className="text-slate-400">Original voice DLL end:</span>
                <span className="text-slate-300 font-bold">Backspace</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="bg-slate-950 p-4 border-t border-slate-800 flex items-center justify-between">
          <span className="text-[10px] text-slate-500 font-mono">
            Saved in this browser • Game INI kept separate
          </span>
          <div className="flex space-x-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-chakra font-bold rounded"
            >
              CLOSE
            </button>
            <button
              onClick={handleSaveSettings}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-chakra font-bold rounded shadow-lg shadow-emerald-600/30 flex items-center space-x-1.5"
            >
              {saveSuccess ? (
                <>
                  <Check className="w-4 h-4 text-white" />
                  <span>SAVED LOCALLY!</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>SAVE LOCALLY & CLOSE</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
