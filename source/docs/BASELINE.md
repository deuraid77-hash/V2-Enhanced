# NPC overhaul baseline

VERIFIED — Baseline taken 3 October 2026 on the user's Windows PC, before implementation. Source: `C:\Users\username\Documents\GTA ChatGPT Integration\V2-Enhanced\source`. GTA remains running with installed client 3.0.1; no installed game payload was replaced.

VERIFIED — A complete project copy including dependencies, existing rollback backups and private local configuration is at `C:\Users\username\Documents\GTA ChatGPT Integration\backups\npc-overhaul-baseline-20261003-184016\V2-Enhanced`. It contains 17,882 files / 332,722,839 bytes. Runtime data was separately copied to sibling `runtime-data`. The backup's `baseline-manifest.json` records executable, SDK, loader, configuration and installed DLL hashes. This backup is private and excluded from packages and Git.

VERIFIED — To restore source, stop the companion with its guarded Stop script, preserve the current project under a new name, copy the backup project to the original path, and start its companion. Only restore game runtime data with GTA closed, after preserving newer campaign progress. Existing `Disable-EnhancedClient.ps1` remains the game loader rollback; it restores the original ScriptHookVDotNet configuration and parks only this client's DLL. Do not overwrite unrelated game files.

## Checks actually run

VERIFIED — Evidence is under `verification/npc-overhaul/baseline` at the package root.

| Command | Observed result |
|---|---|
| `npm ci` | Initial attempt failed EPERM: running companion held esbuild.exe. Failure retained in npm-ci.txt. Guarded companion shutdown and its verified child-process shutdown released the file. Retry succeeded (npm-ci-retry.txt). |
| `npm run typecheck` | Exit 0 |
| `npm test` | 52 passed, 0 failed, 0 skipped |
| `npm run build` | Exit 0 |
| `Build-EnhancedClient.ps1` | Compiled successfully; no install performed |
| `Test-EnhancedClient.ps1` | 53 / 53 passed |
| `Audit-EnhancedClient.ps1` | 104 / 104 GTA members resolved, 8 native names present; no custom unsafe/PInvoke |

VERIFIED — The companion was restarted successfully after the dependency refresh. The live game process was not stopped. All docs and the main client/server/portal structures were reviewed by the implementation team before changing them. The existing folder had no Git repository; a local repository is being created for the requested stage commits, with private configuration, runtime data, dependency output and backups excluded.

## Version discrepancy resolved

VERIFIED — The actual executable FileVersion and ProductVersion are `1.0.1158.16`. Installed SDK assembly is `3.9.0.0`, loader file version `3.9.0.6`. Read-only Mono.Cecil inspection of the installed Enhanced loader shows `GTA.Game.FileVersion` delegates to `SHVDN.NativeMemory.GameFileVersion`. The `SHVDN.NativeMemory` static constructor detects Enhanced and constructs a version with the executable major number plus one (IL offsets 0196–01c4). Thus SDK telemetry `2.0.1158.16` identifies the same game build. Protocol 4 must distinguish executable and SDK versions and guard using the actual executable plus audited SDK.

VERIFIED — Installed client hash: `8A2348ADA40A25EEFDD164DB463E64BF03D8A8624C6BCB26A53B8FB7D84D6994`. Existing Desktop V3 release ZIP and original user ZIP are preserved. The known working source contains seven executed dialogue actions, actual session conversation memory and GTA recorded ambient speech; it lacks the new native menu, controller conversation path, persistent coherent NPC mind, vehicle scenarios and generated voice playback.

## Scope and evidence boundary

VERIFIED — The user authorized the full attached overhaul and a combined US$5 daily AI/voice cap. Previously observed V3 world encounters and persistence do not certify new V4 behavior. No new F7 press, controller operation, native screen inspection, audible output or before/after native frame timing was captured by these baseline checks.

BELIEVED — An SDK-drawn native menu avoids adding a menu-library dependency to the exact Enhanced build. NativeUI is archived and uses older SHVDN; LemonUI is maintained and has input support but this exact Enhanced installation has not been validated against its release. Record complete library evidence in the input design document.

VERIFIED — Native desktop operation is unavailable to this agent. New game control, audio audibility and hardware controller acceptance require the user's in-game test sheet. Until that acceptance, the overhaul is **not certified in the game**.
