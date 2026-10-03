/** Canonical settings metadata. Runtime consumers must use these exact keys.
 * Actions (reset, panic, export, test connection) are not counted as settings.
 * Existing protocol-3 director settings remain authoritative in /api/world/config.
 */
export type SettingValue = boolean | number | string;
export type NpcSettings = Record<string, SettingValue>;
export interface SettingDefinition {
  key: string; label: string; group: string; type: 'boolean' | 'number' | 'select' | 'text';
  default: SettingValue; min?: number; max?: number; step?: number; options?: string[];
  tooltip: string; consumer: 'game' | 'ai' | 'memory' | 'audio' | 'ui';
}
const catalog: SettingDefinition[] = [];
function add(group: string, consumer: SettingDefinition['consumer'], key: string, value: SettingValue, tooltip: string, bounds?: [number, number, number?] | string[]) {
  const numeric = typeof value === 'number', choice = Array.isArray(bounds) && typeof bounds[0] === 'string';
  catalog.push({ key, label: key.split('.').at(-1)!.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase()), group,
    type: typeof value === 'boolean' ? 'boolean' : numeric ? 'number' : choice ? 'select' : 'text', default: value,
    ...(numeric ? { min: Number(bounds![0]), max: Number(bounds![1]), step: Number(bounds![2] ?? 1) } : choice ? { options: bounds as string[] } : {}), tooltip, consumer });
}
type Row = [string, SettingValue, string, ([number,number,number?] | string[])?];
function group(name: string, consumer: SettingDefinition['consumer'], prefix: string, rows: Row[]) { for (const [key, value, tip, bounds] of rows) add(name, consumer, `${prefix}.${key}`, value, tip, bounds); }
group('General', 'game', 'general', [
  ['enabled',true,'Run the NPC overhaul. Turning off cancels interactions, AI and owned scenarios.'],
  ['languageIntensity','gta','AI dialogue language style; identity slurs are excluded in every mode.',['clean','mature','gta']],
  ['subtitleScale',1,'Scale generated dialogue subtitles.',[0.6,1.8,0.1]],
  ['speakerNames',true,'Prefix subtitles with the actual NPC persona name.'],
  ['hints',true,'Show context-sensitive interaction and input hints.'],
  ['debugOverlay',false,'Show measured script Tick cost and job counts.'],
  ['menuSounds',true,'Play game menu navigation cues.'],
  ['safeMode',false,'Keep only menu and diagnostics active; cancel world and NPC work.'],
]);
group('AI', 'ai', 'ai', [
  ['enabled',true,'Allow provider jobs, subject to the combined daily budget.'],
  ['provider','gemini','Provider used for text jobs. Offline mode uses explicitly labelled fallback.',['gemini','offline']],
  ['liveModel','gemini-3.8-flash','Model used for streamed live NPC conversation.'],
  ['directorModel','gemini-3.5-flash-lite','Model used for background multi-NPC intent decisions.'],
  ['bankModel','gemini-3.5-flash-lite','Model used to author reusable bark banks.'],
  ['personaModel','gemini-3.8-flash','Model used to create short persistent persona records.'],
  ['ttsModel','gemini-3.8-flash-lite-tts','Voice model. Must appear in the live account model list.'],
  ['directorIntervalSeconds',10,'Minimum interval between compact background director jobs.',[5,20]],
  ['liveMaxOutputTokens',512,'Maximum billed output token allowance for a live reply.',[128,2048,32]],
  ['directorMaxOutputTokens',768,'Maximum output tokens for a director intent batch.',[128,2048,32]],
  ['bankMaxOutputTokens',1536,'Maximum output tokens for one bank generation batch.',[256,4096,64]],
  ['maxSpeechCharacters',320,'Maximum characters in a spoken AI response.',[80,600,20]],
  ['maxConcurrent',2,'Maximum provider calls in flight, including voice.',[1,4]],
  ['liveReservedSlots',1,'Reserve this many provider slots for direct player interactions.',[0,2]],
  ['queueLimit',24,'Maximum queued jobs; stale and low-priority work is rejected.',[4,64]],
  ['requestTimeoutMs',20000,'Cancel a provider attempt after this deadline.',[3000,35000,1000]],
  ['maxRetries',1,'Retry transient failures only within the original job deadline.',[0,2]],
  ['retryBaseMs',500,'Initial transient-error backoff; subsequent retries increase it.',[200,3000,100]],
  ['breakerFailureThreshold',3,'Consecutive failures before the provider circuit opens.',[1,10]],
  ['breakerOpenSeconds',30,'Cooldown before one provider recovery probe is allowed.',[10,300,10]],
  ['dailyBudgetUsd',5,'Combined text, evaluation and voice daily allowance in US dollars. Unknown usage retains its reserved estimate.',[0,5,0.25]],
  ['maxRequestsPerMinute',24,'Hard request-rate ceiling across AI jobs.',[1,60]],
  ['maxInputTokensPerMinute',16000,'Reserve bounded prompt usage before sending jobs.',[1000,64000,1000]],
  ['maxOutputTokensPerMinute',8000,'Reserve bounded response usage before sending jobs.',[512,32000,256]],
  ['cancelDistance',55,'Cancel NPC work when the speaker moves beyond this distance in metres.',[10,100]],
  ['showSource',true,'Display AI, cached AI or fallback provenance beside generated lines.'],
]);
group('AI banks', 'ai', 'bank', [
  ['enabled',true,'Use cached AI-authored reactions.'],
  ['idlePregeneration',true,'Generate bank refills only behind live requests.'],
  ['maxLinesPerBucket',24,'Bound retained lines for each situation, mood and district.',[4,80]],
  ['refillThreshold',4,'Request a refill below this many usable lines.',[1,20]],
  ['generationBatchSize',8,'Number of lines requested in one AI bank batch.',[2,16]],
  ['minGenerationIntervalSeconds',30,'Minimum interval between background bank generation calls.',[10,300,10]],
]);
group('Conversation', 'game', 'conversation', [
  ['rangeMeters',5,'Maximum distance to start a conversation.',[2,10,0.5]],
  ['approachEnabled',true,'Allow AI-selected NPC approaches which the player can dismiss.'],
  ['approachChance',25,'Admission chance for an AI-proposed approach, in percent.',[0,100]],
  ['approachCooldownSeconds',90,'Minimum delay between NPC-initiated conversations.',[30,600,10]],
  ['vehicleEnabled',true,'Allow guarded driver and passenger conversation.'],
  ['vehicleMaxSpeed',5,'Maximum speed in metres per second when starting vehicle conversation.',[0,12,0.5]],
  ['timeoutSeconds',45,'End idle conversations after this many seconds.',[10,120,5]],
  ['walkAwayMeters',12,'End a conversation if player and speaker separate this far.',[5,30]],
  ['interruptOnDanger',true,'Cancel conversation on combat, damage or unsafe scene changes.'],
  ['quickReplyCount',4,'Number of AI-written controller reply options.',[3,5]],
  ['language','English','Requested dialogue and transcription language; bounded to 40 characters.'],
  ['prewarmMeters',12,'Distance at which eligible nearby NPC personas may be prepared.',[5,30]],
  ['maxTurns',12,'Maximum turns before the conversation wraps up.',[2,30]],
  ['pushToTalk',false,'Enable microphone capture only while the talk control is held.'],
]);
group('Mind and memory', 'memory', 'memory', [
  ['enabled',true,'Use bounded working, episode and summary memory.'],
  ['maxNpcs',200,'Maximum stored NPC mind records; oldest unprotected records are evicted.',[16,500]],
  ['maxEpisodesPerNpc',24,'Bound the episode notes retained for one NPC.',[4,64]],
  ['maxEpisodeChars',240,'Maximum length of an AI-written memory note.',[80,400,20]],
  ['workingMemorySeconds',600,'Idle lifetime of session conversation history.',[60,3600,60]],
  ['summaryEveryEpisodes',6,'Summarize accumulated episodes after this interval.',[3,20]],
  ['summaryMaxTokens',192,'Maximum output tokens for an AI memory summary.',[64,512,32]],
  ['decayHalfLifeHours',48,'Half-life of transient emotional memory strength.',[1,720]],
  ['persistNotable',true,'Persist notable fingerprints; other identities remain session-only.'],
  ['recognitionEnabled',true,'Enable explicitly best-effort model/clothing/area/role recognition.'],
  ['minFingerprintConfidence',0.85,'Minimum fingerprint confidence accepted for a notable re-identification.',[0.6,1,0.05]],
  ['notableCap',12,'Maximum nearby notable NPCs protected by this mod.',[0,24]],
  ['personaRichness',120,'Target token budget for short AI personas.',[60,180,10]],
  ['grudgeThreshold',25,'Trust below this value affects grudges in AI context.',[0,45]],
  ['friendshipThreshold',75,'Trust above this value affects friendship in AI context.',[55,100]],
]);
group('Reputation', 'memory', 'reputation', [
  ['enabled',true,'Apply bounded faction and district reputation changes.'],
  ['decayHalfLifeHours',72,'Reputation naturally approaches neutral over this half-life.',[1,720]],
  ['gossipDelaySeconds',60,'Delay before an AI-authored rumour can affect other NPCs.',[10,600,10]],
  ['gossipRadius',180,'Maximum local spread radius for witnessed rumours, in metres.',[25,500,5]],
  ['maxGossipPerMinute',4,'Maximum admitted gossip propagation events per minute.',[1,12]],
]);
export const VEHICLE_SCENARIOS = ['windowTalk','carToCar','passengerChat','lifts','roadRage','carjack','pedestrianImpact','trafficStop','driveBy','breakdown'] as const;
for (const id of VEHICLE_SCENARIOS) {
  add('Vehicles', 'game', `vehicles.${id}.enabled`, true, `Allow the guarded ${id} scenario when AI selects it.`);
  add('Vehicles', 'game', `vehicles.${id}.weight`, 50, `Relative admission weight for AI-selected ${id} scenarios; zero suppresses starts.`, [0,100]);
}
group('Vehicles', 'game', 'vehicles', [
  ['roadRageIntensity',65,'Bound aggression requested in AI road-rage context.',[0,100]],
  ['windowTalkMeters',4,'Maximum safe window-conversation distance.',[2,7,0.5]],
  ['maxActive',1,'Maximum owned vehicle scenario at once.',[1,2]],
]);
group('Audio', 'audio', 'audio', [
  ['enabled',true,'Enable generated voice playback; subtitles can remain visible.'],
  ['provider','auto','Auto prefers metered Gemini and falls back to labelled Windows speech.',['auto','gemini','windows']],
  ['outputDeviceId','default','Playback device from the companion enumerated Windows device list.'],
  ['masterVolume',0.85,'Overall companion voice gain.',[0,1,0.05]],
  ['casualVolume',0.8,'Conversation category gain.',[0,1,0.05]],
  ['combatVolume',1,'Combat category gain.',[0,1,0.05]],
  ['vehicleVolume',0.9,'Vehicle category gain.',[0,1,0.05]],
  ['phoneVolume',0.75,'Gain applied to NPC phone conversation audio.',[0,1,0.05]],
  ['narratorVolume',0.8,'Narrator category gain.',[0,1,0.05]],
  ['maxVoices',4,'Maximum simultaneous voices; higher priority speech can preempt barks.',[1,8]],
  ['maxDistanceMeters',45,'Silence voices beyond this distance.',[5,100]],
  ['referenceDistanceMeters',3,'Distance before attenuation begins.',[1,10]],
  ['distanceRolloff',1.2,'Exponent controlling distance attenuation.',[0.25,3,0.05]],
  ['spatialStrength',1,'Blend from centred mono to full listener-relative stereo pan.',[0,1,0.05]],
  ['positionHz',10,'Rate of lightweight position updates from the client.',[10,20]],
  ['positionStaleMs',500,'Silence playback when positional telemetry is older than this.',[250,2000,50]],
  ['smoothingMs',40,'Interpolate pan and gain changes over this duration.',[10,150,10]],
  ['windowMuffleGain',0.45,'Gain when a closed vehicle window separates speaker and listener.',[0,1,0.05]],
  ['windowLowPassHz',1800,'Low-pass cutoff through a closed window.',[300,10000,100]],
  ['interiorMuffleGain',0.65,'Gain across an interior boundary.',[0,1,0.05]],
  ['interiorLowPassHz',2800,'Low-pass cutoff across an interior boundary.',[300,10000,100]],
  ['playerVehicleGain',0.8,'Gain for exterior speakers when the player is inside a vehicle.',[0,1,0.05]],
  ['duckGame',true,'Temporarily reduce only the GTA Windows audio session during foreground speech.'],
  ['duckAmount',0.18,'Amount removed from the game session volume while ducking.',[0,0.6,0.02]],
  ['followGameSessionVolume',true,'Follow GTA Windows session mute and volume; internal game slider is not exposed.'],
  ['pitchSpread',0.08,'Stable per-persona variation used by the voice renderer.',[0,0.25,0.01]],
  ['speedSpread',0.12,'Stable per-persona speaking-speed variation.',[0,0.3,0.01]],
  ['emotionIntensity',0.8,'Strength of supported speech style annotations.',[0,1,0.05]],
  ['preRender',true,'Prepare reusable AI bank audio ahead of playback.'],
  ['cacheMegabytes',256,'Maximum cached rendered voice size.',[32,2048,32]],
  ['transcriptsEnabled',true,'Retain generated NPC lines locally; player private text is excluded.'],
  ['transcriptMaxEntries',5000,'Maximum retained generated-line transcript entries.',[100,20000,100]],
  ['ambientCooldownSeconds',12,'Minimum interval between ambient barks per speaker.',[2,90]],
  ['combatCooldownSeconds',5,'Minimum interval between combat barks per speaker.',[1,30]],
  ['hurtCooldownSeconds',3,'Minimum interval between hurt barks per speaker.',[1,20]],
  ['vehicleCooldownSeconds',10,'Minimum interval between vehicle barks per speaker.',[2,60]],
  ['preemptFadeMs',60,'Fade duration when urgent speech replaces lower-priority audio.',[20,250,10]],
  ['queueMaxAgeMs',3000,'Discard speech which waited too long to remain relevant.',[250,10000,250]],
  ['micDeviceId','default','Microphone selected from enumerated Windows devices.'],
  ['micSensitivity',1,'Gain applied to explicitly held push-to-talk microphone capture.',[0.1,3,0.1]],
  ['micMaxSeconds',20,'Hard duration limit for one held microphone utterance.',[2,30]],
  ['micSilenceThreshold',0.015,'Normalized microphone silence threshold.',[0.001,0.1,0.001]],
]);
group('Combat', 'game', 'combat', [
  ['barkDensity',65,'Admission rate for AI-authored combat barks, percent.',[0,100]],
  ['tauntIntensity',75,'Intensity included in AI combat speech context.',[0,100]],
  ['fleeHealth',35,'Health threshold included in AI flee decisions for owned combatants.',[10,70]],
  ['surrenderFear',85,'Fear threshold for AI surrender proposals.',[50,100]],
  ['backupEnabled',true,'Allow capped owned backup groups after a validated AI request.'],
  ['panicRadius',25,'Maximum distance for AI-selected witness panic reactions.',[5,60]],
  ['witnessReactions',true,'Enable AI-written witness response scenarios.'],
  ['lastWords',true,'Enable high-priority AI-authored last words when the NPC is still alive.'],
  ['aftermathChatter',true,'Enable AI-authored post-fight reactions.'],
]);
export const EXTRA_SCENARIOS = ['argument','deal','chase','holdup','tourist','fan','drunks','protest','policeCivilian','aftermath'] as const;
for (const id of EXTRA_SCENARIOS) add('World director','game',`director.${id}Weight`,50,`Weight included in the AI scenario digest for ${id}; zero prevents starts.`,[0,100]);
for (const id of ['grove','forum','rancho','chamberlain','davis','cypress']) add('World director','game',`director.${id}Multiplier`,1,`Encounter frequency multiplier for ${id}; zero pauses autonomous starts in that district.`,[0,2,0.1]);
group('World director','game','director',[
  ['nightMultiplier',1.25,'Encounter weight after dusk.',[0,2,0.05]],
  ['rainMultiplier',0.8,'Encounter weight during wet weather.',[0,2,0.05]],
  ['scenarioTimeoutSeconds',90,'Hard timeout for noncombat owned scenes.',[20,180,5]],
]);
export const NPC_ACTIONS = ['TALK_CASUAL','INTIMIDATE','SURRENDER','FLEE_PANICKED','TAKE_COVER','DRAW_WEAPON','ATTACK_MELEE','CALL_911','CALL_FACTION_BACKUP','OFFER_SIDE_GIG','HANDSHAKE_RESPECT','FOLLOW','LEAD_TO','SIT_DOWN_TALK','LEAN_AND_SMOKE','USE_PHONE','WAVE_OFF','APOLOGISE','PLEAD','BEG','SELL_TIP','GIVE_DIRECTIONS','ASK_FOR_RIDE','HONK_AT_PLAYER','THREATEN_FROM_CAR','LEAVE_VEHICLE_TO_CONFRONT','DRIVE_AWAY'] as const;
for (const action of NPC_ACTIONS) add('Allowed actions','game',`action.${action}`,true,`Permit the locally validated ${action} task. Turning off never grants alternative powers.`);
group('Controls','game','controls',[
  ['menuKey','F6','Keyboard binding for native menu. F4 remains the script console.'],
  ['talkKey','F7','Keyboard binding for native text conversation.'],
  ['wheelKey','G','Keyboard binding for AI quick-reply wheel.'],
  ['pttKey','N','Keyboard hold binding for explicitly enabled microphone capture.'],
  ['panicKey','F10','Cancel AI, audio and owned scenes while keeping menu access.'],
  ['controllerMenu',236,'Menu chord target; default Xbox View/Back, held with RB.',[0,360]],
  ['controllerTalk',51,'Game control index used for conversation.',[0,360]],
  ['controllerWheel',52,'Reply wheel control; default Xbox D-pad Left, scoped to an eligible conversation.',[0,360]],
  ['controllerPtt',230,'Push-to-talk hold control; default Xbox Left Stick click during an eligible conversation.',[0,360]],
  ['controllerPanic',231,'Panic chord target; default Xbox Right Stick click, held with RB.',[0,360]],
  ['menuModifier',227,'Controller menu/panic chord modifier; default Xbox RB.',[0,360]],
  ['holdMs',650,'Continuous chord hold needed to open menu or invoke panic.',[300,1500,50]],
  ['deadzone',0.25,'Navigation stick deadzone.',[0.1,0.8,0.05]],
  ['vibration',true,'Short controller feedback for confirmed UI actions.'],
  ['promptStyle','auto','Button labels follow active input unless explicitly overridden.',['auto','xbox','playstation','keyboard']],
  ['menuScale',1,'Scale native menu text and rows.',[0.7,1.5,0.05]],
  ['menuOpacity',0.9,'Native menu background opacity.',[0.3,1,0.05]],
  ['menuX',0.06,'Horizontal menu position as fraction of safe viewport.',[0,0.65,0.01]],
  ['menuY',0.08,'Vertical menu position as fraction of safe viewport.',[0,0.3,0.01]],
  ['accent','cyan','Accessible menu highlight colour.',['cyan','amber','white']],
]);
group('Safety and performance','game','safety',[
  ['pauseInInteriors',true,'Pause risky tasks in interiors. Mission and cutscene guards still apply.'],
  ['protectMissions',true,'Never start NPC interventions in protected Story missions.'],
  ['maxOwnedVehicles',2,'Hard cap on vehicles created by the overhaul.',[0,3]],
]);
group('Safety and performance','game','performance',[
  ['trackedNpcCap',32,'Maximum NPCs considered for the active mind and scenario loop.',[8,32]],
  ['scansPerSecond',2,'Rate of bounded nearby NPC scans.',[1,5]],
  ['tickBudgetMs',1,'Measured work budget; defer remaining optional work to later ticks.',[0.5,3,0.25]],
]);

