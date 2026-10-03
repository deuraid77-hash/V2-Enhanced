# Living Los Santos 4 — user acceptance sheet

VERIFIED — This sheet describes required acceptance checks for the authorized overhaul. It is a checklist, not evidence that those features have passed. Build/test/audit evidence is recorded separately. Until the user completes the relevant rows, the overhaul is **not certified in the game**.

BELIEVED — Default bindings under implementation are F6 menu, F7 typed talk, G quick replies, held N push-to-talk when enabled, F8 existing director toggle, F10 panic. Xbox defaults are held RB + View/Back for menu, held RB + Right Stick click for panic, D-pad Right for talk, D-pad Left for replies, held Left Stick click for push-to-talk in an eligible conversation. Confirm the final native prompts after installing; rebindings and controller remapping take precedence.

## Installation and connection

- [ ] Enter Story Mode through RAGE Plugin Hook. Let the startup grace finish. Confirm the version and compatibility status in the portal/native diagnostics.
- [ ] Confirm the portal marks the game fresh and shows the current character position. Move a short distance and check that the position updates.
- [ ] Change one harmless setting in the portal. Confirm its desired revision becomes applied in game, with the correct change source.
- [ ] Change a different setting in the native menu. Confirm the portal receives that newer revision.
- [ ] Make competing edits from menu and portal. Confirm the older edit is flagged or rejected instead of silently replacing the newer one.

## Native menu and keyboard/mouse

- [ ] Open and close the menu repeatedly with F6. Navigate tabs, categories and long lists. Read a tooltip and search for a setting.
- [ ] Change a toggle, number, slider, selection and text field using keyboard alone, then mouse alone.
- [ ] Change and reset a binding. Attempt a reserved/duplicate binding and confirm a clear rejection.
- [ ] Open pause, die/reload, enter a cutscene, lose player control and reload the script with the menu open. Confirm the menu closes and ordinary controls return.
- [ ] Try the menu on foot, in a parked car, on a motorcycle, on a boat and in an aircraft. Confirm context prompts and that closing it returns movement, steering and camera control.
- [ ] Save, load, rename, export, import and delete a custom profile. Confirm built-in profiles remain intact. Quiet must stop generated voices; Performance must reduce actual work.
- [ ] Ask the Settings Advisor for a change. Read before/after values, reject once, then accept another proposal. Confirm rejection makes no change and acceptance is revision-checked.
- [ ] Explain a selected option with AI help. Check its source label and what happens with the provider unavailable.

## Xbox controller — separate hardware confirmation

- [ ] Prompts switch when alternating keyboard/mouse and controller. Xbox labels match actual buttons; PlayStation-label override is readable if selected.
- [ ] A single RB or View/Back tap does not open the menu. The full held chord opens it once, with no repeated activation while held.
- [ ] Navigate every native panel with controller only. Open, adjust, confirm, back out, and close without typing.
- [ ] Use the AI quick-reply wheel for several conversation turns. Reply count matches the setting. The wheel releases controls on cancel.
- [ ] Test controller text entry only as a backup. Record whether the Enhanced native keyboard is usable with this controller/Steam Input setup.
- [ ] Test microphone hold/release when enabled. Confirm capture stops on release, timeout, pause, death and panic; it never starts from unrelated stick use.
- [ ] Test chords and interaction controls on foot, in cars, motorcycles, boats and aircraft; while aiming; with phone, weapon wheel or radio wheel open. Record any unwanted radio/headlight/cover/camera action.
- [ ] Confirm deadzone, hold-time and vibration settings make an observable difference, without trapped focus or a disabled control after exit.

## Conversation, memory and actions

