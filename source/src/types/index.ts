export type FactionId = 'Families' | 'Ballas' | 'Vagos' | 'Madrazo Cartel' | 'LSPD' | 'Merryweather' | 'Civilians';

export type DiplomaticStatus = 'WAR' | 'HOSTILE' | 'TENSE_TRUCE' | 'STRATEGIC_ALLIANCE' | 'NEUTRAL';

export type EmotionalState = 
  | 'ENRAGED' 
  | 'TERRIFIED' 
  | 'SUSPICIOUS' 
  | 'GREEDY' 
  | 'RELAXED' 
  | 'STOIC' 
  | 'BLOOD_FEUD';

export interface BodyLanguageIndicator {
  state: EmotionalState;
  icon: string;
  label: string;
  postureDescription: string;
  animationClass: string;
  color: string;
  heartRateBpm: number;
  breathingRate: 'RAPID' | 'NORMAL' | 'HEAVY' | 'SHALLOW';
}

export interface Faction {
  id: FactionId;
  name: string;
  shortName: string;
  color: string;
  accentColor: string;
  headquarters: string;
  turfPercent: number;
  militaryStrength: number; // 0 - 100
  wealth: number; // 0 - 100
  playerRespect: number; // -100 to 100
  leader: string;
  description: string;
  diplomacy: Record<FactionId, DiplomaticStatus>;
  tacticalStyle: string;
  preferredWeapons: string[];
}

export interface MemoryIncident {
  id: string;
  timestamp: string;
  district: string;
  incidentType: 
    | 'HELD_AT_GUNPOINT' 
    | 'SAVED_LIFE' 
    | 'BETRAYAL_WITNESSED' 
    | 'BRIBE_ACCEPTED' 
    | 'HONORED_CONTRACT' 
    | 'GANG_WAR_CASUALTY' 
    | 'DISRESPECT_ON_TURF' 
    | 'FRIENDLY_DEAL';
  severity: 'TRIVIAL' | 'NOTABLE' | 'SEVERE' | 'UNFORGIVABLE';
  summary: string;
  directQuote?: string;
  impactOnRespect: number;
  impactOnFear: number;
}

export interface LongTermMemory {
  npcId: string;
  incidents: MemoryIncident[];
  grudge: {
    active: boolean;
    reason: string;
    severity: 'NONE' | 'MILD' | 'VENGEFUL' | 'BLOOD_FEUD';
    willAttackOnSight: boolean;
  };
  alliance: {
    active: boolean;
    reason: string;
    level: 'NONE' | 'CASUAL_FRIEND' | 'TRUSTED_ASSOCIATE' | 'RIDE_OR_DIE';
    willProvideBackup: boolean;
  };
  lastEncounterDate: string;
  totalEncounters: number;
}

export interface PersonalityMatrix {
  bravery: number;      // 0 (Cowardly) to 100 (Fearless / Suicidal)
  aggression: number;   // 0 (Pacifist) to 100 (Volatile / Psychopathic)
  caution: number;      // 0 (Reckless) to 100 (Hyper-vigilant / Tactical)
  friendliness: number; // 0 (Misanthropic) to 100 (Charismatic / Warm)
  greed: number;        // 0 (Loyal / Principled) to 100 (Bribable / Mercenary)
  primaryTrait: 'Brave' | 'Cautious' | 'Aggressive' | 'Friendly' | 'Greedy' | 'Volatile' | 'Cynical';
}

export interface NPCEntity {
  id: string;
  name: string;
  alias?: string;
  faction: FactionId;
  archetype: string;
  personality: PersonalityMatrix;
  x: number; // 0 to 100 (map percentage)
  y: number; // 0 to 100 (map percentage)
  targetX?: number;
  targetY?: number;
  district: string;
  health: number;
  maxHealth: number;
  fear: number; // 0 - 100
  aggression: number; // 0 - 100
  morale: number; // 0 - 100
  alertness: 'CALM' | 'SUSPICIOUS' | 'COMBAT' | 'PANICKED';
  weapon: string;
  hasWeaponDrawn: boolean;
  voiceTone: string;
  personalMemory: string;
  currentAction: string;
  spontaneousQuirk?: string;
  longTermMemory?: LongTermMemory;
  opinionOfPlayer: {
    respect: number; // -100 to 100
    fear: number; // 0 to 100
    trust: number; // -100 to 100
    label: string;
  };
  rumorsKnown: string[];
}

export interface Rumor {
  id: string;
  headline: string;
  whisperedDialogue: string;
  sourceFaction: FactionId;
  targetFaction: FactionId;
  credibilityPercent: number;
  socialImpact: string;
  playerReputationShift: string;
  timestamp: string;
  spreadCount: number;
}

export interface EmergentWarfareEvent {
  id: string;
  eventHeadline: string;
  timestamp: string;
  diplomaticShift?: {
    initiatorFaction: FactionId;
    targetFaction: FactionId;
    oldStatus: DiplomaticStatus;
    newStatus: DiplomaticStatus;
    reason: string;
  };
  territoryClash?: {
    district: string;
    attackingFaction: FactionId;
    defendingFaction: FactionId;
    contestedPercent: number;
    flashpointDescription: string;
  };
  worldAtmosphereNote: string;
}

export interface DialogueMessage {
  id: string;
  role: 'player' | 'npc';
  speakerName: string;
  text: string;
  timestamp: string;
  voiceTone?: string;
  action?: string;
  spontaneousQuirk?: string;
  internalThought?: string;
  fearDelta?: number;
  aggressionDelta?: number;
  factionRepDelta?: number;
}

export interface DistrictInfo {
  id: string;
  name: string;
  dominantFaction: FactionId;
  contestedPercent: number;
  dangerRating: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  x: number;
  y: number;
  width: number;
  height: number;
}
