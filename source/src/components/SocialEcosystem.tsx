import { responseSource, errorMessage } from '../lib/api';
import React, { useState } from 'react';
import { 
  Users, 
  MessageSquare, 
  Radio, 
  Sparkles, 
  Share2, 
  AlertCircle, 
  Flame, 
  ShieldCheck, 
  Search,
  Send,
  Zap,
  CheckCircle2
} from 'lucide-react';
import { Faction, NPCEntity, Rumor } from '../types';

interface SocialEcosystemProps {
  npcs: NPCEntity[];
  factions: Faction[];
  rumors: Rumor[];
  setRumors: React.Dispatch<React.SetStateAction<Rumor[]>>;
  onOpenDialogue: (npc: NPCEntity) => void;
  addSimEvent: (event: string) => void;
}

export const SocialEcosystem: React.FC<SocialEcosystemProps> = ({
  npcs,
  factions,
  rumors,
  setRumors,
  onOpenDialogue,
  addSimEvent,
}) => {
  const [activeNpcA, setActiveNpcA] = useState<NPCEntity>(npcs[0]);
  const [activeNpcB, setActiveNpcB] = useState<NPCEntity>(npcs[1]);
  const [simulatedChat, setSimulatedChat] = useState<{ speaker: string; text: string; role: 'A' | 'B' }[]>([]);
  const [isGeneratingGossip, setIsGeneratingGossip] = useState<boolean>(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [lastSource, setLastSource] = useState('');
  const [customRumorText, setCustomRumorText] = useState<string>('');
  const [plantSuccess, setPlantSuccess] = useState<boolean>(false);

  // Trigger Gemini-powered street gossip generation
  const handleGenerateFreshGossip = async () => {
    setIsGeneratingGossip(true); setRequestError(null);
    try {
      const res = await fetch('/api/social/gossip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          district: activeNpcA?.district || 'Davis',
          playerActions: ['Brandished military assault rifle near Forum Drive', 'Offered cash bribe to Ballas lookouts'],
          factions: factions.map((f) => f.name),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `Request failed (${res.status})`);
      setLastSource(responseSource(data));
      if (data.success && Array.isArray(data.rumors)) {
        const mapped = data.rumors.map((r: any, idx: number) => ({
          id: `rumor_${Date.now()}_${idx}`,
          headline: r.headline,
          whisperedDialogue: r.whisperedDialogue,
          sourceFaction: r.sourceFaction,
          targetFaction: r.targetFaction,
          credibilityPercent: r.credibilityPercent,
          socialImpact: r.socialImpact,
          playerReputationShift: r.playerReputationShift || 'Reputation changed',
          timestamp: 'Just now',
          spreadCount: 3,
        }));
        setRumors((prev) => [...mapped, ...prev]);
        addSimEvent(`${responseSource(data)} generated ${mapped.length} dynamic street rumors for Los Santos`);
      }
    } catch (err) {
      setRequestError(errorMessage(err));
    } finally {
      setIsGeneratingGossip(false);
    }
  };

  // Plant a custom player rumor into the NPC ecosystem
  const handlePlantRumor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customRumorText.trim()) return;

    const newRumor: Rumor = {
      id: `custom_${Date.now()}`,
      headline: `Player Street Intel: "${customRumorText.slice(0, 45)}..."`,
      whisperedDialogue: `Yo, listen up: "${customRumorText}"`,
      sourceFaction: activeNpcA.faction,
      targetFaction: activeNpcB.faction,
      credibilityPercent: 75,
      socialImpact: 'NPCs in this district will discuss and react to this rumor in subsequent dialogues.',
      playerReputationShift: '+15 Cunning Influencer',
      timestamp: 'Just now',
      spreadCount: 1,
    };

    setRumors((prev) => [newRumor, ...prev]);
    addSimEvent(`Planted custom rumor into ${activeNpcA.faction} whisper network`);
    setCustomRumorText('');
    setPlantSuccess(true);
    setTimeout(() => setPlantSuccess(false), 3000);
  };

  // Simulate NPC-to-NPC Spontaneous Conversation
  const handleSimulateNpcConversation = () => {
    const isRival = activeNpcA.faction !== activeNpcB.faction;
    const traitA = activeNpcA.personality.primaryTrait;
    const traitB = activeNpcB.personality.primaryTrait;

    const script: { speaker: string; text: string; role: 'A' | 'B' }[] = [];

    if (isRival) {
      script.push({
        speaker: activeNpcA.name,
        role: 'A',
        text: `Yo, what are you doing stepping across Carson Ave, ${activeNpcB.name}? You lost or something?`,
      });
      script.push({
        speaker: activeNpcB.name,
        role: 'B',
        text: `Nobody owns the public sidewalk, homie. Besides, word is your crew is running low on ammo after that Port bust.`,
      });
      script.push({
        speaker: activeNpcA.name,
        role: 'A',
        text: `Keep talking that reckless mouth and see what happens when the sun sets over South Central.`,
      });
    } else {
      script.push({
        speaker: activeNpcA.name,
        role: 'A',
        text: `What's good, ${activeNpcB.alias || activeNpcB.name}? Did you hear about that outsider walking around with military hardware?`,
      });
      script.push({
        speaker: activeNpcB.name,
        role: 'B',
        text: `Yeah man, word on the street is they ain't with the cops, but they got deep pockets. Sweet said to keep an eye out.`,
      });
      script.push({
        speaker: activeNpcA.name,
        role: 'A',
        text: `If they step on our block with respect, we eat together. If they try anything funny, they get left on the asphalt.`,
      });
    }

    setSimulatedChat(script);
    addSimEvent(`Simulated spontaneous street talk: ${activeNpcA.name} & ${activeNpcB.name}`);
  };

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-6">
      {requestError && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-3 text-sm text-rose-300">{requestError}</p>}
      {lastSource && <p role="status" className="text-xs text-amber-300 font-mono">Response source: {lastSource}</p>}
      {/* Social Ecosystem Banner */}
      <div className="bg-gradient-to-r from-cyan-950/60 via-slate-900 to-indigo-950/50 border border-slate-800 rounded-xl p-5 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <Users className="w-5 h-5 text-cyan-400" />
              <h2 className="font-chakra font-bold text-lg text-white tracking-wider">
                LOS SANTOS SOCIAL ECOSYSTEM & RUMOR MILL
              </h2>
            </div>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl">
              NPCs dynamically gossip, form opinions about the player, share rumors across faction boundaries, 
              and make spontaneous social choices driven by their underlying personality matrices.
            </p>
          </div>
          <button
            onClick={handleGenerateFreshGossip}
            disabled={isGeneratingGossip}
            className="px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-900 text-white font-chakra font-bold text-xs rounded-lg shadow-lg shadow-cyan-600/20 flex items-center space-x-2 transition-transform active:scale-95"
          >
            <Sparkles className="w-4 h-4 animate-spin" />
            <span>{isGeneratingGossip ? 'SYNTHESIZING RUMORS...' : 'GENERATE STREET GOSSIP (GEMINI)'}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT: Street Rumor Mill & Gossip Network (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-chakra font-bold text-slate-200 text-sm tracking-wider flex items-center space-x-2">
              <Radio className="w-4 h-4 text-amber-400" />
              <span>ACTIVE STREET RUMORS & WORD-OF-MOUTH NETWORK</span>
            </h3>
            <span className="text-xs text-slate-500 font-mono">
              {rumors.length} Rumors Circulating
            </span>
          </div>

          {/* Plant Rumor Form */}
          <form onSubmit={handlePlantRumor} className="bg-slate-900/90 border border-slate-800 rounded-lg p-3">
            <div className="text-xs font-chakra font-bold text-slate-300 mb-1.5 flex items-center justify-between">
              <span>PLANT FALSE RUMOR OR LEAK INTEL INTO STREET NETWORK</span>
              {plantSuccess && (
                <span className="text-emerald-400 text-[10px] flex items-center">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Planted successfully!
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={customRumorText}
                onChange={(e) => setCustomRumorText(e.target.value)}
                placeholder="e.g. 'NOOSE is planning a dawn raid on Ballas stash house in Strawberry'..."
                className="flex-1 bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
              />
              <button
                type="submit"
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-chakra font-bold text-xs rounded flex items-center space-x-1"
              >
                <Send className="w-3 h-3" />
                <span>LEAK</span>
              </button>
            </div>
          </form>

          {/* Rumor Cards Feed */}
          <div className="space-y-3 max-h-[580px] overflow-y-auto pr-1">
            {rumors.map((rumor) => (
              <div
                key={rumor.id}
                className="bg-slate-900/80 border border-slate-800 hover:border-slate-700 rounded-xl p-4 transition-all hover:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-chakra font-bold text-white text-sm">
                    {rumor.headline}
                  </h4>
                  <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded text-[10px] font-mono whitespace-nowrap">
                    {rumor.credibilityPercent}% Credible
                  </span>
                </div>

                <div className="my-2 bg-slate-950/70 p-2.5 rounded-lg border border-slate-800 text-slate-300 font-mono text-xs italic">
                  "{rumor.whisperedDialogue}"
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-400 mt-2">
                  <div className="flex items-center space-x-1">
                    <span className="text-slate-500">Source:</span>
                    <span className="text-cyan-400 font-semibold">{rumor.sourceFaction}</span>
                    <span className="text-slate-600">→</span>
                    <span className="text-purple-400 font-semibold">{rumor.targetFaction}</span>
                  </div>
                  <div className="text-right text-emerald-400">
                    {rumor.playerReputationShift}
                  </div>
                </div>

                <div className="text-[10px] text-slate-500 mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between">
                  <span>Impact: {rumor.socialImpact}</span>
                  <span className="font-mono">Spread: {rumor.spreadCount} NPCs</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: Spontaneous NPC-to-NPC Social Interaction Lab (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl">
            <h3 className="font-chakra font-bold text-slate-200 text-sm tracking-wider mb-3 flex items-center space-x-2">
              <Share2 className="w-4 h-4 text-emerald-400" />
              <span>SPONTANEOUS NPC-TO-NPC STREET ENCOUNTER</span>
            </h3>

            {/* Select Pair of NPCs */}
            <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
              <div>
                <label className="text-[10px] text-slate-400 font-mono mb-1 block">Speaker A:</label>
                <select
                  value={activeNpcA.id}
                  onChange={(e) => setActiveNpcA(npcs.find((n) => n.id === e.target.value) || npcs[0])}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-white font-mono"
                >
                  {npcs.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name} ({n.faction})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 font-mono mb-1 block">Speaker B:</label>
                <select
                  value={activeNpcB.id}
                  onChange={(e) => setActiveNpcB(npcs.find((n) => n.id === e.target.value) || npcs[1])}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-white font-mono"
                >
                  {npcs.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name} ({n.faction})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={handleSimulateNpcConversation}
              className="w-full py-2 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-chakra font-bold text-xs rounded-lg shadow flex items-center justify-center space-x-2 transition-transform active:scale-98"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>SIMULATE STREET ENCOUNTER CONVERSATION</span>
            </button>

            {/* Simulated Chat Window */}
            {simulatedChat.length > 0 && (
              <div className="mt-4 bg-slate-950 rounded-lg p-3 border border-slate-800 space-y-2.5 max-h-[320px] overflow-y-auto">
                {simulatedChat.map((msg, i) => (
                  <div
                    key={i}
                    className={`p-2.5 rounded-lg text-xs font-mono ${
                      msg.role === 'A'
                        ? 'bg-emerald-950/40 border border-emerald-500/30 text-emerald-200'
                        : 'bg-purple-950/40 border border-purple-500/30 text-purple-200 ml-4'
                    }`}
                  >
                    <div className="font-chakra font-bold text-[10px] text-slate-400 mb-1">
                      {msg.speaker}:
                    </div>
                    <div>"{msg.text}"</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* NPC Memory & Perception of Player Roster */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl">
            <h3 className="font-chakra font-bold text-slate-200 text-sm tracking-wider mb-2">
              NPC PERSISTENT SOCIAL MEMORY ROSTER
            </h3>
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 text-xs">
              {npcs.map((npc) => (
                <div
                  key={npc.id}
                  onClick={() => onOpenDialogue(npc)}
                  className="p-2.5 bg-slate-950/60 rounded border border-slate-800/80 hover:border-slate-700 cursor-pointer transition-all flex items-center justify-between"
                >
                  <div>
                    <div className="font-chakra font-bold text-white flex items-center space-x-1.5">
                      <span>{npc.name}</span>
                      <span className="text-[10px] text-slate-500 font-mono">({npc.faction})</span>
                    </div>
                    <div className="text-[11px] text-slate-400 italic line-clamp-1">
                      "{npc.personalMemory}"
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-cyan-300">
                      {npc.opinionOfPlayer.label}
                    </span>
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
