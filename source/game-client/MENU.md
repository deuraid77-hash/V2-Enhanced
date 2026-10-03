# Native menu — Step 2 implementation and evidence

This stage implements the menu in the Enhanced client using the installed SHVDN 3.9 SDK's `TextElement` and `ContainerElement`. It adds no NativeUI/LemonUI binary. The reasoning and primary source review for that choice are in `FOUNDATION.md`. This document describes implemented source and offline contract evidence. Native rendering, controller hardware, sound, vibration and on-screen keyboard behavior have **not** yet been accepted in GTA.

## Implemented flow

F6 or holding RB + View opens the menu in a safe Story Mode scene. Groups, breadcrumbs, search, setting help, value editors and rebind capture cover the generated 220 NPC settings and original 14 world settings. Every row edits the same companion settings authority used by the portal. Showing a setting does not claim its later-stage action, voice, memory or vehicle consumer is already implemented.

Keyboard and mouse use arrows, Enter, Escape, F1, hover/click and wheel scrolling. Controller navigation uses D-pad or left stick, A to select, B to go back and X to explain. PlayStation prompt preference substitutes Cross, Circle and Square. Controller text entry uses an SDK-drawn 10-column character grid with capitals, punctuation, delete, clear, done and cancel. It scrolls the selected grid row at smaller safe zones or larger menu scales. Keyboard text entry uses the asynchronous native on-screen keyboard; it never blocks exchange or Tick. Search also has an explicit Clear action.

The layout is calculated in SDK scaled coordinates (720 units high, `Screen.ScaledWidth` wide), clamped to the actual safe zone, configured scale, opacity and position. The visible row count shrinks to reserve help and status space. Preallocated SDK text/container objects draw the panel. Menu sounds and short optional vibration use audited SDK native names; whether they are perceptible remains a game acceptance check.

## Settings, revisions and persistence

Edits debounce for 350 ms. The first edit captures that scope's server revision; later portal acknowledgements cannot advance this captured draft base. The compact world PATCH response reads `config.revision`, while NPC settings read `revision`. A 409 or any failed request preserves the draft and stops automatic retry. **Review pending edits → Refresh and rebase edits** explicitly reads both current server snapshots, validates the full merged settings, and retries against those revisions. Newer local edits survive an older successful batch. Profile or advisor application marks existing drafts for review.

The footer distinguishes local draft, saving, saved-but-pending game application, and applied NPC/world revisions. The game continues to apply settings from exchange on Tick, preserving separate revision acknowledgements. This is not a local-only preferences copy.

Profiles provide all built-in presets and custom save, rename, delete, full bundle apply, JSON export and import. Apply uses both expected revisions and the companion's atomic NPC+world authority. Local exports/imports are restricted to `%LOCALAPPDATA%\LivingLosSantos\Enhanced\Profiles`, use validated filenames and bounded JSON, and run off Tick. Import stores a profile without applying it. Existing exported files retain a `.bak` when replaced.

## AI and diagnostics

The Settings Advisor sends a separate asynchronous menu job. A creation gate prevents repeated clicks from starting multiple paid jobs. Each completed proposal lists the original and proposed values and reasoning; only **Accept proposal** changes settings. Reject, back and close discard the preview. Accept adapts the backend's `npcSettings` and `worldConfig` snapshots. Explain supports NPC and `world.*` setting keys.

Pending menu jobs are polled at 750 ms. Three failed status reads request cancellation, with bounded retry spacing. Close/panic cancels known jobs. A creation response arriving after menu close is cancelled using its returned ID. Menu job requests and cleanup use independent, bounded, loopback-only HTTP transports so script cancellation does not immediately cancel its own cleanup request. Cleanup is best effort if the process terminates or the companion is unavailable; the server deadline remains authoritative.

