import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { audioToWav, DEFAULT_TEXT_MODEL, DIPLOMATIC_STATUSES, FACTION_IDS, isAllowedLocalRequest, loadMemoryStore, normalizeWarfareUpdate, persistMemoryStore, readGeminiCredential, redactError, RuntimeStatus, serverConfiguration } from './server-lib/compatibility.ts';
import { WorldState } from './server-lib/world.ts';
import { installWorldRoutes } from './server-lib/world-routes.ts';
import { SettingsStore } from './server-lib/settings-store.ts';
import { installSettingsRoutes } from './server-lib/settings-routes.ts';
import { GeminiProvider, providerError } from './server-lib/ai-provider.ts';
import { AiService } from './server-lib/ai-service.ts';
import { installAiRoutes } from './server-lib/ai-routes.ts';
import { meteredLegacyClient } from './server-lib/ai-legacy.ts';
import { createDiagnosticReport } from './server-lib/diagnostics.ts';
import { installDiagnosticRoutes } from './server-lib/diagnostic-routes.ts';
import { MenuAiService } from './server-lib/ai-menu.ts';
import { installMenuAiRoutes } from './server-lib/ai-menu-routes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: [path.join(__dirname, '.env.local'), path.join(__dirname, '.env')], quiet: true });

export const app = express();
const { host: HOST, port: PORT } = serverConfiguration();
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || DEFAULT_TEXT_MODEL;
const TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-lite-tts';
const knownSecrets = new Set<string>();
let client: GoogleGenAI | null = null;
let clientKey: string | null = null;
function getRawAI(): GoogleGenAI {
  const key = readGeminiCredential();
  if (!key) throw new Error('Gemini is not configured. Set a private backend key or use the existing game settings.');
  knownSecrets.add(key);
  if (!client || key !== clientKey) {
    client = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: 20_000 } });
    clientKey = key;
  }
  return client;
}
function hasGemini() { return readGeminiCredential() !== null; }
function safeError(error: unknown) { return redactError(error, knownSecrets); }
function logUpstream(context: string, error: unknown) { console.warn(context, providerError(error).code); }
const runtime = new RuntimeStatus();
const world = new WorldState(path.join(process.env.LLAI_DATA_DIR || path.join(__dirname, 'data'), 'world-settings.json'));
const npcDataDirectory = process.env.LLAI_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(__dirname, 'data'), 'LivingLosSantos', 'Enhanced');
export const npcSettings = new SettingsStore(path.join(npcDataDirectory, 'npc-settings-v4.json'));
npcSettings.bindWorld(world);
export const aiProvider = new GeminiProvider(getRawAI, hasGemini);
export const aiService = new AiService({ provider: aiProvider, getSettings: () => npcSettings.snapshot().settings, directory: npcDataDirectory });
const diagnosticReport = () => createDiagnosticReport({ settings: npcSettings.snapshot(), world: world.snapshot(), ai: aiService.status(), audio: { available: false } });
export const menuAiService = new MenuAiService({ provider: aiProvider, budget: aiService.budget, scheduler: aiService.scheduler, getSettings: () => npcSettings.snapshot().settings, snapshot: () => npcSettings.snapshot(),
  previewBundle: (settings, worldPatch) => { npcSettings.previewBundle(settings, worldPatch); }, applyBundle: (settings, worldPatch, revision, worldRevision) => npcSettings.configureBundle(settings, worldPatch, 'advisor', revision, worldRevision), diagnosticReport, directory: npcDataDirectory });
npcSettings.subscribe(() => aiService.settingsChanged());
function getAI(): GoogleGenAI { return meteredLegacyClient(getRawAI(), aiService.budget, aiService.scheduler, () => aiService.scope(), () => npcSettings.snapshot().settings); }

// Native clients have no Origin. Browser calls must originate from this loopback companion.
app.use('/api', (req, res, next) => {
  if (!isAllowedLocalRequest(req.headers.host, req.get('origin'), req.get('sec-fetch-site'), PORT)) {
    return res.status(403).json({ success: false, error: 'Only this local companion origin is allowed.' });
  }
  next();
});
app.use(express.json({ limit: '10mb', strict: true }));
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && (!req.is('application/json') || !req.body || typeof req.body !== 'object' || Array.isArray(req.body))) {
    return res.status(400).json({ success: false, error: 'A JSON object body is required.' });
  }
  next();
});

async function bridgeStatus() {
  try {
    const response = await fetch('http://127.0.0.1:8765/health', { signal: AbortSignal.timeout(750) });
    if (!response.ok) return { reachable: false, port: 8765, provider: null };
    const state = await response.json() as Record<string, unknown>;
    return { reachable: true, port: 8765, provider: typeof state.provider === 'string' ? state.provider.slice(0, 32) : null };
  } catch { return { reachable: false, port: 8765, provider: null }; }
}

// Health & Status Endpoint
app.get('/api/health', async (req, res) => {
  res.json({
    status: 'online',
    version: '4.0.0-enhanced-foundation',
    model: TEXT_MODEL,
    geminiConfigured: hasGemini(),
    mode: 'enhanced-companion',
    gameRuntime: runtime.summary(),
    bridge: await bridgeStatus(),
    worldRuntime: { protocol: 4, legacyProtocol: 3, connected: world.snapshot().connected, runtimeId: world.snapshot().runtimeId },
    npcRuntime: aiService.status().runtime,
    tacticalMLEngine: 'In-game encounter director with bounded utility tactics and observed battle outcomes',
    cloudSyncEnabled: false,
  });
});

