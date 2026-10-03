# Living Los Santos NPC overhaul

VERIFIED — This is the implementation contract for the user-authorized overhaul. Baseline evidence and recovery instructions are in BASELINE.md. Individual features remain unverified until their corresponding checks are recorded. An implementation entry is not a claim of in-game acceptance.

## Responsibility boundaries

- Game client: GTA API reads and tasks on Tick only; native menu/input; handle/model/scene/session/TTL checks; bounded owned entity lifecycles; actual telemetry. No secret, microphone hardware API or external audio library enters the game DLL.
- Companion: provider interfaces, structured AI validation, cancellation, metering, memory and reputation, shared settings, rendered audio cache, transcript storage and hidden audio helper. Literal loopback only.
- Audio helper: separate Windows process managed by the companion. Playback/microphone capability is reported explicitly. A running helper is not evidence that its output was audible.
- Portal: reads backend state and observed game snapshots. Desired settings are distinguished from game acknowledgements. No synthetic world state is shown as live.

## AI job map

BELIEVED — The following lane assignments preserve AI authorship while keeping game movement and audio mixing bounded locally. These are design obligations, with acceptance recorded separately.

| Feature | AI input/output | Lane | Local execution |
|---|---|---|---|
| Foot and vehicle dialogue | Persona, memory, actual mood/context → short speech, tone, allowed action, clamped deltas | A | Revalidate identity/vehicle/scene; execute a bounded task |
| Persona prewarm | Model role, appearance, district → short identity and voice cast | B | Cache; session identity or labelled best-effort notable fingerprint |
| Ambient reactions | Situation/mood/district → authored bank lines | C | Match context and cooldown; fall back explicitly |
| Combat, hurt and last words | Health, fear, witnesses → stance and authored lines | B/C, A for notable moments | Retain bounded combat tasks between pulses |
| Vehicle scenes | Observed vehicle/seat/engine/mission state → allowed scenario and beats | B/A | Separate scenario guards, timeout and ownership cleanup |
| NPC conversations | Nearby persona/relationships → two/three speaker lines | B/C | Validate all speakers before each turn |
| Memory | Bounded episodes → notes, summary, trust changes | B | Atomic storage, eviction and decay |
| Gossip/reputation | Witnessed incident → short rumour and faction/district deltas | B | Delayed bounded propagation, no fake omniscience |
| World director | Compact streamed scene and budgets → allowed scenario | B | Ground-safe placement, budget, timeout, observed outcome |
| Voice | Validated speech/tone/cast → rendered speech | A/C | Cache, stereo pan, distance gain, mixing and cleanup |
| Menu advisor/help | Wish or option metadata → proposed changes/explanation | A | Explicit Accept/Reject, revision check; no automatic patch |
| Controller replies | Current conversation → 3–5 reply options | A | Wheel selection; no freeform text required |
| Evaluation | Scenario categories → synthetic test prompts | Offline AI | Grade schema, action safety, length and tone with stored evidence |

VERIFIED — Collision avoidance, navmesh queries, frame-level locomotion, task completion checks, volume interpolation and control release are local deterministic operations. They execute validated AI selections; running a model for these per-frame operations would not add useful scene intelligence.

## Settings and revisions

VERIFIED — `shared/settings.ts` is the canonical descriptor and bounds source. `scripts/generate-settings.ts` produces the matching C# catalogue; `--check` detects drift. The original fourteen director settings keep their established world revision. NPC settings have a separate monotonic revision, source and timestamp. Both are included in protocol 4; a native menu or portal edit may supply its expected revision. A stale proposal receives 409 and must refresh before it can replace newer settings.

VERIFIED — Settings include a hard US$5 maximum combined daily provider allowance, as chosen by the user. Lower caps, including zero, are available. Presets do not raise this authorization ceiling. Every setting must have a consuming behavior and a behavior test before the final catalogue is called complete; schema validation alone does not prove that a slider affects the game.

## Content and privacy

BELIEVED — GTA-style fictional aggression is supplied through bounded prompts and schemas. Private credentials stay server-side. Diagnostics omit prompts, player utterances, microphone contents, generated transcripts and NPC secret/persona text. Transcript export is a separate explicit user action containing only generated NPC lines. The existing legacy voice service on port 8765 remains separate.

## Certification limits

VERIFIED — This agent can compile, exercise HTTP and pure policies, inspect recorded runtime telemetry and test the portal. It cannot directly operate the native GTA window or a hardware controller. New controls, native visual layout and audible voice therefore require user acceptance. Runtime and offline evidence are separate. Until the user completes the test sheet, the overhaul is **not certified in the game**.
