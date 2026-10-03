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
| 3 Mind/memory/PTT/actions | Code present (Codex, uncommitted at handoff). See "Step 3" below. | `Test-NpcOverhaul.ps1 -Stage mind` |
| 4 Vehicles | Not started beyond vehicle-aware actions (HONK_AT_PLAYER, THREATEN_FROM_CAR, LEAVE_VEHICLE_TO_CONFRONT, DRIVE_AWAY, ASK_FOR_RIDE) and vehicle context in the action schema | — |
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

## How to run checks
- Full offline gate: `& ".\Test-NpcOverhaul.ps1" -Stage <foundation|menu|mind|vehicles|audio|director|release>` from the repo root, in Windows PowerShell 5.1 (no pwsh installed). Writes `verification/npc-overhaul/<stage>-<timestamp>/gate.json`.
- Backend only: `npm test` in `source\`.
- C# compile needs the game's `ScriptHookVDotNet3.dll` (default GameRoot is the Steam Enhanced path). The csproj and `Build-EnhancedClient.ps1` both list files by hand; add new `.cs` files to both, and to `Test-EnhancedClient.ps1` if they are pure policy.
- `Audit-EnhancedClient.ps1` proves every SDK member against the installed DLL; extend its native-name list for new natives.

## Known limits (unchanged)
- No agent session has operated the game window, a controller or speakers. Every native behaviour is **not certified in the game** until the user runs `source/docs/IN-GAME-TEST-SHEET.md`.
- Daily AI spend cap is US$5 (user choice). Ledger at the last Codex measurement showed ~US$4.99 remaining.
