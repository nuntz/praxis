# The voice model is a front for the Agent and no sound is kept

Talking to the Agent is a Call: a live spoken exchange the person starts and ends by hand, inside one Context's Conversation. The model that listens and speaks is a front. It has no tools and is given nothing from the Journal, and it hands what the person asks to the one Agent, so each request is an ordinary Run on the same model, tools and rules as a typed Message. The person's Message is the transcript of what they said, the Agent's Message is what the Agent wrote, and the voice model speaks that in its own wording. Praxis keeps no sound anywhere. We decided this because a voice model that acted on the Journal itself would be a second Agent, with its own behaviour, its own evals and its own reading of the rules; because the Conversation is already where the person and the Agent work, so a spoken exchange kept apart would be a second one; and because a recording is the most sensitive copy there could be of something the Journal already holds as text once it is recorded.

## Considered Options

- **The voice model as the Agent**, calling the tool seam itself. Rejected: two Agents that act differently depending on whether the person typed or spoke, and a second set of evals.
- **Hold to talk with a written reply.** Rejected: the reply must be read, so it does not serve hands-busy use, which is the only reason voice is here.
- **A microphone on the Journal's composer.** Rejected: the device's keyboard already dictates.
- **A Call as its own exchange**, apart from the Conversation. Rejected: a second Conversation per Context, with its own history, clearing and export rules.
- **Keeping the transcript of what was spoken as the Agent's Message.** Rejected: it is a transcript of a paraphrase and may hold mistakes, and what the Agent wrote is what the Agent stands behind.
- **Reading back before recording, or a spoken yes before a write.** Rejected: every capture becomes two turns, and the Agent already acts at once (ADR 0005). A mishearing is mended afterwards.
- **Keeping the audio**, to listen back or to check a transcript. Rejected: bytes to store, export, trash and protect, for something that is not the record.
- **Sound relayed through the Worker.** Rejected: the audio would pass through something Praxis runs for no gain.
- **A Call that goes on in the background or on a locked phone.** Rejected: an open microphone nobody is watching, billed by the minute.

## Consequences

- A Call is the only voice in Praxis. It belongs to the Context it was started from until it ends; the Agent knows the other Contexts by name only and says to switch, which is done by hand.
- The voice model cannot be forced to hand everything over, so it may answer small talk by itself. It can say nothing of the Journal, since it knows nothing of it. What it says by itself, including "one moment", is not a Message and is not kept.
- The record may differ in wording from what was heard. In a Call the Agent is told it is being heard: it writes short answers, offers the rest, and always says what it changed.
- An Entry recorded in a Call uses the transcript of what the person said, with the person as its Author and no mark that it was spoken. A mishearing is fixed like any other Entry: by the person's edit, or by a Held Change, and the Versions keep the original.
- A Held Change made in a Call waits for a tap as always. A spoken yes does nothing, and the Agent says so.
- Talking over the Agent stops the speech and nothing else. A Run that has started finishes, its writes stand, and its Message is kept in full even if it was never heard. Undoing is a new request, done by ordinary means.
- The sound travels between the device and the voice provider. The Worker sets the Call up, and the Context's object follows the provider's side channel for the transcript and the handovers, where it starts Runs and returns answers. The voice key never reaches a device.
- The voice provider is a second provider with a second optional key, kept like the first (ADR 0017). Without it there is no way to start a Call and nothing looks broken; without the Agent's key there is no Call either.
- What is said in a Call, and what the Agent answers in it, reaches the voice provider and whatever that provider keeps for its own monitoring. Praxis never asks the provider to store a session. Setup says this where the key is given (ADR 0010).
- The voice model starts every Call blank and is never given earlier Messages. Continuity is the Agent's, which has the Conversation.
- The person's tap ends a Call, and so does leaving Praxis: the tab hidden, the screen locked or the network gone. It also ends after about two minutes of silence and when the cap is reached, saying so first. An ended Call is never resumed by itself.
- One Call at a time for the deployment; starting another ends the first. On the device in the Call the Conversation's composer gives way to the Call's controls, end and mute. A Message typed elsewhere meanwhile is answered in writing only, and Runs in a Context still happen one after another.
- A Call's time is counted against the monthly cap at a price shipped with the code, on top of the Runs it starts. A Call leaves a record with no words: when, how long, what it cost and why it ended. No Call starts at the cap.
- When a Run fails in a Call the voice says so and the usual notice sits under the person's Message. When the voice provider fails or the connection drops, the Call ends with a notice that is not a Message, and a Run already started still finishes. A refused voice key is a standing notice.
- Nothing unprompted speaks: a Brief or a Review is heard only if the person asks for it in a Call, and Praxis never starts one. A Call is not a tool, so a Connection can neither start nor see one.
- In CI the voice provider is faked at the side channel, with scripted transcripts and handovers and no sound. Real Calls are checked by hand with the other evals (ADR 0015).
- The side channel from a Durable Object and the longest a Call may last are unproven, and rest on a trial before the spec is assembled.
