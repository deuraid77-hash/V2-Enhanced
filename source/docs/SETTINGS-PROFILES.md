# V4 settings and profiles

**VERIFIED by `test/settings-bundle.test.ts`:** a full profile contains the 220 NPC settings and all 14 existing director settings. Chill lowers street hostility and gang aggression; Chaos raises them and the bounded encounter frequency. Other built-ins are Realistic, Cinematic, Performance and Quiet. A custom name captures the current full settings, and can be renamed, deleted, exported or imported. Import refuses to replace an existing custom name.

**VERIFIED by the same tests:** the two sets retain separate revision numbers and source labels. NPC edits use `expectedRevision`; world edits use `expectedRevision` at `/api/world/config`; profile apply and advisor acceptance require both `expectedRevision` and `expectedWorldRevision`. A stale preview changes neither set. Cross-setting constraints are validated before saving, including unique bindings, audio ranges and reserved AI slots.

**VERIFIED implementation:** both sets persist in one atomic `npc-settings-v4.json` document under the companion data directory, normally `%LOCALAPPDATA%\LivingLosSantos\Enhanced`. The previous complete document is retained as `.bak`. Invalid documents are preserved as `.rejected-*` and produce a visible recovery message. On first V4 startup the already validated V3 desired world configuration is copied into the combined document. After migration, this combined document is the authority. The original `source/data/world-settings.json` remains available for V3 rollback; it is not a current mirror of V4 edits.

**VERIFIED by failure injection:** an obstructed backup path causes a combined profile save to fail before replacing the saved document. Neither in-memory revision changes and no notification is published. A successful save publishes the world and NPC values together. Runtime execution still happens when the game receives the next exchange; a successful save alone does not prove the game received or executed it.

**VERIFIED API contract:** `GET /api/settings?catalog=false` supplies a compact current snapshot without the compiled settings catalogue. `GET /api/profiles` returns names, built-in flags and current revisions. `GET /api/profiles/:name/export` returns `{format:"LivingLosSantos.profile",version:4,name,settings,worldSettings}`. Imports require both complete sets, validated against their current bounds. An older NPC-only export must explicitly gain a chosen world snapshot before import; it is never silently treated as a full profile.

**BELIEVED / pending native acceptance:** profile effects on an actual NPC, controller navigation and visual menu readability require the in-game sheet. Settings for later implementation stages remain labelled accordingly until their consumers and tests exist.

**GUESS:** none of these checks is treated as evidence that the new DLL has run in GTA.
