# Living Los Santos 3 — Enhanced world director

This is the actual GTA V Enhanced Story Mode client for the live portal. It targets .NET Framework 4.8 and the installed Enhanced ScriptHookVDotNet3 API 3.9.0.0. The inspected executable is 1.0.1158.16. It builds as `LivingLSAIsV2.Enhanced.dll` for upgrade continuity, assembly version 3.0.1.0.

Compilation, offline rules/HTTP tests, and compiled API resolution are verified. A separate Story Mode acceptance run confirmed automatic loading, live telemetry, street combat, a nine-participant turf battle, ownership transfer, campaign persistence and cleanup on the installed 3.0.1 client. See the package's `world-runtime-acceptance.json` for evidence. Native game visuals/audio, F7/F8 key presses and compatibility with every other installed mod were not independently verified by that run.

## Controls and startup

Use the package installer to configure the dedicated `scripts\LivingLosSantos` script directory. Keep the Enhanced ScriptHookV and Enhanced ScriptHookVDotNet runtime in the game root. The package sets automatic loading for this dedicated directory; it does not need a manual F4 command for normal startup. Never load a second copy of the DLL from another scripts directory.

The script waits 15 seconds after construction and requires a living player with control, an outdoor scene and no protected mission/cutscene. The world director operates with the most recently saved settings while the local portal is closed. Gemini conversation requires the local companion at `http://127.0.0.1:3000/`. No API key is stored in this DLL.

- **F7:** Choose the closest eligible pedestrian within 5 metres and open text entry. The keyboard is polled without blocking the script, so portal heartbeats continue while typing. A late reply requires the same handle/model, a living on-foot NPC, no current combat and a distance of at most 12 metres. Owned idle event NPCs are also eligible.
- **F8:** Toggle the entire autonomous street director. Disabling clears its owned encounters. The actual local setting is reported to the portal; a later portal configuration revision can override it.
- **Portal:** Start a nearby turf battle or street fight, clear owned events, set weather, time or wanted level, and talk to a currently visible nearby NPC. Commands expire after 30 seconds and are tied to one script session. Precise rejections distinguish a protected scene, unavailable NPC, distance, population cap or model/placement failure.

`NETWORK_IS_GAME_IN_PROGRESS` and `NETWORK_IS_SESSION_ACTIVE` cause this Story Mode script to clean up and stop. No Online functionality is provided or tested.

## Real street encounters

The default profile is frequent encounters: enabled, hostility 65, gang aggression 75, panic 70, a 75-second encounter interval plus 0–15 seconds of variation, at most two concurrent encounters, and at most sixteen created pedestrians. Failed placement/streaming checks do not force spawns.

Turf wars are attempted in a nearby defined district. Street fights can happen elsewhere outdoors near the player. Both use model-validated, asynchronously requested models. Each pedestrian is placed on a verified non-water, non-interior pavement position with ground-height, vehicle and pedestrian clearance checks. Creation happens at most once per director pulse. Partial preparation failures remove already-created participants.

Version 3.0.1 expands the placement search after actual gang-battle attempts exhausted the original narrow line of candidate points. Each pedestrian now has up to 48 angular/radial candidates, with at most eight navmesh attempts and one pedestrian creation across the entire director per 250-ms pulse. The first half searches a team-side fan; the second half searches three full-circle rings. Witnesses have a separate orientation. Repeated snapped navmesh positions are skipped without relaxing collision checks. Preparation has a twenty-second bound, and failures report navmesh, ground, occupancy, distance, height and repeated-coordinate counters. Successful street-fight runtime behavior was observed before this placement change; actual turf success still requires testing with this build.

Each encounter moves through streaming, a four-second confrontation, fighting, and cleanup. A gang battle uses two to four fighters on each side, bounded by the configured population budget. Street fights use two created unarmed locals. If the budget and panic setting permit, one owned civilian witness reacts by watching or fleeing. The game AI executes the actual combat tasks. No weapons are handed to unrelated ambient NPCs.

All gang combat targets are explicit NPC references with six-second task refreshes. Low-health owned fighters can retreat or surrender and stop being counted as active combatants. A battle ends when only one side remains active, both sides are eliminated/withdraw, the 150-second limit is reached, the scene becomes protected or the player leaves the streamed area. Completed encounters linger for eighteen seconds before removal. Corpses count against the population budget until cleanup.

Only observed, sole surviving active sides produce an ownership result. A vanished handle, an abandoned scene, a timeout or mutual elimination never invents a winner. Ambient participants are never created in unloaded parts of the city; ownership away from the player does not advance through a browser simulation.

Occasional eligible ambient pedestrians within twelve metres can be asked to play GTA's hostile ambient speech. This does not change their task, weapons, persistent status or relationship group. Existing audio availability depends on the NPC model and game speech bank. Event participants also trade insults during confrontations. There are no global relationship edits.

## Six persistent gang districts

| District | Initial owner | Center |
|---|---|---|
| Grove Street | Ballas | 105, −1940, 20 |
| Forum Drive | Families | −150, −1620, 33 |
| Rancho | Vagos | 480, −1880, 26 |
| Chamberlain Hills | Families | −210, −1490, 31 |
| Davis | Ballas | 100, −1700, 29 |
| Cypress Flats | Vagos | 850, −2100, 30 |

Each defined district has radius 180. A portal turf request first requires the player to be within 350 metres. It may still require moving closer for streamed pavement and safe spawning; encounters are staged inside the district near the player. A district cannot start another battle while its prior encounter is still clearing.

