# Living Los Santos 4 — runtime and menu contract

**VERIFIED in offline HTTP and compiled-client tests:** the V4 companion accepts protocol 4 and preserves the original protocol 3 exchange below. The installed V3 release remains separate while the overhaul is staged. **BELIEVED:** native behavior still needs the acceptance sheet; the V4 build is **not certified in the game**. **GUESS:** no fixture telemetry is used as a gameplay result.

## Protocol 4 extension

`POST /api/runtime/exchange` retains every protocol 3 world field and adds `protocol:4`, `sceneEpoch`, `sdkGameVersion`, `appliedNpcRevision`, `tickMetrics`, `aiReceipts` and `aiOutcomes`. `gameVersion` is the actual executable file version; `sdkGameVersion` is the loader's separate interpretation. On the audited Enhanced installation these are 1.0.1158.16 and 2.0.1158.16 respectively. Never compare them as though they are the same version source.

The NPC payload adds `handle`, `archetype`, `weapon`, `mind:{fear,aggression,morale,trust,respect,mood}`, `longTermMemory`, `recentDamage`, `recentEvents` and `distance`. Mind values are 0–100; faction/district standings are -100–100. The player payload includes weapon name, stance and those standings. Environment includes observed nearby gunfire. The live frame is capped at 32 NPCs, 64 AI receipts and 32 action outcomes. Working conversation history is sent only with a job, as at most 12 `{role:'player'|'npc',text}` entries of at most 400 characters.

The V4 reply is `{success:true,protocol:4,config,commands,npcSettings,aiUpdates,capabilities}`. `config` and `commands` retain the V3 meanings. `npcSettings` is the current NPC revision snapshot. Updates contain an ID, job ID, runtime ID, scene epoch, NPC ID, kind, status, source, lane, expiry and payload. Delivery acknowledgement (`aiReceipts`) means received once; `aiOutcomes` separately reports whether a validated action was dispatched or rejected. A dispatched task is not proof of its eventual outcome.

Runtime uploads are bounded at 128 KiB; replies fit the native reader's 64 KiB limit and contain at most eight updates. Undelivered updates remain bounded in memory until acknowledged or expired. The adapter validates the complete V4 frame before entering the world exchange, and the common world fields still pass the V3 validator. Game APIs execute only on Tick; HTTP and JSON work cannot directly manipulate game entities.

## AI jobs and menu assistance

- `POST /api/ai/jobs`: `{requestId,runtimeId,sceneEpoch,kind:'conversation',lane:'A',npcIds:[oneCurrentId],context:{playerUtterance,trigger?,history?}}`. Returns HTTP 202 and `{success:true,job}`. `GET /api/ai/jobs/:id` reads status; `DELETE` cancels. A stable request ID prevents duplicate provider calls, including after a companion restart. A restart never restores an executable job.
- Conversation responses validate speech, voice tone, allowed action, bounded mental/reputation deltas and memory notes. Only complete speech sentences may stream early; an incomplete JSON fragment can never dispatch an action. Disabled actions and stale handles, scenes, models, ranges or lifetimes are rejected. Offline speech remains explicitly labelled fallback.
- `GET /api/ai/status` reports actual queue, circuit, token and estimated spending counters, model availability and latest runtime metadata. The combined text/evaluation/voice cap is US$5 per Australia/Sydney calendar day. Unknown started-request usage retains its conservative reservation. A price estimate is not an invoice amount.
- `POST /api/ai/menu/jobs`: `{requestId,kind:'advisor'|'explain'|'diagnose'|'connection',context}`. Advisor context is `{intent}` (600 characters); explanation context is `{settingKey}`; the other two use `{}`. `GET /api/ai/menu/jobs/:id` supplies the eventual result; `DELETE` cancels. These jobs have a separate scene-independent scope, but share provider switches, queue capacity and spending limits.
- An advisor result is a retained proposal with at most eight typed changes, before/after values, reasons, both expected revisions and a five-minute expiry. `POST /api/ai/advisor/proposals/:id/accept` requires `{expectedRevision,expectedWorldRevision}`. `.../reject` takes `{}`. No proposal applies before explicit acceptance. Acceptance returns `{success,proposal,npcSettings,worldConfig}`; replay does not apply again. Stale or expired proposals are rejected.
- Explanation is bounded text grounded in the selected catalogue entry and current value. Diagnosis receives only the sanitized report, not raw logs, dialogue, transcripts or keys. Neither endpoint executes generated instructions.