- [ ] Talk to an eligible nearby pedestrian with F7. Observe a source-labelled subtitle and the first spoken sentence; later text must not repeat the already-spoken first sentence.
- [ ] Interrupt by walking away, drawing a weapon, taking damage, pausing, entering a protected scene or leaving the area. No late line/task may affect another reused NPC handle.
- [ ] Use calm, rude, threatening and conciliatory lines. Inspect actual fear/aggression/morale/trust/respect and memory changes. Zero-valued states must remain zero when appropriate.
- [ ] Revisit the same notable NPC and check remembered context. After restart, any fingerprint match must say best-effort; unrelated pedestrians must not inherit certain identity claims.
- [ ] Test forget-one-NPC, faction reputation reset and reset-all memory. Check that unrelated records survive the selective operations.
- [ ] Observe a witnessed event, delayed local gossip and reputation decay. Confirm the UI distinguishes observed events from AI-written interpretation.
- [ ] Test AI-initiated approaches and dismiss one. Confirm approach cooldown and disabling approaches take effect.

BELIEVED — Each action below must produce a real, bounded behavior when its context permits it, or an explicit rejection when it does not. Confirm a disabled action never executes. Observe completion, interruption and cleanup. A dialogue sentence mentioning an action does not pass this row.

| Action | Observe and mark |
|---|---|
| Casual talk / intimidate | Turn/look or bounded intimidation; no ambient weapon grant |
| Surrender / panic flee / cover | Appropriate hands-up/flee/cover task with timeout |
| Draw weapon / melee | Existing-weapon-only draw or bounded melee; no task applied to a protected NPC |
| Call 911 | Phone behavior plus bounded permitted wanted/police consequence |
| Call faction backup | Capped owned backup group; owned-only cleanup |
| Side gig | Clear small objective, success/failure event and cleanup |
| Handshake respect | Visible social animation and actual reputation change |
| Follow / lead to | Bounded follow or locally approved destination; no AI-invented coordinates |
| Sit and talk / lean and smoke | Eligible scenario animation, interruptible and cleaned up |
| Use phone / wave off / apologise | Distinct appropriate game task or animation |
| Plead / beg | Distinct appropriate behavior, finite task lifetime |
| Sell tip / give directions | Actual bounded tip/destination result and interaction outcome |
| Ask for ride | Safe seat/vehicle/destination checks before task |
| Honk / threaten from car | Correct observed vehicle/occupant remains the target |
| Exit to confront / drive away | Correct seat/driver, safe motion and timeout; no forced player-vehicle alteration |

## Ten vehicle scenarios

Implementation boundary: scenarios use only peds and vehicles already in the world. Nothing is spawned, warped or deleted, so the created-entity count must not change at all. One scene runs at a time, made of 1–4 beats about 3.5 s apart. Each beat is one subtitle line (`LLS: <name> [gemini|fallback]: …`) plus one catalogue action. Scenario start, finish and end reasons appear as `vehicle_scenario` events in the portal event list.

For every row:
- Confirm the subtitle source label (`gemini` or `fallback`).
- Then cancel: walk/drive away, press panic, or use portal Clear. The scene must stop with an end reason, and no further beat may run.
- A mission-persistent ped or vehicle must never be selected. Do one row during a story mission to confirm nothing triggers.

Detection only offers each NPC once per 120 s and each scenario once per 45 s. Wait between attempts.

