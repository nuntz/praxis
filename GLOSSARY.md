# Praxis

A journal-centric personal task manager for one person, where an Agent and the person work on the same Journal.

## Language

**Context**:
A part of the person's life kept apart from the others, such as work. The person defines Contexts and there is always at least one. Every Entry, Task, Project and Person belongs to exactly one, and nothing links across two. A retired Context is hidden, not deleted.
_Avoid_: Workspace, area, space

**Journal**:
The person's record, made of Entries. It is the only truth: anything worth keeping is in the Journal.
_Avoid_: Log, notes, history

**Entry**:
One piece of the Journal, in the person's own words unless they asked the Agent to compose it.
_Avoid_: Note, post, record

**Conversation**:
The continuing exchange between the person and the Agent within one Context. Each Context has exactly one. It is a way of working on the Journal, not part of it.
_Avoid_: Chat, session, thread

**Message**:
One turn in a Conversation. A Message is never an Entry; something said becomes an Entry only when it is recorded.
_Avoid_: Chat message, turn

**Author**:
Who made an Entry or Task: the person, the Agent, or an MCP caller. A record the person edits becomes theirs.
_Avoid_: Creator, owner, source

**Origin Entry**:
The Entry a Task came from. Every Task has one, whoever created it.
_Avoid_: Source entry, parent entry

**Follow-up**:
An Entry that continues or corrects one earlier Entry. It is the only direct link between two Entries.
_Avoid_: Thread, reply, chain

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
The state of a Task that waits on a Task or Project in its own Context that is not yet finished. It says the Task cannot be acted on yet; it does not stop the person finishing it.
_Avoid_: Blocked, dependent, depends on

**Delegated**:
The state of a Task that a Person other than the deployment's person is doing. The Task is still the person's to track, and only they can finish it or take it back.
_Avoid_: Assigned, waiting for, shared