## Vehicle scenarios (Step 4)

- Each NPC entry may carry `vehicle:{id,handle,modelHash,seat(-1..15),speed(0..200 m/s),engineRunning,isPlayerVehicle,protected}` or `null`. `protected` is the vehicle's persistence flag. The companion uses it to restrict in-vehicle NPCs to vehicle-compatible actions and excludes protected and player vehicles.
- The exchange frame may carry `vehicleOpportunities` (at most 4): `{id(UUID),scenario,npcIds[1..3],detectedAt,facts:{playerInVehicle,playerSpeed,npcSpeed,wantedLevel(0..5),contact,npcFaction}}`. No other keys are accepted. Every `npcIds` entry must be an NPC in the same frame, so the client only advertises opportunities whose NPC is in the packet it sends. Scenarios are `windowTalk, carToCar, passengerChat, lifts, roadRage, carjack, pedestrianImpact, trafficStop, driveBy, breakdown`.
- Client detection reads observed entities within 25 m, at most 16 peds per second. It never spawns, warps or deletes. Mission-persistent peds/vehicles, mod-owned peds and NPCs in combat are not offered. Throttles: 45 s per scenario, 120 s per NPC, 10 s advertisement, 4 open. A delivered plan may claim its opportunity only once, within 60 s.
- The companion admits at most one opportunity per `ai.directorIntervalSeconds`, weighted by `vehicles.<scenario>.weight`, and skips disabled scenarios. It runs one Lane B job (`ai.directorModel`), falling back to a labelled Lane D plan. The result is delivered as AI update `kind:'scenario'` with payload `{opportunityId,scenario,title,beats:[{npcId,expectedHandle,expectedModelHash,speech(≤240),voiceTone,action:ActionEnvelope}],actions}` and 1–4 beats.
- The client rejects the whole plan if any of these fail: the scenario is known; the beat count is in range; the speech is non-empty after cleaning; every action is in the catalogue; every action has the exact job/runtime/scene/NPC/handle/model identity and an unexpired lifetime; the opportunity ID was offered by this client and not yet used; the speaker is the offered NPC. Beats run in order, 3.5 s apart, each through the same `QueueNpcAction` guards as conversation actions. The first rejected beat ends the scene. Every remaining action then receives a rejected `aiOutcome`. `director.scenarioTimeoutSeconds` bounds the scene. Pause, scene change, panic, portal clear and script unload all end it.

## Street scenarios (Step 6)

