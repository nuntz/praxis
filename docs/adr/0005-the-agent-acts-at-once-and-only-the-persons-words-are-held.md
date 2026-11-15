# The Agent acts at once and only the person's words are held

When the person asks the Agent to do something in the Conversation, the Agent does it at once: it records Entries, creates, finishes, reschedules, delegates and deletes Tasks, and makes Projects and Persons without a tap. The one exception is the words of an Entry whose Author is the person. A call from the Agent that changes or deletes them becomes a Held Change, which shows the Entry before and after and is made only by the person's tap. Safety everywhere else comes from being able to put things back, not from asking first: a deleted record stays in the Trash for 30 days, an Entry keeps its earlier versions, and a Task's state is derived from events that a later event reverses. We decided this because an agentic-first task manager that asks before every change is not one, while a reworded Entry is the one kind of damage that looks like the truth, in a Journal that is the only truth.

An MCP caller is held to the Agent's rule, not the screen's, because it is almost always another model and Praxis cannot see whether anyone approved anything on the other side. The person's own hand in the PWA runs at once.

## Considered Options

- **Draft, then accept**, for everything the Agent writes, as mise does for what an LLM produces. Rejected: nothing here is as costly to get wrong as an allergen, and it would undo agentic-first.
- **A general undo of an Agent turn.** Rejected: it has to invert arbitrary sequences of calls and breaks as soon as the person edits in between. Restoring by ordinary means covers the same ground.
- **Holding every deletion.** Rejected: a deleted Task is visible in the Conversation and comes back from the Trash. A tap is kept for damage that is quiet.
- **The Agent never changes the person's words**, only adds a Follow-up. Rejected: "fix the typo in yesterday's entry" is a fair request.
- **The Agent changes the person's words freely**, relying on Entry versions. Rejected: nobody looks at the versions of an Entry that reads as their own.
- **A held call over MCP left for a tap in the PWA.** Rejected: an approval inbox across surfaces is a lot to build for one narrow case, and it lets an outside model queue requests in the person's Conversation. The call is refused, and the error says to add a Follow-up or ask the person to make the edit.
- **Treating an MCP call like a tap on a screen.** Rejected: the caller is a model, not the person's hand.
- **Author deciding what the Agent may change again**, as mise's pencilled and own dinners do. Rejected: the Agent changes things only when asked, so there is no unprompted overwrite to guard against.
- **A hold above some number of changes in one turn.** Rejected: any threshold is arbitrary and each change can be put back.

## Consequences

- An unprompted run is offered read tools only. A Brief or Review cannot create or change anything and cannot leave a Held Change; if it thinks something should change, it says so.
- Some calls are never offered to the Agent or to an MCP caller, with no held version: removing anything for good (emptying the Trash, deleting a retired Context's data), defining, renaming or retiring a Context, moving a record between Contexts, anything that mints or shows a credential, and a device's own settings.
- The Agent is offered restoring from the Trash and a Context's Brief and Review times.
- Restoring an earlier Version of an Entry is offered exactly as editing its words is, because it is a change to words like any other. The Agent makes it at once on an Entry that is not the person's and leaves a Held Change on one that is. An MCP caller makes it at once on an Entry that is not the person's and is refused on one that is. This replaces an earlier form of this decision, which offered it to the Agent only for an Entry that is not the person's and kept it from an MCP caller.
- Adding a Reference or Mention that leaves an Entry's words as they were is not a Held Change.
- An Entry the Agent composed becomes the person's once they edit it, and its words are held from then on.
- A Held Change is made by a call, never asked for in prose first. It is never made by a typed or spoken "yes". It can be cancelled by a tap or by telling the Agent, and it lapses the moment the Entry changes underneath it, so a tap never makes a change other than the one shown. Each turn the Agent is told which Held Changes are still waiting.
- The person can empty the Trash before the 30 days are up.
- Which caller is offered which tool, and which calls are held, is metadata of the tool, enforced in the tool layer and not in a prompt.