app.post('/api/runtime/telemetry', (req, res) => {
  try {
    const gameRuntime = runtime.record(req.body);
    res.json({ success: true, gameRuntime });
  } catch (error) { res.status(400).json({ success: false, error: safeError(error) }); }
});
app.get('/api/runtime/status', (req, res) => res.json({ success: true, ...runtime.snapshot() }));
const recordWorldTelemetry = (telemetry: unknown) => {
  const input = telemetry as Record<string, unknown>;
  runtime.record({ ...input, player: input.player ?? undefined, environment: input.environment ?? undefined });
};
installSettingsRoutes(app, npcSettings);
installAiRoutes(app, aiService, world, npcSettings, recordWorldTelemetry, () => menuAiService.status());
installMenuAiRoutes(app, menuAiService);
installWorldRoutes(app, world, recordWorldTelemetry);
installDiagnosticRoutes(app,path.join(npcDataDirectory,'diagnostics'),diagnosticReport);

// Local companion memory only; independent of the installed mod and Firebase.
const memoryFile = path.join(process.env.LLAI_DATA_DIR || path.join(__dirname, 'data'), 'npc-memories.json');
const npcMemoryStore: Record<string, any> = loadMemoryStore(memoryFile);

// Get all long-term memories
app.get('/api/memory/all', (req, res) => {
  res.json({ success: true, memories: npcMemoryStore });
});

// Record or update memory incident / grudge
app.post('/api/memory/record', (req, res) => {
  const { npcId, incident, grudge, alliance } = req.body;
  if (typeof npcId !== 'string' || !/^[A-Za-z0-9_:-]{1,128}$/.test(npcId)) return res.status(400).json({ success: false, error: 'A bounded npcId is required.' });
  if (JSON.stringify({ incident, grudge, alliance }).length > 16_000) return res.status(400).json({ success: false, error: 'Memory record is too large.' });
  if (!npcMemoryStore[npcId] && Object.keys(npcMemoryStore).length >= 2000) return res.status(400).json({ success: false, error: 'Companion memory limit reached.' });

  if (!npcMemoryStore[npcId]) {
    npcMemoryStore[npcId] = {
      npcId,
      incidents: [],
      grudge: { active: false, reason: '', severity: 'NONE', willAttackOnSight: false },
      alliance: { active: false, reason: '', level: 'NONE', willProvideBackup: false },
      lastEncounterDate: new Date().toISOString(),
      totalEncounters: 0,
    };
  }

  const mem = npcMemoryStore[npcId];
  if (incident) {
    mem.incidents.unshift(incident);
    mem.incidents = mem.incidents.slice(0, 100);
  }
  if (grudge !== undefined) {
    mem.grudge = grudge;
  }
  if (alliance !== undefined) {
    mem.alliance = alliance;
  }
  mem.totalEncounters += 1;
  mem.lastEncounterDate = new Date().toISOString();

  try {
    persistMemoryStore(memoryFile, npcMemoryStore);
    res.json({ success: true, memory: mem, source: 'local-companion-memory' });
  } catch (error) { res.status(500).json({ success: false, error: safeError(error) }); }
});

// Clear all memories
app.delete('/api/memory/clear', (req, res) => {
  for (const k in npcMemoryStore) delete npcMemoryStore[k];
  try {
    persistMemoryStore(memoryFile, npcMemoryStore);
    res.json({ success: true, message: 'Local companion NPC memories reset' });
  } catch (error) { res.status(500).json({ success: false, error: safeError(error) }); }
});