- Same wire field (`vehicleOpportunities`), same validator, same `kind:'scenario'` update and same client execution path as vehicle scenarios. `scenario` may also be one of `argument, deal, chase, holdup, tourist, fan, drunks, protest, policeCivilian, aftermath`. Facts keep the six vehicle keys; `contact` is always `false`.
- Client detection (`StreetPolicy.Classify`) runs inside the same 1 Hz, 25 m, 16-ped scan, only when no vehicle scenario applies and the NPC is on foot. It never spawns entities. In priority order: `holdup` = player armed and targeting this non-cop NPC within 15 m. `policeCivilian` = cop on foot with a non-cop within 4 m, no wanted level. Live gunfire (player or scanned NPC shooting in the last 8 s) suppresses everything below. `chase` = NPC fleeing, no wanted level. `aftermath` = civilian within 20 m and gunfire 8–90 s ago. Scenes below this also need a player on foot with no wanted level. `deal` = gang NPC standing with exactly one neighbour within 4 m. `protest` = civilian with 3+ neighbours by day. `drunks` = civilian with 2+ neighbours at night (game hour 20:00–05:59). `argument` = civilian standing with exactly one neighbour. `fan` = civilian closing at least 1 m per scan, within 8 m, player unarmed. `tourist` = standing civilian within 8 m by day, player unarmed. A scenario whose `director.<id>Weight` is 0 is never offered.
- Only the primary NPC speaks and acts. Neighbours are counted but are not participants, so arguments, deals, protests and drunk groups are voiced by one person.
- Companion admission weight = `director.<id>Weight` × `director.nightMultiplier` (night) × `director.rainMultiplier` (weather `Raining|ThunderStorm|Clearing`) × each `director.<district>Multiplier` whose key appears in the lower-cased zone name. Grove/Forum multipliers match only if the zone name contains those words, which has not been checked in the game. Vehicle and street opportunities compete in one weighted draw and share the `ai.directorIntervalSeconds` spacing. At most one scenario runs at a time.
- Lane D fallbacks are fixed, labelled lines with a preferred action list (for example, holdup = SURRENDER, then PLEAD, then FLEE_PANICKED).

## Voice frames (Step 5)

- `POST /api/audio/frame` (loopback only, 400 requests/10 s, 16 KB body). Body keys exactly: `runtimeId, sceneEpoch, paused, listener{x,y,z}, right{x,y,z}, playerInVehicle, playerInterior, speakers[≤8]{npcId,position,alive,interior,inPlayerVehicle}, cues[≤4]{cueId,npcId,speaker,text,tone,category,source,lane}, barks[≤4]{requestId,npcId,speaker,group,tags[≤4],archetype?}`. Any other key, a non-finite coordinate, or text over `ai.maxSpeechCharacters` (or containing `<>~`) rejects the whole frame.
- The client sends at `audio.positionHz` (10–20), with one request in flight. It sends only when lines are pending or a speaker spoke in the last 30 s. It also sends one `paused:true` frame on a hard pause, death or panic. Typing a reply or using the reply wheel does not stop audio. Listener = `GameplayCamera.Position`/`RightVector`; interior = `Entity.CurrentInteriorProxy.Handle` (0 outside).
- Cues are the exact lines already shown as subtitles: final conversation replies (lane A, category `conversation`) and successful scenario beats (lane B; `vehicle` for vehicle scenarios, `combat` for holdup, `casual` for other street scenarios). Streamed partial `speech` updates are not voiced.
- Barks: the client admits at most one per 300 ms scan: hurt (health drop >5), combat (reload/cover/suppress/taunt, gated by `combat.barkDensity`), weapon aimed at the NPC, and the player standing within 1.2 m. The companion picks a Lane C bank line, applying the per-speaker `audio.*CooldownSeconds`. It returns `barks[{requestId,npcId,text,source,mood,cueId}]` for the subtitle.
- The companion records every accepted cue/bark to `transcripts.jsonl` (`audio.transcriptsEnabled`, capped by `audio.transcriptMaxEntries`). It drops lines that are stale (`audio.queueMaxAgeMs`), belong to an old scene, are paused or belong to a dead speaker. It plays the line through the helper and forwards positions with category gain. Interior mismatch applies `interiorMuffleGain`/`interiorLowPassHz`. A player in a vehicle hearing an outside speaker applies `playerVehicleGain`/`windowLowPassHz`. Scene change and pause send `playStopAll`; a dead speaker sends `playStop`.
- Provider: `windows` = System.Speech rendered in memory by the helper. `auto` = cached Gemini audio if present, otherwise Windows; it **never** starts a metered render. `gemini` = budget-reserved, scheduler-admitted Interactions TTS (`ai.ttsModel`), cached by sha256, with Windows as the labelled fallback on failure.
- Also: `GET /api/audio/status` (helper mixer status, drops, last 20 latencies), `GET /api/bank/status`, `GET`/`DELETE /api/transcripts`.

## Settings, profiles and diagnostics

