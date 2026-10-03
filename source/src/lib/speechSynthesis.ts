import { NPCEntity, PersonalityMatrix } from '../types';
import { getNPCBodyLanguage } from '../components/NPCBodyLanguageVisualizer';

export interface VoiceProfileConfig {
  voiceName: string;
  pitch: number;      // 0.5 to 2.0
  rate: number;       // 0.5 to 2.0
  volume: number;     // 0 to 1.0
  styleLabel: string;
  emotionalState: string;
  emotionalIcon: string;
  pitchDescription: string;
  speedDescription: string;
}

/**
 * Dynamically calculates a browser speech synthesis voice profile
 * adjusting pitch and speed in real-time based on the NPC's emotional state
 * and live profile metadata (fear, aggression, alertness, personality, weapon status).
 */
export function getPersonalityVoiceProfile(npc: NPCEntity): VoiceProfileConfig {
  const p: PersonalityMatrix = npc.personality;
  const isFemale = npc.name.includes('Ashley') || npc.archetype.toLowerCase().includes('influencer');
  const bodyLang = getNPCBodyLanguage(npc);

  // Normalized emotional metadata factors (0.0 to 1.0)
  const fearRatio = Math.max(0, Math.min(100, npc.fear)) / 100;
  const aggRatio = Math.max(0, Math.min(100, npc.aggression)) / 100;
  const cautionRatio = (p.caution || 50) / 100;

  // Base vocal baseline by gender and faction
  let basePitch = isFemale ? 1.15 : 0.95;
  let baseRate = 1.0;
  let volume = 1.0;
  let styleLabel = 'Natural Conversational Cadence';
  let pitchDesc = 'Balanced Nominal Pitch';
  let speedDesc = '1.00x Conversational Rate';

  // Apply real-time emotional state modulation
  switch (bodyLang.state) {
    case 'BLOOD_FEUD': {
      // Cold, low bass, measured lethal delivery
      basePitch = isFemale ? 0.85 : 0.68;
      baseRate = 0.92;
      volume = 1.0;
      styleLabel = 'Predatory Vendetta (Cold & Lethal)';
      pitchDesc = 'Ultra-low guttural register (blood feud)';
      speedDesc = '0.92x Deliberate execution pacing';
      break;
    }

    case 'TERRIFIED': {
      // Dynamic pitch rises with fear level; speed accelerates into panic
      const dynamicPitchShift = fearRatio * 0.45; // Up to +0.45 pitch
      const dynamicRateShift = fearRatio * 0.35;  // Up to +0.35 speed
      basePitch = (isFemale ? 1.25 : 1.10) + dynamicPitchShift;
      baseRate = 1.12 + dynamicRateShift;
      volume = 0.92;
      styleLabel = 'Terrified / Hyperventilating Panic';
      pitchDesc = `Elevated tremble (+${Math.round(dynamicPitchShift * 100)}% treble)`;
      speedDesc = `Frantic panic surge (+${Math.round(dynamicRateShift * 100)}% speed)`;
      break;
    }

    case 'ENRAGED': {
      // Pitch drops into gravel roar with aggression; rate bursts aggressively
      const dynamicPitchDrop = aggRatio * 0.32; // Drops pitch by up to 0.32
      const dynamicRateBoost = aggRatio * 0.26; // Accelerates barked orders
      basePitch = Math.max(0.60, (isFemale ? 0.95 : 0.76) - dynamicPitchDrop);
      baseRate = 1.10 + dynamicRateBoost;
      volume = 1.0;
      styleLabel = 'Enraged / Combat Aggression Roar';
      pitchDesc = `Deepened combat roar (-${Math.round(dynamicPitchDrop * 100)}% bass drop)`;
      speedDesc = `Barked combat cadence (+${Math.round(dynamicRateBoost * 100)}% speed)`;
      break;
    }

    case 'SUSPICIOUS': {
      // Guarded, low, deliberate sizing up of player
      basePitch = isFemale ? 1.05 : 0.88;
      baseRate = Math.max(0.80, 0.94 - cautionRatio * 0.12);
      volume = 0.88;
      styleLabel = 'Suspicious / Low Guarded Mutter';
      pitchDesc = 'Guarded flat pitch with inflection checks';
      speedDesc = 'Slow, calculated surveillance cadence';
      break;
    }

    case 'GREEDY': {
      // Smooth, silky, persuasive commercial drawl
      basePitch = isFemale ? 1.12 : 0.94;
      baseRate = 1.02;
      volume = 0.92;
      styleLabel = 'Calculating / Silky Persuasive Drawl';
      pitchDesc = 'Silky melodic modulation (opportunist)';
      speedDesc = 'Measured persuasive timing';
      break;
    }

    case 'STOIC': {
      // Rigid, disciplined military attention
      basePitch = isFemale ? 1.00 : 0.82;
      baseRate = 0.88;
      volume = 0.90;
      styleLabel = 'Stoic / Disciplined Military Demeanor';
      pitchDesc = 'Monotone unyielding pitch';
      speedDesc = '0.88x Controlled military discipline';
      break;
    }

    case 'RELAXED':
    default: {
      // Street swagger or casual conversation
      if (npc.faction === 'Families' || npc.faction === 'Ballas' || npc.faction === 'Vagos') {
        basePitch = isFemale ? 1.10 : 0.86;
        baseRate = 1.04;
        styleLabel = 'West Coast Street Swagger';
        pitchDesc = 'Relaxed street drawl';
        speedDesc = 'Effortless street swagger cadence';
      } else {
        basePitch = isFemale ? 1.15 : 0.98;
        baseRate = 0.98;
        styleLabel = 'Relaxed / Casual Citizen Cadence';
        pitchDesc = 'Neutral conversational pitch';
        speedDesc = 'Standard 1.00x pacing';
      }
      break;
    }
  }

  // Extra boost if weapon is actively drawn
  if (npc.hasWeaponDrawn) {
    baseRate = Math.min(1.50, baseRate + 0.08);
    volume = Math.min(1.0, volume + 0.05);
  }

  // Final clamping to browser-safe parameters
  const finalPitch = Math.max(0.55, Math.min(1.90, Number(basePitch.toFixed(2))));
  const finalRate = Math.max(0.70, Math.min(1.70, Number(baseRate.toFixed(2))));
  const finalVolume = Math.max(0.20, Math.min(1.0, Number(volume.toFixed(2))));

  return {
    voiceName: isFemale ? 'Female Voice' : 'Male Voice',
    pitch: finalPitch,
    rate: finalRate,
    volume: finalVolume,
    styleLabel,
    emotionalState: bodyLang.state,
    emotionalIcon: bodyLang.icon,
    pitchDescription: pitchDesc,
    speedDescription: speedDesc,
  };
}

