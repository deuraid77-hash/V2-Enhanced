import React from 'react';
import { 
  Flame, 
  Heart, 
  Eye, 
  DollarSign, 
  ShieldAlert, 
  Smile, 
  Skull, 
  Activity, 
  Wind,
  Zap
} from 'lucide-react';
import { BodyLanguageIndicator, EmotionalState, NPCEntity } from '../types';

export function getNPCBodyLanguage(npc: NPCEntity): BodyLanguageIndicator {
  // Check for blood feud grudge first
  if (npc.longTermMemory?.grudge?.active && npc.longTermMemory.grudge.severity === 'BLOOD_FEUD') {
    return {
      state: 'BLOOD_FEUD',
      icon: '💀',
      label: 'BLOOD FEUD / VENDETTA',
      postureDescription: 'Predatory combat stance, weapon safety off, locked eyes on target',
      animationClass: 'animate-pulse text-rose-500 shadow-rose-500/50',
      color: '#ef4444',
      heartRateBpm: 135,
      breathingRate: 'HEAVY',
    };
  }

  // Extreme fear
  if (npc.fear >= 60 || npc.alertness === 'PANICKED') {
    return {
      state: 'TERRIFIED',
      icon: '😱',
      label: 'TERRIFIED / HYPERVENTILATING',
      postureDescription: 'Crouched low, trembling knees, palms raised in surrender, darting eyes',
      animationClass: 'animate-bounce text-amber-400 shadow-amber-400/50',
      color: '#fbbf24',
      heartRateBpm: 165,
      breathingRate: 'RAPID',
    };
  }

  // High aggression
  if (npc.aggression >= 65 || npc.alertness === 'COMBAT') {
    return {
      state: 'ENRAGED',
      icon: '😡',
      label: 'ENRAGED / COMBAT AGGRESSION',
      postureDescription: 'Chest thrust forward, clenched jaw, gripping holster, flaring nostrils',
      animationClass: 'animate-pulse text-red-500 shadow-red-500/50',
      color: '#dc2626',
      heartRateBpm: 142,
      breathingRate: 'HEAVY',
    };
  }

  // Suspicion / Vigilance
  if (npc.alertness === 'SUSPICIOUS' || npc.personality.caution > 70) {
    return {
      state: 'SUSPICIOUS',
      icon: '🧐',
      label: 'SUSPICIOUS / ON EDGE',
      postureDescription: 'Head on swivel, hands near waistline, sizing up player movements',
      animationClass: 'animate-pulse-subtle text-cyan-400',
      color: '#06b6d4',
      heartRateBpm: 104,
      breathingRate: 'SHALLOW',
    };
  }

  // High Greed
  if (npc.personality.greed > 70) {
    return {
      state: 'GREEDY',
      icon: '🤑',
      label: 'CALCULATING / OPPORTUNISTIC',
      postureDescription: 'Rubbing palms together, tilted head, assessing player watch and cash',
      animationClass: 'text-emerald-400',
      color: '#10b981',
      heartRateBpm: 92,
      breathingRate: 'NORMAL',
    };
  }

  // Stoic or Cynical
  if (npc.personality.primaryTrait === 'Cynical' || npc.faction === 'Madrazo Cartel' || npc.faction === 'Merryweather') {
    return {
      state: 'STOIC',
      icon: '🥶',
      label: 'STOIC / COLD DISCIPLINE',
      postureDescription: 'Unflinching military gaze, rigid spine, arms crossed over ballistic vest',
      animationClass: 'text-indigo-400',
      color: '#818cf8',
      heartRateBpm: 72,
      breathingRate: 'NORMAL',
    };
  }

  // Relaxed / Friendly default
  return {
    state: 'RELAXED',
    icon: '😎',
    label: 'RELAXED / STREET CHILL',
    postureDescription: 'Casual lean against wall, dropped shoulders, relaxed open hand gestures',
    animationClass: 'text-emerald-300',
    color: '#34d399',
    heartRateBpm: 68,
    breathingRate: 'NORMAL',
  };
}

interface NPCBodyLanguageVisualizerProps {
  npc: NPCEntity;
  variant?: 'compact' | 'full' | 'hud';
}

