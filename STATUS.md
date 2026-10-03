# Living Los Santos NPC overhaul — stage status

**VERIFIED — installed release:** the existing 3.0.1 Enhanced client and V3 portal are preserved. The V4 source described below has not been installed in GTA. The baseline backup and commit `576ee3a` retain the previous source, installer and rollback. See `source/docs/BASELINE.md`.

**VERIFIED — Step 0 completed:** the baseline passed 52 backend tests, 53 C# tests, 17 installer checks, 104 SDK references and 8 direct native names. The executable is 1.0.1158.16; the installed Enhanced loader deliberately presents SDK Game.FileVersion as 2.0.1158.16. These are separate fields in protocol 4.

**VERIFIED — Step 1 offline gate passed on 3 October 2026:** `Test-NpcOverhaul.ps1 -Stage foundation` passed all nine checks: generated settings consistency, TypeScript, 101 backend tests, staged portal build, client build, 74 C# tests, audit of 113 SDK references and 9 direct native names, 18 external audio-helper policy checks, and 17 installer/rollback checks. No unsafe memory access or P/Invoke was found in the game client. Evidence: `verification/npc-overhaul/foundation-20261003-193248/gate.json`.

**VERIFIED — foundation behavior:** protocol 4 preserves protocol 3; AI work is validated, bounded, cancellable and metered against the combined US$5/day cap in Australia/Sydney. A compiled C# probe exercised streamed speech, final results, receipts, cancellation, duplicate suppression and delivery of working history and NPC memory into the provider prompt. No game-native action ran in this probe. The settings catalogue contains 220 bounded entries; consumption of later-stage settings is not claimed yet.

**VERIFIED — provider samples:** one successful Gemini 3.5 Flash Lite stream took 1,834 ms to first text and 2,859 ms to completion; one Gemini 3.8 Flash stream took 9,251 ms and 9,258 ms. Neither measures first audio. Five evaluations, including three failed requests with retained conservative reservations, used an estimated US$0.0119645. Actual invoice charges are not verified. See `verification/ai-foundation-summary.json`.

**VERIFIED — portal fixture:** save, concurrent-edit conflict/rebase, draft preservation and disconnected controls passed at desktop and 390×844 mobile sizes. Connected testing recorded no console errors. The built V4 portal is staged outside the live V3 assets. Audio-helper checks opened no audio devices.

**VERIFIED limitation — Step 1 native gate:** the new DLL has not been installed; this tool session cannot operate the native game window or controller. F7 for this DLL therefore cannot yet be proven. The brief permits this gate with a written reason. `source/docs/IN-GAME-TEST-SHEET.md` records the required human checks. This build is **not certified in the game**.

**BELIEVED:** the validated input and transport logic will support the next menu and conversation stages, subject to actual game/controller acceptance. Step 2 menu implementation is next; complete mind, vehicle, audio and director features remain required.

**GUESS:** no guessed compatibility, latency, audibility or gameplay result is used as acceptance evidence.
