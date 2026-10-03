import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Send, 
  Mic, 
  Sparkles, 
  ShieldAlert, 
  Volume2, 
  VolumeX,
  DollarSign, 
  Heart, 
  Crosshair, 
  Eye, 
  Zap,
  Radio,
  CornerDownRight,
  Play
} from 'lucide-react';
import { errorMessage, responseSource } from '../lib/api';
import { useMicrophone } from '../lib/microphone';
import { DialogueMessage, Faction, NPCEntity } from '../types';
import { NPCBodyLanguageVisualizer } from './NPCBodyLanguageVisualizer';
import { speakNPCUtterance, stopSpeaking, getPersonalityVoiceProfile } from '../lib/speechSynthesis';

interface NPCInteractionModalProps {
  npc: NPCEntity | null;
  onClose: () => void;
  factions: Faction[];
  weather: string;
  timeOfDay: string;
  wantedLevel: number;
  isArmed: boolean;
  onUpdateNpc: (updated: NPCEntity) => void;
  addSimEvent: (msg: string) => void;
}

export const NPCInteractionModal: React.FC<NPCInteractionModalProps> = ({
  npc,
  onClose,
  factions,
  weather,
  timeOfDay,
  wantedLevel,
  isArmed,
  onUpdateNpc,
  addSimEvent,
}) => {
  const [messages, setMessages] = useState<DialogueMessage[]>([]);
  const [inputText, setInputText] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [lastSource, setLastSource] = useState('Scripted browser greeting');
  const microphone = useMicrophone(text => setInputText(text));
  const isMicRecording = microphone.recording;
  const latestNpc = useRef(npc);
  latestNpc.current = npc;
  const requestRef = useRef<AbortController | null>(null);
  const [autoSpeak, setAutoSpeak] = useState<boolean>(true);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Stop speaking when modal closes or changes
  useEffect(() => {
    return () => {
      requestRef.current?.abort();
      stopSpeaking();
    };
  }, []);

  // Initialize initial greeting if empty
  useEffect(() => {
    if (!npc) return;
    if (messages.length === 0) {
      const greetingText = `*Looks up at you from the sidewalk* "Yeah? What you want around here?"`;
      setMessages([
        {
          id: 'msg_init',
          role: 'npc',
          speakerName: npc.name,
          text: greetingText,
          timestamp: new Date().toLocaleTimeString(),
          voiceTone: npc.voiceTone,
          action: npc.currentAction,
          spontaneousQuirk: npc.spontaneousQuirk,
        },
      ]);
      if (autoSpeak) {
        speakNPCUtterance(greetingText, npc, () => setIsSpeaking(true), () => setIsSpeaking(false));
      }
    }
  }, [npc, messages.length, autoSpeak]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  if (!npc) return null;

  const faction = factions.find((f) => f.id === npc.faction);
  const factionColor = faction?.color || '#94a3b8';
  const voiceProfile = getPersonalityVoiceProfile(npc);

  // Send dialogue request to server (Gemini 3.8 Flash)
  const handleSendMessage = async (textToSend: string) => {
    if (!textToSend.trim() || isLoading) return;

    const userMsg: DialogueMessage = {
      id: `usr_${Date.now()}`,
      role: 'player',
      speakerName: 'Player',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setIsLoading(true); setRequestError(null);
    const controller = new AbortController(); requestRef.current = controller;

    try {
      const res = await fetch('/api/dialogue', {
        signal: controller.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          npc: {
            id: npc.id,
            name: npc.name,
            faction: npc.faction,
            archetype: npc.archetype,
            weapon: npc.weapon,
            fear: npc.fear,
            aggression: npc.aggression,
            morale: npc.morale,
            memory: npc.personalMemory,
          },
          player: {
            weaponDrawn: isArmed,
            weaponDrawnName: isArmed ? 'Heavy Pistol' : 'None',
            wantedLevel,
            stance: isArmed ? 'Armed / Threatening' : 'Casual',
            factionStandings: { [npc.faction]: npc.opinionOfPlayer.trust },
          },
          environment: {
            district: npc.district,
            weather,
            timeOfDay,
            heatLevel: wantedLevel,
          },
          playerUtterance: textToSend,
          history: messages.slice(-4).map((m) => ({
            role: m.role,
            text: m.text,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `Dialogue request failed (${res.status})`);
      setLastSource(responseSource(data));
      if (data.success && data.result) {
        const r = data.result;
        if (typeof r.speech !== 'string' || !r.speech.trim()) throw new Error('The dialogue response contained no speech.');
        const currentNpc = latestNpc.current;
        if (!currentNpc || currentNpc.id !== npc.id || controller.signal.aborted) return;
        const boundedDelta = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(-100, Math.min(100, value)) : 0;

        const npcReply: DialogueMessage = {
          id: `npc_${Date.now()}`,
          role: 'npc',
          speakerName: npc.name,
          text: r.speech,
          timestamp: new Date().toLocaleTimeString(),
          voiceTone: r.voiceTone,
          action: r.action,
          spontaneousQuirk: r.spontaneousQuirk,
          internalThought: r.internalThought,
          fearDelta: r.fearDelta,
          aggressionDelta: r.aggressionDelta,
          factionRepDelta: r.factionRepDelta,
        };

        setMessages((prev) => [...prev, npcReply]);

        // Speak utterance using browser SpeechSynthesis with personality voice profile
        if (autoSpeak && r.speech) {
          speakNPCUtterance(r.speech, npc, () => setIsSpeaking(true), () => setIsSpeaking(false));
        }

        // Update NPC State with new emotion deltas and memory
        const nextFear = Math.max(0, Math.min(100, currentNpc.fear + boundedDelta(r.fearDelta)));
        const nextAgg = Math.max(0, Math.min(100, currentNpc.aggression + boundedDelta(r.aggressionDelta)));
        const nextRespect = Math.max(-100, Math.min(100, currentNpc.opinionOfPlayer.respect + boundedDelta(r.factionRepDelta)));

        onUpdateNpc({
          ...currentNpc,
          fear: nextFear,
          aggression: nextAgg,
          currentAction: r.action || currentNpc.currentAction,
          spontaneousQuirk: r.spontaneousQuirk || currentNpc.spontaneousQuirk,
          personalMemory: r.memoryNote || currentNpc.personalMemory,
          hasWeaponDrawn: r.action === 'HOLSTER_WEAPON' ? false : r.action === 'DRAW_WEAPON' || currentNpc.hasWeaponDrawn,
          alertness: r.action === 'DRAW_WEAPON' ? 'COMBAT' : r.action === 'FLEE_PANICKED' ? 'PANICKED' : currentNpc.alertness,
          opinionOfPlayer: {
            ...currentNpc.opinionOfPlayer,
            respect: nextRespect,
          },
        });

        addSimEvent(`${npc.name} responded (${r.action}): "${r.speech.slice(0, 35)}..."`);
      }
    } catch (err) {
      if (!controller.signal.aborted) setRequestError(errorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleMic = () => { if (isMicRecording) microphone.stop(); else void microphone.start(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div 
        className="w-full max-w-3xl bg-[#0c121e] border-2 border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col font-mono text-xs select-none max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Header */}
        <div 
          style={{ borderBottomColor: `${factionColor}66` }}
          className="bg-slate-950 px-6 py-3.5 border-b flex items-center justify-between"
        >
          <div className="flex items-center space-x-3">
            <div 
              style={{ backgroundColor: factionColor }}
              className="w-8 h-8 rounded-full flex items-center justify-center font-chakra font-black text-black text-sm shadow-md"
            >
              {npc.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-chakra font-bold text-white text-base">
                  {npc.name}
                </h3>
                {npc.alias && (
                  <span className="text-amber-400 font-mono text-xs font-semibold">
                    "{npc.alias}"
                  </span>
                )}
                <span 
                  style={{ color: factionColor, borderColor: `${factionColor}55`, backgroundColor: `${factionColor}15` }}
                  className="px-2 py-0.5 rounded border text-[10px] font-chakra font-bold uppercase"
                >
                  {npc.faction}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 font-mono flex items-center space-x-2 mt-0.5">
                <span>{npc.archetype}</span>
                <span>•</span>
                <span>Trait: <strong className="text-amber-300">{npc.personality.primaryTrait}</strong></span>
                <span>•</span>
                <span>District: <strong className="text-slate-200">{npc.district}</strong></span>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <span className="hidden sm:inline bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-1 rounded text-[10px] font-bold">
              BROWSER NPC DIALOGUE
            </span>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* NPC Current State HUD Strip */}
        <div className="bg-slate-900/80 px-6 py-2 border-b border-slate-800 grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] font-mono">
          <div className="flex items-center space-x-1.5">
            <span className="text-slate-400">Fear:</span>
            <div className="flex-1 bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: `${npc.fear}%` }}></div>
            </div>
            <span className="text-amber-400 font-bold">{npc.fear}%</span>
          </div>

          <div className="flex items-center space-x-1.5">
            <span className="text-slate-400">Aggression:</span>
            <div className="flex-1 bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div className="bg-rose-500 h-1.5 rounded-full" style={{ width: `${npc.aggression}%` }}></div>
            </div>
            <span className="text-rose-400 font-bold">{npc.aggression}%</span>
          </div>

          <div className="flex items-center space-x-1.5">
            <span className="text-slate-400">Weapon:</span>
            <span className="text-emerald-300 font-bold">{npc.weapon}</span>
          </div>

          <div className="flex items-center space-x-1.5">
            <span className="text-slate-400">Standing:</span>
            <span className="text-purple-300 font-bold">{npc.opinionOfPlayer.label}</span>
          </div>
        </div>

        {/* Observable Body Language Visualizer Bar */}
        <div className="px-6 py-2 bg-slate-950/90 border-b border-slate-800">
          <NPCBodyLanguageVisualizer npc={npc} variant="compact" />
        </div>

        {/* Browser Speech Synthesis & Dynamic Personality Voice Profile Strip */}
        <div className="px-6 py-2.5 bg-slate-900/70 border-b border-slate-800 space-y-1 text-[11px] font-mono">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Volume2 className={`w-4 h-4 ${isSpeaking ? 'text-emerald-400 animate-pulse' : 'text-slate-400'}`} />
              <span className="text-slate-400">ACOUSTIC PROFILE:</span>
              <span className="text-amber-300 font-bold">{voiceProfile.emotionalIcon} {voiceProfile.styleLabel}</span>
            </div>

            <div className="flex items-center space-x-2">
              {isSpeaking && (
                <button
                  onClick={() => {
                    stopSpeaking();
                    setIsSpeaking(false);
                  }}
                  className="px-2 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/40 rounded text-[10px] font-bold flex items-center space-x-1"
                >
                  <VolumeX className="w-3 h-3" />
                  <span>STOP</span>
                </button>
              )}

              <button
                onClick={() => setAutoSpeak(!autoSpeak)}
                className={`px-2.5 py-0.5 rounded border text-[10px] font-chakra font-bold transition-all ${
                  autoSpeak
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 shadow-sm shadow-emerald-500/20'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                {autoSpeak ? '🔊 AUTO-VOICE: ON' : '🔇 AUTO-VOICE: OFF'}
              </button>
            </div>
          </div>

          {/* Dynamic Pitch & Speed Parameters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] pt-1 border-t border-slate-800/60">
            <div className="flex items-center justify-between bg-slate-950/60 px-2 py-1 rounded border border-slate-800/80">
              <span className="text-slate-400">Dynamic Pitch:</span>
              <span className="text-emerald-300 font-bold">{voiceProfile.pitch}x <span className="text-slate-500 font-normal">({voiceProfile.pitchDescription})</span></span>
            </div>
            <div className="flex items-center justify-between bg-slate-950/60 px-2 py-1 rounded border border-slate-800/80">
              <span className="text-slate-400">Dynamic Speed:</span>
              <span className="text-cyan-300 font-bold">{voiceProfile.rate}x <span className="text-slate-500 font-normal">({voiceProfile.speedDescription})</span></span>
            </div>
          </div>
        </div>

        {/* Persistent Long-Term Memory & Grudge Warning Banner */}
        {npc.longTermMemory?.grudge?.active && (
          <div className="bg-rose-950/80 border-b border-rose-800 px-6 py-2 flex items-center justify-between text-xs text-rose-200">
            <div className="flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 text-rose-400 animate-pulse" />
              <span>
                <strong>ACTIVE {npc.longTermMemory.grudge.severity} GRUDGE:</strong> "{npc.longTermMemory.grudge.reason}"
              </span>
            </div>
            {npc.longTermMemory.grudge.willAttackOnSight && (
              <span className="bg-rose-600 text-white font-bold text-[9px] px-2 py-0.5 rounded font-mono">
                ATTACKS ON SIGHT
              </span>
            )}
          </div>
        )}

        {npc.longTermMemory?.alliance?.active && (
          <div className="bg-emerald-950/80 border-b border-emerald-800 px-6 py-2 flex items-center justify-between text-xs text-emerald-200">
            <div className="flex items-center space-x-2">
              <Heart className="w-4 h-4 text-emerald-400" />
              <span>
                <strong>{npc.longTermMemory.alliance.level} ALLIANCE:</strong> "{npc.longTermMemory.alliance.reason}"
              </span>
            </div>
            <span className="bg-emerald-600 text-white font-bold text-[9px] px-2 py-0.5 rounded font-mono">
              PROVIDES BACKUP
            </span>
          </div>
        )}

        {/* Dialogue Messages Container */}
        <div className="flex-1 p-5 overflow-y-auto space-y-3.5 bg-gradient-to-b from-[#0a0f19] to-[#0c121e]">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === 'player' ? 'items-end' : 'items-start'}`}
            >
              <div className="flex items-center space-x-2 text-[10px] text-slate-500 mb-1 px-1">
                <span className="font-chakra font-bold text-slate-300">{msg.speakerName}</span>
                <span>•</span>
                <span>{msg.timestamp}</span>
                {msg.voiceTone && (
                  <span className="text-amber-400 italic">[{msg.voiceTone}]</span>
                )}
                {msg.role === 'npc' && (
                  <button
                    onClick={() => speakNPCUtterance(msg.text, npc, () => setIsSpeaking(true), () => setIsSpeaking(false))}
                    title="Replay Spoken Dialogue with Voice Profile"
                    className="text-slate-400 hover:text-emerald-400 p-0.5 rounded transition-colors ml-1"
                  >
                    <Play className="w-2.5 h-2.5 fill-current" />
                  </button>
                )}
              </div>

              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                  msg.role === 'player'
                    ? 'bg-emerald-600 text-white rounded-tr-none shadow-lg shadow-emerald-900/30'
                    : 'bg-slate-900 border border-slate-800 text-slate-100 rounded-tl-none shadow-lg'
                }`}
              >
                <div>{msg.text}</div>

                {/* NPC Spontaneous Action & Quirk Indicators */}
                {msg.action && msg.action !== 'TALK_CASUAL' && (
                  <div className="mt-2 pt-2 border-t border-slate-800/80 text-[10px] font-mono text-amber-300 flex items-center space-x-1.5">
                    <span className="bg-amber-500/20 px-1.5 py-0.5 rounded border border-amber-500/30 font-bold">
                      ACTION: {msg.action}
                    </span>
                    {msg.spontaneousQuirk && <span>• {msg.spontaneousQuirk}</span>}
                  </div>
                )}

                {/* NPC Internal Thought (AI Behind the scenes) */}
                {msg.internalThought && (
                  <div className="mt-1.5 text-[10px] text-slate-400 italic bg-black/40 p-2 rounded border border-slate-800/60">
                    <span className="text-slate-500 font-bold not-italic">Internal Thought: </span>
                    "{msg.internalThought}"
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex items-center space-x-2 text-slate-400 font-mono text-xs p-2">
              <Sparkles className="w-4 h-4 text-emerald-400 animate-spin" />
              <span>{npc.name} is awaiting a dialogue response…</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {(requestError || microphone.error) && <p role="alert" className="px-5 py-2 text-rose-300">{requestError || microphone.error}</p>}
        <p role="status" className="px-5 py-1 text-[10px] text-amber-300">{microphone.pending ? 'Preparing microphone / transcribing…' : `Response source: ${lastSource}. Voice playback uses browser speech synthesis.`}</p>
        {/* Quick Action Prompt Chips */}
        <div className="px-5 py-2.5 bg-slate-950 border-t border-slate-800/80 flex flex-wrap gap-1.5">
          <span className="text-[10px] font-mono text-slate-500 self-center mr-1">QUICK ACTIONS:</span>
          {[
            { label: 'Ask for Street Gossip', text: 'What kind of rumors you hearing on the wire lately?' },
            { label: 'Offer $500 Cash', text: 'Here is $500 cash. What can you tell me about the district?' },
            { label: 'Intimidate with Gun', text: 'You see this iron in my belt? Give me what I want or regret it.' },
            { label: 'Flash Gang Signs', text: '*Flashes gang respect hand sign* Keep it 100 on the block.' },
            { label: 'Warn About Police', text: 'Heads up, NOOSE cruisers were spotted two blocks back.' },
          ].map((chip) => (
            <button
              key={chip.label}
              onClick={() => handleSendMessage(chip.text)}
              disabled={isLoading}
              className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-slate-300 hover:text-white font-chakra text-[10px] font-semibold rounded border border-slate-700 transition-colors"
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Message Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage(inputText);
          }}
          className="p-4 bg-slate-950 border-t border-slate-800 flex items-center space-x-2"
        >
          <button
            type="button"
            onClick={handleToggleMic}
            disabled={microphone.pending || isLoading}
            aria-label={isMicRecording ? "Stop recording and transcribe" : "Record microphone to text"}
            className={`p-2.5 rounded-lg border font-mono text-xs flex items-center justify-center transition-all ${
              isMicRecording
                ? 'bg-rose-600 border-rose-400 text-white animate-pulse'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
            }`}
            title="Record real microphone audio; transcript appears in the text field for review"
          >
            <Mic className="w-4 h-4" />
          </button>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={`Say something to ${npc.name}... (Press Enter)`}
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
          />

          <button
            type="submit"
            disabled={!inputText.trim() || isLoading}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-chakra font-bold text-xs rounded-lg shadow-lg shadow-emerald-600/30 flex items-center space-x-1.5 transition-transform active:scale-95"
          >
            <Send className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">SEND</span>
          </button>
        </form>
      </div>
    </div>
  );
};
