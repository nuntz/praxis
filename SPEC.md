# Praxis: specification

Praxis is a self-hosted, journal-centric personal task manager for one person. It is agentic-first: an Agent and the person work on the same Journal, outside agents reach it over MCP, and every capability is a tool before it is a screen. It runs on the person's own Cloudflare account.

This document says what Praxis does. It is meant to be sliced into implementation issues.

## 1. How to read this

- **Terms** are defined in [`GLOSSARY.md`](GLOSSARY.md) and capitalised here, except the person and the states open, closed and actionable. The glossary wins on what a word means.
- **Reasons** are in [`docs/adr/`](docs/adr/). Each section names the ADRs behind it. An ADR wins on why, and on any option it rejects.
- **This spec** wins on what is built. Where it only restates an ADR it says so by naming it.
- Tool names are working names. They may change until the first release, after which a name is a contract with outside agents.

**The person** means the one human a Deployment belongs to. A **Person** (capitalised) is someone the person deals with, kept as a record in one Context.

## 2. Principles

These hold everywhere. When a slice seems to need an exception, the slice is wrong.

1. **The Journal is the only truth** (ADR 0001). Anything worth keeping is an Entry or derives from one. The Conversation is a way of working on the Journal and can be lost without losing anything true.
2. **Nothing crosses a Context** (ADR 0003). Not a link, a view, a search, a Person, a Notification or the Agent's knowledge.
3. **One tool seam** (ADR 0007). The screen, the Agent and a Connection all go through one registry. Nothing is made for one caller.
4. **Every change reports its Effects** (ADR 0007). A caller never has to read again to learn what a change did.
5. **The Agent acts at once, and only the person's words are held** (ADR 0005). Safety comes from being able to put things back, not from asking first.
6. **State is derived, never set** (ADR 0002, 0011, 0012). A Task's state follows from what has happened to it. Rules are applied by the system, on the server, and work with no model.
7. **No words leave** (ADR 0010). Text from a Journal or a Conversation goes only to the providers the person gave a key for, and to files the person makes by hand. Never to logs, traces, Notifications or Run records.
8. **A Deployment is one person.** No tenants, no sharing, no roles.

## 3. The domain

### 3.1 Context

ADR 0003, 0006.

- The person defines Contexts. There is always at least one.
- Every Entry, Task, Project and Person belongs to exactly one Context. Someone dealt with in two Contexts is two Persons.
- A Context has a name, an accent colour (section 8.11), a time zone, a Brief time, a Review day and time, a Notification switch, and one Conversation.
- **The time zone** is set when the Context is made, defaulting to the zone of the Device it is made on, and is changed only by the person's hand. Travel changes nothing by itself: when a Device's zone differs from the Context's, that Context's settings show both, with one tap to switch. There is no Notice and no prompt. A change moves no date, because a Due Date and a Defer Date are days. Only "today" and the hour of the Brief and the Review shift.
- The person always has one current Context in the PWA. It decides what they see, which Conversation they are in and where new records go. There is no combined view.
- **Retiring** a Context hides it and ends its Connections. Nothing is deleted. The person can bring it back, which does not restore the Connections.
- **Deleting** a Context is offered only for a retired one (section 10.4).
- **Moving a record** to another Context is the one act that crosses the boundary (section 3.9).

### 3.2 Entry

ADR 0001, 0008, 0025. Glossary: Entry, Author, Version, Follow-up, Standing Entry, Reference, Mention, Inline Task.

An Entry has:

- **Words**: plain text, kept exactly as typed. No ids, no markup that means anything to the server. The server never reads words to find Tasks or links. The screen shows them as Markdown (section 8.4).
- **A time**: when it was made. Set by the server on arrival, or by the made-at time on a write from the person's hand (section 4.6). It is an instant, shown in the Context's time zone, so the Journal's days agree with "today".
- **An Author**: the person, the Agent, or a Connection shown by its name. Stamped by the tool layer, never stated by the caller. An Entry the person edits becomes theirs.
- **Whether it came through the Conversation.** It does not link back to a Message, and an Entry recorded in a Call carries no mark that it was spoken.
- **Links**, kept beside the words: References to Tasks and Projects, and Mentions of Persons, each optionally anchored to a span of the words. An anchor whose span is gone stays on the Entry without one.
- **At most one Follow-up link** to one earlier Entry it continues or corrects. This is the only direct link between two Entries.
- **A Standing mark**, or none (section 5.5).
- **Versions**: every earlier state of its words.

Rules:

- The person writes an Entry directly in the Journal's composer with no Run.
- An Entry recorded by the Agent from the Conversation holds the person's words verbatim, trimmed of filler and never paraphrased, with no Markdown added, and has the person as Author. The tool layer tells it by the words alone: every word of the Entry is one the person said in the Message the Run answers, in the order they said it, case, accents and punctuation aside, though some they said may be left out. A word added or moved makes it the Agent's. The Agent composes prose only when asked, and such an Entry has the Agent as Author. What was said together becomes one Entry; the Agent splits only on a plain change of subject.
- Adding or removing a link never changes the words, makes no Version and is never a Held Change.
- **Inline Task**: a marker the person types in an editor. The editor, using a parser in the domain package, turns it into the list of Tasks passed to `record_entry`, or to `edit_entry` for a marked line an edit adds. The Task it makes is the same as any other, and editing the words later cannot delete it. The same holds for what the person types to link something.

**What the person types.**

- **An Inline Task** is a line that starts with `[]`. `[ ]` and `- [ ]` are accepted too. A leading `- ` alone is a list item and makes no Task. The rest of the line is the Task's title. The marker stays in the words. The syntax carries no date and no Project: those are set on the Task.
- **A Mention**: `@` opens a picker of the Context's Persons. **A Reference**: `#` opens a picker of its Tasks and Projects. Picking puts the name into the words, with the `@` or `#` kept, and anchors the link to it. Either picker offers to make a new Person or Project from what was typed. The `#` picker opens only when a character follows the `#`. A `#` and a space at the start of a line is a heading, and a picked Reference never has that space.
- Only a pick makes a link. `@ali` typed and left is text. The parser never matches a name to a record, since two records can share one.

**Versions.** Every saved change to an Entry's words keeps the words before it as a Version, with who changed them and when, for as long as the Entry exists. No pruning and no coalescing. A Version covers the words only. An Entry whose words have changed shows an edited mark, naming the last Author to change them when that was not the person. Opening it lists the Versions newest first, each compared against the current words. Restoring one is a new change with Effects, and the words it replaced become a Version. Restored words that contain an Inline Task marker make no Task.

### 3.3 Task

ADR 0002, 0011. Glossary: Task, Origin Entry, Waiting, Delegated, Finished, Dropped, Due Date, Overdue, Deferred, Recurrence.

A Task has:

- **A title**, and nothing else of its own. It has no body: what there is to say about a Task is said in Entries that Reference it.
- **An Origin Entry**, always, whoever created it. A Task is made only with an Entry named (section 4.8).
- **An Author**, as for an Entry: a Task the person renames becomes theirs.
- **A Project**, or none.
- **A Due Date** and **a Defer Date**, both optional, both days with no time of day.
- **A Recurrence**, or none.
- **The Person it is Delegated to**, or none.
- **What it waits on**: any number of Tasks and Projects in its own Context.
- **Its events**: what has happened to it. State is derived from these.

A Task has no parts. Work that turns out to have parts becomes a Project in one call (`make_project_from_task`), and the Task keeps its Origin Entry.

### 3.4 Task state

A Task is **open** or at one of two ends:

- **Finished**: it was done.
- **Dropped**: the person decided not to do it. The record stays where it was. Dropping is not deleting.

Either end can be reopened, and a Task at one end reaches the other only by being reopened first: finishing a Dropped Task or dropping a Finished one is refused. Reopening does not bring back waits that had ended or a Recurrence that has moved on to a newer Occurrence.

An open Task can be any of the following at once:

| State | Holds when |
|---|---|
| **Waiting** | it waits on a Task or Project that is still open |
| **Delegated** | a Person is doing it |
| **Deferred** | its Defer Date has not come yet |
| **Overdue** | its Due Date has passed |

- A Task is **actionable** when it is open and none of Waiting, Delegated or Deferred.
- Every Task in every tool result carries its derived state and the reason for it: which end it reached and when, what it waits on, who it is Delegated to, the day it is Deferred until, the day it became Overdue. No caller works out state.
- "Today", and so Overdue and Deferred, is the current day in the Context's time zone.

- There is no leading state. On the screen each state that holds is its own mark, Overdue is marked on the date, and nothing is ranked. The only order is in Attention, where a Task sits in the first section it fits (section 8.3).