// NPC Dialogue & Social Interaction with Gemini
app.post('/api/dialogue', async (req, res) => {
  try {
    const { npc, player, environment, playerUtterance, history } = req.body;

    const systemInstruction = `You are the neural intelligence engine for Grand Theft Auto V mod "Living Los Santos AI v2".
You control an NPC in Los Santos who possesses real human personality, tactical instincts, social bias, and spontaneous behavior.
Always remain in-character for the GTA universe (gritty, humorous, cynical, realistic, dramatic).

NPC PROFILE:
- Name: ${npc?.name || 'Pedestrian'}
- Faction: ${npc?.faction || 'Civilians'}
- Archetype: ${npc?.archetype || 'Street Resident'}
- Base Weapon: ${npc?.weapon || 'Unarmed'}
- Current Fear (0-100): ${npc?.fear || 20}
- Current Aggression (0-100): ${npc?.aggression || 30}
- Current Morale (0-100): ${npc?.morale || 70}
- Personal Memory of Player: ${npc?.memory || 'First time encountering this person'}
- LONG-TERM MEMORY & GRUDGE STATUS:
  * Grudge Active: ${npc?.longTermMemory?.grudge?.active ? `YES - Level: ${npc.longTermMemory.grudge.severity}. Reason: "${npc.longTermMemory.grudge.reason}"` : 'None'}
  * Alliance Active: ${npc?.longTermMemory?.alliance?.active ? `YES - Level: ${npc.longTermMemory.alliance.level}. Reason: "${npc.longTermMemory.alliance.reason}"` : 'None'}
  * Past Recorded Incidents: ${npc?.longTermMemory?.incidents?.length ? JSON.stringify(npc.longTermMemory.incidents.slice(0, 3).map((i: any) => `${i.incidentType} (${i.severity}): ${i.summary}`)) : 'None'}

WORLD CONTEXT:
- District: ${environment?.district || 'Davis'}
- Weather: ${environment?.weather || 'Clear'}
- Time of Day: ${environment?.timeOfDay || 'Night'}
- Player Wanted Level: ${player?.wantedLevel || 0} Stars
- Player Weapon Drawn: ${player?.weaponDrawn ? player.weaponDrawnName || 'Firearm' : 'Holstered / None'}
- Player Stance: ${player?.stance || 'Casual'}
- Faction Respect towards Player (-100 to 100): ${player?.factionStandings?.[npc?.faction] ?? 0}
- Nearby Gunfire or Chaos: ${environment?.nearbyGunfire ? 'YES - gunfire echoes within 100m' : 'Calm'}

PLAYER SAYS OR DOES: "${playerUtterance || '*Walks up and gestures*'}"

RULES:
1. Speak realistically with natural cadence, appropriate slang, dialect, or corporate/cop jargon. Keep speech between 1 to 3 punchy sentences.
2. Spontaneous Actions: The NPC can spontaneously react to threats, disrespect, bribes, weather, or police presence.
Valid actions:
- 'TALK_CASUAL' (relaxed conversation)
- 'INTIMIDATE' (threaten or posture)
- 'DRAW_WEAPON' (pull out weapon ready to shoot)
- 'ATTACK_MELEE' (throw punch or push)
- 'TAKE_COVER' (dive behind car or wall)
- 'FLEE_PANICKED' (run away screaming)
- 'CALL_FACTION_BACKUP' (whistle or radio homies/squad)
- 'CALL_911' (call police on cell phone)
- 'SURRENDER' (hands up, plead for life)
- 'OFFER_SIDE_GIG' (propose illegal hustle or tip)
- 'HANDSHAKE_RESPECT' (greet with gang sign or respectful nod)
3. Return output adhering strictly to the JSON schema.`;

    if (hasGemini()) {
      const response = await getAI().models.generateContent({
        model: TEXT_MODEL,
        contents: [
          ...(Array.isArray(history) ? history.map((h: any) => ({
            role: h.role === 'npc' ? 'model' : 'user',
            parts: [{ text: h.text }]
          })) : []),
          {
            role: 'user',
            parts: [{ text: `Player: "${playerUtterance}". What do you say, how do you feel, and what spontaneous action do you take?` }]
          }
        ],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              speech: { type: Type.STRING, description: 'Spoken line with authentic voice and slang' },
              voiceTone: { type: Type.STRING, description: 'Vocal inflection e.g. Anxious mutter, Boastful gang swagger, Cold commanding' },
              action: { type: Type.STRING, description: 'Spontaneous action code e.g. DRAW_WEAPON, TALK_CASUAL, CALL_911, TAKE_COVER' },
              spontaneousQuirk: { type: Type.STRING, description: 'Physical mannerism e.g. Taps gun grip, adjusts jacket, looks at rain' },
              internalThought: { type: Type.STRING, description: 'Internal assessment of player and danger' },
              fearDelta: { type: Type.INTEGER, description: 'Change in fear (-40 to +40)' },
              aggressionDelta: { type: Type.INTEGER, description: 'Change in aggression (-40 to +40)' },
              factionRepDelta: { type: Type.INTEGER, description: 'Change in player faction standing (-20 to +20)' },
              memoryNote: { type: Type.STRING, description: 'Short bullet point to store in persistent NPC memory' },
            },
            required: ['speech', 'voiceTone', 'action', 'spontaneousQuirk', 'internalThought', 'fearDelta', 'aggressionDelta', 'factionRepDelta', 'memoryNote'],
          }
        }
      });

      const parsed = JSON.parse(response.text || '{}');
      return res.json({ success: true, result: parsed, source: TEXT_MODEL });
    } else {
      // Intelligent fallback when API key is not configured yet
      const fallback = generateHeuristicNPCResponse(npc, player, environment, playerUtterance);
      return res.json({ success: true, result: fallback, source: 'heuristic-ml-engine' });
    }
  } catch (error: any) {
    logUpstream('Dialogue API Error:', error);
    const fallback = generateHeuristicNPCResponse(req.body.npc, req.body.player, req.body.environment, req.body.playerUtterance);
    return res.json({ success: true, result: fallback, source: 'fallback-on-error', error: safeError(error) });
  }
});

// Spontaneous Los Santos Emergent Event Generator
app.post('/api/spontaneous-event', async (req, res) => {
  try {
    const { district, playerReputation, heatLevel, weather, timeOfDay } = req.body;

    const systemInstruction = `You are the Dynamic Story & World Director for GTA V "Living Los Santos AI v2".
Generate an authentic, spontaneous, emergent world event happening right now in Los Santos that directly intersects with player presence.
Events should feel like organic Los Santos life: cartel drops, rival gang drive-bys, police sting operations, street brawls, road rage escalations, spontaneous street races, or criminal heists.`;

    if (hasGemini()) {
      const response = await getAI().models.generateContent({
        model: TEXT_MODEL,
        contents: `Generate a spontaneous emergent event for district "${district || 'Davis'}" at "${timeOfDay || 'Dusk'}" with weather "${weather || 'Clear'}" and player heat level ${heatLevel || 0}.`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: 'Catchy event title' },
              district: { type: Type.STRING, description: 'District in Los Santos' },
              factionsInvolved: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Factions clashing or participating'
              },
              description: { type: Type.STRING, description: 'Sensory description of what starts unfolding' },
              playerOpportunity: { type: Type.STRING, description: 'How player can intervene, exploit, or profit' },
              threatLevel: { type: Type.STRING, description: 'LOW, MEDIUM, HIGH, LETHAL' },
              escalationTimerSec: { type: Type.INTEGER, description: 'Seconds until situation explodes' },
              initialNPCActions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Immediate spontaneous actions NPCs take'
              }
            },
            required: ['title', 'district', 'factionsInvolved', 'description', 'playerOpportunity', 'threatLevel', 'escalationTimerSec', 'initialNPCActions']
          }
        }
      });

      const parsed = JSON.parse(response.text || '{}');
      return res.json({ success: true, event: parsed, source: TEXT_MODEL });
    } else {
      const defaultEvent = generateHeuristicWorldEvent(district || 'Davis', heatLevel || 0);
      return res.json({ success: true, event: defaultEvent, source: 'heuristic-event-engine' });
    }
  } catch (error: any) {
    logUpstream('Spontaneous Event Error:', error);
    const defaultEvent = generateHeuristicWorldEvent('Davis', 0);
    return res.json({ success: true, event: defaultEvent, source: 'fallback-event' });
  }
});

