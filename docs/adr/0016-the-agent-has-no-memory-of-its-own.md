# The Agent has no memory of its own

The Agent's only lasting memory is the Journal. There is no memory store the Agent writes to as it goes, the Conversation is never searched by anyone, and the summary that stands in for older Messages once the Conversation is compacted may lose anything, so no fact may live only there. Something the person wants the Agent to keep honouring is a Standing Entry: an ordinary Entry with a mark, given to the Agent at the start of every Run in its Context. We decided this because the Journal is the only truth, and a memory the Agent keeps for itself is a second truth the person did not write, cannot easily see and has to learn to correct; and because anything findable in the Conversation would soon be relied on, which makes the Conversation data.

## Considered Options

- **A memory store the Agent writes to unasked.** Rejected: it is a second record beside the Journal, in the Agent's words, with its own questions of export, Trash and versions.
- **A settings page of instructions outside the Journal.** Rejected: the same words would need their own editing, history and export, all of which an Entry already has.
- **Leaving it to search**, with nothing given at the start of a Run. Rejected: a correction is honoured only if the Agent happens to look for it.
- **A tool for the Agent to search older Messages.** Rejected: the person would come to rely on the Agent finding things said months ago, and clearing a Conversation would then lose something.
- **Giving the Agent today's Tasks and recent Entries at the start of every Run.** Rejected: it is paid for on every Run whether needed or not, and what the Agent knew would no longer show in the Run's tool calls.

## Consequences

- At the start of a Run the Agent is given the Context's Standing Entries with their dates, today's date and the Context's name, and nothing else from the Journal. Everything else it fetches through the tools any caller uses. This holds for a Brief and a Review too.
- The person marks or unmarks any Entry by hand. The Agent records and marks one when asked, in the person's words, and never unasked. A Connection can read Standing Entries but cannot mark or unmark one, and its outside agent is not handed them.
- A Context's Standing Entries have a ceiling on their total size, not their number. A mark that would pass it is refused with the reason, to the person and the Agent alike; nothing is dropped silently. A change that lengthens a Standing Entry's words is held to it too, or the ceiling could be passed by marking an Entry short and lengthening it. One in the Trash keeps its room, so putting it back is never refused (ADR 0014).
- When two disagree the newer wins. A Follow-up to a Standing Entry is not standing unless marked. The Agent changing the words of one the person wrote is a Held Change.
- A Standing Entry stays in its Context. One that should apply in two Contexts is written twice.
- Praxis supplies the compaction summary. It carries only what is in flight: what the person was last working on, questions left unanswered and any Held Change still waiting. It names records rather than restating them.
- The person can scroll back through every Message. Nothing searches the Conversation: not the search tool, not the Agent, not a Connection.
