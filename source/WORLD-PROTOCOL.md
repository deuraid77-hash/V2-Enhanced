# Living Los Santos 3 — runtime contract

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