// Tactical ML Combat Coordinator
app.post('/api/tactical-decision', async (req, res) => {
  try {
    const { squad, targets, coverPositions, environment } = req.body;

    const systemInstruction = `You are the Machine Learning Tactical Combat Director for GTA V "Living Los Santos AI v2".
You coordinate squad maneuvers (LSPD SWAT, Ballas strike team, Vagos hit squad, or Merryweather mercenaries) in real-time.
Calculate flanking vectors, bounding overwatch, cover suppression, and tactical callouts.`;

    if (hasGemini()) {
      const response = await getAI().models.generateContent({
        model: TEXT_MODEL,
        contents: `Evaluate combat situation: Squad of ${squad?.length || 3} operatives facing target at range. Weather is ${environment?.weather || 'Clear'}. Cover availability is ${coverPositions?.length || 4} nodes. Recommend coordinated tactical plan.`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              tacticalPlanName: { type: Type.STRING, description: 'Name of maneuver e.g. Pincer Bounding Overwatch' },
              radioCallout: { type: Type.STRING, description: 'Authentic tactical chatter over radio' },
              suppressionTargetId: { type: Type.STRING, description: 'Target to pin down with heavy fire' },
              flankerMemberId: { type: Type.STRING, description: 'Member assigned to flank' },
              retreatThresholdMorale: { type: Type.INTEGER, description: 'Morale % when squad retreats' },
              posture: { type: Type.STRING, description: 'AGGRESSIVE_PUSH, DEFENSIVE_HOLD, FLANK_ENVELOPE, FALLBACK' },
              squadOrders: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    unitName: { type: Type.STRING },
                    order: { type: Type.STRING },
                    targetCoverNode: { type: Type.STRING }
                  },
                  required: ['unitName', 'order', 'targetCoverNode']
                }
              }
            },
            required: ['tacticalPlanName', 'radioCallout', 'posture', 'squadOrders', 'retreatThresholdMorale']
          }
        }
      });
      const parsed = JSON.parse(response.text || '{}');
      return res.json({ success: true, tactics: parsed, source: TEXT_MODEL });
    } else {
      const fallbackTactics = generateHeuristicTactics(squad);
      return res.json({ success: true, tactics: fallbackTactics, source: 'heuristic-tactics' });
    }
  } catch (error: any) {
    logUpstream('Tactical Decision Error:', error);
    const fallbackTactics = generateHeuristicTactics(req.body.squad);
    return res.json({ success: true, tactics: fallbackTactics, source: 'fallback-tactics' });
  }
});

// Heuristic fallback functions for offline or instantaneous response
function generateHeuristicNPCResponse(npc: any, player: any, env: any, utterance: string) {
  const faction = npc?.faction || 'Civilians';
  const playerWeapon = player?.weaponDrawn;
  const wanted = player?.wantedLevel || 0;

  if (playerWeapon) {
    if (faction === 'LSPD' || faction === 'NOOSE') {
      return {
        speech: "LSPD! Drop the weapon immediately and get on the ground, or we will open fire!",
        voiceTone: "Authoritative, screaming through megaphone",
        action: "DRAW_WEAPON",
        spontaneousQuirk: "Takes combat stance and clicks safety off",
        internalThought: "Subject is armed with a deadly firearm. Authorizing lethal force if barrel points toward officers.",
        fearDelta: -10,
        aggressionDelta: 45,
        factionRepDelta: -25,
        memoryNote: "Subject brandished lethal weapon in public."
      };
    }
    if (faction === 'Families' || faction === 'Ballas' || faction === 'Vagos') {
      return {
        speech: "You flashing that iron on our turf, fool?! Put that piece away 'fore you get ventilated!",
        voiceTone: "Aggressive street swagger with hand on waistband",
        action: "DRAW_WEAPON",
        spontaneousQuirk: "Whistles loudly to alert fellow gang members down the block",
        internalThought: "Player is testing our block. Can't look weak in front of the set.",
        fearDelta: 15,
        aggressionDelta: 40,
        factionRepDelta: -20,
        memoryNote: "Pulled gun on gang territory."
      };
    }
    return {
      speech: "Whoa, whoa! Don't shoot man, take whatever you want, please!",
      voiceTone: "Trembling panicked shriek",
      action: "SURRENDER",
      spontaneousQuirk: "Raises hands in air, knees trembling",
      internalThought: "Armed robber! Stay calm, don't make sudden moves.",
      fearDelta: 50,
      aggressionDelta: -20,
      factionRepDelta: -10,
      memoryNote: "Held at gunpoint by player."
    };
  }

  if (wanted > 1 && (faction === 'LSPD' || faction === 'NOOSE')) {
    return {
      speech: "Dispatch, we have eyes on the active felony suspect. Moving in to apprehend!",
      voiceTone: "Urgent radio transmission",
      action: "DRAW_WEAPON",
      spontaneousQuirk: "Taps chest microphone and calls unit",
      internalThought: "Active felony warrant. Suspect must be taken down.",
      fearDelta: 0,
      aggressionDelta: 35,
      factionRepDelta: -15,
      memoryNote: "Attempted felony apprehension."
    };
  }

  // Normal social interaction
  if (faction === 'Families') {
    return {
      speech: "What's good with you, homie? Keep your head on a swivel around Chamberlain.",
      voiceTone: "Relaxed West Coast drawl",
      action: "HANDSHAKE_RESPECT",
      spontaneousQuirk: "Gives respectful gang sign and nods",
      internalThought: "Seems alright, not repping rival colors. Keeping casual eye on them.",
      fearDelta: -5,
      aggressionDelta: -10,
      factionRepDelta: 5,
      memoryNote: "Friendly exchange on the block."
    };
  } else if (faction === 'Vagos') {
    return {
      speech: "¿Qué onda, vato? If you ain't looking for business, keep moving down Rancho.",
      voiceTone: "Gritty, skeptical Spanish-English accent",
      action: "INTIMIDATE",
      spontaneousQuirk: "Leans against lowrider hood, folding arms",
      internalThought: "Outsider walking through Rancho. Need to ensure they aren't DEA or Ballas.",
      fearDelta: 0,
      aggressionDelta: 10,
      factionRepDelta: 0,
      memoryNote: "Casual standoff on Rancho turf."
    };
  } else if (faction === 'Madrazo Cartel') {
    return {
      speech: "Mr. Madrazo appreciates people who understand discretion. Speak carefully.",
      voiceTone: "Cold, polite, menacing",
      action: "TALK_CASUAL",
      spontaneousQuirk: "Adjusts sunglasses and scans the street perimeter",
      internalThought: "Assessing if this individual is an asset or a liability to the organization.",
      fearDelta: -5,
      aggressionDelta: 5,
      factionRepDelta: 10,
      memoryNote: "Professional diplomatic contact."
    };
  }

  return {
    speech: "Hey man, Los Santos is crazy today. Did you hear those sirens over by Vinewood?",
    voiceTone: "Casual city pedestrian",
    action: "TALK_CASUAL",
    spontaneousQuirk: "Checks smartphone screen and looks up at the sky",
    internalThought: "Just an ordinary conversation with a passerby.",
    fearDelta: 0,
    aggressionDelta: 0,
    factionRepDelta: 2,
    memoryNote: "Casual small talk."
  };
}