export const NPCBodyLanguageVisualizer: React.FC<NPCBodyLanguageVisualizerProps> = ({
  npc,
  variant = 'full',
}) => {
  const bl = getNPCBodyLanguage(npc);

  if (variant === 'hud') {
    return (
      <div 
        style={{ borderColor: `${bl.color}44`, backgroundColor: `${bl.color}15` }}
        className="inline-flex items-center space-x-1.5 px-2 py-0.5 rounded-full border text-[10px] font-mono font-bold"
      >
        <span className="text-xs">{bl.icon}</span>
        <span style={{ color: bl.color }}>{bl.state}</span>
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className="bg-slate-950/70 p-2 rounded border border-slate-800 flex items-center justify-between text-xs font-mono">
        <div className="flex items-center space-x-2">
          <span className="text-base">{bl.icon}</span>
          <div>
            <div style={{ color: bl.color }} className="font-chakra font-bold text-[11px]">
              {bl.label}
            </div>
            <div className="text-[10px] text-slate-400 line-clamp-1">{bl.postureDescription}</div>
          </div>
        </div>
        <div className="text-right text-[10px] text-slate-400">
          <div className="text-rose-400 font-bold">{bl.heartRateBpm} BPM</div>
          <div>{bl.breathingRate}</div>
        </div>
      </div>
    );
  }

  // Full Animation & Body Language Inspector
  return (
    <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 space-y-3 font-mono text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
        <div className="flex items-center space-x-2">
          <span className="text-xl animate-pulse">{bl.icon}</span>
          <div>
            <div className="text-[10px] text-slate-400 uppercase font-chakra font-bold">
              OBSERVABLE BODY LANGUAGE & EMOTIONAL STATE
            </div>
            <div style={{ color: bl.color }} className="font-chakra font-bold text-sm tracking-wider">
              {bl.label}
            </div>
          </div>
        </div>

        {/* Biometrics */}
        <div className="flex items-center space-x-3 text-[10px]">
          <div className="flex items-center space-x-1 text-rose-400 bg-rose-950/40 px-2 py-1 rounded border border-rose-800/40">
            <Heart className="w-3 h-3 animate-ping" />
            <span className="font-bold">{bl.heartRateBpm} BPM</span>
          </div>
          <div className="flex items-center space-x-1 text-cyan-400 bg-cyan-950/40 px-2 py-1 rounded border border-cyan-800/40">
            <Wind className="w-3 h-3" />
            <span>{bl.breathingRate} BREATH</span>
          </div>
        </div>
      </div>

      {/* Posture Description */}
      <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 text-slate-200 text-[11px] leading-relaxed">
        <span className="text-amber-400 font-bold">Kinesic Posture: </span>
        {bl.postureDescription}
      </div>

      {/* Dynamic Body Language Indicators Chips */}
      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
        <div className="bg-slate-900/40 p-1.5 rounded border border-slate-800 text-slate-300 flex items-center justify-between">
          <span className="text-slate-500">Gaze Vector:</span>
          <span className="text-white font-semibold">
            {bl.state === 'TERRIFIED' ? 'Darting / Sidewalks' : bl.state === 'ENRAGED' ? 'Center-Mass Fixed' : 'Scanning 60° Cone'}
          </span>
        </div>
        <div className="bg-slate-900/40 p-1.5 rounded border border-slate-800 text-slate-300 flex items-center justify-between">
          <span className="text-slate-500">Muscle Tension:</span>
          <span style={{ color: bl.color }} className="font-semibold">
            {bl.state === 'TERRIFIED' || bl.state === 'ENRAGED' ? 'Maximum (Rigid)' : 'Low / Relaxed'}
          </span>
        </div>
        <div className="bg-slate-900/40 p-1.5 rounded border border-slate-800 text-slate-300 flex items-center justify-between">
          <span className="text-slate-500">Hand Posture:</span>
          <span className="text-white font-semibold">
            {npc.hasWeaponDrawn ? 'Weapon Gripped' : bl.state === 'TERRIFIED' ? 'Raised Palms' : 'Near Belt / Waist'}
          </span>
        </div>
        <div className="bg-slate-900/40 p-1.5 rounded border border-slate-800 text-slate-300 flex items-center justify-between">
          <span className="text-slate-500">Vocal Pitch:</span>
          <span className="text-amber-300 font-semibold">
            {bl.state === 'TERRIFIED' ? 'Trembling Falsetto' : bl.state === 'ENRAGED' ? 'Guttural Roar' : 'Natural Cadence'}
          </span>
        </div>
      </div>
    </div>
  );
};
