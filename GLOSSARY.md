# Praxis

A journal-centric personal task manager for one person, where an Agent and the person work on the same Journal.

## Language

**Context**:
A part of the person's life kept apart from the others, such as work. The person defines Contexts and there is always at least one. Every Entry, Task, Project and Person belongs to exactly one, and nothing links across two. A retired Context is hidden and keeps everything; only the person can then delete it, which removes everything in it and cannot be put back.
_Avoid_: Workspace, area, space

**Journal**:
The person's record, made of Entries. It is the only truth: anything worth keeping is in the Journal.
_Avoid_: Log, notes, history

**Entry**:
One piece of the Journal, in the person's own words unless they asked the Agent to compose it.
_Avoid_: Note, post, record

**Version**:
The words an Entry had before a change to them, with who changed them and when. An Entry keeps every Version for as long as it exists, and restoring one is a new change that leaves the others in place. It covers the words only, not the Entry's References or Mentions.
_Avoid_: Revision, history, draft

**Conversation**:
The continuing exchange between the person and the Agent within one Context. Each Context has exactly one. It is a way of working on the Journal, not part of it.
_Avoid_: Chat, session, thread

**Message**:
One turn in a Conversation. A Message is never an Entry; something said becomes an Entry only when it is recorded.
_Avoid_: Chat message, turn

**Author**:
Who made an Entry or Task: the person, the Agent, or a Connection, shown by its name. A record the person edits becomes theirs.
_Avoid_: Creator, owner, source

**Connection**:
The standing permission the person gives an outside agent to work in one Context, which may be limited to reading. The person names it, its Context never changes, and only the person makes or ends one. Its name stays on what it made after it ends.
_Avoid_: Grant, integration, API key, token

**Origin Entry**:
The Entry a Task came from. Every Task has one, whoever created it.
_Avoid_: Source entry, parent entry

**Follow-up**:
An Entry that continues or corrects one earlier Entry. It is the only direct link between two Entries.
_Avoid_: Thread, reply, chain

**Standing Entry**:
An Entry the person has marked for the Agent to keep honouring. The Agent is given every Standing Entry of a Context at the start of each Run there. It is an Entry like any other, and unmarking it stops it applying. The Agent marks one only when asked.
_Avoid_: Instruction, pinned entry, memory, preference

**Reference**:
A link from an Entry to a Task or Project in its Context. It is kept beside the Entry's words, not in them, so adding or removing one leaves the words as they were.
_Avoid_: Link, tag, backlink

**Mention**:
A link from an Entry to a Person in its Context, kept beside the Entry's words like a Reference. It says the Person came up; it never delegates anything to them.
_Avoid_: Tag, at-mention

**Inline Task**:
A marker typed in an Entry that creates a Task when the Entry is saved. It is a way of typing; the Task it creates is the same as any other.
_Avoid_: Checkbox, todo syntax

**Task**:
One thing to do. It has no parts: work made of several Tasks is a Project. Its state is derived from what has happened to it, never set directly.
_Avoid_: Todo, item, sub-task

**Project**:
Work made of several Tasks. It is the only thing that contains Tasks.
_Avoid_: Parent task, list, epic

**Waiting**:
The state of a Task that waits on a Task or Project in its own Context that is still open. The wait ends when that one is Finished or Dropped. It says the Task cannot be acted on yet; it does not stop the person finishing it.
_Avoid_: Blocked, dependent, depends on

**Delegated**:
The state of a Task that a Person other than the deployment's person is doing. The Task is still the person's to track, and only they can finish it or take it back.
_Avoid_: Assigned, waiting for, shared

**Finished**:
The state of a Task that was done, or of a Project the person has declared done. A Project is never Finished by its Tasks alone: one with no open Task is waiting for its next Task or for the person to finish it.
_Avoid_: Done, completed, closed

**Dropped**:
The state of a Task or Project the person decided not to do. It is an end like Finished, and the record stays where it was; dropping is not deleting. Finishing or dropping a Project drops the Tasks still open in it. Either end can be reopened.
_Avoid_: Cancelled, abandoned, won't do

**Due Date**:
The day a Task or Project should be Finished by. It is a day, never a time of day. A Project's Due Date says nothing about its Tasks'.
_Avoid_: Deadline, due

**Overdue**:
The state of an open Task or Project whose Due Date has passed. A Task can be Overdue while also Waiting, Delegated or Deferred.
_Avoid_: Late, missed

**Deferred**:
The state of a Task the person has put off until a day that has not come yet. Until then it is not offered as something to act on.
_Avoid_: Snoozed, scheduled, start date

**Recurrence**:
A rule on a Task that makes the next occurrence when this one is Finished or Dropped. It either follows a schedule or counts from the day the Task was closed, and what it sets is the next occurrence's Due Date, so a Task with a Recurrence always has one. Each occurrence is a Task of its own, only one is ever open, and all share one Origin Entry. It runs until the person removes it.
_Avoid_: Repeat, series, recurring task template

**Run**:
One piece of work by the Agent, from what started it to the Agent stopping. A Message from the person starts one, and so does the clock.
_Avoid_: Turn, session, job, invocation

**Brief**:
A Message the Agent leaves in a Context's Conversation without being asked, saying what in that Context needs attention today. It is a view of the Journal, not part of it, and a new Brief replaces one the person has not read. It is read once Praxis has shown it to the person, on any device.
_Avoid_: Digest, summary, daily note

**Review**:
A Message the Agent leaves in a Context's Conversation without being asked, less often than a Brief, listing what has gone stale or been missed in that Context. Like a Brief it is a view of the Journal, and a new Review replaces one the person has not read. It is read in the same way as a Brief.
_Avoid_: Audit, retrospective, check-in

**Notification**:
What Praxis sends to the person's devices when the Agent leaves a Brief or a Review, so they learn of it while not looking at Praxis. It names the kind and the Context and carries nothing from the Message or the Journal. Nothing else in Praxis sends one: there are no reminders for a Due Date.
_Avoid_: Alert, reminder, push

**Held Change**:
A change to the words of an Entry whose Author is the person, asked for by the Agent and not yet made. It shows the Entry before and after, and only the person's tap makes it.
_Avoid_: Confirmation, pending confirmation, approval, draft

**Effect**:
One thing a change brought about: a record made, changed or deleted, whether directly or by a rule that followed from the change. Every change reports all of its Effects, and says so when there are none.
_Avoid_: Side effect, consequence, cascade

**Trash**:
Where a deleted Entry, Task, Project or Person stays until it is removed for good. A deleted record takes with it only what cannot exist without it, such as the Tasks an Entry is the Origin Entry of, and what went together is restored together. Anything in it can be restored as it was, and nothing of it is left once it is removed for good.
_Avoid_: Archive, bin, soft delete

**Export**:
A file holding everything a deployment keeps that is worth keeping: every Context's Journal with its Trash and its Entries' Versions, and the deployment's own settings. It does not hold any Conversation. Only the person makes one, it is always the whole deployment, and a new deployment can be started from it.
_Avoid_: Dump, download, archive

**Backup**:
An Export the system makes by itself each day and keeps for a limited time, so a deployment that is lost can be started again.
_Avoid_: Snapshot, copy

**Unsent**:
The state of an Entry recorded or a Task finished on a device that Praxis has not yet received. It is on that device only, and until it is sent it is the person's to change or discard. Nothing else can be made Unsent: every other change needs the network.
_Avoid_: Pending, queued, draft, outbox

**Offline Copy**:
What a device keeps of the Journal so it can be read with no network, shown as it was when last fetched. The person turns it on for each device. It never holds any of a Conversation.
_Avoid_: Cache, replica, sync