`GET /api/settings` supplies `{success,revision,settings,source,updatedAt,world,catalog,worldCatalog,recovery}`. `?catalog=false` omits both catalogues for the compiled native client. NPC edits use `PATCH /api/settings` with `{settings,source:'game'|'portal'|'advisor',expectedRevision}`. The original world route also accepts `source` and `expectedRevision`, and **returns the world snapshot with its revision under `config.revision`**. A saved revision and a fresh game acknowledgement are displayed separately.

Native editors use `PATCH /api/world/config?compact=true` to receive only `{success:true,config}`. This prevents a large browser event/NPC history from exceeding the native transport's 64 KiB response limit after an otherwise successful save. The default browser response remains unchanged.

Full profiles include all 220 NPC and 14 original world settings. `GET /api/profiles` returns names, built-in flags and both current revisions. `POST /api/profiles` saves `{name,settings?,worldSettings?}`; omitted snapshots mean the current values. `PATCH /api/profiles/:name` renames with `{name}`; `DELETE` removes a custom profile. Built-ins cannot be overwritten or deleted.

`POST /api/profiles/:name/apply` requires both expected revisions and returns the NPC snapshot plus `world:{revision,settings,source,updatedAt}`. Both sets are validated and persisted in one atomic V4 document before either is published. Export is `GET /api/profiles/:name/export`; import is `POST /api/profiles/import` with `{profile}`. Export format is `{format:'LivingLosSantos.profile',version:4,name,settings,worldSettings}`. Existing custom names are preserved on import conflict. See `docs/SETTINGS-PROFILES.md` for migration and rollback behavior.

`GET /api/diagnostics` reads a whitelist-based report. `POST /api/diagnostics/export` writes one bounded local report and returns its filename, size and hash, without a full user path. Reports contain version metadata, numerical metrics, validated setting values and recognized error codes; private text and arbitrary errors are excluded. Up to 32 reports are retained before further export asks the user to archive an older report. No report is silently deleted.

## Preserved protocol 3 world contract

The game owns observed world state. Browser edits are desired settings until the game acknowledges their revision. Commands are bound to one runtime session, expire after 30 seconds, and are acknowledged on the script tick. A disconnected browser must never display simulated events as live game results.

## Shared HTTP contract

- `GET /api/world` and SSE `GET /api/world/events` return the same snapshot; SSE event name `world`, sent on changes and at least every second (including freshness). Snapshot shape: `{success:true, connected:boolean, lastSeenAt:string|null, runtimeId:string|null, config:{revision:number, settings:Settings}, appliedRevision:number, telemetry:Telemetry|null, commands:Command[], events:WorldEvent[]}`. Freshness limit 5 seconds.
- `PATCH /api/world/config` body `{settings:Partial<Settings>}` merges validated settings, persists atomically and increments revision. Returns snapshot. Desired settings may be edited offline. Never claim applied until ack.
- `POST /api/world/commands` body `{type, payload, requestId}` with client UUID requestId for idempotency. Requires fresh compatible protocol 3 game session or returns 409. Returns `{success:true,command:Command}`. Bounded queue, reject excess (429), no replay into a new session.
- `POST /api/runtime/exchange` accepts telemetry plus `{protocol:3, appliedRevision:number, acknowledgements:[{id,status:'applied'|'rejected',message:string}], events:WorldEvent[]}`; returns `{success:true,protocol:3,config:{revision,settings},commands:Command[]}`. Runtime POSTs every 750–1000 ms asynchronously. All GTA calls run on script tick. Ack entries can repeat until delivered; runtime deduplicates commands by id. Exchange must keep old telemetry routes working.
- Command shape `{id,requestId,runtimeId,type,payload,status:'queued'|'applied'|'rejected'|'expired',createdAt,expiresAt,message?}`. Timestamps are ISO UTC strings. Status applied means dispatch executed, not battle completed. Events report outcomes.
- WorldEvent `{id,at,type,message,districtId?,faction?}`. Max 240 char message, max 50 per frame; server deduplicates and keeps 100. Never fabricate events offline.

