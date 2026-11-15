# The Agent wakes on a clock and leaves only Messages

Without being spoken to, the Agent does two things: a Brief once a day and a Review once a week, each inside one Context at a time the person sets for that Context. Nothing else wakes it. In particular it does not react to the person saving an Entry, to an MCP caller writing, or to a date passing. What it leaves behind is one Message in that Context's Conversation and never an Entry. Changes that need no judgment, such as a Recurrence producing its next Task or a Waiting Task becoming actionable, are the system applying a rule; they are not the Agent acting and they work when the model is unavailable. We decided this because an Agent that reads every Entry as it is saved makes writing in your own Journal feel watched and costs a model run per save, and because a Brief is a view of the Journal, not something the person said.

## Considered Options

- **Reacting to a saved Entry**, to propose Tasks, links or a Follow-up straight away. Rejected: the Journal is where the person writes freely, an Inline Task already covers "this is a Task", and the Review picks up what was missed.
- **Reacting to other events**, such as an MCP caller's write or a due date passing. Rejected: the Brief already sweeps for these each day, and every event trigger is another way for the Agent to run with nobody watching.
- **Storing each Brief and Review as an Entry.** Rejected: Entries are in the person's words, and a view of the Journal stored in the Journal goes stale and crowds out what the person wrote.
- **Unprompted work the person defines**, such as "every Friday, list what I Delegated to Sam". Rejected for now: it is a scheduler of its own, and the person can ask for the same thing in the Conversation at any time.
- **A separate trigger for chasing** Delegated or Waiting Tasks that have gone quiet. Rejected: it is content of the Brief and the Review, not a third thing.
- **A threshold setting for "gone quiet"**, such as seven days. Rejected: Tasks go quiet on different timescales and the Journal usually says which; the Agent judges. So what has gone quiet is said only in a Brief or a Review. Attention, which is derived by rule with no model, lists Delegated Tasks oldest first and leaves the judging to the person.

## Consequences

- Each Context has its own Brief time and Review day and time, and either can be switched off there. There is no Brief across Contexts.
- A new Brief replaces one the person has not read, and the same for a Review, so there is never a backlog. One that has been read stays as an ordinary Message.
- A Brief with nothing to raise leaves no Message. A Review with nothing to raise says so in one line, so that silence cannot be mistaken for it not having run.
- A run that could not happen on time happens as soon as it can and is dropped once the next one is due.
- The Review is one Message. What the person does about it is ordinary Conversation, not a guided mode.
- A correction the Agent must keep honouring, such as "stop raising this, Sam said March", has to be recorded as an Entry, because the Conversation is compacted and is not truth.
- Reaching the person when they are not looking at Praxis is a separate decision; this one only says where the Message lands.
