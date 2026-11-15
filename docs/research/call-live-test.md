# Live test: a Call from a Durable Object against GPT-Live

Tested 2026-11-14 with a throwaway probe Worker on a `workers.dev` hostname, holding one SQLite Durable Object, against `gpt-live-1`. Three short Calls were made from a desktop browser: one of 79 seconds with the object following the provider's side channel, and two with the device carrying the Call on its WebRTC data channel, the second of 54 seconds. Sources are in `probes/call/`. The hostname is written `<probe-host>` and session ids are left out.

The probe's stand-in for a Run drains a streamed subrequest for about 2.5 seconds and returns a fixed answer holding two titles and two dates, followed by the request it was given.

## Result

A Call works, but not as ADR 0021 described it. The side channel works from a Durable Object, and it carries every frame of sound to whoever attaches. The device's data channel carries the transcript and the handovers with no sound, and the device can hand the answer back to be spoken. So the device carries the Call, and the object attaches only to end one.

| Question | Result |
|---|---|
| Can a Durable Object attach to the side channel with an `Authorization` header? | Yes. `fetch("https://api.openai.com/v1/live/sessions/<id>/attach", { headers: { Upgrade: "websocket", Authorization } })` opened on the first attempt, in 146 to 191 ms. The `https` scheme worked, so `wss` was never tried. |
| How long may a session last? | Two hours. `expires_at` on `session.started` was 7,199 seconds after the session was made, in both Calls checked. Read from the session, not waited out. |
| Do the transcript and the handovers arrive on the side channel? | Yes, both. So does the sound. |
| Do they arrive on the device's data channel? | Yes, both, and no sound. |
| Can the request be rebuilt from the transcript? | Yes, in 4 of 4 handovers, with no wait after the handover. It holds everything said since the last handover. |
| Can the answer be returned to be spoken? | Yes, from the side channel and from the data channel alike, with `session.commentary.append`. |
| Does the sound travel between the browser and the provider? | Yes, over WebRTC. A copy is also sent to anything attached to the side channel. |
| Can the object end a Call it is not following? | Yes. It attached 54 seconds in, sent `session.close`, and received `session.closed` with the final usage. |

## The side channel carries the sound

With the object attached, the side channel delivered 394 `session.input_audio.append` and 392 `session.output_audio.delta` events in 79 seconds, each holding base64 PCM, about 10 MB in all. The provider's documentation calls this reflected audio and names it as the way a server receives sound. It documents no parameter, filter or session field that leaves the sound out; the permissions under `session.client.data_channel` apply to the device's channel only.

The first version of the probe logged every event, so its table held a recording for a few minutes. It was wiped, and the probe now drops audio events unread.

An object that only attaches to end a Call is sent the last three seconds of sound as a replay. In the Call ended that way, one audio frame arrived before the close.

## The device carrying the Call

- The browser makes the offer and a data channel named `oai-events`, and posts the offer to the Worker. The object calls `POST /v1/live/sessions` with the key and returns the answer. Making the session took 150 ms and 1.4 s in the two Calls measured. The key never reaches the device.
- The data channel delivered `session.started`, `session.input_transcript.delta`, `session.output_transcript.delta`, `session.delegation.created`, `session.commentary.appended`, `session.usage.updated` and `session.closed`. No audio event arrived on it.
- On a handover the device posted the rebuilt request to the object, which ran the stand-in and returned the answer, 2.7 s for the round trip. The device sent `session.commentary.append` on the data channel and the provider acknowledged it 0.7 s later.
- The object held no outgoing socket and saw nothing of the Call but that one request.

## Handovers and the request

- A handover is a `session.delegation.created` event with an id and no words.
- Transcript fragments have no turn boundary, and none is documented. The probe kept everything heard since the last handover as the request. Twice that included a greeting the voice model had already answered by itself: `[clear throat] Hey Um... This is a test, right` and `Hello [sigh] What time is it`.
- The transcript holds sounds as well as words, written in brackets.
- The handover came 1.2 to 3.5 seconds after the last fragment of the request, and no fragment of a request arrived after its handover.

## What the voice model said by itself

Across the two Calls with a full log, 5 of 9 things the person said were answered with no handover: "Hey" twice, "Hello", "Goodbye" and "I think we're going to stop this call". Each answer was a word or three ("Hi.", "Yeah?", "Goodbye!", "Okay."). Every question was handed over, including "What's two plus two", "What time is it" and "what's on my list", under instructions to hand everything over and never answer from its own knowledge.

Before speaking an answer it said a few words of its own: "Okay, one moment. I'll check.", "Let's see.", "Right, let's check.", "Checking."

## How far the spoken answer strays

By the transcript of what was spoken, against the text given:

| Handover | Spoken |
|---|---|
| 1 | Both titles and both dates, word for word. The echoed request left out. |
| 2 | The first title only. The due date and the second change left out. |
| 3 | The first title only. The due date and the second change left out. |
| 4 | Everything, word for word, the echoed request included. |

In handovers 2 and 3 the fixed answer did not fit the question asked, which may be why it was cut short, and it was not noted whether the person spoke over it. Titles and dates were never altered, only dropped. So a change the Agent made can go unsaid.

## Usage and ending

- `session.usage.updated` arrives every 15 seconds with cumulative `usage.seconds`, on both channels. `session.closed` carries the final figure: 78 for a Call of 79 seconds, 54 for one ended at 54 seconds.
- Leaving from the browser ended the session with reason `connection_lost`, seen on the side channel within a second or so. The object's socket then closed with code 1006.
- `session.close` sent by the object ended it with reason `close_requested`, and both the object and the device received `session.closed`.
- `POST /v1/live/sessions/<id>/hangup` exists: against an ended session it answers `404` with `session_id_not_found`, where `GET` and `DELETE` on the session and `POST .../close` answer a bare `404`. It was not tried against a session still open.

## The streamed-subrequest drop

cloudflare/workerd#6774 reports an outgoing WebSocket in a Durable Object closing with code 1005 a second or two after a streamed subrequest is drained. With the object attached, three streamed subrequests were drained and the socket stayed open for the whole Call. Three is too few to call it absent. With the device carrying the Call the object holds no socket during a Run, so the question no longer arises.

## Not tested

- A Call longer than 79 seconds, including the two-hour limit, the provider's behaviour in a long silence, and whether the object is evicted with a socket open.
- A phone, a locked screen, or a lost network.
- The device sending `session.close` on its data channel. It was run, but its log was wiped by the next Call.
- The hangup endpoint against an open session.
- A real model as the Run. The probe has the mode and it was not used.
- Speaking over an answer.
- Restricting the data channel with `session.client.data_channel`.