This replaces the single ordered state decided earlier in [Sub-tasks and dependencies](https://github.com/nuntz/praxis/issues/6).

**Waiting.**

- One relation, no types, no lag. A cycle is refused when the wait is made, listing each Task whose wait would close it. Only a Task waits, so a cycle runs through Tasks alone.
- A wait is only between Tasks and Projects in one Context, never on a Person. It can cross Projects.
- A wait ends when the thing waited on is Finished or Dropped, a Task dropped with its Project among them. The released Task is an Effect of that change, by rule. When it was a drop, the Agent says so. Waiting on something closed is refused.
- Waiting locks nothing: a Waiting Task can be finished, and what it waited on is left untouched.
- Only an open Task waits: its waits end when it reaches an end, and a closed Task is refused a wait until it is reopened, as for a delegation.

**Delegated.**

- To one Person, by an explicit act (`delegate_task`), never inferred from a Mention. Delegating to another Person hands it on, and the delegation runs from then.
- Only an open Task is Delegated: delegating a closed one is refused until it is reopened, as an end is.
- The Person has no access to the Deployment. There is no accept or decline.
- It ends when the person finishes the Task, drops it or takes it back.
- "Waiting for Alice to reply" is a Task Delegated to Alice that other Tasks can wait on.

### 3.5 Recurrence

ADR 0011.

- A Recurrence is a rule on a Task, not a record. Each Occurrence is a Task of its own, only one is ever open, and all share one Origin Entry.
- The next Occurrence is made when the current one is Finished or Dropped, as an Effect of that change. The clock never makes one.
- The rule is one of two kinds:
  - **A schedule**: every N days; every N weeks on chosen weekdays; every N months on a day of the month or its last day; every N years. No nth weekday, end date, count or second rule.
  - **An interval** counted from the closing day: N days, weeks, months or years.
- What the rule sets is the next Occurrence's Due Date. For a schedule: the first date on it after both the current Due Date and the closing day. A day the month lacks falls on that month's last day. For an interval: the closing day plus the interval. The closing day is the day the Task reached its end, in the Context's time zone.
- A schedule counts from the Due Date the Task had when the rule was set, and the Task reads it with the rule: every N days from that day, every N weeks from its week (weeks run Monday to Sunday), every N months from its month, every N years on its day and month. Setting the rule a Task already has changes nothing and keeps that day.
- A Task with a Recurrence must have a Due Date: `set_recurrence` on a Task with none is refused, and so is clearing the Due Date of one that has a Recurrence. Only an open Task takes a Recurrence: a closed one is refused until it is reopened.
- The next Occurrence carries the title, the Author, the Project, the rule, the delegation, the Origin Entry and the gap in days between its Defer Date and its Due Date. The delegation runs from the closing. Waits and References stay with the Occurrence they were made on, and the Occurrence closed becomes a plain Task. Made by rule, it is an Effect of the change that closed the one before.
- Changing the rule applies from the next Occurrence. Moving the open Occurrence's Due Date changes that Occurrence only, since the schedule still counts from its own day.
- Dropping an Occurrence still makes the next one. Ending a Recurrence is removing the rule from the open Occurrence.
- Reopening an earlier Occurrence gives a plain Task.
- Future Occurrences do not exist until each is made. A view of the weeks ahead works them out from the rule.

### 3.6 Project

ADR 0002, 0012.

- A Project has a name, an optional Due Date that says nothing about its Tasks', and the Tasks in it. It has no description: what there is to say about it is said in Entries that Reference it. It is the only thing that contains Tasks.
- Two Projects may share a name.
- A Project is open, Finished or Dropped. It can be Overdue. It is Finished only when declared, by the person, or by the Agent or a Connection through the tool, and never because its Tasks ran out.
- A Project with no open Task is flagged in Attention as needing a next Task or finishing.
- Finishing or dropping a Project drops the Tasks still open in it and ends their Recurrences, each as an Effect. Closing a Project is never refused: unlike a Task, a Project at one end is declared at the other directly, without being reopened first.
- A Project can be reopened. The Tasks dropped with it stay Dropped.
- A Task can join a closed Project, or be reopened in one; the Project stays at its end, and declaring an end again drops its open Tasks.
- A Task's place in a Project is the Task's own. A Task joining, changing or leaving a Project (`move_task`) changes the Task alone, whatever state it is in, and the Project reads its Tasks.
- `make_project_from_task` makes a Project named after the Task, unless given a name, with no Due Date, and the Task becomes its first Task with its title and Origin Entry. A Task already in a Project leaves it for the new one, since a Project holds no Project.

### 3.7 Person

- A Person has a name and belongs to one Context. Nothing else is kept about them: what there is to say is said in Entries that Mention them.
- A Person can be Mentioned in Entries and have Tasks Delegated to them.
- Two Persons may share a name, and the server never guesses that they are the same. A picker tells them apart by the latest Entry that Mentions each.

### 3.8 Deleting and the Trash

ADR 0014. Glossary: Trash.

A delete sends to the Trash the record and only what cannot exist without it. It is never refused for what hangs off the record.

| Deleted | Goes with it | Stays, changed (each an Effect) |
|---|---|---|
| **Entry** | The Tasks it is the Origin Entry of, open or closed, with every Occurrence and the Recurrence of a recurring one. Its own References and Mentions. | A Follow-up of it stays and shows that it continues a deleted Entry (not an Effect). |
| **Task** | Its Recurrence, if it is the open Occurrence. No next Occurrence is made. | Tasks Waiting on it stop Waiting. Earlier Occurrences stay. Its Origin Entry is never touched. |
| **Project** | Nothing. | Its Tasks stay and show no Project. Tasks Waiting on it stop Waiting. |
| **Person** | Nothing. | Each open Task Delegated to them is taken back. |

- Every other link to a deleted record is kept but **dormant**: shown as deleted, back on restore, removed only with the record. A dormant link is not an Effect. No Entry's words change at any point.
- What was deleted together is one item in the Trash with one clock, and comes back together. Restoring a Task whose Origin Entry is in the Trash restores that Entry and everything that went with it.
- On restore a dormant link comes back unless its other end has changed since: a Task moved to another Project stays there; a Task goes back to Delegated only if still open and Delegated to nobody else; a wait resumes only if the waiting Task is still open, and never to close a cycle made while it was away. References, Mentions and Follow-up links always come back. Each link that comes back to a Task is an Effect.
- A dormant link whose Task is in the Trash too waits there with it, and comes back by the same rules when the Task does.
- A record that comes back is an Effect `made`, the one asked for by the call and the rest by rule. A Task that comes back holds no link to a record in the Trash now: the link is taken as that record's delete would have taken it, and kept dormant with it. A wait on something that reached an end meanwhile is released.
- `restore` and `remove_for_good` take the id of any record in the item.
- A trashed record is left out of every view, list and search. It cannot be changed or linked to. The only calls on it are restore and, by the person's hand, removal for good.
- **Removal for good** happens 30 days after the delete, or when the person empties the Trash. It takes the record, everything deleted with it, all its Versions and every dormant link to it, and leaves no marker. A Follow-up of it becomes an ordinary Entry, and a Task once Delegated to a Person removed keeps no trace of it. A Task deleted on its own goes with its Origin Entry's removal, since no Task is left without one. Its summaries in the change log are blanked. It leaves both search indexes.
- A removal's Effects are each record removed, `deleted` with an empty summary, and each record not in the Trash that lost a link to one, `changed` by rule. Removal at 30 days is the Context's alarm, not a call, so it goes in no change log; a reader learns of it by reading.
- A record removed for good is gone from everything Praxis holds within 30 days of its removal, not at once, because a Backup lives 30 days (section 10). What the Agent quoted of it stays in the Conversation until the person clears that Conversation (section 5.8): the Conversation is the record of what the Agent heard, said and called, dropped whole and never edited. The screens for emptying the Trash and deleting a Context say that Praxis cannot reach a file the person downloaded, and the Trash's says that the Conversation keeps what the Agent quoted until it is cleared.

### 3.9 Moving a record between Contexts

ADR 0003, 0006.

- Only the person's hand moves a record. It is a Deployment tool.
- A move takes a whole unit, and the person is shown all of it before confirming:
  - **An Entry's unit**: the Entry, its Follow-ups and theirs in turn, and the Tasks that came from them, with every Occurrence of a recurring one.
  - **A Project's unit**: the Project, its Tasks, their Origin Entries, those Entries' Follow-ups and theirs in turn, and any other Tasks those Entries made. It goes no further. A Task is never left without its Origin Entry.
- `get_move_unit`, a read offered to the hand only, shows the unit in the Context it would leave. `move_record` takes the ids shown, and is refused when what would move is no longer that.
- **Dropped at the boundary**, with the text kept, each an Effect:
  - every Mention in a moved Entry;
  - a Reference between something moved and something that stays, in either direction;
  - a wait between something moved and something that stays, in either direction, so a Task left behind stops Waiting;
  - a delegation, which is taken back, and the moved Task's earlier delegations with it, since the Person stays;
  - a moved Task's place in a Project that stays;
  - the Follow-up link of a moved Entry to an Entry that stays;
  - a Standing mark.
- **What goes with the unit**: every Version, each Recurrence, each record's Author, and each Task's and Project's events. A Task taken back or whose wait stopped at the boundary arrives so, at the time of the move.
- In the Context left, each record of the unit is an Effect, deleted with no summary, the one asked for by the call and the rest by rule; each record that stays and lost a link is changed by rule; and a Held Change on an Entry that goes lapses. Its change log's summaries of the unit's records are blanked, so none of their words stays there. In the Context moved to, each record of the unit is made. Each goes in that Context's change log under `move_record`, with the person's hand as caller and the time it arrived there, and `move_record` returns both; when the destination did not answer, only the source's, and says the unit has not arrived.
- Nothing is made in the destination. No Person or Project there is matched by name.
- A record in the Trash cannot be moved, and is in no unit: a Follow-up in the Trash stays where it is. While a Task in the Trash has its Origin Entry in the unit, the move is refused, since a Task never leaves its Origin Entry: restoring it or removing it for good mends that. A dormant link to a moved record is dropped.
- Both Contexts' change logs record the move.
- Ids are unique across the Deployment, and a record keeps its id when it moves.
- The unit is never lost and never visible in both Contexts. The source hides it and marks it as moving; the destination takes it under a move id so a retry cannot add it twice; the source removes it only once the destination has confirmed. An interrupted move is finished from the source's alarm, through the Deployment object. For a moment the unit is in neither Context's view.
- A unit whose destination was deleted before it arrived comes back to the source, each record made by rule. A Context holding a unit on its way out cannot be deleted until it arrives.
- A move into a Context whose object is stuck on an upgrade is refused, before anything leaves the source.

## 4. The tool seam

ADR 0005, 0007, 0008, 0015.

### 4.1 Three groups of tools

- **Context tools** run inside one Context's object and take no Context as input. The Context is fixed before the call arrives: by the screen's current Context, by the Conversation, or by the Connection's address.
- **Deployment tools** run on the Deployment object and are offered to the person's hand only.
- **Conversation tools** run inside one Context's object and are offered to the person's hand only (section 4.12). They are how the screen reaches the Conversation.

The screen reads and writes only through tools. What the server pushes to it, the Effects of each change and the Agent's answer as it is written, comes over one live channel that carries nothing upward (section 9.5).

### 4.2 Callers

Five callers, used by the offering table and by tests:

| Caller | Who |
|---|---|
| **Hand** | The person, in the PWA. |
| **Agent** | The Agent in a Run the person started, by a typed or spoken Message. |
| **Clock** | The Agent in a Run the clock started: a Brief or a Review. Reads only. |
| **Connection** | An outside agent through a Connection. Held to the Agent's rule. |
| **Read-only Connection** | A Connection limited to reading. Reads only. |

Which caller is offered which tool, and which calls are held, is metadata of the tool, enforced in the tool layer and never in a prompt.

### 4.3 Results

A result is a success or an error from a closed set of codes:

| Code | Meaning |
|---|---|
| `not_found` | No such record in this Context, or it is in the Trash. For a call to a Context, no such Context to reach: one never made, or one retired. |
| `invalid_input` | The input is malformed. |
| `not_offered` | This caller is never offered this tool. |
| `held` | The call would change the person's words. For a Connection this is the refusal, and it says to add a Follow-up or ask the person to make the edit. For the Agent it is not an error: the result is the Held Change it left. |
| `stale` | A change to an Entry's words was made against a Version that is no longer current. |
| `refused` | A rule stands in the way. The result lists each thing in the way as data. |

- A change is refused only for what it brings, not for faults already there.
- A call that asks for what is already so succeeds with no Effects.
- Dates in input are dates, never prose. The caller resolves "next Friday" using the Context's time zone.

### 4.4 Effects and the change log

- Every write returns the record it changed and its Effects: every record made, changed or deleted, the record itself among them, what happened to each, and whether the call did it or a rule did. A call that changes nothing says so and has no Effects.
- An Effect carries the record's id and a one-line summary, the same summary reads use.
- A Context is not a record, but a change to its settings, such as its time zone, is an Effect on the Context, carrying its id and its name as the summary. A time zone change changes no Task: its dates are days, and what today makes of them is derived when read.
- A Deployment tool that changes a Context returns its Effect on the Context to its caller. Only a rename goes in that Context's change log, since it is the one such change a reader of the Context sees: the accent shows only on the person's screen, a retired Context cannot be read, and a new Context's log starts empty. The Deployment object keeps no change log.
- A Connection is not a record either. A Deployment tool that makes or changes one returns an Effect on it, carrying its id and its name as the summary. Retiring a Context ends its Connections, and deleting one deletes them, each an Effect by rule. None of these goes in a change log.
- Nor is a Held Change (section 4.7). Leaving one is an Effect on it, made, and making, cancelling or lapsing one an Effect on it, deleted, carrying its id and its summary. These go in the change log, so the screen hears them, but `list_changes` gives a Connection none of them, and no change whose Effects were all on Held Changes. The person's tap still shows to it as the change it made to the Entry, under `make_held_change`.
- Nor is a Device. A Device tool returns an Effect on it, carrying its id and its name as the summary: made when something is first switched on there, changed when it is renamed or switched, and deleted when it leaves the list. None goes in a change log. When it was last seen changes with no Effect.
- Neither is the spend cap. `set_spend_cap` returns an Effect on it, carrying its fixed id and its new amount as the summary, and it goes in no change log.
- The same Effects go into a **change log** in the Context's object, each with its caller and the time the call arrived.
- `list_changes` since a cursor serves the PWA catching up, a Connection polling, and the Agent, which is given a bounded digest of what changed since the last Message it answered.
- `list_changes` can be narrowed to one caller, a Connection by its id whatever its name or whether it reads only now, and can list from the newest change back, its cursor giving the earlier ones, which is how Changes in settings reads it (section 8.6). Narrowed or not, a page with nothing after it gives the cursor where the log stands.
- The change log is kept 90 days, pruned by the Context's alarm. A caller whose cursor is older is told to read afresh: `list_changes` gives no changes, says so, and gives the cursor where the log now stands, to ask from once it has.
- A connected PWA receives the Effects of each change and patches what it shows.

### 4.5 One call, one transaction

- Each call is one transaction in one object. There is no batch tool. A compound change exists only as a named tool: `record_entry` and `make_project_from_task`.
- Every write accepts an optional key from the caller, remembered for 30 days per caller. A repeat returns the first result and does nothing again. A key given again with another tool is `invalid_input`. The Agent's calls get a key from the runtime.

### 4.6 Made-at

`record_entry` and `finish_task` accept the time they were made. It is offered to the hand only and refused if in the future. It sets the Entry's time and the Task's closing day. The call is otherwise judged against the Journal as it is on arrival, and the change log records when it arrived.

### 4.7 Held Changes

ADR 0005. Glossary: Held Change.

- One thing is held: a call from the Agent that changes or deletes the words of an Entry whose Author is the person. That covers `edit_entry`, `delete_entry` and `restore_entry_version`.
- The held call changes nothing but the Held Change it leaves, and returns it, marked `held`. It is first checked as the change would be: words it already has change nothing, a change against a Version no longer current is `stale`, and one that would take the Standing Entries past their ceiling is refused, so no Held Change is left already lapsed or bound to be refused.
- The Held Change shows the Entry before and after, and an edit's Inline Tasks it would make. For a delete it lists the Tasks that would go with the Entry, so the tap covers them. Its one-line summary says what the tap does, in none of the Entry's words.
- Only the person's tap makes it (`make_held_change`). A typed or spoken "yes" never does, and the Agent says so. Made, the change is the Agent's: its Version and the edited mark name the Agent, and the Entry stays the person's.
- It can be cancelled by a tap or by telling the Agent.
- It lapses the moment the Entry changes underneath it, so a tap never makes a change other than the one shown: when its words change, by any caller or another Held Change made, when it goes to the Trash, and for a delete when the Tasks that would go with it change, as when one is added or a Recurrence makes its next Occurrence on the Entry. A link, a Standing mark, or a change to one of its Tasks that makes no other leaves it waiting. A lapse is an Effect by rule of the change that caused it.
- Leaving, making, cancelling and lapsing are each an Effect on the Held Change (section 4.4).
- With each Message it answers, the Agent is told which Held Changes are still waiting.
- An Entry the Agent composed becomes the person's once they edit it, and its words are held from then on.
- There is no undo of a Run and no cap on how many changes a Run makes. Things are put back by ordinary means: the Trash, Versions, reopening.

### 4.8 Entries, Tasks and links in the tools

- `record_entry` takes the words, a list of Tasks to make with it, a list of links, and optionally the Entry it is a Follow-up to.
- `edit_entry` takes the new words, the Version they were made against, and a list of Tasks to make with them: the Inline Tasks the edit added. `restore_entry_version` makes none.
- A change to an Entry's words moves each anchor to where the text it spans now is, so a change on both sides of a span keeps it. A change that inserts into or deletes from an anchor's span leaves the link on the Entry without its anchor.
- `add_task` attaches a Task to an Entry that exists. There is no bare `create_task`.
- A link in `record_entry` or `add_link` may name a new Person or Project to make in the same call.
- A link that names a record now in the Trash is recorded dormant. An Entry's words are never refused for a link.
- Only a change to an Entry's words states the Version it was made against.

### 4.9 Reads

- Two named views (`view_attention` and `view_ahead`), one filtered list per kind, get by id, one search, `list_changes`, `list_connection_calls`, `list_trash`, `list_held_changes`, and `get_move_unit`, what moving a record would take.
- Lists are paged by cursor, 50 by default.
- An Entry comes with its words in full, its links and its Tasks. A Task comes with its derived state and the reason.

### 4.10 Context tools and who is offered them

This is the offering table of ADR 0015. The copy kept in the repo for tests must equal it.

Every **read** is offered to all five callers, except where noted:

| Area | Reads |
|---|---|
| Entries | `get_entry`, `list_entries`, `list_entry_versions` |
| Tasks | `get_task`, `list_tasks` |
| Projects | `get_project`, `list_projects` |
| Persons | `get_person`, `list_persons` |
| Views | `view_attention`, `view_ahead`, `search`, `list_changes` |
| Trash | `list_trash` |
| Held Changes | `list_held_changes` (hand, Agent and Clock; never a Connection) |
| Notices | `list_notices` (hand only: the standing Notices of section 8.3) |
| Settings | `get_settings` (the Context's name, its time zone, today's date there, the Brief and Review times, the Notification switch) |
| Runs | `list_runs`, `get_run` (hand only: a Run record, never its words) |
| Connection calls | `list_connection_calls` (hand only) |
| Moving | `get_move_unit` (hand only: what moving a record would take, section 3.9) |

`get_settings` is offered to every caller because a Connection needs the time zone and today's date to resolve "next Friday".

`view_ahead` returns the open Tasks and Projects with a Due Date, and the open Tasks with a Defer Date, in the coming days: from tomorrow, 28 by default, 90 at most. Today is not ahead: what is due today or Overdue is in Attention's Due section, and a Defer Date of today has come. Each is listed on the day it falls on, by day, and a Task with both its days ahead is listed on each. A Recurrence's future Occurrences are worked out from its rule, each as if the one before it were closed on its Due Date, or today once that has passed, and marked as not yet existing: they have no id, and name the open Occurrence they would follow.

`list_entries` can be narrowed to Standing Entries, which is how the person sees the full list in one place and how a Connection reads them.

**Writes.** Clock and Read-only Connection are offered none. "Held" means section 4.7 applies when the Entry's Author is the person, and the call otherwise runs at once.

| Tool | What happens | Hand | Agent | Connection |
|---|---|---|---|---|
| `record_entry` | An Entry is recorded, with its Tasks and links | yes | yes | yes |
| `edit_entry` | An Entry's words change | yes | held | held (refused) |
| `restore_entry_version` | An Entry's words go back to a Version | yes | held | held (refused) |
| `delete_entry` | An Entry goes to the Trash | yes | held | held (refused) |
| `add_link`, `remove_link` | A Reference or Mention is added or removed | yes | yes | yes |
| `add_task` | A Task is made on an existing Entry | yes | yes | yes |
| `mark_standing`, `unmark_standing` | An Entry becomes or stops being a Standing Entry | yes | yes, only when asked | no |
| `finish_task`, `drop_task`, `reopen_task` | A Task reaches an end or leaves it | yes | yes | yes |
| `rename_task` | A Task's title changes | yes | yes | yes |
| `set_task_dates` | A Task's Due Date or Defer Date is set or cleared | yes | yes | yes |
| `set_recurrence`, `remove_recurrence` | A Task gains, changes or loses its Recurrence | yes | yes | yes |
| `delegate_task`, `take_back_task` | A Task is Delegated to a Person or taken back | yes | yes | yes |
| `wait_on`, `stop_waiting` | A Task starts or stops waiting on a Task or Project | yes | yes | yes |
| `move_task` | A Task joins, changes or leaves a Project | yes | yes | yes |
| `make_project_from_task` | A Task becomes a Project | yes | yes | yes |
| `delete_task` | A Task goes to the Trash | yes | yes | yes |
| `create_project`, `rename_project` | A Project is made or renamed | yes | yes | yes |
| `set_project_due_date` | A Project's Due Date is set or cleared | yes | yes | yes |
| `finish_project`, `drop_project`, `reopen_project` | A Project reaches an end or leaves it | yes | yes | yes |
| `delete_project` | A Project goes to the Trash | yes | yes | yes |
| `create_person`, `rename_person`, `delete_person` | A Person is made, renamed or sent to the Trash | yes | yes | yes |
| `restore` | An item comes back from the Trash | yes | yes | no |
| `remove_for_good` | One item in the Trash is removed for good | yes | no | no |
| `empty_trash` | Everything in the Trash is removed for good | yes | no | no |
| `make_held_change` | A Held Change is made by the person's tap | yes | no | no |
| `cancel_held_change` | A Held Change is cancelled | yes | yes | no |
| `set_brief_time`, `set_review_time` | A Context's Brief or Review time is set or switched off | yes | yes | no |
| `set_notifications` | A Context's Notification switch is turned | yes | no | no |
| `set_time_zone` | A Context's time zone is changed | yes | no | no |
| `clear_conversation` | A Context's Conversation text is dropped | yes | no | no |
| `rebuild_search_index` | The Context's meaning index is rebuilt from the Journal | yes | no | no |

The set may grow and inputs may gain optional fields freely. There are no version numbers on tools or on the endpoint. The schemas live in the domain package.

### 4.11 Deployment tools

Offered to the hand only, never to the Agent or a Connection.

| Area | Tools |
|---|---|
| Contexts | `list_contexts`, `create_context`, `rename_context`, `set_context_accent`, `retire_context`, `bring_back_context`, `delete_context` |
| Moving | `move_record` |
| Connections | `list_connections`, `create_connection`, `rename_connection`, `set_connection_reading_only`, `end_connection` |
| Devices | `list_devices`, `rename_device`, `set_device_notifications`, `set_device_offline_copy`, `remove_device` |
| Spend | `get_spend`, `set_spend_cap` |
| Export | `make_export`, `restore_export` (setup only), `get_last_backup` |
| Runs | `save_run_transcript` |

Never offered to the Agent or a Connection in any form: removing anything for good, defining, renaming or retiring a Context, moving a record between Contexts, anything that mints or shows a credential, and a Device's own settings.

`create_context` takes the name, the time zone and the accent colour. The time zone is then kept in the Context's own object, which is why changing it is a Context tool. `retire_context` refuses the last Context not retired, since there is always one.

The repo keeps a copy of who is offered each Deployment tool, by hand, beside the table of section 4.10, and the generic test of section 13 calls each as every caller.

### 4.12 Conversation tools

ADR 0001, 0010. Offered to the hand only, never to the Agent, the Clock or a Connection.

| Tool | What happens |
|---|---|
| `send_message` | A Message from the person is added to the Context's Conversation and starts a Run. It says whether it was typed or spoken. |
| `list_messages` | The Conversation's Messages, paged back to the start, with the Notices under them and each Run's folded calls. |
| `retry_run` | A Run that failed is tried again from the person's Message, as a new Run. Only the newest Message's: one sent since has moved the Conversation on. A Brief or a Review is never tried again this way. |
| `note_shown` | The screen says it has shown a Brief or a Review in a focused window, which makes it read (section 5.4). The person never calls it by a tap. |
| `start_call`, `end_call` | A Call is set up in this Context, or ended (section 6). |
| `note_call_alive` | The Device in a Call sends a sign of life every 15 seconds, and learns from the Call's record whether the object has ended it (section 6). The person never calls it by a tap. |

- They return no Effects and write nothing to the change log, because the Conversation is not data. What a Run changes is reported by the Context tools it calls, as always.
- They are in the offering table and its tests like any other tool. The oracle of section 13 holds them to changing no domain table.
- `clear_conversation` stays a Context tool, since it is listed with a Context's settings.
- The answer is not the result of `send_message`. It arrives on the live channel (section 9.5) and is read back with `list_messages`.

## 5. The Agent

ADR 0001, 0004, 0005, 0010, 0016, 0017, 0024.

### 5.1 One Agent, one Conversation per Context

- There is one Agent. Each Context has exactly one continuing Conversation with it, compacted as it grows. There is no list of past Conversations.
- Inside a Context the Agent knows the other Contexts' names and nothing else. It cannot read, search, count or record in them. Asked about another Context, it says to switch, which the person does by hand.
- The Agent's tools are Praxis's Context tools and nothing else: no outside MCP server, no web search, no fetching a URL, no running code. A link in an Entry stays a link, and the Agent says it cannot open it.
- The Agent runs on Pi Durable inside the Context's object. The runtime's tables hold only the Conversation.

### 5.2 Runs

Glossary: Run.

- A Message from the person starts a Run. So does the clock, for a Brief or a Review. Nothing else does: not a saved Entry, not a Connection's write, not a date passing.
- Runs in a Context happen one after another.
- At the start of every Run the Context's object asks the Deployment object for the other Contexts' names and whether a Run may start (section 9.2). This is the same for a Run the person started and one the clock started, and the Worker hands the Agent nothing.
- At the start of every Run the Agent is given: the Context's Standing Entries with their dates, today's date, the Context's name, and the other Contexts' names. With each Message it answers it is also given the Held Changes still waiting and a bounded digest of what changed since the last Message it answered. Nothing else from the Journal: everything else it fetches through tools, so what it knew shows in the Run's tool calls.
- A Run is limited to 25 model rounds when the person started it and 10 when the clock did. The numbers are in code. A Run that reaches the limit stops, says so in its last Message, and its record marks it as cut short.

### 5.3 Acting when asked

- The Agent makes a change at once, with no tap and no draft: recording Entries; creating, finishing, rescheduling, delegating and deleting Tasks; making Projects and Persons.
- The one exception is the Held Change (section 4.7).
- The Agent judges what is worth recording as an Entry, without needing a cue, and always says what it recorded. This is the same for a typed Message and a spoken one.
- When it composes, in an Entry or a Message, the Agent may use the Markdown of section 8.4, and is told the set. An image it puts in an Entry waits for a tap.
- There is no "save this Message". What the Agent says enters the Journal only as an Entry with the Agent as Author, when asked.
- A correction the Agent must keep honouring is recorded as a Standing Entry, when asked.

### 5.4 Acting unprompted: the Brief and the Review

ADR 0004. Glossary: Brief, Review.

- **Brief**: once a day, at a time the person sets for the Context. A new Context starts with it on, at 07:00. It says what is due, what became actionable, and what is Delegated or Waiting and has gone quiet.
- **Review**: once a week, on a day and time the person sets for the Context. A new Context starts with it on, on Sunday at 17:00. It lists stale Tasks, Projects with no next Task, and Entries that look like they hold a Task nobody made.
- What has gone quiet is the Agent's judgment from the Journal. There is no threshold setting. It is said only in a Brief or a Review: Attention lists Delegated Tasks by age and judges nothing (section 8.3).
- Either can be switched off for a Context. There is no Brief across Contexts.
- A Clock Run is offered reads only. It cannot change anything or leave a Held Change. If it thinks something should change, it says so.
- It leaves one Message in the Context's Conversation and never an Entry.
- A new Brief replaces an unread one, and the same for a Review. One that has been read stays as an ordinary Message. A Brief with nothing to raise still takes away an unread one, since what that one said is no longer so; one that failed, or waits at the cap, takes nothing away, since it read nothing.
- A Brief with nothing to raise leaves no Message. A Review with nothing to raise says so in one line.
- A Brief or Review is **read** once Praxis has shown it in a focused window on any Device. Read is held once per Context. There is no "mark as read".
- A run that could not happen on time happens as soon as it can and is dropped once the next one is due.
- The Review is one Message. What the person does about it is ordinary Conversation.
- A Brief or Review sees the Journal only. It neither mentions a calendar nor apologises for lacking one.
- Without the Agent's key no Brief or Review is ever due.
- A Brief or Review is a Run like any other, after any going, and told what every Run is told at its start. It answers no Message, so it is not told the Held Changes waiting or what changed. A Message sent while one is going waits behind it and keeps its own limit of 25 rounds.
- A Brief or Review with nothing to raise answers so in a fixed word. Praxis leaves no Message for a Brief, and its own one line for a Review. Each ends by naming the ids of the Tasks it raises, which Praxis takes off before showing it, and counts how many have been Finished since it was taken.
- A Brief or Review the model could not be reached for is tried again after five minutes, then a gap doubling each time up to an hour, in code. One whose key the provider refused is not tried again: it is dropped, and the next is tried when it comes. Either way Attention's line stands until one of its kind runs. One due at the cap looks again every 15 minutes. Setting or switching on a time, or changing the time zone, starts none at once for a time already gone by that day: the next comes at its time.

Changes that need no judgment are the system's and not the Agent's: a Recurrence making its next Occurrence, a wait ending, a Project's Tasks being dropped, the Trash expiring. They work when the model is unavailable.

### 5.5 Memory and Standing Entries

ADR 0016. Glossary: Standing Entry.

- The Agent's only lasting memory is the Journal. There is no memory store.
- Nothing searches the Conversation: not the search tool, not the Agent, not a Connection. The person can scroll back through every Message.
- Praxis supplies the compaction summary. It carries only what is in flight: what the person was last working on, questions left unanswered and any Held Change still waiting. It names records and does not restate them.
- A **Standing Entry** is an ordinary Entry with a mark. Versions, the Trash and the Export apply unchanged.
  - The person marks or unmarks any Entry by hand. The Agent records and marks one when asked, in the person's words, and never unasked.
  - A Connection can read Standing Entries but cannot mark or unmark one, and its outside agent is not handed them.
  - A Context's Standing Entries have a ceiling on their total size, not their number: 10,000 characters as seen, in code. A mark that would pass it is refused with the reason, the other Standing Entries listed as in the way. So is a change that lengthens a Standing Entry's words, since it would pass it as surely. One in the Trash keeps its mark and its room, so restoring it is never refused and nothing is dropped from it, and removing it for good frees the room. It is not given to the Agent while there.
  - The mark is kept beside the words, like a link: marking or unmarking changes no words, makes no Version and is never held. It is a change to the Entry, with an Effect.
  - When two disagree the newer wins: the Agent is given them oldest first, each with the day it was made, and read as they stand when the person's Message is sent. A Follow-up to one is not standing unless marked.
  - It stays in its Context. One that should apply in two is written twice.

### 5.6 The model

ADR 0017.

- One model from one provider, reached directly from the Worker with the person's own API key. No gateway, no fallback.
- The key and the model's name are in the Deployment's configuration outside the repo (section 12). No tool or screen reads or sets the key, and it is never in an object.
- The model must be one the code ships a price for. One with no shipped price fails the deploy with the reason. The first release ships a price for one model, Claude Sonnet 5.5, which also writes the compaction summary. Another model is a release.
- **The key is optional.** Without one there is no Agent: the Conversation says so in place of its composer. The Journal, the screen, Connections and search work as normal, and nothing is shown as broken.
- **When the model cannot be reached**, a Run the person started retries for seconds, then ends as failed. The person's Message stays, with a Notice under it that is not a Message and a way to try again. Nothing is answered later by itself. A Message sent while that Run was going is answered in its turn, as after an answer, and keeps a Notice of its own if it fails too. Trying again is a new Run, with its own record, that answers the Conversation as it stands: what the failed Run already changed stays changed, and the new Run sees it.
- **Two failures are told apart.** The provider being unavailable shows only on the Run that failed. The provider refusing the key (wrong, out of credit, or at the provider's own limit) is a standing Notice in Attention until a call succeeds. It is not retried, and since the key is the Deployment's, its Notice shows in every Context and a call succeeding in any ends it. The provider's own words tell the two apart, and anything not a refused key counts as unavailable.
- A Brief or Review that was due retries with a growing gap during an outage. Attention shows one line with the reason, and no Notification is sent.

### 5.7 Spend

ADR 0010, 0017.

- One cap, in money, per calendar month, for the whole Deployment. Set by the person's hand. There is always one: a Deployment starts with 20 US dollars, which setup says. The month is UTC's, since the Contexts may each keep another time zone.
- Counted from Run records, Call records and embedding, against a price table shipped with the code. Each Context's object reports what it spent to the Deployment object, which keeps the month's running total and answers whether a Run or a Call may start. A report is the Context's whole total for the month, so one repeated or overtaken counts once. A Run counts in the month it started. The provider's own spend limit is the hard backstop, and setup says to set one.
- A warning shows at 80%.
- At the cap: no new Run starts, whether the person or the clock would start it, and `send_message` is refused with the cap in the way and its Message kept nowhere; a Run already going finishes, and so does one for a Message accepted before the cap was reached, waiting behind it; no Call starts, and one going ends, the voice saying so first (section 6); embedding of newly saved Entries stops, and search answers from words and says so. The Conversation's composer is replaced by a Notice that links to the cap in settings. The Journal's composer, the screen and Connections keep working.
- A Brief or Review due at the cap waits for the cap to be raised or the month to turn, and is dropped once the next one is due.
- Raising the cap takes effect at once.
- The spend of a deleted Context stays as monthly totals with no name attached, so the month's count never goes down.

### 5.8 What is kept of what the Agent did

ADR 0010. There is no agent log.

- **The runtime's record**: what the Agent heard, said and called is the runtime's record of the Conversation, in the Context's object. It is kept until the person clears that Conversation, which drops all of it at once and leaves the Journal, the change log and the Run records as they were. It keeps what the Agent quoted of a record since removed for good, and is never edited to take that out (section 3.8).
- **The change log**: what changed, with the caller.
- **A Run record**, which holds no words: what started the Run, when, the model, tokens, cost, how it ended and which changes it made, each by kind and id. Kept for good. A Run that failed, or was not started because of the cap, still leaves one. `list_runs` and `get_run` give it to the person's hand; a change older than the change log's 90 days is only counted.
- **A Run Transcript** is a file the person saves of one Run, by hand, from the Run's calls folded under its Message, or from the Notice under a Message whose Run failed: the prompt and the tools it was offered, the Message it answered as the model was shown it, each answer of the model with its calls, and each call's result. It is the only way Conversation text leaves for debugging. It is not an Export. A Run still going, one never started and one whose Conversation was cleared since have none.
- **Clearing** is refused while a Run is going. It changes no record and leaves no Effect, like the Conversation tools. Each Run record lets go of its handles on the Conversation and of where the Agent was last told the change log stood, so the first Message after is told the newest changes; nothing it says of its Run changes. It also starts afresh a Conversation the runtime cannot open (section 11).
- Platform logs carry ids, tool names, result codes, counts and timings, on every setting. There is no verbose switch.

## 6. Voice: the Call

ADR 0021. Glossary: Call.

- A Call is a live spoken exchange the person starts and ends by hand, inside one Context's Conversation. It is the only voice in Praxis. Dictating an Entry is left to the Device's keyboard.
- **The voice model is a front.** It has no tools and is given nothing from the Journal. It hands what the person asks to the Agent, so each request is an ordinary Run. It starts every Call blank and is never given earlier Messages. Its instructions ship with the code, one file for the one voice model (`apps/worker/src/voice/gpt-live-1.1.ts`): hand over every request but a greeting or small talk, claim to know or to have done nothing, speak what it is given in its own words, and stop speaking when the person speaks.
- **The Messages.** The person's Message is the text of everything they said since the last handover. It may open with a word the voice model already answered by itself, and nothing said is left out. The Agent's Message is what the Agent wrote. The voice model speaks that in its own wording and may leave part unsaid, so the Agent's Message is the record of what it did.
- What the voice model says by itself is not a Message and is not kept.
- In a Call the Agent is told it is being heard: it writes short answers, offers the rest, and always says what it changed.
- **No sound is kept**, anywhere.
- **Who carries it.** The Context's object sets the Call up with the voice key, which never reaches a Device, and with the voice model and its instructions, which the Device cannot change. Sound travels between the Device and the voice provider. The Device follows the text of what is said and the handovers on its own channel to the provider, sends each request to the object as it would a typed Message, marked as spoken, and passes the Agent's answer back to be spoken, under that handover, split at sentences into parts the provider takes: the Agent's Message names the person's Message it answers. `list_messages` says whether there is a voice key, and the Device offers to start a Call only with one and with an Agent. The object lets the Device send the provider only the Agent's answer, or, when there is none, what Praxis says in its place, and the end of the Call. The object holds no connection to the provider during a Call. The Device ends a Call at the provider itself, waits to hear it closed and says whether it did when it reports the end. The object attaches to the provider's side channel only to end a Call the Device has not, and drops unread every sound it is sent until the provider says the session has closed. At the cap it first gives the voice a sentence to say, outside any handover, that the cap is reached and the Call ends.
- **Entries.** The Agent records an Entry in a Call as it does when the person types: without needing a cue, saying what it recorded. The Entry uses the text of what the person said, with the person as Author. A mishearing is fixed by the person's edit or by a Held Change, which is tapped as always.
- **Talking over the Agent** stops the speech and nothing else. The speech stops as soon as the voice model yields, which may take a moment, since the provider offers no way to cut it off. A Run that has started finishes and its writes stand.
- **Ending.** The person's tap; leaving Praxis (tab hidden, screen locked, network gone); about two minutes of silence, in which neither the person nor the voice says anything, an answer awaited that long included, which the Device checks with each sign of life; the cap, saying so first; another Call starting; its Device silent; the provider ending it, at its two-hour session limit or by its safety filter. The Device ends a Call on the first three, the object on the next three. An ended Call is never resumed by itself, and the Conversation's foot says why it ended, from the Call's record, unless the person's tap ended it.
- **One Call at a time for the Deployment.** Starting another ends the first: once it is set up, its Context's object tells the Deployment object, which names it the Call going and has the first one's object end it at the provider, so of two started at once the later stands. The Device of the first learns of it from its next sign of life. On the Device in the Call, the Conversation's composer gives way to the Call's controls: end and mute. Mute turns off the Device's microphone, and the Call goes on and is counted. A Message typed elsewhere meanwhile is answered in writing only.
- **Counting.** A Call's time is counted by the object's own clock, from setting it up until the Device reports its end, against the cap at a price shipped with the code, on top of the Runs it starts. It is counted at one rate: Praxis never puts a Call on the provider's cheaper standby. A Call going as a month turns counts in each month for its time in it, so the new month's cap ends it, and no Call counts past the provider's two-hour limit. Whole seconds are counted, a part of one as a whole, as the provider bills. The Device sends a sign of life every 15 seconds (`note_call_alive`), and with each the Call's cost so far is reported to the Deployment object, which answers whether the cap is reached. When none comes for 45 seconds, by the object's alarm, or the cap is reached, the object ends the Call at the provider itself. A Call leaves a record with no words: when, how long, what it cost and why it ended, the provider's own reason when it ended the Call. `end_call` and `note_call_alive` answer with it.
- **Failures.** When a Run fails in a Call the voice says so and the usual Notice sits under the person's Message: the Device gives the voice the Notice's words under that Message's handover, in place of an answer. A Message refused, as at the cap, has the voice say why under its handover in the same way. When the voice provider fails, ends the Call itself or the connection drops, the Call ends with a Notice that is not a Message. A refused voice key is a standing Notice in every Context until a Call is set up.
- **The voice key** is a second optional key for a second provider, kept like the first. Without it there is no way to start a Call and nothing looks broken. Without the Agent's key there is no Call either. The voice model is not part of the configuration: it is fixed in the code beside its price and its instructions. The first release ships one, GPT-Live-1.1 (`gpt-live-1.1`), at $0.05 a minute. Another voice model is a release. What the provider documents of it, and what it leaves unknown, is in `docs/gpt-live.md`.
- What is said in a Call reaches the voice provider and whatever it keeps for its own monitoring. Praxis never asks it to store a session. Setup says this where the key is given.
- Nothing unprompted speaks. A Call is not a tool, so a Connection can neither start nor see one.

## 7. Connections: Praxis as an MCP server

ADR 0003, 0005, 0007, 0009, 0010. Glossary: Connection.

### 7.1 Sign-in

- Every caller signs in through Cloudflare Access managed OAuth: the person's browser, a hosted client and a local one. Web and MCP share one hostname behind one Access application. The Worker holds no OAuth code and no keys, and verifies the Access token on every request.
- There is no static credential. A caller with no browser to sign in through cannot connect.
- Only the person's Google address signs in: one address, never a list or a Workspace domain. The Access policy lets in that address alone, and the Worker is given it too and refuses any request whose token carries another address, or none, and every request while it was given no address of the person's. Signing in again would hand back the same account, so this is no lapsed sign-in: the Worker answers a 403 with a page saying the Praxis belongs to another Google address and a link to sign out of Access, which the screen opens itself again onto, and an MCP client gets the same. It logs why as a result code, never the address itself.
- The clients the spec promises are Claude's apps, ChatGPT and Claude Code. Another hosted client works only once the person lists its redirect address.
- Praxis serves only the stateless 2026-07-28 protocol over Streamable HTTP. No sessions, no HTTP+SSE. Older clients are refused.

### 7.2 A Connection

- The person makes a Connection in Praxis: a name, one Context, and whether it is limited to reading. Praxis gives an address under `/mcp` holding an opaque id, which the person pastes into the client. The address is not a secret.
- The request path alone tells the Worker which Connection is calling. Nothing in the token does.
- Whatever signs in as the person through an address is that Connection. One address pasted into two clients puts both under one name. One client may hold two Connections to two Contexts.
- Praxis records the client registrations it has seen on each Connection. A registration id is a history, never a key: nothing may be keyed on one.
- The Context is fixed for the Connection's life. Reading-only is the one thing the person can switch afterwards.
- On every call the Worker checks the Connection in the Deployment object, so ending one or switching it to reading only takes effect on the next call.
- A call to an ended Connection and a call to an address that never existed get the same refusal, which says to make a new Connection in Praxis.
- Retiring a Context ends its Connections.
- The Connection's name is the Author of what it makes and is kept after it ends.

### 7.3 What a Connection gets

- The Context tools of section 4.10 under the same names and schemas, per its column. A held call is refused. Nothing is made or renamed for MCP.
- It reads and writes an Entry's words as typed. The tools' descriptions say the words are shown as Markdown and name the set. Words are never checked or refused for their Markdown.
- Tools only: no resources, no prompts. Read-only and destructive hints come from the tool's metadata.
- It is never offered the Conversation, Run records, a Call, Standing marks, or the cap. No tool it calls starts a Run, so it sees nothing of an outage.
- Every call from a Connection is kept for 90 days, reads included: the tool, the time, the result code and how many records came back, never the text of its arguments or results. A name that is no tool of Praxis's is kept as none, since it is text the Connection sent. How many records came back counts the Entries, Tasks, Projects and Persons in the answer, each once: a Project in Attention's Due and in its Projects is one, and a future Occurrence in the weeks ahead is none, since it does not yet exist. The record is pruned by the Context's alarm, and `list_connection_calls` gives it to the person's hand, newest first, narrowed to one Connection or to reads if asked. A Context stuck on its upgrade serves nothing and keeps nothing of the calls it refuses (section 11).

## 8. The PWA

ADR 0013, 0020, 0022. The layout is from [The main screen when conversation is primary](https://github.com/nuntz/praxis/issues/12).

### 8.1 The main screen

Three peers, none hosting the others: **Attention**, the **Journal** and the **Conversation**.

| Width | Layout |
|---|---|
| Desktop | Three columns: Attention left, Journal middle, Conversation right. |
| In between | Journal and Conversation side by side. Attention is a column opened from a button in the top bar that carries its count. |
| Phone | Three bottom tabs: Attention, Journal, Agent. It opens on Attention. |

- The Context switcher is in the top bar at every width. Settings opens from the top bar too, as a screen of its own (section 8.6).
- A change the Agent makes shows in the other two columns as it happens, patched from its Effects.
- **The newest is where the person types.** The Journal and the Conversation keep time order, oldest first, and open at their newest, beside their composer. They stay there as more arrives. Scrolled away from it, a column stays where the person is, and a pill above its composer, "Jump to latest" with a count of what arrived, takes them back. The person's own send always brings what they sent into view.
- **Days.** Both are parted into days, "Today", "Yesterday", then the weekday and the date, by the Context's time zone, the zone their times are shown in.

### 8.2 Composers

- The Journal's composer records an Entry with no Run. The Conversation's composer sends a Message to the Agent. Where the person types decides what happens. No composer offers both sends.
- Attention has no composer.
- The Journal's composer names its Context. Both composers carry the Context's accent colour (section 8.11).
- The Journal's composer keeps its draft when the person switches Context, so the Context can be changed before sending. A link in it is to a record of the Context it was picked in and stays there, and the composer says so. A draft is not stored: it goes with the screen, and one on its way is not kept.

### 8.3 Attention

Attention is what in the current Context is open for the person to act on. It is derived by rule, with no judgment by the Agent, and works with no key.

The column is composed by the screen from four sources, in this order:

1. **Unsent writes the server did not accept** (section 8.8). Only the Device knows them.
2. **Standing Notices**, from `list_notices`: a refused key, the cap reached or 80% passed, no good Backup for three days, a Context stuck on an upgrade, a Brief or Review that could not run.
3. **Held Changes**, from `list_held_changes`.
4. **The sections of `view_attention`**, below.

`view_attention` is one view. It holds Tasks and Projects only, derived from the Journal, and returns the same to every caller. A Connection therefore sees nothing of the cap, the key or a Held Change through it. Its sections, in order:

| Section | Holds | Order |
|---|---|---|
| **Due** | Every open Task that is Overdue or due today, whatever else holds for it, and every open Project that is. | Oldest Due Date first |
| **Newly actionable** | Actionable Tasks whose wait ended, whose Defer Date came or that were taken back in the last seven days. | Newest first |
| **Delegated** | Every other Delegated Task that is neither Waiting nor Deferred, with the Person and the day it was Delegated. | Oldest delegation first |
| **Projects** | Every open Project, with its count of actionable Tasks, flagged when it has no open Task. Opening one shows its Tasks. | By name |
| **Loose** | Every other actionable Task with no Project. | Oldest first |

- A Task appears once, in the first section it fits. The rule covers Tasks only: a Project in Due appears as itself and is still in Projects, and its Tasks are placed by their own dates.
- A Waiting or Deferred Task that is not due is not shown. It is reached through its Project, its Entry or search, and arrives in Newly actionable when it comes up.
- A Task comes up when the last thing keeping it from being actionable ends: a wait released or stopped, a delegation taken back, or its Defer Date coming at the start of that day. Only what ended since it was last reopened counts, and a Defer Date counts only for a Task made before it came, since one made on or after it was never Deferred. It is listed for the day it came up and the six after, with why and when.
- Seven days is in code and is not a setting. It decides only how long a released Task is listed apart.
- There is no "due soon" in Attention. The weeks ahead are another view, `view_ahead`, opened from the Due section, which shows for it even with nothing due, and shown in Attention under it, a heading for each day. It is not a fourth peer. A Task is finished from it as from Attention; an Occurrence not yet existing is marked as not made yet and has nothing to finish.
- Nothing in Attention says what has gone quiet. That is the Agent's judgment, said in a Brief or a Review (section 5.4).
- **The count** on the Attention tab, and on the top-bar button at middle widths, is the refused Unsent writes, the Held Changes and the Due section. Nothing else is counted.
- A Task is finished from wherever it is shown: Attention or the Entry it hangs off.

### 8.4 The Journal

- Entries in time order, opening at the newest (section 8.1), each with its Tasks, its links, an edited mark where its words have changed, and its Follow-ups. On a desktop a hairline parts one Entry from the next. On a phone each Entry is a card.
- **An Entry's actions**, Edit, Follow up, Standing, Move and Delete, are not shown with every Entry. Where there is a pointer they are a toolbar on the Entry while it is hovered or has the keyboard's focus, Move and Delete behind its More button. On a touch screen they are a menu behind one button on each Entry. The edited mark and the Standing mark are always shown.
- Search sits in the Journal column (section 9.4), its field above the Entries. While it holds words, what is found shows in their place, and follows each change as the Journal does. An Entry or a Task found opens in the Journal, and Escape or opening one ends the search.
- What is found is grouped by kind, always in this order: Projects, Persons, Tasks, Entries. Each group sits under a heading drawn as Attention's sections are, with the kind's icon and how many were found, and a kind with nothing found has no heading. Within a group, hits keep the order the tool gave; the tool's one list is reordered for no other caller. What matched is marked on `match`. A hit's time reads as the Journal's days do, in the Context's time zone, the weekday shortened beside the time, "Today · 4:41 PM", "Yesterday · 8:30 PM", "Wed, Nov 18 · 7:55 PM", with a year only for another year, then its Author when it is not the person, named as elsewhere on the screen. A hit is named for a screen reader by its kind, its time and its excerpt. One "Show more found" ends the list, and what it brings joins its kind's group, so no group is cut short.
- **Close in meaning.** Where words were given and meaning was asked, an Entry found in which nothing matched was found only by meaning, and goes after the Entries under a heading of its own, "Close in meaning", with a line saying these hold none of the words but are about something close. An Entry found both by the words and by meaning stays with the words. When anything found holds the words, the group is folded behind "Show N Entries", a button that unfolds it with one tap, and new words fold it again; when nothing holds them, it is open. When search answered from words alone, there is no such group, and the line saying why stays under the count.
- Under the field, a row of chips narrows what is found, starting with the time; a Project, a Person and an Author join it. A chip not set is a `surface` pill with a `rule` border and a chevron, and opens its picker. A chip set is `ink` with `surface` text, says what it holds with an x, and one tap lifts it and reads the list again. The time chip offers Any time, Today, Last 7 days, Last 30 days and a range of days, its two ends named fields, reckoned in the Context's time zone from today there, both ends included, and sent as the tool's `from` and `to`. A time chip alone asks nothing and lists nothing until the field holds words. Each chip, its picker and the range's fields are reached by the keyboard and named; Escape puts a picker away.
- A link to a trashed record shows as deleted. A Follow-up of a trashed Entry shows that it continues a deleted Entry.
- A Held Change shows as a marker on its Entry that leads to Attention.

**How an Entry's words are shown.** ADR 0025.

- An Entry's words are rendered as Markdown, on the screen only. An Unsent Entry is rendered like any other.
- **The set** is fixed, with CommonMark's syntax: emphasis and strong, inline code and code blocks, links and bare addresses, bulleted and numbered lists, quotes, headings, tables and images. A line typed within a paragraph stays a line. A table wider than its column scrolls sideways inside the Entry.
- **Shown as typed**: raw HTML, footnotes, strikethrough, rules and task-list checkboxes. An Inline Task's line shows as typed, with no checkbox. Its Task is shown with the Entry.
- **Addresses**: a link or an image takes only an `https` address. Anything else is shown as typed. A bare address is one typed with its `https://`: `www.` and a mail address are words. A link opens in a new tab and sends no referrer.
- **An image** is given by its address, and Praxis keeps none of its bytes. It sends no referrer.
  - It loads by itself only in an Entry whose Author is the person and which did not come through the Conversation.
  - In any other Entry it shows its description and waits for a tap, and so it does in one whose words the Agent last changed, through a Held Change the person tapped (section 5.3). A tap loads that image for that showing and is not remembered. Editing the Entry makes it the person's, and its images then load by themselves.
  - One that fails to load shows its description and its address as a link.
  - The content security policy, which the Worker puts on the screen and its files, allows images from any `https` host, and nothing else from anywhere but the Deployment's own address.
- **How it looks** is fixed in the [Praxis design system](https://claude.ai/artifact/1drME2ytFn9ta9seAetLuw): the Rendered Markdown section of its `project/README.md`, drawn in `project/components/Markdown/preview.html`, from [Styles for rendered Markdown in the design system](https://github.com/nuntz/praxis/issues/36).
  - Markdown changes weight, indentation and face, never size, and never takes the Context's accent. A heading is the size of the words around it, and three levels are kept apart: bold, semibold, and semibold in the muted colour.
  - A quote is indented behind a hairline, in the muted colour. Code is in the Device's own monospace on the inset colour. A table is hairlines only, with no box and a muted header.
  - The three kinds of link are told apart by shape. A Mention is a tinted pill, a Reference is an inset pill, and a link or a bare address is underlined ink.
  - An image that has loaded has no frame. One waiting for a tap is one line: an icon, its description and "Show image". One that failed is the same line saying it did not load, with its address.
- **Never rendered**: both composers and the Entry editor, which show the words as typed with no toolbar and no preview; a Held Change's before and after; a Version compared against the current words; a search result's excerpt; a Task's title; a Project's or a Person's name.

### 8.5 The Conversation

- Every Message, scrollable to the start, opening at the newest (section 8.1).
- **The Call button** sits in the Conversation's header: a phone icon and "Call", and on a phone the icon alone. It is there wherever a Call can be offered (section 6). Offline, or at the cap, it is shown but cannot be pressed, and says why. In a Call the header says so, with the time so far, and the composer gives way to Mute and End, End in `warn`.
- A Message from the Agent, a Brief and a Review included, is rendered as an Entry's words are (section 8.4), except that an image never loads and shows as its description. The person's own Messages show as typed.
- A Run's calls fold under the Message it left, each change linking to its record, with the Run's cost on opening it.
- A Held Change waits where the Agent left it, as well as at the top of Attention and on its Entry. It is counted in the Attention badge.
- A Brief says when it was taken, and says so once Tasks it names have been finished since. The live Attention list stays beside it.
- On a phone the Agent tab carries a badge while a Brief or Review is unread.
- Notices that are not Messages: a failed Run with a way to try again, the cap, no key, no network.

### 8.6 Settings

Settings is a screen of its own, at `/settings`, each section at `/settings/<section>`. It takes the main screen's place, and Back or Escape returns to the main screen as it was left: its tab, where each column was scrolled, and the drafts in its composers. The Context switcher stays in its top bar. A sign-in that lapsed and is made again lands on `/`, even where Access returns the browser to an address of Settings (section 8.8).

Its sections are in two groups, the current Context's and the Deployment's:

| Group | Section | Holds |
|---|---|---|
| The current Context | **General** | The time zone, and both zones when the Device's differs (section 3.1). |
| | **Brief and Review** | The Brief's time, the Review's day and time, each with its switch, and the Notification switch. |
| | **Standing Entries** | The full list for the Context. |
| | **Changes** | The Context's list of changes, newest first, filtered by caller, with a Connection's reads listed alongside: each change's caller, time and Effects, each read's Connection, tool, time and how many records came back or the code it was answered with. It reaches back by hand, never further than both lists have been read, and a change made while it is shown comes over the live channel. A Connection's reads are as of the last read, since the live channel carries none. There is no activity screen beyond this. |
| | **Trash** | Each item, what went with it and when it will be removed. Restore, remove one for good, empty. |
| | **Conversation and search** | Clear the Conversation, rebuild the search index. |
| Everything in Praxis | **Contexts** | Each with its accent colour. |
| | **Connections** | Each with the registrations seen. |
| | **Devices** | Section 8.10. |
| | **Spend** | The spend cap and the month's spend against it. |
| | **Backups and Export** | When the last Backup was made, and making an Export. |

- On a desktop the sections are listed beside the one shown, and Settings opens on General. On a phone the list is a screen of its own, and each section opens from it.
- A switch is a switch, not a checkbox.
- A standing Notice shows in Attention only, and leads to the section that deals with it, where there is one: the cap to Spend, no good Backup to Backups and Export.
- **The first Context**: a Deployment with no Context shows only the form that makes one, with `create_context`, the tool the setup wizard uses too.

### 8.7 Notifications

ADR 0013. Glossary: Notification.

- Sent by Web Push when the Agent leaves a Brief or a Review. Nothing else in Praxis ever sends one.
- Fixed wording naming the kind and the Context: "Work: your Brief is ready", or "Work: your Review is ready". Nothing from the Message or the Journal, not even a count.
- Off until the person switches them on for a Device, from a tap. Each Context has one switch covering both kinds, on for a new Context, so a Device switched on hears from every Context until one is switched off. No quiet hours, no switch per kind.
- The Context's object asks the Deployment object to notify, telling it the kind only. The Deployment object words it from the Context's name and sends it to each Device switched on.
- Nothing to raise sends nothing, for either kind. A late run notifies when it finally happens.
- A new Brief's Notification replaces the earlier one for that Context on a Device, and the same for a Review: one tag per kind and Context where it is shown, and one topic per kind and Context at the push service while it waits there undelivered, for a day at most. Two Contexts give two Notifications.
- Every switched-on Device receives it, including one with Praxis open.
- It cannot be withdrawn, so one may linger after the Brief was read elsewhere. Tapping it opens that Context's Conversation.
- The Worker holds a signing key pair. A Device whose subscription the push service reports gone is switched off.
- On iOS a Notification reaches only a Praxis added to the Home Screen.
- There is no email, and no badge on the installed app's icon.

### 8.8 Offline

ADR 0020. Glossary: Unsent, Offline Copy.

Capture never fails, and Praxis is not local-first. The server stays the only place a rule runs or a Task's state is derived.

**Opening with no network.**

- The service worker keeps the built screen: the files the Worker serves at the Deployment's own address, and nothing else: never anything under `/api/`, and no image but the screen's own icons, never one an Entry shows. It asks the network first and shows what it kept only when the network cannot be reached, so whatever the network answers is shown: a lapsed Access sign-in sends the browser to Access's login page, and nothing kept is shown in its place. Access sends the browser back to the address it was at once the sign-in is made again, and the service worker answers an address of Settings reached that way with the main screen, at `/` (section 8.6).
- The browser keeps the Contexts it last read: each one's id, name, accent and whether it is retired, and nothing of its Journal. With no network Praxis opens on the Context the Device last showed, from that list, and reads it again once the network is back. The Journal's composer names that Context in its accent, and its times are in the Device's time zone until the Context's settings are read, or in the Context's own where the Offline Copy holds it. A Device that has read no list opens on none, and says it needs the network.
- Each release keeps its own screen, and replaces the last once the browser has its service worker, which it fetches with the network. Until then the Device opens the earlier screen with no network, and the first load with the network is the current one. Unsent writes are kept in the browser's storage, apart from the screen: an earlier screen still open sends its own to the current Worker once the network is back, and the current screen sends whatever is left. So a release reads the Unsent writes an earlier one stored, as stored, and keeps any it cannot read, such as one a later release's screen open beside it stored, and the tools take what an earlier screen sends.

**Reading: the Offline Copy.**

- Switched on per Device, off until then, with `set_device_offline_copy`. Praxis holds only the switch; the Device holds the copy.
- Holds, for every Context that is not retired: the result of `view_attention`, every open Task and Project, every Person, the Standing Entries, the last 30 days of Entries, and any older Entry that Device has opened from search. It holds each Context's time zone too, so today and the Entries' times are that Context's.
- Fetched while Praxis is open: on opening, when the network is back, on coming into view and every ten minutes, at most once a minute. First it reads whether its switch is still on. Each Context's part is kept as it arrives, the one last shown first, and a Context switched to that the copy does not hold yet is fetched at once.
- Shown, when the network cannot be reached, as last fetched, with the time that Context's part was. The person can switch Context.
- Search, older Entries, the weeks ahead, the Trash, Versions and the change log need the network, and say so.
- It holds no image an Entry shows, and the service worker keeps none. Without the network an image shows its description.
- Its text sits in the browser's storage unencrypted. Turning it off or removing the Device clears it, on that Device's next contact if it is away, and the person is asked first about any Unsent writes: kept, to be sent, or discarded with the copy. Turned off here, nothing is switched off until they answer; switched off elsewhere, the copy is cleared whichever they choose.
- A copy a later release cannot read is read as none and fetched again on the next contact, since the server holds all it holds.

**Writing: two Unsent writes.**

- On every Device, with or without an Offline Copy: recording an Entry and finishing a Task.
- An Unsent Entry may be a Follow-up to an Entry the Device holds, carries its Inline Tasks, and links only to records the Device holds. It makes no new Person or Project: with no network the composer's pickers offer only what the copy holds. With no Offline Copy it is words and Inline Tasks only. What it leaves off, it says.
- It sits in the Journal where it will go, marked Unsent, its Inline Tasks shown as part of its words. A Task finished Unsent is marked so and leaves Attention. Nothing that would follow is shown. A count of Unsent writes is visible whenever there is one.
- It is the person's to change: an Entry can be edited or discarded and a finish undone, with no trace. Nothing can point at an Unsent record.
- It carries its made-at time and a key. A write made while the Device has the network and nothing Unsent waits ahead of it is sent at once with its key and no made-at, so the Device's clock is never set against the server's; only one that waited, or whose answer was lost, is sent with its made-at.
- Sent only while Praxis is open, in the order made. The Device then catches up from the change log. If the Access sign-in has lapsed, it waits until the person signs in again.
- It never expires and lives on that one Device. Praxis asks the browser to keep its storage for good and says so beside the count where the browser will not promise it.

**On arrival** there is no merge logic. Finishing a Task already Finished succeeds with no Effects and runs no Recurrence again. Finishing one that is Dropped, deleted or moved is refused. An Entry linking to a record since deleted is recorded with that link dormant.

**A refused write** stays on the Device, marked as not accepted with the server's reason, at the top of Attention. A refused Entry can be edited and sent again, copied or discarded. A refused finish can only be dismissed. Nothing is dropped silently, and nothing is sent again by itself after a refusal. A network failure is not a refusal and is retried, a little later each time. An Unsent write whose key is older than 30 days is put to the person like a refused one. Sending a refused Entry again gives it a new key, since the server remembers the refusal under the old one, and it keeps its made-at time. An Unsent Entry edited after its answer was lost is put to the person the same way, with its edit, since its key gives back the Entry Praxis made with the words it had then.

**Everything else** needs the network and says so: every other Context write, tapping a Held Change, every Deployment tool, and the whole Conversation, an unread Brief or Review included. No Conversation text is ever stored on a Device, and a Message is never queued.

### 8.9 Other ways in

From [Other ways in](https://github.com/nuntz/praxis/issues/28). Something reaches the Journal only through the PWA in the person's Access session or through a Connection.

- **Share sheet.** The installed PWA is a share target for text and links, never files. It works on Android and desktop Chromium. iOS Safari does not support it, so on an iPhone the person pastes.
- **Home-screen shortcut.** An app shortcut opens straight onto the Journal's composer.
- For both: nothing is recorded until the person sends it. The composer opens in the Context that Device last showed, which can be changed before sending. A shared link is text; Praxis fetches nothing. Shared text is added to a draft already in the composer and never replaces it.
- Both open the composer's own address, which the screen leaves for its usual one. Where the browser has a launch handler (Chromium), a share or the shortcut goes to the window of Praxis already open, so the draft there is added to; elsewhere it opens the screen afresh. The share is a GET of that address with the title, text and link as given, each on a line of its own, a link the text already holds given once.

### 8.10 Devices

Glossary: Device.

- A Device is one browser's installation of Praxis, known by an id Praxis keeps in that browser's storage.
- Praxis holds a record of a Device only while Notifications or an Offline Copy is switched on there. A browser with neither is not listed, and one whose last switch goes off leaves the list.
- It is named by itself from the browser and the system its user agent names, such as "Safari on iPhone". The person can rename it, and switching it on again keeps the name. The list shows when each was last seen: the screen names its Device in a header on each Deployment call, and a call from a Device listed is a sighting of it.
- Removing a Device, from any Device, switches both off. Its Offline Copy is cleared on its next contact (section 8.8).
- Removing a Device does not sign it out. The sign-in is Access's session, and settings says so.
- Unsent writes and the Context a browser last showed are kept in the browser and need no record.

### 8.11 Look, language and accessibility

- **A design system of Praxis's own**, new and not derived from mise's. Its tokens are in code as the source, and the SolidJS components are built from them. No third-party kit.
- **The direction is Atelier**: soft panels on a tinted ground, round controls and one type family, Figtree, with the Device's own monospace for code only. It was picked from three directions drawn on the canvas [Praxis design directions](https://claude.ai/artifact/2XWrtwoKZCBjJ6kcT3q5zS), in [Explore design directions for the main screen](https://github.com/nuntz/praxis/issues/34). Its tokens, voice and rules are captured in the [Praxis design system](https://claude.ai/artifact/1drME2ytFn9ta9seAetLuw), which the tokens in code are written from. Both are private to the person who made them.
- The canvas draws the main screen at desktop and phone width, in light and dark, in two Contexts, with these states: an Entry with an Inline Task and a Mention, a Held Change waiting, an unread Brief, an Unsent Entry and a standing Notice.
- A second canvas, [Praxis UI polish](https://claude.ai/artifact/2UgKxtc3ZoP6WhUMtdB9Cg), private like the first, draws what the first left out or got wrong, at desktop and phone width: the Journal and the Conversation opening at their newest with the "Jump to latest" pill, an Entry's actions, the Call button and a Call going, Settings with Brief and Review open, and the map of interface icons. Its directions marked as not picked were not. The other sections of Settings are built from the system.
- A third canvas, Praxis search directions, private like the others and linked from the design system's Search pattern, draws search in the row "Direction A, as decided"; the rows above it were not picked. With it the system gained one colour, `match` (light #FFE58A, dark #5C4A0E): the mark on what a search matched, in an excerpt or a title, with `ink` at 600 on it. Nothing else takes it, and the PWA's token test holds `ink` on `match` to 4.5:1 with the other pairings.
- **The app icon** is the Lucide hammer, kept from the predecessor, in white on a dark neutral tile. It never takes a Context's accent colour, since it stands for the whole Deployment. The same mark sits in the top bar beside the name, inverting with the theme. Interface icons are Lucide too, under the ISC licence. An icon sits beside its label, on the tabs, the sections of Settings, Attention's sections, the groups of what a search finds and the primary buttons; it stands alone only on a well-known action, such as Edit, Follow up, Dates, Send, Search, Close or More, and then has an accessible name and a tooltip. Lucide and the Figtree typeface, under the SIL Open Font Licence, are the only outside assets. Both ship with the app, which fetches nothing from elsewhere, and their licences ship beside it, with those of every library whose code is in the app, gathered from the bundle at build time.
- **Fixed**:
  - the layout of section 8.1;
  - light and dark, following the Device, with no switch;
  - one accent colour per Context, from a fixed set of six, Blue, Rust, Teal, Plum, Moss and Slate, shown in the top bar, the Context switcher and both composers, so the person sees where they are about to write. There is no theme beyond it;
  - the interface in English, with no translation layer. An Entry can be in any language. Dates and numbers follow the Device's locale;
  - WCAG 2.2 AA, in light and in dark. Everything is reachable by keyboard.

## 9. Architecture

ADR 0006, 0010, 0017, 0023, 0024.

### 9.1 Shape

- One Worker and one PWA in one workspace. The Worker serves the PWA, the tool endpoint for the screen, and MCP under `/mcp`.
- A pure domain package with no Cloudflare or Bun imports holds the rules, the tool schemas and the parsers. Consequences are derived when read, never stored.
- Bun, Biome, Pulumi. Pi Durable is the agent runtime.

### 9.2 Storage

- All of a Deployment's data is in Durable Object SQLite. There is no D1.
- **Each Context is its own object**, holding its Journal, Tasks, Projects, Persons, Trash, change log, the record of its Connections' calls, Run records, words index and Conversation. The domain is in Praxis's own tables. The runtime's tables hold only the Conversation and can be dropped without losing anything true.
- **One Deployment object** holds the list of Contexts with their names and accent colours, the Connections, the Devices with their push subscriptions and switches, the spend cap, the month's running spend total, the monthly spend totals of deleted Contexts, when the last Backup was made, and which Context has a Call. It holds nothing from any Journal.
- The Worker asks the Deployment object which Context a request is for, then talks to that Context's object. A Context's object reaches the Deployment object only through a closed set of calls:
  - the other Contexts' names;
  - whether a Run or a Call may start, or embedding go on, which is the cap;
  - what a Run, a Call or embedding cost;
  - what a Run or a Call found of its provider's key;
  - notify the Devices that this Context has a Brief or a Review;
  - a Call is starting here, or has ended;
  - carry a unit it holds on its way out to the Context it moves to, for a move interrupted (section 3.9);
  - it is stuck on its upgrade, or no longer (section 11).
- The Deployment object holds nothing from any Journal and never reads one. It reaches into a Context's object only to make it, to make it from its file of an Export on a restore, to rename it, to delete it, for an Export or a Backup, a move, a Run Transcript, and ending a Call there when another starts elsewhere. For an Export, a Backup or a Run Transcript it carries the file the Context's object writes and reads none of it.
- A Context's object keeps its own name, for its settings and the summary of an Effect on it. The Deployment object is its only writer, writes it before its own list, and runs its writes one at a time, so the two never disagree (ADR 0006).
- Revoking a Connection or retiring a Context takes effect on the next request.
- Each Context has its own alarm, which schedules its Brief and Review, expires its Trash, prunes its change log and the record of its Connections' calls and finishes an interrupted move.
- A jurisdiction (`eu`, `us` or `fedramp`) is chosen once at setup, optionally, for every object. It cannot be changed except by Export and restore into a new Deployment.
- An Entry is text only. Nothing but Backups needs R2.

### 9.3 What is outside the objects

Anything kept outside a Context's object is derived from it, kept per Context, and can be thrown away and rebuilt.

| Thing | Where | Notes |
|---|---|---|
| Meaning index | Vectorize, embeddings by Workers AI, on the person's account: one index, a part per Context, in no jurisdiction | Section 9.4 |
| Backups | R2 on the person's account | Section 10 |
| Offline Copy | The Device's browser storage | Section 8.8 |

### 9.4 Search

ADR 0023. From [Recall](https://github.com/nuntz/praxis/issues/21).

- One `search` tool returns one ranked list. No caller picks a mode. It is the same tool for the hand, the Agent and a Connection.
- It covers Entries, Tasks, Projects and Persons in the current Context by words. Meaning applies to Entries only. The Trash and Versions are never searched.
- It can be narrowed by date range, Project, Person and Author, together or alone:
  - a date range by when a record was made, an Entry by its time, on days in the Context's time zone, both ends included;
  - a Project to the Tasks in it and the Entries that Reference it or hold a Task in it;
  - a Person to the Entries that Mention them and the Tasks ever Delegated to them, a Task finished since among them;
  - an Author to the Entries and Tasks whose Author they are, a Connection by its name or any Connection.
  - Narrowed by a Project, a Person or an Author, no Project or Person is listed, since none is in a Project, Mentioned or made by an Author.
- By words, a record holds every word given, its case and accents set aside. The last word, with nothing typed after it, also finds the words it begins, so a list follows what is being typed. Nothing typed is read as a query language. The best match comes first, and the newest among equals.
- Each result gives the record's kind, id, summary and time, an Entry's and a Task's Author, a Task's Entry, and an excerpt: one line of the words, title or name, an Entry's cut around what matched, with the spans that matched. The record itself is read by its id.
- By meaning, an Entry is found when the meaning index holds it alike enough to the words given, by a measure fixed in code with the model, whether or not it holds them. The two are one list: each record scores by its place in the list by words and its place in the list by meaning, added, so an Entry found both ways comes before one found either way alone at the same place. An Entry found by meaning alone has its first words as its excerpt, with no spans.
- The words index is inside the Context's object, kept by SQLite as the records and the Trash change, so no write can leave it behind. The meaning index is outside it. Its embeddings come from `@cf/baai/bge-m3` on Workers AI, chosen because it handles Entries in more than one language. The model is fixed in code and is not configuration: a release that changes it marks every meaning index stale. Nothing goes to a third party, and embedding spend counts toward the cap: Workers AI does not say what a call took, so the cost is reckoned from the length of the words, the Entries' and those searched for.
- The Context's object keeps the queue of Entries the meaning index has still to take in, kept by SQLite as the words index is: an Entry made or whose words change is queued to be embedded, and one removed for good to be taken out. The object works through it after each write and when its alarm comes, and an Entry leaves the queue only while it is as it was read. Each Context has its own part of the index, by its id.
- If the meaning index is missing or stale, search still answers from words, and tells every caller that it did, and why: there is no meaning index in the Deployment, it is being built from the Journal, it did not answer, or the month's spend has reached the cap.
- A saved Entry is findable by words at once and by meaning shortly after. A deleted Entry leaves both indexes at once and returns on restore: its embedding stays in the index while it is in the Trash and search never returns it, so a restore needs no embedding again. One removed for good leaves the index.
- The person can start a full rebuild from settings, `rebuild_search_index`: every Entry is queued afresh, and search answers from words until it is done. It changes no record and leaves no Effect. A Context's object made before the meaning index, or under another embedding model, does the same as it wakes.

### 9.5 Live updates

- The PWA holds one WebSocket to its current Context's object, which hibernates when idle.
- It carries two things, both downward: the Effects of each change in that Context, from which the PWA patches what it shows, and the Conversation: the Agent's answer as it is written, each Message once it is whole, a Brief or Review gone once a newer one replaced it, and the Conversation cleared.
- On opening, it first says where the change log stands. Each change after comes with the cursor after it, as `list_changes` would give it.
- Nothing travels up it. Every send is a tool call, and anything sent up closes it.
- A PWA that was away catches up from `list_changes` and `list_messages`. An answer missed part-way is not replayed: the Message is read once it is whole.
- Switching Context closes the socket and opens one to the other object.
- A Connection has no live channel. It polls `list_changes`.

## 10. Export, Backup and retention

ADR 0018.

### 10.1 The file

- An **Export** is an archive in a documented JSON format of Praxis's own (`docs/export-format.md`), stamped with a format version: one file for the Deployment and one per Context. It is always the whole Deployment. Only the person's hand makes one.
- A **Backup** is the same file, made by the system once a day into R2 and deleted after 30 days. Always on, with no switch.
- **In**: each Context's Entries, Tasks and their events, Projects, Persons, References, Mentions, Follow-up links, Recurrences and Standing marks; every Entry's Versions; the Trash with each item's clock; each unit on its way out of a Context, marked as moving; Run records, without which changes each made, since those are lines of the change log; each Context's time zone, its Brief and Review times and its Notification switch, in its own file. From the Deployment: the Contexts with their names and accent colours, whether each is retired; the spend cap; the monthly spend totals of deleted Contexts; Connections.
- **Out**: every Conversation and the runtime's record of it, the change log, the record of a Connection's calls, Devices and push subscriptions, both provider keys.
- An Entry in the file is its plain words plus its links as data.
- The words go out as typed, with an image as its address only. There is no Export of the Journal as Markdown files, no per-Context Export and no encryption of Praxis's own.

### 10.2 Restore

- One way only: whole, with ids kept, into a Deployment that holds nothing yet, by the person's hand during setup. No merge, and no restoring one Context into a live Deployment. The screen offers it in place of making the first Context, through `restore_export`, which takes the zip as it was downloaded or as a Backup is kept, and is refused once the Deployment holds a Context, a Connection, a cap the person set or any spend.
- Every record, Run record and Connection keeps its id. A Context comes back under a new id, since a Context's id is its object's and only the platform mints one: its name, accent, time zone, Brief and Review times and Notification switch are as they were, and a retired one comes back retired. Each Context's object is made from its file before the Deployment lists it, and a file that does not hold together restores nothing.
- A Connection comes back ended. Its name stays as an Author.
- The Trash's clock counts from the original delete. Anything past its 30 days is removed during the restore.
- The files of one Export are not one instant. A record caught moving between Contexts is settled by id: found in both, the destination keeps it; marked as moving with no copy elsewhere, it stays in the source. No move is left going after a restore.
- A Context restored starts with an empty change log and no record of a Connection's calls, since the file holds neither, and the restore's Effects are each Context and Connection made and the spend cap, and not the records, which the file brought whole. A Run the file holds as going cannot go on without its Conversation, and comes back failed. The month's spend against the cap starts again from the Run records the file holds, since what Calls and embedding spent is not in it. Its first Brief and Review are the first to come after the restore, and its Entries are queued for the meaning index, which search answers without until its alarm, first search or first write has built it.
- A restore reads a file whose format version is older than the code's, however old, and refuses one that is newer. It reads the zip Praxis writes, and one a system's archiver made again of its files, deflated.
- Point-in-time recovery of an object is an operator's escape hatch described in the docs (`docs/deployment.md`), not a feature.

### 10.3 Backups on the screen

Settings shows when the last Backup was made, from `get_last_backup`. When none has succeeded for three days a standing Notice appears in Attention, leading to Backups and Export in settings. It is not a Notification.

- The three days count from the last Backup made or, before any, from the first Context made. A day the daily trigger did not fire counts as one that failed.
- Each day's Backup, made or failed, deletes those made 30 days or more before it, so a record removed for good outlives its 30 days in no Backup.
- The daily trigger fires at 03:00 UTC, and a Backup is named after the day it was due, `praxis-export-YYYY-MM-DD.zip`, the name an Export downloads under.

### 10.4 Deleting a Context

- Offered only for a retired Context, by the person's hand, after typing its name and being offered an Export. `delete_context` takes the name as typed, and refuses one that is not the Context's.
- It removes the object's whole storage, its part of the meaning index and its Connections, each Connection an Effect by rule. No Trash, no way back.
- Its Run records go. Its spend stays as monthly totals with no name attached.
- It is refused, with nothing deleted, while a Run is going in the Context, while it holds a record on its way out to another Context (section 3.9), and when the meaning index does not answer: only waiting mends any of these. An Entry already taken out of the index when it stopped answering is queued to go back in, so the index is whole again should the Context be brought back.
- The screen says that Praxis cannot reach a file the person downloaded, and that its files in Backups go as those Backups age out.

### 10.5 How long things are kept

| Thing | Kept |
|---|---|
| Entries, Tasks, Projects, Persons | Until deleted |
| An Entry's Versions | As long as the Entry exists |
| The Trash | 30 days from the delete, or until emptied |
| The change log | 90 days |
| The record of a Connection's calls | 90 days |
| Run records and Call records | For good |
| Conversation text | Until the person clears that Conversation |
| Backups | 30 days, except the last one holding a stuck Context |
| A caller's key for a write | 30 days |
| An Unsent write | Until sent or discarded |
| Sound | Never |

## 11. Upgrades

ADR 0019.

- Each object upgrades its own tables when it wakes, before it serves anything, by a ladder of numbered steps. One ladder for a Context's object and one for the Deployment object.
- The ladder goes forward only and reaches back to the first release for good. A released step is never edited, dropped or squashed. There are no down steps. A fix to a bad step is a new step. Skipping releases needs no ceremony.
- There is no sweep at deploy: the daily Backup wakes every object, retired Contexts included.
- Each step is its own transaction. Before its first pending step an object notes the platform's point-in-time bookmark, which it keeps and logs. A new object, holding nothing, is made rather than upgraded and notes none.
- A release is the commit CI deploys, which names it to the Worker.
- **A step changes shape, never meaning.** It writes nothing to the change log, has no Author, makes no Version and never touches an Entry's words: a Context's object checks this around each step, and a step that does any of it fails. Reads through a tool return the same before and after, apart from what the release adds. A change in meaning to existing records is a rule of the release that this spec states.
- A step carries across what the Export does not hold: the change log, the record of a Connection's calls, Devices and their push subscriptions, and a Connection's standing.
- A step never migrates anything outside the object. When a release changes what the meaning index holds, the step marks it stale and it is rebuilt.
- **A failed step** leaves the object whole on the earlier step, serving nothing, reads included, until a fixed release is deployed. So does an object that finds its tables newer than the code.
- **A stuck Context** is named in a standing Notice, and the other Contexts keep working. It says so itself as it wakes, and the daily Backup finds it out too. Everything on its clock stops: no Brief or Review, no Trash expiry, no finishing of an interrupted move. It tries again only when woken under a different release, and its clock starts again at once when it comes back. The last Backup that holds it is kept past 30 days until it upgrades, and the Notice says so.
- A stuck Context writes no file. An Export the person makes is refused, since it is always the whole Deployment. The daily Backup carries on without it, its listing and its Connections left out of the Deployment's file. It cannot be renamed or deleted, and a move into it is refused.
- **A stuck Deployment object** means nothing can be routed. The Worker shows one plain page saying the upgrade failed and under which release.
- **A deploy is a one-way door** once any object has woken under it. There is no gradual rollout. Going back is by fixing forward, or by restoring a Backup into a fresh Deployment.
- The deploy (section 12, ADR 0026) checks that a Backup from the last day exists, the one the daily trigger was last due to make, and stops with a warning if not, before anything changes. The person overrides it with a line `Deploy-Without-Backup: yes` in the message of the commit pushed. A first deploy has nothing to check.
- The runtime's tables are not on the ladder. A runtime that cannot open its tables never blocks the Journal: the screen and Connections keep working, the Conversation shows as unavailable, and starting it afresh is the person's choice, by clearing it (section 5.8). Until then the Agent takes no Message there, and no Brief or Review runs.
- The Export's format version is a separate number with its own ladder, which brings an old file forward as it is read and reaches back to format 1 for good. Each of its steps is a file of its own, numbered by the format it reaches, never edited once released.

## 12. Setup and configuration

ADR 0009, 0017, 0018, 0021, 0026. The mechanics follow [mise](https://github.com/nuntz/mise): Pulumi, a setup wizard, and Deployment configuration kept outside the repo, in a Pulumi ESC environment. The repository's CI deploys on every push to master: Pulumi makes everything around the Worker, then `wrangler deploy` makes the Worker and its Durable Object classes with the vars and secrets Pulumi gives. `docs/deployment.md` walks through it.

The setup wizard:

- Creates the Worker, the Durable Object classes, the R2 bucket for Backups and the meaning index.
- Creates one Access application for the hostname, with Google as the way in for the person's own address and no other, switches on managed OAuth, lists the redirect addresses of Claude and ChatGPT (the latter with a wildcard), and allows clients on localhost and loopback.
- Offers the jurisdiction, once: `eu`, `us`, `fedramp` or none. A deploy that would change it fails before changing anything.
- Takes the Agent's provider key and the model's name, both optional, and says to set a spend limit with the provider.
- Takes the voice provider key, optional, and says what reaches that provider.
- Says the monthly spend cap starts at 20 US dollars, and where on the screen to change it.
- Makes the Web Push signing key pair.
- Leads the person to the screen, signed in through Access, to make the first Context with its name, time zone and accent colour, through `create_context`, or, in its place, to restore an Export or a Backup there (section 10.2).

Changing a key or the model is a change to the configuration and a deploy, never something done in Praxis.

## 13. Testing

ADR 0015, 0019, 0020, 0021.

**Layers.**

- `bun test` for the pure domain package. Direct tests there only where the input space is too large for scenarios: a Task's derived state and its reason, Recurrence dates, the shapes an Entry's words can take on the way in, parsing an Inline Task and what the person types to link something, following an anchor through a change to the words, comparing a Version against the current words, and what the Markdown renderer lets through: the set, the addresses and when an image loads.
- `bun test` for the PWA, for three things only. The design tokens: every text pairing the design system names is at least 4.5:1 in light and in dark, for all six accents, since the browser's accessibility check sees only the accent the screen shows. Then the screen's end of the live channel: reconnecting and catching up, since a journey cannot stage a dropped channel or a log pruned since reliably. And what the screen stores for a later load: every shape a release stored under each key reads through the current screen's reader, since a journey would store only the shape the current release does.
- Vitest in real workerd for anything touching a Durable Object or SQL. A test can stand up several Context objects and the Deployment object.
- No domain or tool code reads the real clock. A test sets the time and the Context's time zone and fires alarms itself.
- CI never calls a model.

**At the tool seam.**

- A test calls a tool through the registry as one of the five callers against a real Context object, and asserts only the result, the Effects and later reads. Tests never read tables and never seed by writing rows.
- **The oracle**: the harness wraps every write, snapshots the domain tables before and after, and fails unless the difference is exactly the Effects returned and the change log holds the same Effects with the right caller. A refused, stale or repeated-key call changes nothing. A Context made by `restore_export` holds what its file held, which no Effect names: it starts with an empty change log, and its test reads the file back through `make_export`. A held call changes nothing but its Held Change. It sees a record as a caller does: one sent to the Trash, or removed from it for good, is deleted, and one restored is made. It remembers each record that leaves a Context, removed for good or moved away once the move has finished, and when the Context's alarm wakes it 30 days on, fails if any text in any of its tables still holds that record's words or summary, reading every table without naming one, except the Conversation's, kept until the person clears it (section 5.8). After every call and every wake it fails a Context that holds a row its alarm removes by age, a key, a change, a Connection's call, an item in the Trash or a move taken in, with no alarm armed, since nothing would then remove it; a stuck Context, whose clock stops, is let off.
- **Offering**: checked against the tables of sections 4.10 and 4.11, kept by hand in the repo. A generic test calls every tool as every caller, and every tool offered to the Agent or the clock again in a Run or a Brief on a scripted model, since their calls reach the registry through the Agent's runtime.
- **Guard**: CI fails when a tool has no row in the offering table or no seam test naming it. No line-coverage threshold.
- **No words leave**: tests seed Entries and Messages with marker strings, and the harness fails any test where a marker appears in anything logged, in a Notification or in a Run record, as kept or as `list_runs` and `get_run` give it. Once `clear_conversation` succeeds, it fails any marker left in the runtime's tables: the Conversation is dropped, not hidden.

**The Agent.** A scripted model plays fixed tool calls and text through the real runtime loop in workerd. What the Agent says or chooses is never asserted in CI. Evals are a small set of seeded Journals, each with a request and a good outcome, judged on tool calls and Effects, run by hand against the real model with the person's own key when the prompt, the tool descriptions or the model changes (`bun run evals`, `apps/worker/test/agent-evals.ts`): recording the person's words verbatim as one Entry, splitting on a plain change of subject, leaving a Held Change, marking a Standing Entry only when asked and never unasked, and saying to switch when asked about another Context. CI never runs them, but holds each one's judge to passing a scripted good outcome and failing a scripted bad one, which asserts the judge and not the Agent. The voice model's instructions have their own, run by hand in real Calls when they or the voice model change: it hands over a request and not a greeting, says nothing of the Journal, speaks the answer it is given, stops when talked over, and whether a sound such as a sigh is written out (`docs/voice-evals.md`).

**MCP.** A real MCP SDK client over Streamable HTTP against the Worker in workerd, with tokens signed by a test key. It asserts the tool list equals the Connection column, held calls are refused with the error saying what to do instead, a read-only Connection gets no writes, an ended Connection is refused on its next call, and a Connection reaches only its own Context.

**The browser.** A Playwright suite runs in CI on every push, against the built PWA served by the real Worker behind a stand-in for Access, which refuses what a browser asks for without its sign-in as Access does, and sends a lapsed sign-in to a login page that returns the browser to the address it was at, at desktop and phone width, beside the checks that gate the deploy rather than among them: each journey runs once and is retried once, a journey that passes on its retry is reported flaky, and one is worked only when it keeps coming back (`docs/flaky-journeys.md`). A screen that breaks is seen on the next visit and mended by the next push; what a deploy cannot undo is the upgrade, held by the tests that gate it (Upgrades, below). Journeys: record an Entry with an Inline Task; finish a Task from Attention; ask the Agent for a change and see the screen patch; tap a Held Change; restore from the Trash; make a Connection; and the offline journeys of ADR 0015. Each journey also runs an automated accessibility check, in light and in dark, except in the run under load, run by hand, where it found nothing the push's run does not and took the time the journeys need. A guard in the screen's own code, such as the Offline Copy's fetch, is tested by a journey that holds the answer it races, not by a test of the PWA's own. Since there is one Call at a time for the Deployment, a journey that starts a Call holds a lock across the suite's workers for the whole of it (`e2e/one-call.ts`).

**Fakes.** Five things are faked: the model, the voice provider (on the Device, with scripted text and no sound), the Web Push sender, the Access key set, and the meaning index, Workers AI and Vectorize together, which takes words a test says mean alike to be alike. Each adapter has one contract suite, run in CI against the fake and by hand against the real service. The voice provider is faked at the Context's object too, which sets every Call up at it and closes a session there, keeping what the voice was given to say first, and its contract runs in the browser suite (`e2e/voice-contract.spec.ts`), since the Device's channel to the provider is WebRTC, and against the real provider when given `VOICE_API_KEY` by hand: it holds the Device to sending only the Agent's answer, under an open handover, and the end of the Call, and checks by hand that the provider refuses anything else from the Device. The meaning index is bound only by the deploy, never in `wrangler.jsonc`, since a binding to either reaches the account even in tests; its contract by hand runs under a configuration of its own that binds both remotely. The bucket of Backups is not faked: it is workerd's own R2, outside the objects like a Device's push service, so a test reads what is kept there, and can make it refuse to keep anything, to see what a failed Backup leaves.

**Upgrades.** Each release that adds a step commits one fixture: a Context object and a Deployment object filled by a fixed scenario run through the tools, saved as a dump beside the Export it produced, and named by the tops of its two ladders, since a release that adds no step has the tables of the one before. The upgrade test wakes every fixture under the current code and checks the tables' shape, the Export brought forward, a few reads, and a step made to fail, and fails when the current ladders have no fixture. A guard fails CI when a released step's text changes, when one is gone, or when a step imports anything, and holds the Export format's steps (`packages/domain/src/format-steps/`) the same way. What the screen stores on a Device for a later load has its own fixtures, one for each shape a release stored under each key, the text as stored; the same kind of guard fails CI when a released one changes or is gone, and the PWA's test fails when a key has none or the current screen stores a shape its last one does not have.

**By hand, per Deployment.** Real Access with real hosted clients, each client's token carrying the person's address, Web Push delivery, install to the Home Screen, real Calls, and a share into Praxis already open on Android adding to the draft there, which holds only where the browser honours the launch handler (section 8.9).

## 14. Out of scope

- Migrating data from the predecessor. The spec only has to not make it impossible.
- More than one user per Deployment, and any sharing.
- Attachments on an Entry.
- Unprompted work the person defines.
- Static credentials and callers with no browser.
- The Agent reaching outside tools ([Praxis as an MCP client](https://github.com/nuntz/praxis/issues/27)). Nothing is reserved for it.
- Email-in, an ambient display, and ways in with no browser.
- Times of day on a Due Date, and reminders.
- An Export of the Journal as Markdown files.

