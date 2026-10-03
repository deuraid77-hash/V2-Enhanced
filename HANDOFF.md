# Living Los Santos NPC overhaul — handoff (written 2026-10-03 21:20 +10:00)

Spec: `C:\Users\username\Desktop\AGENT-PROMPT-LivingLosSantos-NPC-Overhaul.md` (sections 12 and 14 are the work order and done-list).
Repo: `C:\Users\username\Documents\GTA ChatGPT Integration\V2-Enhanced` (git). Source in `source\`.
Codex ran out of credits while writing its handoff; this file replaces it. Its stub folder `Desktop\Living-Los-Santos-Handoff-2026-10-03\` contains only two test logs.

## State by step

| Step | State | Evidence |
|---|---|---|
| 0 Baseline | VERIFIED done, commit `576ee3a` | `source/docs/BASELINE.md` |
| 1 Foundation | VERIFIED offline gate, commit `9a1d461` | `verification/npc-overhaul/foundation-20261003-193248/gate.json` |
| 2 Menu/settings | VERIFIED offline gate, commit `2a9c8ce` | `verification/npc-overhaul/menu-20261003-202515/gate.json` |
| 3 Mind/memory/PTT/actions | VERIFIED offline gate, commit `f2dcc92` | `verification/npc-overhaul/mind-20261003-212029/gate.json` |
| 4 Vehicles | VERIFIED offline gate (see "Step 4" below) | `verification/npc-overhaul/vehicles-20261003-213816/gate.json` |
| 5 Audio | Helper process scaffolding only (`source/audio-host`, NAudio vendored, PCM/IPC policy tests). No bank generation, TTS rendering, casting, spatial playback | — |
| 6 Director/perf/soak/panic/install | Not started | — |

Nothing from V4 is installed in the game. The installed 3.0.1 DLL and V3 portal are preserved.

## Step 3 notes
- Backup of Codex's uncommitted work: `backups/step3-wip-20261003-211634/` (copies of all 91 changed/new files, `tracked.patch`, `git-status.txt`).
- All 27 actions in `ActionPolicy.Names` map to a game task in `NpcActions.cs` `StartNpcAction`; unmapped types throw.
- Two stale baseline tests were updated to the Step 3 contract (2026-10-03 21:17–21:20):
  - `source/test/http.test.ts`: legacy `/api/memory/record` and `/clear` now assert 410 `legacy_memory_retired` (retired by MIND-CONTRACT.md).
  - `source/game-client/test/OfflineTests.cs`: action classification now asserts the full catalogue is supported and that invented names are rejected.
- Gate harness fix: `Test-NpcOverhaul.ps1` portal build now passes `--emptyOutDir`. Without it, vite's stderr warning aborts the gate under Windows PowerShell 5.1 with `$ErrorActionPreference='Stop'` even though the build exits 0. Backup of the old script is in the step3-wip backup folder.

## Step 4 notes
- Backup of pre-wiring client/build/docs files: `backups/step4-wire-20261003-213621/`.
- Flow: `VehicleScenarios.cs` `TickVehicles` (1 Hz, ≤16 peds within 25 m) → `VehiclePolicy.Classify` → `ScenarioGate.Offer` → exchange `vehicleOpportunities`. On the server, `ai-service.ts` `pulseVehicles` → Lane B `vehicleScenario` (fallback is Lane D) → update `kind:'scenario'`. Back in the client, `ConsumeScenario` (Parse + Bind, single-use claim) → `TickScenarioRun` (one beat every 3.5 s via `QueueNpcAction`).
- Gap fixed: the client's `Describe()` never sent `vehicle`, so server-side vehicle action filtering was inert. It now sends it. Side effect: NPCs in vehicles are limited to vehicle-compatible actions in conversations too. This was Codex's server design, now active.
- Known non-functional or partial scenarios are listed in `STATUS.md` (Step 4 scope) and the in-game sheet.

## How to run checks
- Full offline gate: `& ".\Test-NpcOverhaul.ps1" -Stage <foundation|menu|mind|vehicles|audio|director|release>` from the repo root, in Windows PowerShell 5.1 (no pwsh installed). Writes `verification/npc-overhaul/<stage>-<timestamp>/gate.json`.
- Backend only: `npm test` in `source\`.
- C# compile needs the game's `ScriptHookVDotNet3.dll` (default GameRoot is the Steam Enhanced path). The csproj and `Build-EnhancedClient.ps1` both list files by hand; add new `.cs` files to both, and to `Test-EnhancedClient.ps1` if they are pure policy.
- `Audit-EnhancedClient.ps1` proves every SDK member against the installed DLL; extend its native-name list for new natives.

## Known limits (unchanged)
- No agent session has operated the game window, a controller or speakers. Every native behaviour is **not certified in the game** until the user runs `source/docs/IN-GAME-TEST-SHEET.md`.
- Daily AI spend cap is US$5 (user choice). Ledger at the last Codex measurement showed ~US$4.99 remaining.
