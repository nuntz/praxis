# The Conversation's text never leaves its object and there is no agent log

Praxis keeps no log of the Agent's words. What the Agent heard, said and called is the runtime's transcript in the Context's object, and what changed is the change log of Effects; the only thing added is a Run record that holds no words: what started the Run, when, the model, tokens, cost, how it ended and which changes it made. No words from a Journal or a Conversation go to Workers Logs, traces or an error service, on any setting. Platform logs carry ids, tool names, result codes, counts and timings. Someone debugging the Agent reads a Run only when the person exports that one Run to a file. We decided this because the Conversation is the most sensitive text on a deployment and is not data, so every copy of it is a second place to protect, clear and explain, and because a deployment is one person, so the question of who may read it is really the question of what leaves without them choosing.

## Considered Options

- **A full-text agent log** in its own table or in Workers Logs. Rejected: it duplicates the transcript, and Workers Logs sits outside the objects, where everything is meant to be derived and rebuildable.
- **A verbose setting** that turns text on in platform logs while debugging. Rejected: it is the switch that gets left on.
- **Tool calls only, with arguments.** Rejected: the arguments are the text. `record_entry` carries the Entry's words.
- **Standing read access to the Conversation for a coding agent**, through a Connection or a debug endpoint. Rejected: a Connection is an outside model, and an export per Run is a choice each time.
- **Pruning the transcript by age.** Rejected: the runtime has no delete, so it means Praxis writing SQL against the runtime's tables. The person clears a whole Conversation instead.
- **Keeping the change log for good.** Rejected: its one-line summaries would make it a second Journal that outlives the Trash.
- **A cap per Context, or in tokens.** Rejected: one more setting nobody tunes, in a unit the person does not think in.
- **Stopping a Run the moment the cap is reached.** Rejected: it leaves half a request done with nothing said about it.

## Consequences

- A Context's Conversation text is kept until the person clears that Conversation, which drops all of it at once. Clearing is a tool for the person's hand only and leaves the Journal, the change log and the Run records as they were.
- The change log is kept for 90 days and then pruned by the system. A caller whose cursor is older than the log is told to read afresh. When a record is removed for good, its summaries in the log are blanked.
- Every call from a Connection is kept for 90 days, reads included: the tool, the time, the result code and how many records came back, never the text of its arguments or results. A Connection is never offered the Conversation, Run records or the record of another Connection's calls.
- Run records are kept for good. After 90 days a Run's list of changes points at lines that are gone, and after a clear its text is gone; the spend history stays.
- Exporting a Run is a deployment tool offered to the person's hand only. The file holds the prompt, the Messages, the tool calls and their results.
- The spend cap is one amount of money per calendar month for the whole deployment, set by the person's hand only and counted from Run records against a price table shipped with the code. The provider's own spend limit is the hard backstop, and setup says to set one.
- At the cap no new Run starts, whether the person or the clock would start it, and a Run already going finishes. The person sees a notice in the Conversation and in attention that is not a Message, with a warning at 80%. The screen and Connections keep working. Raising the cap takes effect at once.
- A Run is limited to 25 model rounds when the person started it and 10 when the clock did. The numbers are in code, not a setting. A Run that reaches the limit stops, says so in its last Message, and its record marks it as cut short.
- A Run that failed, or was not started because of the cap, still leaves a Run record, so a missing Brief or Review has a reason the person can see.
- There is no activity screen. A Run's calls fold under the Message it left, each change linking to its record, with the Run's cost on opening it. A Context's list of changes filters by caller and lists a Connection's reads alongside. The month's spend against the cap is in settings.