## Settings (defaults)

`enabled:true, ambientHostility:65, gangAggression:75, civilianPanic:70, eventIntervalSeconds:75, maxActiveEvents:2, maxSpawnedPeds:16, turfWars:true, streetFights:true, ambientTaunts:true, tacticalRetreat:true, blips:true, subtitles:true, protectMissions:true`.

Numeric ranges: hostility/aggression/panic 0–100 integers, interval 30–300 seconds, active events 1–3, spawned peds 4–24. Other settings boolean. F8 toggles local enabled state; telemetry settings reports actual state. Portal applying a new revision may override F8. Desired settings persist across companion restarts.

## Supported commands

- `start_turf_war`: `{districtId,attacker}`; attacker is Families/Ballas/Vagos, differs from current owner. Only starts if player within 350 m of the district center and scene is safe. Explicit rejection otherwise.
- `start_street_fight`: `{}`; uses eligible nearby ambient peds or bounded owned event participants.
- `clear_events`: `{}`; cleans up only mod-owned event entities and restores touched ambient NPC state where applicable.
- `set_weather`: `{weather:'CLEAR'|'EXTRASUNNY'|'CLOUDS'|'OVERCAST'|'RAIN'|'THUNDER'|'FOGGY'|'SMOG'}`.
- `set_time`: `{hour:0..23}` integer.
- `set_wanted`: `{level:0..5}` integer.
- `talk`: `{npcId,text}` <=240 chars, only streamed visible NPC id from current session, must pass range/state validation. Uses existing Gemini dialogue path, actual game subtitles/tasks, with completion event.

## Telemetry extensions

Existing runtimeId/pluginVersion/gameVersion/player/environment/npcs fields remain. Add `protocol:3, appliedRevision, director:{enabled:boolean,pausedReason:string|null,settings:Settings,activeEvents:Battle[],territories:Territory[],ownedPedCount:number}`.

- NPC: `{id,name,faction,position:{x,y,z},health,alive,inCombat,modelHash,owned:boolean,memory?:string}`. Faction is only verified for model-known/owned gang members; other NPCs Civilian/Unknown. Do not invent emotions or counts.
- Battle: `{id,type:'turf_war'|'street_fight',districtId,attacker,defender,state,attackerAlive,defenderAlive,startedAt}`. Outcome events and ownership only update after actual survivors evaluated. Nearby unloaded world is not simulated.
- Territory: `{id,name,owner,challenger:null|string,heat:number,position:{x,y,z},radius:number,wins:number}`.
- Canonical territories: `grove` Grove Street Ballas center(105,-1940,20), `forum` Forum Drive Families(-150,-1620,33), `rancho` Rancho Vagos(480,-1880,26), `chamberlain` Chamberlain Hills Families(-210,-1490,31), `davis` Davis Ballas(100,-1700,29), `cypress` Cypress Flats Vagos(850,-2100,30). Radius 180. Owner and wins persist locally in game client campaign file, with validated restore and reset-free reload.

## Implementation boundaries

Story Mode only. Pause autonomous encounters during loading, death, mission protection, interiors or busy scene. Native thread only; HTTP must never block it. Revalidate handles/model identities before delayed commands. Spawn only bounded streamed models, cleanup only entities owned by this client. No global relationship changes or ambient weapon distribution. Battle spawn placement must use ground-safe positions and clear space; reject/abort if models or placement unavailable. Short combat tasks with survivor checks, retreat and finite timeouts. Created blips/entities removed on cleanup/abort. Persist campaign safely. No keys in frontend/client/package.

The rebuilt portal replaces the demo tabs with Live city / Gang territories / NPCs & dialogue / Director settings / Connection. Display live coordinates and actual territory ownership, command acknowledgements, pending/applied configuration revisions, fresh/stale/disconnected state, errors and real event feed. Controls unavailable offline except desired config. No invented AI learning claims. Keep speech/browser microphone optional and clearly separate if retained.
