# Living Los Santos 3 — Enhanced world rebuild

The game client now owns world observations, gang encounters and territory outcomes. The web portal sends commands and desired settings to the client, then displays the client's acknowledgements and reported state. It no longer offers the old browser simulation as live GTA gameplay.

## Play

Open **Living Los Santos** on the desktop. The launcher starts the local companion and the installed RAGE Plugin Hook. Enter Story Mode and allow the world director's 15-second readiness period to finish. The client is installed in a dedicated ScriptHookVDotNet script directory and loads automatically.

- **F7:** enter a line of dialogue for an eligible nearby NPC. Typing does not block world telemetry.
- **F8:** toggle the local world director. The portal shows local overrides separately from its saved settings.
- **F4:** script console, for recovery and diagnostics. The normal launch no longer needs a console command.
- Portal: <http://127.0.0.1:3000/>. This address is local to this computer.

## What changes inside the game

- Three gangs—Families, Ballas and Vagos—contest six districts: Grove Street, Forum Drive, Rancho, Chamberlain Hills, Davis and Cypress Flats.
- Turf encounters stream gang models, find clear grounded pedestrian positions, stage a confrontation and assign combat between the two sides.
- Street fights can occur around the player outside gang districts. Eligible ambient NPCs can deliver hostile street chatter.
- Combatants can retreat or surrender at low health. Event witnesses can flee. Gang aggression, hostility and panic controls affect these behaviors.
- Territory ownership changes after a verified battle result. Leaving the streamed scene, losing a participant handle, interrupting the event or timing out does not invent a winner.
- Territory owners, win counts and director settings are persisted in the local campaign. Conversation context is bounded to the current NPC/session; the mod does not claim permanent identities for arbitrary streamed pedestrians.
- Director-owned entities and blips are tracked and cleaned up. The mod does not globally arm every pedestrian or rewrite global gang relationship tables.

Default intensity is **frequent street fights and turf battles**: hostility 65, gang aggression 75, civilian panic 70, encounter attempts every 75–90 seconds, at most 2 encounters and 16 spawned participants. These are attempts subject to scene and spawn checks, not a guaranteed battle every 75 seconds.

## Portal controls

| Area | Game connection |
| --- | --- |
| Live city | Actual player/NPC coordinates, reported events, active fights, owned participant count, start street fight, clear director encounters |
| Gang territories | Reported ownership, heat, win count, challenger, nearby turf-battle commands |
| NPCs & dialogue | Current streamed NPCs, faction identification where known, health, current conversation memory, game-directed dialogue |
| Director settings | All 14 validated settings with desired/applied revision tracking; separate weather, hour and wanted-level commands |
| Connection | Companion, Enhanced client, provider configuration, controls, last heartbeat and protocol status |

The map is a coordinate schematic, not a road map. It reports the player's streamed world. It does not simulate NPCs fighting across unloaded areas of the entire city.

The client exchanges snapshots approximately once per second, and the server pushes changes to open portals using Server-Sent Events. Each command is tied to a game session, has a 30-second expiry and is deduplicated by ID. Game controls disable when telemetry is older than 5 seconds. A queued command is not displayed as applied until acknowledged. Applied means the client dispatched the operation; the event feed reports later dialogue and battle outcomes.

## Installation and recovery

Close GTA and RAGE Plugin Hook before running `Install-EnhancedClient.ps1`. The installer checks the actual Enhanced executable version and SDK hash recorded in `release-manifest.json`, verifies the payload, and installs only the rebuilt client into `scripts\LivingLosSantos`.

It backs up `ScriptHookVDotNet.ini`, changes `ScriptsLocation` to that isolated directory and enables automatic loading. The previous scripts, voice bridge and private INIs remain on disk. They are outside the new automatic script-loading directory; ASI mods continue using their existing loaders.

Run `Disable-EnhancedClient.ps1` with GTA and RAGE closed to park the rebuilt DLL and restore the original loading configuration. The recovery script refuses to overwrite settings changed since installation. Campaign data is retained.

Campaign and diagnostic files: `%LOCALAPPDATA%\LivingLosSantos\Enhanced`. Companion desired settings: `source\data\world-settings.json`. Credentials remain in the existing private backend configuration and are excluded from the distributable package.

## Verification scope

See `world-verification.json` for checks actually run against this release. The automated tests cover command/telemetry validation, acknowledgements, freshness, idempotency, settings persistence, campaign rules and installer rollback. A compiled API audit verifies that the client resolves against the installed Enhanced SDK. Browser fixtures are isolated on another port, explicitly labelled QA, and never presented as actual GTA observations.

Actual in-game loading, command effects and encounter outcomes require runtime evidence. They are reported separately from compilation, static compatibility and fixture tests. This release does not claim a complete replacement of GTA's underlying AI, new story missions, or an autonomous campaign outside streamed areas.