| Scenario | How to trigger | Expected |
|---|---|---|
| 1. Window talk | On foot, stand ≤ `vehicles.windowTalkMeters` (default 4 m) from a stopped NPC car. | Occupant speaks; action is `TALK_CASUAL`/`WAVE_OFF`/vehicle-compatible only. |
| 2. Car-to-car | In a car, stop or crawl (≤ `conversation.vehicleMaxSpeed`) within 6 m of an NPC driver. | Driver speaks; honk/drive-away only if they are the driver. |
| 3. Passenger chat | Have an NPC in your own vehicle. | **Expected to not start.** The existing safety rule excludes NPCs in the player's vehicle from every action, so the companion admits no plan. Record whether anything appears. |
| 4. Lifts | Stop your car (≤ 1 m/s) with the front passenger seat free, ≤ 8 m from a pedestrian. | `ASK_FOR_RIDE` or talk. No forced entry, no destination travel (not implemented). |
| 5. Road rage | Bump an NPC-driven car at low speed. | Driver honks/threatens/exits to confront within lease timeout; no chase is created. |
| 6. Carjack | Jack an NPC driver (F / Y). | Victim reacts (flee, call 911, plead). Witness reactions are not separate scenarios in this build. |
| 7. Pedestrian impact | Clip a pedestrian with your vehicle without killing them. | Struck ped reacts (911/flee/talk). Requires the hit to register within one scan second. |
| 8. Traffic stop | Get a 1-star wanted level near an ambient officer on foot or in a stopped car (≤ 12 m). | Officer line + intimidate/talk. No bribe logic exists; wanted level is not altered by the scene. |
| 9. Drive-by / cruising | Stand near a slow (≤ 8 m/s) Families/Ballas/Vagos car (≤ 25 m). | Threaten/honk from car. No weapons are fired by the scene itself; no relationship edits. |
| 10. Breakdown | Find an NPC on foot within 8 m of their wrecked last vehicle (engine health < 300 or undriveable), ≤ 12 m from you. | NPC asks for help / uses phone. An NPC still sitting in an undriveable car gets no actions, because the existing guard requires a driveable vehicle. No repair or completion flow exists. |

Also record `director.log` lines starting `Vehicle scenario rejected:` if any appear.

## Voice and transcripts

- [ ] Test casual, combat, vehicle, phone and narrator category volumes. Test master mute and Quiet profile.
- [ ] Walk around a speaking NPC and compare left/right pan. Walk away until inaudible. Turn the camera and verify listener orientation.
- [ ] Compare open/closed windows and interior boundaries. Note muffling and range behavior.
- [ ] Overlap lower-priority barks with conversation; the voice cap and priority rules must remain audible and intelligible.
- [ ] Confirm GTA Windows-session mute/volume is respected and temporary ducking is restored after speech/cancel/helper exit. The game's separate internal audio sliders require independent confirmation.
- [ ] Disconnect the provider or set budget to zero. Cached AI lines remain labelled as cached; Windows speech/local lines remain labelled fallback.
- [ ] Confirm stable per-persona voice casting and distinct emotional delivery. Repeat a cached line and compare startup delay.
- [ ] Check timed subtitles, speaker names and source labels against what is heard. Mouth animation, if available, must stop with speech.
- [ ] Filter transcripts by speaker/category/source/time and export generated lines. Diagnostics must not include their contents or player/microphone text.

## World, performance and recovery

- [ ] Near Grove Street/Davis, observe a turf war. Verify observed winner/territory ownership, persistence and eventual owned cleanup. An interrupted battle must not invent a winner.
- [ ] Observe street fights and the noncombat scenes: arguments, deals, chases, hold-ups, tourists, fans, drunks, protests, police/civilian incidents and aftermath chatter.
- [ ] Set one scenario/district weight to zero and verify it prevents starts. Restore defaults afterward.
- [ ] Run a long session with encounters, conversations, vehicles, menus and repeated interruptions. Record duration, maximum owned entities, queue growth, audio count and measured Tick/frame times.
- [ ] Press panic during speech, AI work and a scene. Owned entities/tasks/audio stop; controls return; menu stays usable.
- [ ] Start safe mode. Confirm only menu/diagnostics run and risky features remain disabled.
- [ ] Confirm the US$5 combined daily cap, timezone and unknown-usage reservations are visible. Provider failure/restart must not reset today's allowance.
- [ ] Export sanitized diagnostics. If recovery is needed, close GTA/RAGE and use the supplied guarded disable/rollback workflow; confirm unrelated mods and campaign files remain.

## User result

Record date, installed DLL hash/version, controller/Steam Input setup, audio output device, checks passed and any failed row with its exact trigger. Native visuals, audibility, controller feel and coexistence with the other installed mods remain **BELIEVED** until these observations are supplied. Do not mark the whole sheet passed from an automated build or HTTP fixture.
