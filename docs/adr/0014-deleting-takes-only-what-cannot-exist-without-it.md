# Deleting takes only what cannot exist without it

Deleting a record sends to the Trash that record and only what cannot exist without it. An Entry takes the Tasks it is the Origin Entry of, open or closed, with every occurrence and the Recurrence of a recurring one, and its own References and Mentions. A Task that is the open occurrence takes its Recurrence, and no next occurrence is made, because deleting is not closing. Nothing else goes: a Project's Tasks stay and show no Project, a Task Delegated to a deleted Person is taken back, a Task Waiting on something deleted stops Waiting, and a Follow-up stays in the Journal. Every other link to the deleted record is kept but dormant, comes back on restore, and is removed only when the record is removed for good. A delete is never refused for what hangs off the record. We decided this because the Journal is the only truth and a delete should not be able to take a record of work that was done, and because safety in Praxis comes from being able to put things back, not from being told no.

## Considered Options

- **A Project takes its Tasks to the Trash.** Rejected: a Project that ran for months has Finished Tasks, and trashing them turns that history into deleted markers across the Journal and loses it after 30 days. Dropping the Project already says "I am not doing any of this", so a cascading delete would be a second, harsher way to say it, and the Agent would have to guess which one was meant.
- **A Project takes only its open Tasks.** Rejected: it makes deleting behave like dropping with more damage.
- **Refusing a delete while anything hangs off the record.** Rejected: the person or the Agent would have to take the record apart by hand first, and a refusal protects nothing that the Trash does not already protect.
- **Tasks left pointing at an Origin Entry in the Trash.** Rejected: every Task has an Origin Entry, and after 30 days these would have none.
- **A deleted Person's Delegated Tasks go with them.** Rejected: the Task is the person's to track whoever was doing it.
- **A marker left behind after removal for good.** Rejected: removed for good means nothing of the record is left.

## Consequences

- Each Task that goes with an Entry, leaves a Project, is taken back or stops Waiting is an Effect of the delete, made by a rule. A dormant Reference, Mention or Follow-up link is not an Effect.
- When the Agent deletes an Entry whose Author is the person, the Held Change lists the Tasks that would go with it, so the tap covers them.
- Deleting a Task never touches its Origin Entry, even when the Task was the only reason for it.
- Deleting a Project with open Tasks leaves them loose in attention. The Effects say how many left, and someone who wants the work gone drops the Project first.
- What was deleted together is one item in the Trash, with one clock counted from the delete, and it comes back together. Restoring a Task whose Origin Entry is in the Trash restores that Entry and everything that went with it. A Task deleted on its own restores alone.
- On restore a dormant link comes back unless its other end has been changed since. A Task moved to another Project stays there, a Task goes back to Delegated only if it is still open and Delegated to nobody else, and a wait resumes only if the waiting Task is still open. References, Mentions and Follow-up links always come back. Each link that comes back to a Task is an Effect of the restore.
- While a record is in the Trash, an Entry that links to it shows the link as deleted and a Follow-up shows that it continues a deleted Entry. No Entry's words change at any point.
- Removal for good, at 30 days or when the person empties the Trash, takes the record, everything deleted with it, all its versions and every dormant link to it. A Follow-up becomes an ordinary Entry and a Task that left a deleted Project simply has no Project.
- Removal for good also blanks that record's summaries in the change log. The log still says what kind of record was made, changed and deleted, and by whom, but not in what words.
- Trashed records are left out of every view, list and search. `list_trash` shows each item, what went with it and when it will be removed, and is offered to the Agent and to a Connection. A trashed record cannot be changed or linked to: the only calls on it are restore and, by the person's hand, removal for good.