/**
 * Speaks text using the browser SpeechSynthesis API with the NPC's custom profile.
 */
export function speakNPCUtterance(
  text: string, 
  npc: NPCEntity, 
  onStart?: () => void, 
  onEnd?: () => void
): SpeechSynthesisUtterance | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    console.warn('Browser SpeechSynthesis is not supported in this environment.');
    return null;
  }

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  // Strip action indicators like *looks around*
  const cleanText = text.replace(/\*[^*]+\*/g, '').trim();
  if (!cleanText) return null;

  const profile = getPersonalityVoiceProfile(npc);
  const utterance = new SpeechSynthesisUtterance(cleanText);

  utterance.pitch = profile.pitch;
  utterance.rate = profile.rate;
  utterance.volume = profile.volume;

  // Pick suitable available voice from browser list
  const voices = window.speechSynthesis.getVoices();
  const isFemale = npc.name.includes('Ashley') || npc.archetype.toLowerCase().includes('influencer');

  if (voices.length > 0) {
    const matchingVoice = voices.find((v) => {
      const name = v.name.toLowerCase();
      if (isFemale) {
        return name.includes('female') || name.includes('samantha') || name.includes('zira') || name.includes('victoria');
      }
      return name.includes('male') || name.includes('david') || name.includes('george') || name.includes('james') || name.includes('alex');
    }) || voices.find((v) => v.lang.startsWith('en')) || voices[0];

    if (matchingVoice) {
      utterance.voice = matchingVoice;
    }
  }

  if (onStart) utterance.onstart = onStart;
  if (onEnd) utterance.onend = onEnd;
  utterance.onerror = (e) => {
    console.warn('SpeechSynthesis error:', e);
    if (onEnd) onEnd();
  };

  window.speechSynthesis.speak(utterance);
  return utterance;
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