The AI status page shows configured model tiers, bounded actual status arrays, the UTC observation time and age, plus explicit refresh. A connection test is a deliberate metered action within the shared budget. The NPC inspector displays observations, observation age, bounded mind state and actual working transcript. Persistent memories, recognition and reply-wheel UI belong to Step 3 and are not represented as completed here.

Diagnostics show actual EXE/SDK versions, observed ScriptHookV and SHVDN loader file versions and hashes, Tick measurements, scene state and request counts. Observed loader hashes do not certify their compatibility. **Export sanitized diagnostics** calls the production export endpoint and displays its saved filename and byte count. No key, provider credential or full transcript is exported by the menu. **Menu self-test** checks current layout bounds and state release, then supplies a page for human visual/input verification; it does not certify a controller or invent a native test result.

## Input conflict and release table

| Context | Inputs consumed | Release / conflict behavior |
|---|---|---|
| Menu activation | F6, or held RB + View by default | Only the actual chord's physical aliases are masked while held in an eligible scene. Defaults avoid impossible opposing D-pad chords. |
| Panic | F10, or held RB + R3 | Remains available during keyboard entry. Cancels menu input and owned AI/world work. |
| Normal controller menu | D-pad, left stick, A/B/X | GTA context aliases for those physical buttons are masked for that frame. RT acceleration and LT braking remain available; using combat/aiming or moving a vehicle above the safe menu speed closes the menu. |
| Controller rebind capture | Canonical script buttons 222–236 | All accepted button aliases are masked during capture only, including LT/RT. Capture waits for the select button to be released before accepting a new binding. |
| Keyboard/mouse menu | Arrows, Enter/Escape/Back, selection and cursor controls | Used cursor/selection controls only. W/A/S/D are not globally disabled. |
| Stock character shortcuts | F5/F6/F7 and F8 overlap GTA character selection | The corresponding stock control is masked only while a valid mod-bound shortcut is held; F4 remains reserved for the SHVDN console. |
| Binding validation | Keyboard key names and accepted controller buttons | Reject reserved console/director keys, duplicates, controller physical aliases (51=235, 52=234), axes and impossible D-pad modifier selection. |
| Close / panic / death / pause / cutscene / loading / error / abort | Menu-owned frame masks and input capture | Frame masks expire automatically, state/capture queues are cleared, native keyboard is cancelled, and no `EnableAllControls` or global control override is used. |

Other installed mods can use the same buttons. Their bindings are not discoverable through the tested SDK. The in-game conflict guide therefore requires checking actual hardware and other mods after rebind. The canonical control labels/aliases are based on the [Cfx control reference](https://docs.fivem.net/docs/game-references/controls/). The SDK exposes [`SET_PAD_SHAKE`](https://github.com/citizenfx/natives/blob/master/PAD/SetPadShake.md) as `Hash.SET_CONTROL_SHAKE`; the audit records its actual hash.

## Repeatable verification

Run from this directory in PowerShell:

```powershell
.\Build-EnhancedClient.ps1
.\Test-EnhancedClient.ps1
.\Audit-EnhancedClient.ps1
.\Build-MenuProbe.ps1
.\bin\Probe-NativeMenu.exe http://127.0.0.1:3112/ .\build\menu-contract.json
```

The HTTP probe refuses the live port and requires the explicit fake-provider fixture identity. It uses the production `DashboardTransport` plus the same revision and advisor adapters as the native menu. It checks compact world settings, stale edits, full profile CRUD/apply/export/import, advisor preview/accept/reject, world explain, diagnostic analysis and sanitized export. The fixture imports no credential reader and makes no paid provider call or GTA action.

Offline tests cover safe-zone layouts, hit testing, navigation/capture release, virtual keyboard bounds/scrolling, revision conflicts, preservation of newer edits, controller alias validation, mask scope, profile path boundaries and local roundtrip. `build/verification.json` records resolved SDK references, native names and source hashes, with `GameExecuted=false`. Native visual and physical input acceptance must be recorded separately when the parent performs the authorized game stage.
