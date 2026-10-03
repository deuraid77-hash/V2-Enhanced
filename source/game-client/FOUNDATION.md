# NPC overhaul foundation gate

This is the source-only protocol 4 foundation. It is not the final overhaul release and must not replace a running game DLL. Parent integration owns installation and live acceptance.

**VERIFIED**: the C# 5 / .NET Framework 4.8 source compiles against the installed Enhanced SHVDN API. `Test-EnhancedClient.ps1` tests pure validation, mind bounds, zero values, malformed atomic updates, update replay, scene expiry, handle/model guards, input hold/release, generated settings validation, revision order, and executable compatibility. The generated catalog is authoritative metadata, not evidence that every later-stage feature is wired.

The client sends protocol 4 frames, retains the 14 original world settings, and separately acknowledges `npcSettings.revision`. NPC observations include the actual handle/model, health, weapon, combat state, recent observed damage, distance, fear/aggression/morale, trust/respect and mood. Player context includes stance, selected weapon and faction standings; gunfire means an observed shooting ped within the bounded scan window. It is not a promise to hear all gunshots anywhere in the world.

Conversation now waits until the chosen NPC has appeared in an accepted exchange, then submits an idempotent `POST /api/ai/jobs` request. Its context includes an immutable snapshot of the latest twelve player/NPC history entries, capped at 400 characters each; that history is not repeated in every telemetry frame. The one active conversation is bound to its NPC identity, runtime and scene epoch. Speech updates only display text. A final valid update applies bounded mental deltas once and asks the guarded executor to perform an allowlisted task. Action outcomes distinguish a task accepted by GTA from a completed action. Receipts only acknowledge transport consumption. A fast final reply arriving before the job creation response remains unreceipted until its job ID is known.

Scene changes, death, departing targets, panic, shutdown and expiry cancel stale work. A cancelled job creation response is cancelled by its returned job ID. A transient submission failure retries the same request ID once. No GTA call occurs in a worker task; workers only exchange immutable JSON and enqueue managed results.

The foundation still executes only the seven original actions. The full menu, controller reply wheel, AI director/personas/banks, persistent notable memory, remaining actions, vehicles and generated audio belong to later gates. Controller input can route the conversation control to GTA's text input at this stage; controller-only freeform speech and quick replies are not claimed. Input device detection and holds are implemented, but actual physical controller use remains **BELIEVED**, not tested hardware behavior.

The native keyboard is polled without blocking Tick. Panic closes it, clears owned encounters, cancels AI and restores temporary weapon selection leases. Keyboard/controller events are consumed on Tick. The full menu will use a scoped control mask; no global input disable is introduced here.

Scans admit at most four observed peds per Tick, check the configured cooperative Tick budget between peds, and expire old observations. A single native call cannot be preempted. `tickMetrics` records total Tick, original world-director cost, NPC/transport remainder, a rolling p95, deferred scans and the actual game's last frame duration. These counters do not establish a performance result until captured in game. The old v3 client did not measure those counters, so no historical before/after claim can be reconstructed from an offline benchmark.

Exact build matching uses actual executable file version, SDK assembly version and SDK SHA-256. A mismatch pauses risky features. `Inspect-EnhancedVersion.ps1` reproduces the installed SDK's version normalization: actual executable `1.0.1158.16` is exposed by the SDK as `2.0.1158.16`. Telemetry keeps both. This check can guard a successfully loaded script; it cannot make an incompatible game loader survive a future update.

Offline commands:

```powershell
.\Build-EnhancedClient.ps1
.\Test-EnhancedClient.ps1
.\Audit-EnhancedClient.ps1
.\Build-FoundationProbe.ps1
.\bin\Probe-NpcFoundation.exe http://127.0.0.1:3107/ .\build\foundation-contract.json
.\Inspect-EnhancedVersion.ps1
```

The compiled probe must target the team's isolated fake-provider fixture, never port 3000. It labels fixture observations, performs no native game actions, marks proposed actions rejected, and checks settings, job idempotency, streaming/final updates, replay, mind application, transport receipts, cancellation and nullable scene resets. The probe does not prove the provider or in-game conversation worked. **GUESS**: none is used as acceptance evidence.

Menu library decision for the next gate: NativeUI is MIT but archived/deprecated and its project references SHVDN2. LemonUI is MIT and provides SHVDN3/controller/mouse support; its official release does not certify this exact installed Enhanced combination. An SDK-drawn menu avoids another binary dependency and permits an explicit control mask audited against the exact installed SDK. This is a footprint and verification choice, not a claim LemonUI is incompatible.

Primary sources inspected: [NativeUI repository](https://github.com/Guad/NativeUI), [NativeUI project](https://github.com/Guad/NativeUI/blob/master/NativeUI/NativeUI.csproj), [LemonUI releases](https://github.com/LemonUIbyLemon/LemonUI/releases), [LemonUI MIT license](https://github.com/LemonUIbyLemon/LemonUI/blob/master/LICENSE), [LemonUI native menu source](https://github.com/LemonUIbyLemon/LemonUI/blob/v2.2/LemonUI/Menus/NativeMenu.cs).
