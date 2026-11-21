# GPT-Live: the new version against the Call's design

Sources read on **2026-11-20**. They are OpenAI's own pages: developers.openai.com docs, the API reference, the changelog and pricing, the system card, the ChatGPT release notes, and the official `openai-node` SDK. The forum threads that turned up in search are not used. This is for #79 (SPEC section 6, ADR 0021). It answers one question: is moving to the new version only a new model name and price, or does it change something the design depends on?

**Short answer:** it is a new model id and a prompt change, and the price is the same. Nothing the design depends on changed with 1.1. Two things the ADR's wording takes for granted are looser in the docs than it reads; see the last section.

## 1. The newest version

**`gpt-live-1.1`** (GPT-Live-1.1) came to the API on **2026-11-19**. The one before it is `gpt-live-1`.

- Changelog, Nov 19: "GPT-Live-1.1 improves pronunciation, accent consistency, and transcription in multilingual voice conversations. Use `gpt-live-1.1` in an existing Live session configuration and describe in plain language when to delegate to your backend." https://developers.openai.com/api/docs/changelog
- Model page: "Model ID: `gpt-live-1.1`". "Compared with GPT-Live-1, it transcribes speech more accurately and maintains a more consistent accent and voice across languages." It has one snapshot, `gpt-live-1.1`. https://developers.openai.com/api/docs/models/gpt-live-1.1
- SDK: openai-node v7.61.0 (2026-11-19) says "add gpt-live-1.1 to Live model choices". The model type is now `'gpt-live-1' | 'gpt-live-1.1'`. https://github.com/openai/openai-node/releases/tag/v7.61.0, `src/resources/live/live.ts`
- System card, published 2026-10-15 and updated 2026-11-19 with API results: "GPT-Live-1.1 API is our latest voice model for real-time conversations on the OpenAI API platform." It also says the API model "cannot call tools". https://deploymentsafety.openai.com/gpt-live-1-1