function generateHeuristicWorldEvent(district: string, heat: number) {
  const events = [
    {
      title: "Rival Cartel Weapon Transfer Ambush",
      district: district || "Port of Los Santos",
      factionsInvolved: ["Madrazo Cartel", "Vagos", "LSPD"],
      description: "An armored Speedo van is parked behind shipping container depot 4B. Armed Vagos lookouts spotted a suspicious black Cavalcade closing in.",
      playerOpportunity: "Ambush both sides for high-grade mil-spec carbines or tip off LSPD for reputation boost.",
      threatLevel: "HIGH",
      escalationTimerSec: 45,
      initialNPCActions: ["Lookouts draw micro-SMGs", "Cavalcade turns off headlights", "Driver revs engine"]
    },
    {
      title: "Davis Corner Store Shakedown Escalation",
      district: district || "Davis",
      factionsInvolved: ["Ballas", "Families", "Civilians"],
      description: "Two Ballas enforcers are shaking down the 24/7 clerk on Carson Ave. A Families scout across the street just cocked a pump shotgun.",
      playerOpportunity: "Disarm the robbers or back up the Families to earn major South Central street respect.",
      threatLevel: "MEDIUM",
      escalationTimerSec: 30,
      initialNPCActions: ["Clerk raises hands behind counter", "Ballas enforcer brandishes heavy pistol", "Scout takes cover behind dumpster"]
    },
    {
      title: "High-Speed NOOSE Interception",
      district: district || "Downtown Pillbox Hill",
      factionsInvolved: ["NOOSE", "LSPD", "Madrazo Cartel"],
      description: "NOOSE tactical SUVs have cornered a matte-black Schafter carrying cartel bearer bonds at the Maze Bank intersection.",
      playerOpportunity: "Intercept the bearer bonds during the shootout or provide suppression cover.",
      threatLevel: "LETHAL",
      escalationTimerSec: 20,
      initialNPCActions: ["NOOSE deploys spike strips", "Cartel passenger fires assault rifle through rear window", "Civilians abandon cars in panic"]
    }
  ];
  return events[Math.floor(Math.random() * events.length)];
}

function generateHeuristicTactics(squad: any[]) {
  return {
    tacticalPlanName: "Bounding Overwatch with Dynamic Crossfire",
    radioCallout: "Team Two, lay down suppressive fire on target vector! Brax, flank wide along the brick wall!",
    suppressionTargetId: "player",
    flankerMemberId: squad?.[1]?.id || "unit_2",
    retreatThresholdMorale: 35,
    posture: "FLANK_ENVELOPE",
    squadOrders: [
      { unitName: squad?.[0]?.name || "Lead Gunner", order: "Continuous suppression bursts, keep target pinned in cover", targetCoverNode: "Concrete Barrier Alpha" },
      { unitName: squad?.[1]?.name || "Flanker", order: "Sprint to 45-degree angle blindspot while suppression is active", targetCoverNode: "Dumpster Corner Bravo" },
      { unitName: squad?.[2]?.name || "Marksman", order: "Hold high ground overwatch, pick off target if they peek", targetCoverNode: "Fire Escape Platform" }
    ]
  };
}

// Social Gossip & Rumor Mill Generator
app.post('/api/social/gossip', async (req, res) => {
  try {
    const { district, playerActions, factions } = req.body;
    const systemInstruction = `You are the Los Santos Social Rumor Engine for GTA V "Living Los Santos AI v2".
Generate realistic street rumors, gossip, and word-of-mouth intelligence spreading between NPCs.
Rumors can be true, exaggerated, or outright paranoid street myths about the player, recent shootouts, police corruption, or gang turf shifts.`;

    if (hasGemini()) {
      const response = await getAI().models.generateContent({
        model: TEXT_MODEL,
        contents: `Generate 3 distinct street rumors currently spreading in "${district || 'Davis'}" given player reputation and actions: "${JSON.stringify(playerActions || [])}".`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                headline: { type: Type.STRING },
                whisperedDialogue: { type: Type.STRING, description: 'How an NPC whispers this rumor' },
                sourceFaction: { type: Type.STRING },
                targetFaction: { type: Type.STRING },
                credibilityPercent: { type: Type.INTEGER },
                socialImpact: { type: Type.STRING, description: 'e.g. Increases suspicion, sparks gang paranoia' },
                playerReputationShift: { type: Type.STRING }
              },
              required: ['headline', 'whisperedDialogue', 'sourceFaction', 'targetFaction', 'credibilityPercent', 'socialImpact']
            }
          }
        }
      });
      const parsed = JSON.parse(response.text || '[]');
      return res.json({ success: true, rumors: parsed, source: TEXT_MODEL });
    } else {
      const fallbackRumors = [
        {
          headline: "Rumor of Armed Freelancer in South Central",
          whisperedDialogue: "Yo, keep your eyes peeled. Word is some new shooter in town pulled heat on Carson Ave and didn't even flinch.",
          sourceFaction: "Families",
          targetFaction: "Ballas",
          credibilityPercent: 85,
          socialImpact: "Gang lookouts are checking strangers for concealed weapons.",
          playerReputationShift: "+10 Notoriety in Davis"
        },
        {
          headline: "Corrupt LSPD Undercover Sting Rumor",
          whisperedDialogue: "Don't sell no packages around Rancho tonight, homie. Cousin in Mission Row says NOOSE is setting up covert surveillance vans.",
          sourceFaction: "Vagos",
          targetFaction: "LSPD",
          credibilityPercent: 65,
          socialImpact: "Vagos street dealers are retreating indoors during dusk hours.",
          playerReputationShift: "Neutral"
        },
        {
          headline: "Madrazo Cartel Offering High-Roller Bounties",
          whisperedDialogue: "Madrazo's enforcers are looking for reliable operators who aren't afraid of dirtying their hands with city officials.",
          sourceFaction: "Madrazo Cartel",
          targetFaction: "Civilians",
          credibilityPercent: 90,
          socialImpact: "Mercenaries and hitmen are patrolling Port of Los Santos looking for contracts.",
          playerReputationShift: "Opportunity Unlocked"
        }
      ];
      return res.json({ success: true, rumors: fallbackRumors, source: 'heuristic-rumor-engine' });
    }
  } catch (error: any) {
    logUpstream('Gossip API Error:', error);
    return res.json({ success: false, error: safeError(error) });
  }
});

