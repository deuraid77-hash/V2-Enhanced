# Release status — Living Los Santos 3

Rebuilt game client and portal installed. Automatic loading is configured for the dedicated `scripts\LivingLosSantos` directory. Existing game executables, scripting libraries, original mod and private credentials are preserved; the previous loading configuration has a verified rollback copy.

Automated verification passed: 52 backend tests, 53 C# tests, 17 installer/rollback checks, 104/104 Enhanced SDK references, 8 native symbols, TypeScript check, production build and compiled C# command/acknowledgement round trip. The portal has been exercised in an isolated browser fixture, including acknowledgements, rejections, NPC dialogue input, setting revisions, responsive layouts and disconnected controls. The backend suite includes a real HTTP regression for large SSE frames and backpressure.

Actual game acceptance passed for the installed 3.0.1 client. Automatic loading, live telemetry, a completed street fight, and a portal-triggered nine-participant Davis turf battle were observed. The Families defeated the Ballas at 2026-10-03 07:02:29 UTC; Davis changed owner to Families, its recorded wins increased to two and heat to 30. The local campaign file matched the portal, and the encounter cleaned up its participants. A prior Davis victory also survived a game restart.

Live testing exposed and resolved an SSE resend loop, stale queued receipts after a companion restart, and an overly narrow gang placement search. The final client uses a wider bounded search while retaining collision and ground checks. The portal stayed responsive throughout the final battle.

Evidence comes from the actual game process, scripting logs, native-derived telemetry, portal UI and campaign file. No native game screen/audio capture was available. F7/F8 key presses and every dialogue/environment option were not independently exercised in the live acceptance run. Microphone input and generated voice playback are not implemented in this rebuilt client. Consult `world-verification.json` and `world-runtime-acceptance.json` for exact scope; fixture results remain separate from live observations.