Other candidates, none of them newer for the API:
- **GPT-Live-1.1 Quip**, the "mini version", is only in ChatGPT (release notes, 2026-10-15, https://help.openai.com/en/articles/6825453-chatgpt-release-notes). The system card names it only for ChatGPT, Codex and Dots, and the API's model enum has no Quip.
- `gpt-live-1` has been GA in the API since 2026-09-10 (changelog). It came to ChatGPT on 2026-07-08 (release notes).
- `gpt-realtime-2.1` (2026-07-06) belongs to the separate Realtime API (`v1/realtime`). It is not GPT-Live.

Both GPT-Live models are reached the same way, at `v1/live/sessions`. Every other endpoint is "Not supported" (both model pages).

## 2. Each thing the design relies on

### a. A front with no tools that still hands over

- The Live model has no tools of its own. The session config's top-level fields are `model, audio, client, delegation, idle_timeout_s, input, instructions, safety_identifier, store, triggers, wake_policy`, and none of them is `tools` (SDK `MediaSessionConfig`; API reference https://developers.openai.com/api/reference/resources/live/methods/create.md). Tools exist only under `delegation.responses.tools`, for when OpenAI runs the backend. The system card says the model "cannot call tools".
- A handover is a **server event, not a function call**. With client delegation (`delegation: { type: "client" }`, which is also what you get by leaving it out or setting it to null: "Omitted or null selects your application"), the model emits `session.delegation.created`. It holds `delegation.id`, `target: "client"` and `offset_ms`. The reference says: "This object contains metadata, not the task text." The delegation guide says: "It does **not** contain the user's utterance or task text. Use the transcript events and application state to work out what the user wants." https://developers.openai.com/api/docs/guides/live-delegation
- You must pick a mode, and one of the two always applies; there is no "none". Client mode needs no tools anywhere. "Choose the mode when you create the session; to change modes, start a new session."
- **What changed in 1.1: how you prompt a handover.** The prompting guide says: "For `gpt-live-1`, replace 'Delegate to the backend' with `Generate <|SpawnThinking|>` and 'Do not delegate' with `Do not generate <|SpawnThinking|>`." So 1.1 takes plain words where 1 took a special token. https://developers.openai.com/api/docs/guides/live-prompting
- The guide also says the model is steered, not forced: "A spoken promise such as 'I'm checking that' does not confirm that backend work has started." By default it says an acknowledgement on each delegation. `acknowledgement_delay_ms` runs from 0 to 800, and any thinking or commentary append "cancels all pending automatic acknowledgements" (reference).

### b. Transcription of the person's speech

- `session.input_transcript.delta` gives the person's words and `session.output_transcript.delta` the model's, each with `start_ms`/`end_ms`. "Transcript deltas have no item ID or event that marks a completed conversational turn, so your application decides how to group them." "A transcript fragment is not a complete user turn, and transcripts may contain mistakes." https://developers.openai.com/api/docs/guides/live-conversations
- Both arrive on the WebRTC data channel by default, since leaving out `allowed_server_events` keeps "the existing allow-all behavior" (reference, `client.data_channel`).
- 1.1 "transcribes speech more accurately" (model page).
- **Whether a sigh or other non-speech sound is written out: not found.** I looked in the Live conversations, prompting, delegation and migration guides, the `session.input_transcript.delta` reference, both model pages and the system card. The prompting guide only says "Do not treat a cough, music, or nearby conversation as a new request", which concerns what the model reacts to, not what the transcript holds.

### c. Speaking text it is given

- `session.commentary.append` with the `delegation_id` and a plain-string `content`. It is "trained to paraphrase the text". The limit is **500 tokens per append**, and "You can send multiple updates with the same client delegation ID" (delegation guide; reference). `session.thinking.append` gives quiet context the model does not speak.
- The acknowledgement "waits for estimated context injection, not for speech or playback to finish".
- "GPT-Live-1.1 uses the same context events as GPT-Live-1" (conversations guide).

### d. Two connections

- **The Device's audio.** WebRTC carries media tracks plus a data channel labelled `oai-events`. "Your browser creates a Session Description Protocol (SDP) offer. Your application server exchanges it for an answer with `POST /v1/live/sessions`, using the project API key. Keep the key and session configuration on your trusted server." https://developers.openai.com/api/docs/guides/voice-webrtc
  - **For Live I found no ephemeral or client token.** The `client_secrets` flow on that page is under the Realtime API tab, and `/live/.../client_secrets` returns 404 in the reference. The server is in the path only for the SDP exchange. The audio never passes through it.
  - `client.data_channel.allowed_client_events` / `allowed_server_events` let the server limit what "an untrusted frontend" may send and receive. "Trusted sideband connections are unaffected" (reference).
  - Creating a WebRTC session bills 15 seconds up front, which is credited against the session's time.
- **The server's side channel** is called the **sideband**: `wss://api.openai.com/v1/live/sessions/{session_id}/attach`, opened with the API key. "Attaching does not create a session." Its commands include `session.close`. https://developers.openai.com/api/docs/guides/voice-server-controls, https://developers.openai.com/api/reference/resources/live/sideband-websocket.md
- **Audio on the sideband:** "Each time you attach, the sideband first replays events from the preceding 3 seconds … This window applies to conversation events, call-progress events, and reflected input and output audio." The guide also says: "A sideband receives copies of input and output audio, including audio in the replay window." These copies are base64 PCM16 at 24 kHz. I found no setting that turns the reflected audio off. Audio keeps arriving after the replay for as long as the sideband stays attached. The close sequence says to keep the sideband open "while pending session events drain", until `session.closed`.
- `POST /live/sessions/{id}/hangup` exists, but it is for SIP: "End a SIP call identified by session_id."
- Nothing here differs between 1 and 1.1 that I could find.

### e. Interruption

- There is no turn-detection setting and no interruption event in the Live API. The session config and the event list in the primary WebSocket reference have neither. The model is full duplex, and yielding is set in the prompt: "Instructions can encourage it to yield when interrupted, but they do not provide precise control over when it stops speaking. The model may keep speaking briefly after an interruption." (prompting guide). The starter prompt has "Interruption policy: Stop speaking when the user interrupts."
- On backend work: "Interrupting the spoken conversation leaves backend work running." (delegation guide)
- I found no change in 1.1. The system card says of interruption only that "all three models are full-duplex".

### f. Storage and retention

- `store` "Defaults to false for new sessions" (reference). A stored session is kept for forking and download as stereo WAV. "Storage defaults to `false`, must be enabled for your project, and requires a data policy that permits persistence." "Stored recordings are available for 30 days." (conversations guide)
- Data controls table, row `/v1/live/sessions`: used for training "No", abuse monitoring retention "30 days", application state "None, or 30 days if stored", ZDR eligible "Yes, with limitations below". The limitations the row points to are **not on the page**. https://developers.openai.com/api/docs/guides/your-data
- What abuse logs hold: "Abuse monitoring logs may contain certain customer content, such as prompts and responses … retained for up to 30 days, unless longer retention is required by law". Whether that includes **audio** for Live is **not found** in that page or the Live guides.
- With ZDR, "`store` is treated as `false`" (conversations guide). ZDR needs OpenAI's approval.

### g. Price

- `gpt-live-1.1` and `gpt-live-1` cost the same: **$0.05/minute active and $0.02/minute standby, billed per second**. There is no per-token charge for the voice. https://developers.openai.com/api/docs/pricing ("GPT-Live bills voice sessions per second."); both model pages.
- "Backend model and tool usage is billed separately." With client delegation the backend is our own Agent, so OpenAI bills only the voice.
- Standby (new on 2026-11-19, for **both** models, WebRTC only): with `wake_policy.type: "speech"` and `idle_timeout_s` set from 5 to 60, inference pauses after that many seconds "without an input or output transcript" and resumes when someone speaks. "Muting microphone input leaves the session active." https://developers.openai.com/api/docs/guides/voice-latency-cost
- The 15 seconds billed when a WebRTC session is created is credited later, not added (see d).

### h. Limits

- Session length: "Ringing is limited to 3 minutes and connected calls to 2 hours; these limits are not configurable in the request." (reference, Create session). The sentence sits beside SIP wording, so it is not clear whether it covers WebRTC too. `session.started` gives `expires_at`, and `session.closed` reason `expired` means "the session duration limit". The ADR's trial of 2026-11-14 saw a two-hour end.
- Concurrency: "GPT-Live-1.1 and GPT-Live-1 have separate concurrent-session limits. Each model's limit applies across inference regions." **No figures are published for 1.1.** For `gpt-live-1` they are Build 50, Launch 300, Grow 500, and Free is unsupported (model pages).
- Other ends, from `session.closed.reason`: `close_requested`, `expired`, `content` ("A safety filter ended the session"), `remote_hangup`, `connection_lost`. Also: "Some moderation events end the session. Others cut off assistant audio for the remainder of its current speech". (conversations guide)
- Context: a 128,000-token window. Above 90% use "it starts a replacement voice engine within the same session" with the original instructions and up to 8,192 tokens of history. `input` defaults to `[]`, so a session starts blank unless given history.

## 3. Removed, deprecated or sunset

- **Nothing on `gpt-live-1` or `v1/live/sessions`.** The deprecations page lists no GPT-Live model or Live endpoint. https://developers.openai.com/api/docs/deprecations
- On other OpenAI audio products, none of which this design uses: the `gpt-realtime` family shuts down on 2027-01-20, and `whisper-1` and the `gpt-4o-*-transcribe` models on 2027-02-26. Advanced and Standard voice leave **ChatGPT** on 2026-12-11 (release notes). That is a consumer change, not an API one.

## 4. What this means for the design

These are inferences from the sources above, not statements by OpenAI.

- **a. Holds.** Client delegation with no tools gives a `session.delegation.created` that carries no words, which is exactly ADR 0021's handover. One change: the voice instructions must say "Delegate to the backend" in plain words, not `<|SpawnThinking|>`, so the shipped prompt is per model.
- **b. Holds, with one unknown.** The transcript deltas have no turns, as the ADR says, and 1.1 transcribes better. Whether a sigh is written out is unknown: the docs don't say. Check it by hand.
- **c. Holds.** `session.commentary.append` is paraphrased. The new constraint is 500 tokens per append, so a longer answer from the Agent goes in several appends with the same `delegation_id`.
- **d. Holds, with a change of wording.** The key stays on the server, but I found no ephemeral token for Live: the Context's object posts the Device's SDP offer and returns the answer. "Never reaches a Device" still holds. The sideband sends reflected audio from the 3-second replay **and on until `session.closed`**, not only the last three seconds as the ADR says. Dropping it unread still works. The object can also use `client.data_channel` permissions to limit what the Device may send.
- **e. Holds, softer than the ADR reads.** Stopping on interruption is the model's behaviour, set by the prompt, and "may keep speaking briefly". Nothing in the API stops it, and backend work goes on, which matches "nothing else".
- **f. Holds.** `store` is off by default and Praxis never sets it. OpenAI keeps abuse logs for up to 30 days, and whether those include audio is unknown. Setup's wording ("whatever it keeps for its own monitoring") still covers it.
- **g. Holds.** The same $0.05/min active rate, so the price shipped with the code does not change. Standby at $0.02/min is new but optional and works on both models. If it is used, the object's clock counts at one rate while OpenAI bills at two, and the Call's record would overstate the cost.
- **h. Holds, with one unknown.** The two-hour limit is stated, but its wording reads as SIP-only, and the trial saw it on WebRTC. 1.1's concurrent-session limit is not published. A safety filter (`content`) is a way a Call can end that SPEC 6 does not list; the existing "the voice provider fails" Notice covers it.

## 5. Follow-up: what the Device sends, and how a Call ends

Read the same day, from the same kind of source. The API reference covers only the primary WebSocket and the sideband. It has no page for the WebRTC data channel, so what the data channel takes comes from the WebRTC guide and the `client.data_channel` field.

- **The Device can end a session on its own channel.** OpenAI's browser example sends `{ type: "session.close" }` on `oai-events`: "To end the conversation, send `session.close` and keep receiving until `session.closed` before closing the peer connection and microphone tracks." https://developers.openai.com/api/docs/guides/voice-webrtc. `session.closed` "contains the close reason and final usage" (primary WebSocket reference).
- **The two events the Device needs** are `session.commentary.append` (the Agent's answer) and `session.close`. `allowed_client_events`: "Client event types that the frontend data channel may send. Use 'all' to allow every client event; an empty array allows none. Omission preserves the existing allow-all behavior." https://developers.openai.com/api/reference/resources/live/methods/create.md
- **What else the list keeps out.** The full list of client events is `session.start`, `session.update`, `session.input_audio.append`, `session.input_audio.mute`, `session.input_audio.unmute`, `session.output_audio.fixture.play`, `session.instructions.append`, `session.thinking.append`, `session.commentary.append`, `decision.create`, `decision.item.create`, `decision.item.delete`, `response.item.create`, `response.create` and `session.close` (primary WebSocket reference). `session.instructions.append` adds instructions that "remain in conversation history through compaction". `session.output_audio.fixture.play` plays up to 30 seconds of audio.
- **The list does not keep everything out.** `session.commentary.append` with `delegation_id: null` adds context outside any handover, and nothing in the docs ties an append to an open handover. Only the Device's own code keeps it to one.
- **Configuration is fixed at the start.** "Model, frontend instructions, audio, and startup input are immutable." `session.update` changes only the delegation settings and the triggers (primary WebSocket reference; https://developers.openai.com/api/docs/guides/live-conversations). `client.data_channel` is "Startup-only". The server sets `model` and `instructions` in `POST /v1/live/sessions` with the key.
- **A connection dropped without `session.close`: mostly not found.** It ends the session, with `remote_hangup` ("The remote primary connection ended gracefully") or `connection_lost` ("The primary or upstream connection was lost unexpectedly"). Which of the two a bare `RTCPeerConnection.close()` gives, how fast the session ends and when billing stops are not found. The only related text is "If a running connection fails before `session.closed`, retain the latest observed usage and mark final usage as unconfirmed." Looked in the live-conversations, voice-webrtc and voice-latency-cost guides, the pricing page, and the primary WebSocket, sideband and create-session references.
- **Not found** either: what the data channel answers to an event not on the list.

## 6. What Praxis does with this

Decided on 2026-11-20 for #79; SPEC section 6 and ADR 0021 say so.

- Only `gpt-live-1.1`, fixed in the code with its price and its instructions. No standby.
- The Device may send only `session.commentary.append`, under an open handover, and `session.close`. A long answer goes in several appends.
- The Device ends a Call with `session.close` and says whether it saw `session.closed`. The object closes through the sideband only when it did not, when the Device went silent, or at the cap. Mute turns off the Device's microphone track.
- The four unknowns stay unknown: a sigh written out (checked by hand in real Calls), the two-hour limit on WebRTC (seen in the trial), 1.1's concurrency (one Call per Deployment), and audio in the abuse logs (setup's wording covers it).

## 7. The wire shapes Praxis relies on

Read on 2026-11-20 for #79, from the create-session and sideband references and the voice-webrtc, voice-server-controls, live-delegation and live-conversations guides (URLs in sections 1, 2 and 5). The code that reads each is named; a change here changes it. Marked "unverified" where the field names come from a schema and the page gave no example verbatim.

- **Setting a session up** (`apps/worker/src/provider-session.ts`). `POST https://api.openai.com/v1/live/sessions`, `Authorization: Bearer <key>`, `Content-Type: application/json`, no beta header. The body is `{ "session": { "model", "instructions", "delegation", "client", "store", … }, "transport": { "type": "webrtc", "sdp": "<offer>" } }`: the SDP offer is a string in the JSON, not multipart or `application/sdp`. The answer is `201` with `{ "session": { "id": "live_…" }, "transport": { "type": "webrtc", "sdp": "<answer>" } }`, and no `Location` header. The voice-webrtc page's multipart and `application/sdp` examples are for `/v1/realtime/calls`, the Realtime API, and do not apply.
- **Session config fields used.** `delegation: { "type": "client" }` (also what omitting it gives; `acknowledgement_delay_ms`, 0 to 800, sits inside it). `client.data_channel.allowed_client_events`: an array of event types, or `"all"`; omitted keeps allow-all. `store`: defaults to false. `wake_policy` and `idle_timeout_s` are standby's, which Praxis never sets. `input`, at most 128 messages, which Praxis never sets.
- **The Device's channel** (`apps/pwa/src/call.ts`). The data channel is labelled `oai-events` and made before the offer. The HTTP request starts the session: the Device sends no `session.start`. Events it reads:
  - `session.input_transcript.delta`: `{ "type", "event_id", "delta": "What is", "start_ms": 1000, "end_ms": 1200 }`. Fragments carry no turn; whether they hold their own spacing is not said.
  - `session.delegation.created`: `{ "type", "event_id", "offset_ms": 1000, "delegation": { "id": "item_…", "type": "delegation", "target": "client" } }`. `offset_ms` is top-level, beside `delegation`, and the event holds no words.
  - `session.started`: `{ "type", "event_id", "session": { "id", "model", "status": "active", "expires_at" } }`, `expires_at` in Unix seconds (unverified).
  - `session.closed`: a `reason` of `close_requested`, `expired`, `content`, `remote_hangup` or `connection_lost`, and `usage.seconds`; a `session` snapshot too (unverified). A socket that closes first leaves the end unconfirmed.
  - `error`: `{ "type": "error", "event_id", "error": { "type", "code", "message", "param", "client_event_id" } }`, `code` possibly null.
  - `session.usage.updated`: `{ "usage": { "seconds": 12 }, "context_window": { "usage_ratio": 0.42 } }`.
- **What the Device sends.** `session.commentary.append`: `{ "type", "delegation_id", "content", "event_id"? }`, `content` a plain string of at most 500 tokens, `delegation_id` required: a known client delegation, or null for context outside any handover. No done flag; it is acknowledged with `session.commentary.appended` (`client_event_id`, `start_ms`, `end_ms`). `session.close`: `{ "type": "session.close" }`, then the Device waits for `session.closed` before closing the connection; the guide's example lets go after 15 seconds.
- **The side channel** (`apps/worker/src/voice.ts`). `wss://api.openai.com/v1/live/sessions/{session_id}/attach`, `Authorization: Bearer <key>`, no subprotocol found; a Worker opens it as `https://…/attach` with `Upgrade: websocket`. It replays the last 3 seconds on attaching, keeping `event_id`s. `session.close` ends the session there as on the Device's channel. The sound it copies is `session.input_audio.append` (`audio`, base64 PCM16 at 24 kHz, no `event_id`) and `session.output_audio.delta` (`delta`, with `start_ms`/`end_ms`), each dropped unread.
- **Not found:** what the Device's channel answers to an event not in `allowed_client_events`. The contract (`e2e/voice-contract.spec.ts`) expects an `error`, and its run by hand settles it.