// Emergent Faction Warfare & Diplomatic Shift Simulation
app.post('/api/factions/warfare-tick', async (req, res) => {
  try {
    const { factions, currentTurf, recentEvents, playerAllegiance } = req.body;
    const systemInstruction = `You are the Dynamic Faction Warfare & Political AI for GTA V "Living Los Santos AI v2".
Analyze the power balance between Los Santos factions (Families, Ballas, Vagos, Madrazo Cartel, LSPD, Merryweather).
Determine if alliances shift, wars are declared, truces broken, or surprise territorial raids launched based on power vacuums and player allegiance.`;

    if (hasGemini()) {
      const response = await getAI().models.generateContent({
        model: TEXT_MODEL,
        contents: `Evaluate faction states: ${JSON.stringify(factions)}. Recent events: ${JSON.stringify(recentEvents)}. Player loyalty: ${JSON.stringify(playerAllegiance)}. What diplomatic or territorial shifts occur this cycle?`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              eventHeadline: { type: Type.STRING },
              diplomaticShift: {
                type: Type.OBJECT,
                properties: {
                  initiatorFaction: { type: Type.STRING, enum: [...FACTION_IDS] },
                  targetFaction: { type: Type.STRING, enum: [...FACTION_IDS] },
                  oldStatus: { type: Type.STRING, enum: [...DIPLOMATIC_STATUSES] },
                  newStatus: { type: Type.STRING, enum: [...DIPLOMATIC_STATUSES] },
                  reason: { type: Type.STRING }
                },
                required: ['initiatorFaction', 'targetFaction', 'oldStatus', 'newStatus', 'reason']
              },
              territoryClash: {
                type: Type.OBJECT,
                properties: {
                  district: { type: Type.STRING },
                  attackingFaction: { type: Type.STRING, enum: [...FACTION_IDS] },
                  defendingFaction: { type: Type.STRING, enum: [...FACTION_IDS] },
                  contestedPercent: { type: Type.INTEGER, minimum: 0, maximum: 100 },
                  flashpointDescription: { type: Type.STRING }
                },
                required: ['district', 'attackingFaction', 'defendingFaction', 'contestedPercent', 'flashpointDescription']
              },
              worldAtmosphereNote: { type: Type.STRING, description: 'How pedestrians and cops in that area behave as a result' }
            },
            required: ['eventHeadline', 'diplomaticShift', 'territoryClash', 'worldAtmosphereNote']
          }
        }
      });
      const parsed = JSON.parse(response.text || '{}');
      return res.json({ success: true, warfareUpdate: normalizeWarfareUpdate(parsed, factions), source: TEXT_MODEL });
    } else {
      const fallbackShift = {
        eventHeadline: "Ballas and Vagos Forge Anti-Cartel Strategic Pact",
        diplomaticShift: {
          initiatorFaction: "Ballas",
          targetFaction: "Vagos",
          oldStatus: "HOSTILE",
          newStatus: "TENSE_TRUCE",
          reason: "Common economic threat from Madrazo Cartel expansion into Cypress Flats"
        },
        territoryClash: {
          district: "Strawberry / Rancho Border",
          attackingFaction: "Families",
          defendingFaction: "Ballas",
          contestedPercent: 18,
          flashpointDescription: "Families drive-by shooters targeted a Ballas stash house following news of the treaty."
        },
        worldAtmosphereNote: "Heavy police helicopter patrols over Davis and Rancho; sirens heard throughout South Central."
      };
      return res.json({ success: true, warfareUpdate: normalizeWarfareUpdate(fallbackShift, factions), source: 'heuristic-warfare-engine' });
    }
  } catch (error: any) {
    logUpstream('Faction Warfare Error:', error);
    return res.json({ success: false, error: safeError(error) });
  }
});

