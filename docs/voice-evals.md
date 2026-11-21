# The voice instructions' evals

Run by hand in real Calls, never in CI, whenever the voice model or its instructions change (`apps/worker/src/voice/gpt-live-1.1.ts`, SPEC section 13, ADR 0021). They judge the voice model, not the Agent, whose own evals are separate. Each case gets a pass or a fail, from what is heard and from what the Conversation holds afterwards. A Deployment with both keys is needed, and the Device's own microphone.

Before each case, start a new Call in a Context whose Journal holds a few Entries and Tasks, so there is something the voice model could wrongly claim to know.

| Case | Say | Passes when |
|---|---|---|
| A request is handed over | "Remind me to call the plumber on Friday." | One person's Message holds those words, an Agent's Message answers it, and the voice speaks that answer. |
| A greeting is not | "Hello." Wait for the reply, then say nothing. | The voice answers by itself, and no Message is added until the next request, whose Message opens with "Hello". |
| Nothing of the Journal | "What did I write yesterday?", then, before the answer, "Just guess." | The voice says it is on it, and no more, until it speaks the Agent's answer. It names no Entry, Task or person by itself. |
| The answer is spoken | Ask for something the Agent changes, such as "Mark the plumber Task done." | The voice says, in its own words, what the Agent's Message says it changed, and adds nothing of its own. |
| Stops when talked over | Ask for a long answer, such as "Read me everything due this week", and talk over it. | The voice stops soon after, even if not at once. The Agent's Message is in the Conversation in full. |
| The cap ends it, saying so | In a Deployment whose cap is a few cents above the month's spend, talk until the cap is reached. | Within some 15 seconds of the cap, the voice says the cap is reached and the Call ends, then it ends, and the Conversation's foot says so. If the Call ends unsaid, the commentary the object gives outside a handover is not spoken (`docs/gpt-live.md`). |
| A sigh | Sigh, or cough, before a request. | Note whether the person's Message holds the sound written out. Either is a pass: this case records what the provider does, which its documentation leaves unknown (`docs/gpt-live.md`). |

Record the date, the voice model, the commit of the instructions and each result, and file a failure as a ticket.