export const SETTINGS_CATALOG: readonly SettingDefinition[] = Object.freeze(catalog.map(entry => Object.freeze(entry)));
export const DEFAULT_NPC_SETTINGS: Readonly<NpcSettings> = Object.freeze(Object.fromEntries(SETTINGS_CATALOG.map(s => [s.key,s.default])));
const byKey = new Map(SETTINGS_CATALOG.map(s => [s.key,s]));
export function validateNpcSettings(value: unknown, partial = true): NpcSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Settings must be an object.');
  const input = value as Record<string,unknown>, entries = Object.entries(input);
  if (!entries.length || entries.length > SETTINGS_CATALOG.length) throw new Error('Settings patch is empty or too large.');
  if (!partial && entries.length !== SETTINGS_CATALOG.length) throw new Error('Complete settings snapshot required.');
  const result: NpcSettings = {};
  for (const [key,item] of entries) {
    const spec = byKey.get(key);
    if (!spec) throw new Error('Unsupported setting key.');
    if (spec.type === 'boolean') { if (typeof item !== 'boolean') throw new Error(`Invalid boolean: ${key}`); }
    else if (spec.type === 'number') {
      if (typeof item !== 'number' || !Number.isFinite(item) || item < spec.min! || item > spec.max!) throw new Error(`Out-of-range setting: ${key}`);
      if ([spec.min,spec.max,spec.step].every(Number.isInteger) && !Number.isInteger(item)) throw new Error(`Integer setting required: ${key}`);
    } else {
      if (typeof item !== 'string' || !item.trim() || item.length > 128 || /[\u0000-\u001f~<>]/.test(item)) throw new Error(`Invalid text setting: ${key}`);
      if (spec.options && !spec.options.includes(item)) throw new Error(`Unsupported option: ${key}`);
      if (key === 'conversation.language' && item.length > 40) throw new Error('Language name is too long.');
      if (key.startsWith('ai.') && key.endsWith('Model') && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,79}$/.test(item)) throw new Error('Invalid model identifier.');
      if (/^controls\..*Key$/.test(key) && !/^(F[1-9]|F1[0-2]|[A-Z]|NumPad[0-9]|Home|End|Insert|Delete|PageUp|PageDown)$/.test(item)) throw new Error('Unsupported keyboard binding.');
      if (/^controls\..*Key$/.test(key) && ['F4','F8'].includes(item)) throw new Error('F4 is the script console and F8 is the existing director toggle.');
    }
    result[key] = item as SettingValue;
  }
  return result;
}

export const BUILTIN_PROFILES: Readonly<Record<string, NpcSettings>> = Object.freeze({
  Chill: {'ai.directorIntervalSeconds':20,'conversation.approachChance':15,'combat.barkDensity':20,'vehicles.roadRage.weight':10,'director.argumentWeight':20},
  Realistic: {},
  Chaos: {'ai.directorIntervalSeconds':5,'conversation.approachChance':60,'combat.barkDensity':90,'vehicles.roadRage.weight':90,'director.argumentWeight':90},
  Cinematic: {'general.hints':false,'general.debugOverlay':false,'audio.masterVolume':1,'general.subtitleScale':1.2,'audio.maxVoices':2},
  Performance: {'performance.trackedNpcCap':16,'performance.scansPerSecond':1,'ai.maxConcurrent':1,'ai.liveReservedSlots':0,'ai.directorIntervalSeconds':20,'audio.maxVoices':2,'bank.idlePregeneration':false},
  Quiet: {'audio.enabled':false,'general.speakerNames':true},
});