Ownership, number of decided battles won/defended, and a bounded heat score are stored in `%LOCALAPPDATA%\LivingLosSantos\Enhanced\campaign-v3.json`. Heat rises by fifteen for a decided battle, capped at 100; it is a gameplay score, not a measured emotion or a machine-learning statistic. Gang ownership changes recolor the six district blips. Participant blips use faction colors and are removed with their owners.

Campaign settings and ownership survive script/game reloads. Validation checks all six district identities, allowed owners, counters and settings before changing anything. Saves use an ordered single writer and atomic file replacement with a backup. Invalid campaigns are preserved in a dated `.rejected-*.json` file before defaults can be saved. The same folder contains a bounded `director.log` with status/error types and safe HTTP codes; it contains no credentials, dialogue prompts or key values.

## Every exposed setting has a game effect

| Setting | Runtime behavior |
|---|---|
| Enabled | Run/stop autonomous encounters; disabling clears owned scenes. |
| Ambient hostility | Chance of an autonomous street fight and nearby hostile ambient speech. |
| Gang aggression | Chance of a nearby turf war, fighter count, accuracy and pistol-vs-unarmed loadout for owned gang fighters. |
| Civilian panic | Whether a witness is created when budget permits and the chance of fleeing the conflict. |
| Event interval | Delay between autonomous encounter attempts; 30–300 seconds. |
| Active event cap | One to three scenes including cleanup; reducing the limit removes excess scenes. |
| Spawn cap | Four to twenty-four owned pedestrians including witnesses and corpses; reducing it clears excess scenes. |
| Turf wars / street fights | Enable each encounter type; disabling a type clears its existing scenes. |
| Ambient taunts | Enable encounter speech and eligible nearby ambient insults. |
| Tactical retreat | Owned fighters with API health below 35 may surrender or flee. |
| Blips | Create/remove district and owned participant markers. |
| Subtitles | Show/hide encounter notices and NPC dialogue captions. |
| Protect missions | Suppress encounters and portal world actions during a Story mission. |

Loading/screen transitions, cutscenes, death, interiors, loss of player control and high-speed vehicle travel suspend or clear owned encounters. Pause-menu and dialogue-keyboard states preserve existing scenes while delaying the director. NPCs owned by other scripts and mission entities are excluded from ambient dialogue/taunts. Accepted dialogue actions on an ambient NPC are short explicit interactions requested by the player; they can naturally provoke GTA AI responses.

## Live portal and conversation

Once per second, the script sends actual player/environment values, up to forty streamed NPCs and complete director state to `/api/runtime/exchange`. The protocol includes actual configuration revision, pending acknowledgements and observed/requested world events. Owned casualties can be reported with their actual negative API health. Affiliation is based on tracked owned participants or known gang model hashes; other models remain `Civilian/Unknown`.

Network work is asynchronous. No background task invokes GTA APIs. Replies enter a queue and are applied on Tick after session, TTL, state, handle and model checks. Each command ID can be claimed only once. Spawn commands are acknowledged only when actual participants have been created; preparation failures are rejected. A dialogue dispatch acknowledgement means the request was sent; the subsequent world event describes its result or failure.

The runtime has a three-second exchange deadline and a thirty-five-second dialogue deadline. Requests use literal loopback, disable proxies/redirects, and cap response size at 64 KiB. Outgoing snapshots have a UTF-8 byte budget; unsent events and acknowledgements remain queued. A companion outage does not stop the autonomous director.

Conversation retains up to six exchanges and a short note per NPC, at most thirty-two NPCs and ten minutes of idle lifetime. This session memory is not a permanent identity across game reloads. Handle/model checks reduce stale-entity mistakes but cannot prove identity across an unobserved same-model handle reuse. Gemini/fallback labels remain explicit.

Dialogue actions actually mapped to GTA: turn toward player, look, hands up, flee, seek cover, unarmed combat, or aim an existing weapon. Backup calls, police dispatch, side gigs and handshake suggestions remain dialogue-only and are labelled as such; they are not exposed as working portal functions. This client does not integrate V1 microphone capture or voice playback, and does not claim a trained combat ML model.

## Build and checks

Run `Build-EnhancedClient.ps1 -GameRoot '<Enhanced installation>'`. It uses the installed .NET Framework C# compiler and the installed Enhanced SDK; no NuGet runtime dependency is required.

Run `Test-EnhancedClient.ps1` for policy and localhost HTTP fixtures. The current suite has 53 checks covering response validation, stale entity handles, local transport/redirect/body limits, timeouts, exact director defaults, configuration bounds, command session/TTL/replay rules, survivor outcomes, bounded placement geometry and team/witness separation, and campaign atomicity/recovery.

Run `Audit-EnhancedClient.ps1 -GameRoot '<Enhanced installation>' -CecilPath '<Mono.Cecil.dll>'`. The compiled audit resolves 104 GTA API member references and eight directly used native names and records all source/build hashes in `build/verification.json`. It also rejects custom unsafe memory access/PInvoke in this client.

`Build-WorldProbe.ps1` compiles `bin/Probe-WorldContract.exe`. Run it against an isolated companion on ports 3101–3199, followed by an optional report path. It posts explicitly labelled QA frames through the same C# transport, validates returned settings, sends and parses a QA command, verifies duplicate prevention and acknowledgement, and checks nullable paused-frame handling. It deliberately cannot target the live port 3000. A successful probe is an HTTP/serialization result, never an in-game result.

The primary API references inspected are the installed Enhanced SDK and [ScriptHookVDotNet Enhanced source](https://github.com/Chiheb-Bacha/ScriptHookVDotNetEnhanced). Nonblocking keyboard signatures and return semantics were checked in the [Cfx native definitions](https://github.com/citizenfx/natives/tree/master/MISC).