// Helper for rich Los Santos to Los Angeles mapping data
function getDetailedLosSantosMapsIntel(query?: string): string {
  const q = (query || '').toLowerCase();
  if (q.includes('vinewood') || q.includes('hollywood')) {
    return `### Geographical Grounding: Vinewood ↔ Hollywood, Los Angeles
- **Vinewood Sign**: Modeled on the world-famous 1923 Hollywood Sign in Mount Lee, Griffith Park.
- **Vinewood Boulevard**: Replicates the Hollywood Walk of Fame along Hollywood Blvd, featuring the Oriental Theater (Grauman's Chinese Theatre) and the Galileo Observatory (Griffith Observatory).
- **Vinewood Hills**: Directly corresponds to Hollywood Hills and Mulholland Drive, featuring steep hillside modernist mansions overlooking the city basin.
- **Tactical Routes**: Access via Vinewood Park Drive offers elevated sniper vantage points overlooking Downtown Pillbox Hill.`;
  }
  if (q.includes('del perro') || q.includes('vespucci') || q.includes('beach') || q.includes('pier')) {
    return `### Geographical Grounding: Del Perro & Vespucci ↔ Santa Monica & Venice Beach
- **Del Perro Pier**: Exact architectural homage to the historic 1909 Santa Monica Pier, complete with the solar-powered Ferris wheel (Pacific Park).
- **Vespucci Beach & Canals**: Modeled after the Venice Canals district and Venice Beach Boardwalk, including Muscle Sands (Muscle Beach Venice).
- **Tactical Routes**: Coastal Highway 1 connects north towards the Pacific Bluffs and Chumash. Wide sandy beaches provide zero ballistic cover against elevated overwatch.`;
  }
  if (q.includes('davis') || q.includes('strawberry') || q.includes('chamberlain') || q.includes('south')) {
    return `### Geographical Grounding: Davis & Strawberry ↔ Compton & South Central LA
- **Davis**: Directly represents the city of Compton, CA. The cul-de-sac of Grove Street mirrors 214th Street in Compton.
- **Carson Avenue**: Parallels Compton Boulevard and Carson Street, the dividing economic line between major local gang sets.
- **Strawberry**: Modeled on Inglewood and Crenshaw, featuring high-density urban apartment complexes and light-rail transit lines.
- **Tactical Considerations**: Dense urban residential alleyways with wooden fences and concrete backyard walls create extreme close-quarters battle (CQB) hazards.`;
  }
  return `### Comprehensive Los Santos ↔ Los Angeles Geographical Mapping
1. **Vinewood & Vinewood Hills** ➔ **Hollywood & Hollywood Hills**: Mount Lee, Hollywood Walk of Fame, Griffith Observatory (Galileo Observatory), and Mulholland Drive.
2. **Del Perro & Vespucci** ➔ **Santa Monica & Venice Beach**: Santa Monica Pier (Del Perro Pleasure Pier), Venice Canals, and the Pacific Coast Highway.
3. **Pillbox Hill & Downtown** ➔ **Bunker Hill & Downtown Los Angeles**: Maze Bank Tower (U.S. Bank Tower / Library Tower), Los Angeles City Hall, and the Figueroa corridor.
4. **Davis & Strawberry** ➔ **Compton & South Los Angeles**: Historic gang territories, Forum Drive, Carson Ave, and dense CQB residential cul-de-sacs.
5. **Rancho & Cypress Flats** ➔ **Watts & Industrial Vernon**: Watts Towers (Rancho Towers), rail freight yards, and metal chop shops.
6. **Port of Los Santos & Terminal** ➔ **Port of Los Angeles (San Pedro) & Long Beach**: Container shipping depots, naval dry-docks, and the Miriam Turner Overpass (Vincent Thomas Bridge).`;
}

function getDetailedSearchModIntel(query?: string): string {
  return `### Local GTA V Enhanced Companion Notes
- Use ScriptHookV and the Enhanced-compatible ScriptHookVDotNet runtime matched to your installed game build. Legacy ScriptHookVDotNet 3.6 alone does not establish Enhanced compatibility.
- This browser dashboard runs on loopback port ${PORT}. Game telemetry is live only while /api/health reports gameRuntime.connected.
- The optional Enhanced game client uses utility rules for opt-in tactical behavior. Dashboard tactical plans and faction simulations are not automatically applied to the game.
- Companion memories are stored locally in data/npc-memories.json. Cloud synchronization is disabled.
- The existing voice bridge remains separate on port 8765. Its availability must be checked through /api/health.
- These are bundled setup notes, not current web search results or proof of an in-game test.`;
}

// Google Maps grounding, with a clearly identified bundled geography fallback.
app.post('/api/maps-grounding', async (req, res) => {
  const { query } = req.body;
  try {
    if (hasGemini()) {
      const response = await getAI().models.generateContent({
        model: TEXT_MODEL,
        contents: query || 'What are the real-world Los Angeles landmarks that inspired GTA V Los Santos locations like Del Perro Pier and Vinewood?',
        config: {
          tools: [{ googleMaps: {} }],
        },
      });
      if (response.text) {
        return res.json({ success: true, text: response.text, source: `${TEXT_MODEL}-maps` });
      }
    }
  } catch (error: any) {
    console.warn('[Maps Grounding] Upstream error/rate-limit, using tactical knowledge base:', safeError(error));
  }

  // Graceful fallback to verified tactical knowledge base
  const fallback = getDetailedLosSantosMapsIntel(query);
  return res.json({
    success: true,
    text: fallback,
    source: 'tactical-los-santos-geo-engine',
    isCached: true,
  });
});

// Google Search grounding, with clearly identified local setup notes if unavailable.
app.post('/api/search-grounding', async (req, res) => {
  const { query } = req.body;
  try {
    if (hasGemini()) {
      const response = await getAI().models.generateContent({
        model: TEXT_MODEL,
        contents: query || 'What are the latest Grand Theft Auto V Enhanced modding updates, ScriptHookVDotNet and RAGE Plugin Hook releases?',
        config: {
          tools: [{ googleSearch: {} }],
        },
      });
      if (response.text) {
        return res.json({ success: true, text: response.text, source: `${TEXT_MODEL}-search` });
      }
    }
  } catch (error: any) {
    console.warn('[Search Grounding] Upstream error/rate-limit, using mod intelligence base:', safeError(error));
  }

  const fallback = getDetailedSearchModIntel(query);
  return res.json({
    success: true,
    text: fallback,
    source: 'tactical-mod-intel-cache',
    isCached: true,
  });
});

