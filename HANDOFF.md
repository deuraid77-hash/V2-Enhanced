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
| 4 Vehicles | VERIFIED offline gate, commit `5d5b291` | `verification/npc-overhaul/vehicles-20261003-213816/gate.json` |
| 5 Audio | VERIFIED offline gate, commit `6dfa974`. No device playback or Gemini TTS call was made | `verification/npc-overhaul/audio-20261003-220735/gate.json` |
| 6 Director/perf/soak/panic/install | Street-scenario director + companion soak: VERIFIED offline gate (10 checks). In-game tick/frame numbers, panic/safe-mode execution, release packaging: NOT done (see "Step 6") | `verification/npc-overhaul/director-20261003-222323/gate.json` |

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

## Step 5 notes
- Backup of pre-change audio, client, server and doc files: `backups/step5-20261003-214845/`.
- Flow: `AudioBridge.cs` `TickAudio` (after `TickPtt`) posts `/api/audio/frame` with listener pose, interior, speaker poses, queued voice cues and barks. On the server, `voice-routes.ts` → `VoiceService.frame()` picks a voice (`voice.ts` `castVoice`, stable per persona) and a source. The `audioHostProcess` in `server.ts` is shared with PTT, and `PlaybackEngine.cs` plays the speech with distance, pan and muffling.
- Source rule: `auto` plays cached Gemini PCM if present, otherwise Windows SAPI. It never starts a metered render. `gemini` renders through the budget, with an output reservation that assumes 32 tokens/s (BELIEVED, not measured).
- Line bank (`line-bank.ts`): 22 labelled seed lines. Generated refills run through lane C (`ai.bankModel`) and `validateGenerated`. They are persisted in `line-bank.json`. No refill has run against the real provider.
- Transcripts: `transcripts.ts`, a capped JSONL log; `GET`/`DELETE /api/transcripts`.
- Measured offline (`--render-test`, in memory, no device): 124.2 ms cold for 2.77 s of audio, 68.6 ms warm for 3.40 s. Installed SAPI voices: Hazel (en-GB) and Zira (en-US), both female, so male personas fall back to them.
- Not implemented: ducking, following game volume, muffling based on window state (`windowMuffleGain` is unused), facial animation, Windows pitch, Gemini idle pre-render. On script abort, silence depends on the host's stale-pose timeout.
- Unverified: the Gemini TTS response format. The docs example shows raw PCM; an earlier README claimed WAV. The provider rejects RIFF and falls back to Windows. The `gemini-3.8-*-tts` prices in `ai-budget.ts` came from Codex, and their provenance is unverified.

## Step 6 notes
- Backup of pre-change files: `backups/step6-20261003-221408/` (includes root `package-result.json`, `release-manifest.json`, `world-package-verification.json`; none of these were modified).
- Street scenarios (`EXTRA_SCENARIOS`) reuse the Step 4 pipeline end to end:
  - Client: `StreetPolicy.cs` classifies, inside the existing scan in `VehicleScenarios.cs`.
  - Server: `street-scenarios.ts` provides briefs, fallbacks and weights; `vehicle-scenarios.ts` validates and admits; `ai-service.ts` `pulseVehicles` plans.
  - `ScenarioCatalog` decides which names the shared gate and parser accept.
  - Contract: `WORLD-PROTOCOL.md` § Street scenarios.
- `director.<id>Weight`, `director.nightMultiplier`, `director.rainMultiplier` and `director.<district>Multiplier` were dead settings before this step. They are now consumed for street scenarios only. Grove/Forum district matching depends on zone names that have not been checked in the game.
- Soak finding (VERIFIED, fixed): background director and memory jobs were never pruned from `AiService.jobs`. A 2-hour simulated run reached 720 entries, growing linearly. The fix applies the existing 256-finished-job bound via `pruneFinishedJobs()`. After the fix, a 4-hour run peaked at 256. Regression test: `test/soak.test.ts`. Harness: `scripts/soak-companion.ts` (companion only; fixture provider; simulated clock; memory pulses disabled).
- Gate: `-Stage director|release` adds a 10th check, `companion-soak` (4 h simulated).
- Panic/safe mode: no code change. Code reading (BELIEVED) shows that the key and menu panic paths both end actions, scenarios and audio by the next tick, through the hard-pause path in `UpdateScene`/`TickNpcActions`/`TickVehicles`/`TickAudio`. Safe mode pauses work but still constructs every component. None of this has been executed in the game.
- Release packaging is BLOCKED and was not run:
  - `Package-Enhanced.ps1` calls `rg`, which is not on PATH (`Get-Command rg` returned nothing).
  - `release-manifest.json` pins the V3 DLL hash `8A2348AD…`; the current V4 build is `6B1DAEFD…`, so `Verify-WorldPackage.ps1` would reject it.
  - Regenerating the manifest is a ship decision for the user.
- Not done: measured tick cost and frame time (needs the game), on-screen debug overlay check, and multi-NPC participants in street scenes.

## How to run checks
- Full offline gate: `& ".\Test-NpcOverhaul.ps1" -Stage <foundation|menu|mind|vehicles|audio|director|release>` from the repo root, in Windows PowerShell 5.1 (no pwsh installed). Writes `verification/npc-overhaul/<stage>-<timestamp>/gate.json`.
- Backend only: `npm test` in `source\`.
- C# compile needs the game's `ScriptHookVDotNet3.dll` (default GameRoot is the Steam Enhanced path). The csproj and `Build-EnhancedClient.ps1` both list files by hand; add new `.cs` files to both, and to `Test-EnhancedClient.ps1` if they are pure policy.
- `Audit-EnhancedClient.ps1` proves every SDK member against the installed DLL; extend its native-name list for new natives.

## Known limits (unchanged)
- No agent session has operated the game window, a controller or speakers. Every native behaviour is **not certified in the game** until the user runs `source/docs/IN-GAME-TEST-SHEET.md`.
- Daily AI spend cap is US$5 (user choice). Ledger at the last Codex measurement showed ~US$4.99 remaining.
