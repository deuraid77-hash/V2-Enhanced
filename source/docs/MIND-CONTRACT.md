# Step 3 implementation contract

**BELIEVED — design contract, not an implementation claim:** this document fixes the boundaries agreed before Step 3 begins. The Step 3 gate must supply executable evidence for every implemented path. Existing protocol 3 remains compatible. All new protocol 4 fields are additive and optional for older clients.

## Identity and memory authority

The companion owns one bounded memory store. It assigns opaque `mindId` values, separate from the session-scoped `npcId` and the reusable game handle. A current binding requires runtime ID, scene epoch, NPC ID, handle and model. Across sessions, model/clothing/first-observed area/role recognition is explicitly best effort; reject ambiguous matches. A first-observed area is not a claim about an NPC's home.

Observed NPCs may include `identity: {clothing: [{slot, drawable, texture}], homeArea, role}` with at most twelve distinct clothing slots and bounded strings. Preserve `mind.revision` in the frame validator. The server creates the fingerprint and persistent identity; clients cannot nominate a persistent record ID.

Store three memory layers: current working conversation, bounded episode notes, and AI-written summaries. Session-only records and raw player dialogue are not restored after restart. Persist notable records only when enabled. Use atomic replacement, previous valid backup, strict bounded load validation and rejected-file preservation. A reset advances a store epoch and invalidates pending memory work so late responses cannot undo the reset.

Persona jobs run in Lane B and never block a live conversation. They return the bounded name, adult age, job, backstory, speech style, three quirks, goal, fear, secret and voice casting. Prewarming is rate-limited and deduplicated per identity. AI summaries and rumours use actual observed events, not claimed completion of an action proposal.

## Application receipts and reputation

Conversation finals carry `memoryCommitId`. Add up to 32 `aiMindOutcomes` per exchange: `{commitId, jobId, npcId, status: "applied" | "rejected", mind?}`. A supplied mind contains fear, aggression, morale, trust, respect, mood and revision. The companion commits staged episodes and reputation once only after validated game application. Transport `aiReceipts`, mind application and physical action outcomes remain distinct.

Add `persona`, `memory` and `quickReplies` to the guarded update kinds. Each retains runtime/scene/NPC/expiry checks. Persona and memory payloads include the expected handle/model, mind ID, record revision, recognition status/confidence and actual provenance. Cached AI content is labelled cached; fallback content is labelled fallback.

The companion owns absolute reputation values. Reply with `reputationSnapshot: {revision, factionStandings, districtStandings}`; the game reports `appliedReputationRevision` and replaces its copies only on a newer revision. Do not also apply the same returned reputation deltas locally.

Bound `witnessedEvents` to known event types, UUID, timestamp, current observed NPC IDs, district and position. Validate identities and deduplicate. AI-authored gossip has delayed availability, radius/rate limits, decay and per-recipient deduplication. It supplies later AI context; it does not invent a witnessed physical outcome.

## Quick replies

Use `/api/ai/jobs` with `kind: "quickReplies"`, Lane A, one current NPC and bounded working history. Return three to five `{id, text, tone}` options. The server issues opaque option IDs and retains their job/NPC/scene/expiry. Conversation submission may contain `quickReply: {jobId, optionId}`; resolve the previously generated text on the server. Option generation has no action or mind effects. A labelled offline set keeps the controller path available.

## Memory routes

- `GET /api/memory/all?offset=0&limit=25`: bounded summaries and store revision.
- `GET /api/memory/npcs/:mindId`: one persona, mind, episodes and summary.
- `GET /api/memory/reputation`: current absolute reputation and bounded rumour summaries.
- `POST /api/memory/reset` with `{scope: "all" | "npc" | "faction", id?, expectedRevision}`: explicit scoped reset, stale revision rejected.

Preserve the old browser-only file as legacy data. Do not silently treat it as observed game memory. Retire direct arbitrary browser incident insertion. Both portal and native inspector use this authority.

## Held push-to-talk

Push-to-talk remains off by default. N/L3 is held only during an eligible conversation. One capture, including transcription, may be active. The game renews a monotonically sequenced held lease every 250 ms; the helper fails closed within one second without renewal. Release explicitly commits the clip. Pause, menu, panic, focus loss, target/scene/device loss, deadline or abort discards it. Hitting the duration cap discards rather than submitting. Require release before rearming.

The external helper may inspect foreground process identity using narrow documented Windows APIs. No capture library or P/Invoke enters the game DLL. Device enumeration never opens capture. Resolve the default device at the start and do not switch it mid-clip. Await the capture API's stopped callback before finalizing audio.

Keep audio in RAM only: normalized signed 16-bit mono 16 kHz, no more than 30 seconds and 960,044 WAV bytes. IPC uses sequenced chunks of at most 32 KiB raw audio, tied to capture generation. Never put an entire base64 recording in one helper message. Silence and too-short recordings are rejected before any provider request. Tests use synthetic audio unless the user explicitly starts a real held capture.

All routes are loopback-only, bounded and rate-limited:

- `GET /api/ptt/devices` returns `{success, capabilities: {capture, transcription, reasonCode?}, selectedDeviceId, devices: [{id, name, isDefault, available}]}`.
- `POST /api/ptt/captures` accepts `{requestId, runtimeId, sceneEpoch, npcId, expectedHandle, expectedModelHash}` and returns 202 `{success, capture}`. Replaying an identical request ID is idempotent; different payload is 409.
- `POST /api/ptt/captures/:id/lease` accepts `{sequence, held: true}`. Replayed sequence cannot extend the lease.
- `POST /api/ptt/captures/:id/stop` accepts `{requestId}` and returns 202 `{success, capture}`. One clip is committed once and transcribed asynchronously.
- `DELETE /api/ptt/captures/:id` idempotently discards or cancels.
- `GET /api/ptt/captures/:id` returns `{success, capture}`.
- `GET /api/ptt/captures/:id/result` returns `{success, captureId, conversationRequestId, text, language, source: "gemini", model}` only when ready; otherwise 409 or 410 on expiry. Submit that same conversation request ID through the existing guarded conversation path.
- `GET /api/ptt/status` returns `{success, capabilities, enabled, active, recent}` with at most eight recent receipts and no text/audio.

A capture receipt contains ID, original request ID, full identity scope, state (`starting`, `capturing`, `stopping`, `transcribing`, `ready`, `cancelled`, `failed`), creation/start/update/finish timestamps, lease expiry, duration limits/elapsed time, device ID/name, optional AI job ID and bounded reason code. Keep at most 32 receipt/result records in RAM for five minutes. Do not log audio or transcribed player text.

Transcription uses an audio-aware provider adapter, verified model/audio prices and the same scheduler, cancellation, breaker and US$5/day combined budget. Recheck live scope before capture, transcription and result delivery. It must not bypass the shared budget by using the legacy base64-as-text estimate.

## Evidence and ownership

**BELIEVED — implementation division:** game client handles observed identities, game-thread tasks, leases, receipt application, controller replies and PTT input; companion handles persistent memory and AI work; portal/audio helper handles held capture and real memory views. Root reviews independent failure cases, the settings-consumer matrix, cross-language contracts and the gate.

**GUESS:** the false-match rate of cross-session recognition and physical input/audio behavior cannot be established by these design notes. Until a human completes the in-game sheet the release is not certified in the game.