// Transcription must never fabricate words when a recording cannot be transcribed.
app.post('/api/transcribe', async (req, res) => {
  const { base64Audio, mimeType = 'audio/webm' } = req.body;
  if (typeof base64Audio !== 'string' || base64Audio.length < 4 || base64Audio.length > 8 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64Audio)) {
    return res.status(400).json({ success: false, error: 'A non-empty base64 audio recording of at most 6 MB is required.' });
  }
  if (typeof mimeType !== 'string' || !/^audio\/(?:wav|mp3|mpeg|aiff|aac|ogg|flac|m4a|l16|opus|alaw|mulaw|webm)(?:;[A-Za-z0-9=; ._-]+)?$/i.test(mimeType)) {
    return res.status(400).json({ success: false, error: 'Unsupported recording audio MIME type.' });
  }
  if (!hasGemini()) return res.status(503).json({ success: false, error: 'Transcription requires Gemini. No transcript was generated.' });

  try {
      const audioPart = {
        inlineData: {
          mimeType,
          data: base64Audio,
        },
      };
      const response = await getAI().models.generateContent({
        model: TEXT_MODEL,
        contents: { parts: [audioPart, { text: 'Transcribe only speech audible in this recording, verbatim. Return an empty string if there is no intelligible speech. Never invent speech, names, dialogue or events.' }] },
      });
      if (response.text) {
        return res.json({ success: true, text: response.text, source: TEXT_MODEL });
      }
      return res.status(422).json({ success: false, error: 'No intelligible speech was returned. No transcript was generated.' });
  } catch (error: any) {
    logUpstream('[Audio Transcribe] Failed:', error);
    return res.status(502).json({ success: false, error: safeError(error) });
  }
});

// Dedicated multi-turn text assistant; caller model names are bounded and explicit.
app.post('/api/chatbot', async (req, res) => {
  const { model = TEXT_MODEL, role = 'general', messages = [] } = req.body;
  if (typeof model !== 'string' || !/^gemini-[A-Za-z0-9.-]{1,100}$/.test(model) || !Array.isArray(messages) || messages.length < 1 || messages.length > 50 || messages.some(m => !m || typeof m.text !== 'string' || m.text.length > 16_000)) {
    return res.status(400).json({ success: false, error: 'Provide a valid Gemini model and 1-50 bounded text messages.' });
  }

  let systemInstruction = 'You are the intelligent GTA V Modding & World Assistant for Living Los Santos AI v2.';
  if (role === 'tactical_commander') {
    systemInstruction = 'You are the Elite Tactical Commander for Los Santos Law Enforcement and PMC Units. Provide rigorous tactical breakdowns, bounding overwatch guidance, cover calculations, and combat analysis.';
  } else if (role === 'world_storyteller') {
    systemInstruction = 'You are the Dynamic Los Santos Lore Master and Street Storyteller. Narrate gritty, immersive stories, gang histories, and faction political conflicts across South Central and Vinewood.';
  } else if (role === 'mod_engineer') {
    systemInstruction = 'You are the Lead Systems Engineer for GTA V ScriptHookVDotNet and RAGEPluginHook AI mods. Provide expert technical assistance on INI configurations, WebSocket bridge latency, and memory persistence.';
  }

  if (!hasGemini()) return res.status(503).json({ success: false, error: 'The chat assistant requires Gemini. Dashboard simulations remain available.' });

  try {
    if (hasGemini()) {
      const formattedContents = messages.map((m: any) => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: [{ text: m.text }],
      }));

      const response = await getAI().models.generateContent({
        model,
        contents: formattedContents,
        config: { systemInstruction },
      });

      if (response.text) {
        return res.json({ success: true, text: response.text, modelUsed: model });
      }
    }
  } catch (error: any) {
    logUpstream('[Chatbot API] Failed:', error);
    return res.status(502).json({ success: false, error: safeError(error), modelUsed: model });
  }
  return res.status(502).json({ success: false, error: 'The model returned no assistant text.', modelUsed: model });
});

// Text-to-speech for the companion. The installed real-time voice bridge is separate.
app.post('/api/voice-converse', async (req, res) => {
  const { text, voice = 'Puck' } = req.body;
  if (typeof text !== 'string' || !text.trim() || text.length > 4000 || typeof voice !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,100}$/.test(voice)) {
    return res.status(400).json({ success: false, error: 'Provide 1-4000 characters of text and a valid voice name.' });
  }
  if (!hasGemini()) return res.status(503).json({ success: false, error: 'Speech generation requires Gemini.' });
  try {
    const response = await getAI().interactions.create({
      model: TTS_MODEL,
      input: [{ type: 'user_input', content: [{ type: 'text', text }] }],
      response_format: { type: 'audio', mime_type: 'audio/wav' },
      generation_config: { speech_config: [{ voice }] },
      store: false,
    });
    const audio = response.output_audio;
    if (!audio?.data) throw new Error('The speech model returned no audio. Check model and voice availability.');
    const wav = audioToWav(audio.data, audio.mime_type);
    return res.json({ success: true, audioBase64: wav.toString('base64'), mimeType: 'audio/wav', source: TTS_MODEL });
  } catch (error: any) {
    logUpstream('Voice Converse Error:', error);
    return res.status(502).json({ success: false, error: safeError(error) });
  }
});

app.use('/api', (req, res) => res.status(404).json({ success: false, error: 'Unknown companion API route.' }));
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(error);
  const status = error?.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500;
  res.status(status).json({ success: false, error: status === 413 ? 'Request body is too large.' : status === 400 ? 'Invalid JSON body.' : 'Companion request failed.' });
});

// In production, serve the built Vite SPA from /dist
// In development, hook Vite into express middleware
export async function startServer() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  return app.listen(PORT, HOST, () => console.log(`[Living Los Santos AI v2] Server running on http://${HOST}:${PORT}`));
}

if (process.env.LLAI_NO_AUTOSTART !== 'true') startServer().catch(error => {
  console.error('Companion startup failed:', safeError(error));
  process.exitCode = 1;
});
