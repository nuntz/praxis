import { z } from "zod";
import type { Attention } from "./attention.ts";
import type { CallerKind } from "./callers.ts";
import { day, daysBefore, timeZone } from "./day.ts";
import type { ChangesPage, Written } from "./effects.ts";
import { type Entry, type Page, STANDING_CEILING, type Version } from "./entry.ts";
import type { Held, HeldChange } from "./held-change.ts";
import type { Person } from "./person.ts";
import type { Project } from "./project.ts";
import { newRecurrence } from "./recurrence.ts";
import { failure, type ToolResult } from "./results.ts";
import type { Settings } from "./settings.ts";
import type { Task } from "./task.ts";
import type { Removal, TrashItem } from "./trash.ts";

/** Whether a caller is offered a tool (section 4.10). */
export type Offer = "yes" | "no";

type ToolDefinition = {
  description: string;
  input: z.ZodType;
  offered: Record<CallerKind, Offer>;
} & (
  | { kind: "read" }
  | {
      kind: "write";
      /**
       * Whether it can take away or overwrite what is there, rather than only add: MCP's
       * destructive hint (section 7.3). Nothing is lost for good either way: what a write takes
       * away is put back by ordinary means.
       */
      destructive: boolean;
    }
);

const toEveryCaller: Record<CallerKind, Offer> = {
  hand: "yes",
  agent: "yes",
  clock: "yes",
  connection: "yes",
  read_only_connection: "yes",
};

/** A write offered to the hand, the Agent and a Connection, and never to a reader. */
const toEveryWriter: Record<CallerKind, Offer> = {
  hand: "yes",
  agent: "yes",
  clock: "no",
  connection: "yes",
  read_only_connection: "no",
};

/** A write offered to the person's hand alone. */
const toHandOnly: Record<CallerKind, Offer> = {
  hand: "yes",
  agent: "no",
  clock: "no",
  connection: "no",
  read_only_connection: "no",
};

/**
 * The optional key every write accepts (section 4.5). A repeat from the same caller within 30
 * days returns the first result and does nothing again.
 */
const key = z.string().min(1).max(200).optional();

/** A write's input: its own fields and the key. Deployment tools' writes take it too. */
export function writeInput<S extends z.ZodRawShape>(shape: S) {
  return z.strictObject({ ...shape, key });
}

/** Days a caller's key for a write is remembered. */
export const KEY_DAYS = 30;

/** A key given at or before the instant this returns is forgotten by `at`. */
export function keysForgottenBy(at: number): number {
  return daysBefore(at, KEY_DAYS);
}

const words = z
  .string()
  .refine((value) => value.trim().length > 0, { message: "An Entry needs words." });

/** A Task's title: one line, kept exactly as given. A Task has no body. */
const title = z
  .string()
  .refine((value) => value.trim().length > 0, { message: "A Task needs a title." })
  .refine((value) => !/[\r\n]/.test(value), {
    message: "A Task's title is one line: say more in an Entry.",
  });

/** A Project's name: one line, kept exactly as given. A Project has no description. */
const name = z
  .string()
  .refine((value) => value.trim().length > 0, { message: "A Project needs a name." })
  .refine((value) => !/[\r\n]/.test(value), {
    message:
      "A Project's name is one line, and a Project has no description: say more in an Entry.",
  });

/** A Person's name: one line, kept exactly as given. Nothing else is kept about a Person. */
const personName = z
  .string()
  .refine((value) => value.trim().length > 0, { message: "A Person needs a name." })
  .refine((value) => !/[\r\n]/.test(value), {
    message:
      "A Person's name is one line, and nothing else is kept about them: say more in an Entry that Mentions them.",
  });

/** A record's id. */
const id = z.string().min(1);

/** A list's cursor, as the list gave it. */
const cursor = z.string().min(1).optional();

/** What was typed after `@` or `#`, to narrow a list to the names that hold it, for a picker. */
const named = z.string().min(1).optional();

/** What a link names: a Task or Project for a Reference, a Person for a Mention. */
const linkTarget = z.strictObject({ kind: z.enum(["task", "project", "person"]), id });

/** What a Task waits on: a Task or Project in its Context, never a Person. */
const waitTarget = z.strictObject({ kind: z.enum(["task", "project"]), id });

/** A span of the words, in UTF-16 code units as JavaScript counts a string, end not included. */
const anchor = z
  .strictObject({ start: z.int().min(0), end: z.int().min(1) })
  .refine((span) => span.end > span.start, {
    message: "An anchor's end comes after its start.",
  });

/** What a new link names: a record there is, or a new Person or Project to make in the call. */
const newLinkTarget = z.discriminatedUnion("kind", [
  linkTarget,
  z.strictObject({ kind: z.literal("new_person"), name: personName }),
  z.strictObject({ kind: z.literal("new_project"), name }),
]);

/** A link as a write takes it, kept beside the words and optionally anchored to a span of them. */
const newLink = z.strictObject({ to: newLinkTarget, anchor: anchor.optional() });

/** Tasks to make with an Entry, each with it as its Origin Entry. */
const newTasks = z.array(z.strictObject({ title })).optional();

/** The Version of an Entry's words a change to them was made against (section 4.8). */
const version = z.int().min(0);

/**
 * What a Connection is told when the words it would change are the person's (section 4.7), in
 * the refusal and in the description of each tool that can be held.
 */
export const HELD_FOR_A_CONNECTION =
  "Refused when the Entry's Author is the person: their words are changed only by them. Add a Follow-up with record_entry instead, or ask the person to make the edit.";

/**
 * What the description of each tool that can be held says (section 4.7): the Agent's call leaves
 * a Held Change, and a Connection's is refused.
 */
const HELD =
  "When the Entry's Author is the person, their words are changed only by their tap. From the Agent the call changes nothing and returns, with `held: true`, the Held Change it left for the tap, which a typed or spoken yes never makes. From a Connection it is refused: add a Follow-up with record_entry instead, or ask the person to make the edit.";

/** The Context tools. The schemas live here; the tools run inside a Context's object. */
export const tools = {
  record_entry: {
    kind: "write",
    destructive: false,
    description:
      "Record an Entry in the Journal. The words are kept exactly as given and never read for Tasks or links: each Task to make with the Entry is given in `tasks`, and has the Entry as its Origin Entry, and each link in `links`. A link to a Task or Project is a Reference and one to a Person a Mention; it may name a new Person or Project to make, and may be anchored to a span of the words. `follow_up_to` names the one earlier Entry this one continues or corrects, if any: a Follow-up. The words are never refused for a link: one naming a record not in this Context is not kept, and an anchor past the words' end is left off. Read the Entry returned for the links kept.",
    input: writeInput({
      words,
      tasks: newTasks,
      links: z.array(newLink).optional(),
      follow_up_to: id.optional(),
    }),
    offered: toEveryWriter,
  },
  get_entry: {
    kind: "read",
    description: "Get one Entry by its id.",
    input: z.strictObject({ id: z.string().min(1) }),
    offered: toEveryCaller,
  },
  list_entries: {
    kind: "read",
    description:
      "List the Journal's Entries, newest first, 50 to a page. Give `standing: true` to list only the Standing Entries: those the person marked for the Agent to keep honouring.",
    input: z.strictObject({
      cursor: z.string().min(1).optional(),
      standing: z.literal(true).optional(),
    }),
    offered: toEveryCaller,
  },
  edit_entry: {
    kind: "write",
    destructive: true,
    description: `Change an Entry's words, stating the \`version\` of them read with the Entry: a change against one no longer current is \`stale\`, so read the Entry again. The words before are kept as a Version, listed by list_entry_versions. Each Task to make with the new words is given in \`tasks\`, as for record_entry; words that lose a Task's line delete no Task. Its links stay: an anchor moves with what is changed around it, and one whose span the change touches stays without one. ${HELD}`,
    input: writeInput({ id, words, version, tasks: newTasks }),
    offered: toEveryWriter,
  },
  restore_entry_version: {
    kind: "write",
    destructive: true,
    description: `Put an Entry's words back to one of its Versions, numbered \`restore\` as list_entry_versions gave it, stating the \`version\` the Entry is at, as for edit_entry. It is a new change: the words it replaces become a Version and the others stay. It makes no Task, whatever the words hold. ${HELD}`,
    input: writeInput({ id, restore: version, version }),
    offered: toEveryWriter,
  },
  delete_entry: {
    kind: "write",
    destructive: true,
    description: `Send an Entry to the Trash, from which it can be restored for 30 days. The Tasks it is the Origin Entry of go with it, open or closed, with every Occurrence of a recurring one, and so do its own References and Mentions; each Task waiting on one of them stops waiting. A Follow-up of it stays, and shows that it continues a deleted Entry; every other link to it is kept, shown as deleted until it is restored. No Entry's words change. It is never refused for what hangs off it. ${HELD}`,
    input: writeInput({ id }),
    offered: toEveryWriter,
  },
  list_entry_versions: {
    kind: "read",
    description:
      "List an Entry's Versions, newest first, 50 to a page: every earlier state of its words, each with who changed them and when. A Version covers the words only, not the links.",
    input: z.strictObject({ id, cursor }),
    offered: toEveryCaller,
  },
  add_link: {
    kind: "write",
    destructive: false,
    description:
      "Link an Entry to a Task or Project (a Reference) or to a Person (a Mention), optionally anchored to a span of its words. The words never change, so this is never held. `to` may name a new Person or Project to make. Linking what the Entry already links, at that span or with none, changes nothing.",
    input: writeInput({ entry_id: id, to: newLinkTarget, anchor: anchor.optional() }),
    offered: toEveryWriter,
  },
  remove_link: {
    kind: "write",
    destructive: true,
    description:
      "Remove the links from an Entry to a Task, Project or Person: every one, or given an anchor only the one at that span. The words never change, so this is never held, and the record itself stays.",
    input: writeInput({ entry_id: id, to: linkTarget, anchor: anchor.optional() }),
    offered: toEveryWriter,
  },
  mark_standing: {
    kind: "write",
    destructive: false,
    description: `Mark an Entry as a Standing Entry, which the Agent is given at the start of every Run in this Context and keeps honouring; when two disagree, the newer wins. The Agent marks one only when the person asks, recording it first in the person's words, and never unasked. The words never change, so this is never held. A Context's Standing Entries hold ${STANDING_CEILING.toLocaleString("en")} characters in all at most: a mark that would pass that is refused, with the Standing Entries in the way. Marking a Standing Entry changes nothing, and a Follow-up to one is not standing unless marked itself.`,
    input: writeInput({ id }),
    offered: { ...toEveryWriter, connection: "no" },
  },
  unmark_standing: {
    kind: "write",
    destructive: true,
    description:
      "Unmark a Standing Entry: it stays in the Journal as an ordinary Entry, and the Agent is no longer given it. The Agent unmarks one only when the person asks. Unmarking an Entry that is not standing changes nothing.",
    input: writeInput({ id }),
    offered: { ...toEveryWriter, connection: "no" },
  },
  add_task: {
    kind: "write",
    destructive: false,
    description:
      "Make a Task on an Entry that exists, which becomes its Origin Entry. Every Task is made with an Entry named: there is no Task without one.",
    input: writeInput({ entry_id: z.string().min(1), title }),
    offered: toEveryWriter,
  },
  finish_task: {
    kind: "write",
    destructive: true,
    description:
      "Finish a Task: it was done. Finishing a Finished Task changes nothing, and a Dropped one is refused until it is reopened.",
    input: writeInput({ id: z.string().min(1) }),
    offered: toEveryWriter,
  },
  drop_task: {
    kind: "write",
    destructive: true,
    description:
      "Drop a Task: the person decided not to do it. It stays where it was; dropping is not deleting. Dropping a Dropped Task changes nothing, and a Finished one is refused until it is reopened.",
    input: writeInput({ id: z.string().min(1) }),
    offered: toEveryWriter,
  },
  reopen_task: {
    kind: "write",
    destructive: true,
    description:
      "Reopen a Finished or Dropped Task, so it is open again. Reopening an open Task changes nothing.",
    input: writeInput({ id: z.string().min(1) }),
    offered: toEveryWriter,
  },
  rename_task: {
    kind: "write",
    destructive: true,
    description: "Change a Task's title. A Task has a title and no body: say more in an Entry.",
    input: writeInput({ id: z.string().min(1), title }),
    offered: toEveryWriter,
  },
  set_task_dates: {
    kind: "write",
    destructive: true,
    description:
      'Set or clear a Task\'s Due Date, its Defer Date, or both. Each is a day written YYYY-MM-DD with no time of day, or null to clear it; one left out stays as it was. Dates are never prose: resolve "next Friday" with today and the time zone from get_settings. A Task is Overdue once its Due Date has passed and Deferred until its Defer Date comes.',
    input: writeInput({
      id: z.string().min(1),
      due_date: day.nullable().optional(),
      defer_date: day.nullable().optional(),
    }).refine((input) => input.due_date !== undefined || input.defer_date !== undefined, {
      message: "Give a due_date, a defer_date or both: a day to set it, or null to clear it.",
    }),
    offered: toEveryWriter,
  },
  set_recurrence: {
    kind: "write",
    destructive: true,
    description:
      'Put a Recurrence on a Task, or change the one it has: when the Task is finished or dropped, the next Occurrence is made by rule, a new Task with the same title, Project, Recurrence, delegation and Origin Entry, and its Defer Date as many days before its Due Date as this one\'s. The rule sets the next Due Date. A schedule is every N days, every N weeks on chosen weekdays, every N months on a day of the month or the last day ("last"), or every N years, and the next Due Date is the first day on it after both the current Due Date and the day the Task was closed; it counts from the Task\'s Due Date now, so every 2 weeks runs from this week. A day the month lacks falls on its last day. An interval ("interval") is counted from the day the Task was closed. The Task must have a Due Date and be open. A change applies from the next Occurrence: this one\'s Due Date stays. Setting the rule it has changes nothing.',
    input: writeInput({ id, recurrence: newRecurrence }),
    offered: toEveryWriter,
  },
  remove_recurrence: {
    kind: "write",
    destructive: true,
    description:
      "End a Task's Recurrence: closing it makes no next Occurrence. Give the open Occurrence, which is the one holding the rule. Its Due Date stays. Removing it from a Task with none changes nothing.",
    input: writeInput({ id }),
    offered: toEveryWriter,
  },
  delegate_task: {
    kind: "write",
    destructive: true,
    description:
      "Delegate a Task to a Person in this Context: they are doing it, and it is no longer actionable for the person, who still tracks it. Only this call delegates: a Mention never does. The Person has no access to Praxis and nothing is sent to them. Delegating to the Person it is Delegated to changes nothing; to another hands it on. A closed Task is refused until it is reopened. The delegation ends when the Task is finished, dropped or taken back.",
    input: writeInput({ id: z.string().min(1), person_id: z.string().min(1) }),
    offered: toEveryWriter,
  },
  take_back_task: {
    kind: "write",
    destructive: true,
    description:
      "Take back a Delegated Task: no Person is doing it any more, and it is the person's to act on again. Taking back a Task no one is doing changes nothing.",
    input: writeInput({ id: z.string().min(1) }),
    offered: toEveryWriter,
  },
  wait_on: {
    kind: "write",
    destructive: false,
    description:
      "Set a Task waiting on another Task or a Project in this Context, which can be in another Project. It is not actionable while what it waits on is open, and the wait ends by itself when that one is finished or dropped. A Task can wait on several. It never waits on a Person: delegate the Task, or wait on a Task Delegated to them. Waiting locks nothing: the Task can still be finished. Waiting on what it already waits on changes nothing. A wait that would make a cycle is refused, and so is one on something closed, or from a closed Task until it is reopened.",
    input: writeInput({ id, on: waitTarget }),
    offered: toEveryWriter,
  },
  stop_waiting: {
    kind: "write",
    destructive: true,
    description:
      "Stop a Task waiting on a Task or Project. Stopping a wait the Task does not have changes nothing.",
    input: writeInput({ id, on: waitTarget }),
    offered: toEveryWriter,
  },
  delete_task: {
    kind: "write",
    destructive: true,
    description:
      "Send a Task to the Trash, from which it can be restored for 30 days. Its Recurrence goes with it when it is the open Occurrence, and no next Occurrence is made: deleting is not closing, so drop a Task the person decided not to do. Each Task waiting on it stops waiting. Its Origin Entry and earlier Occurrences stay, and an Entry that References it shows the link as deleted until it is restored. It is never refused for what hangs off it.",
    input: writeInput({ id }),
    offered: toEveryWriter,
  },
  get_task: {
    kind: "read",
    description:
      "Get one Task by its id, with its dates, its derived state and the reason for it: the end it reached and when, or, while open, whether it is actionable, what it waits on, who it is Delegated to, the day it is Deferred until and the day it became Overdue.",
    input: z.strictObject({ id: z.string().min(1) }),
    offered: toEveryCaller,
  },
  list_tasks: {
    kind: "read",
    description:
      "List the Context's Tasks, newest first, 50 to a page, open or closed, each with its derived state. Give `named` to list only those whose title holds it, whatever its case and accents.",
    input: z.strictObject({ cursor, named }),
    offered: toEveryCaller,
  },
  move_task: {
    kind: "write",
    destructive: true,
    description:
      "Put a Task in a Project, move it to another, or take it out of any with a project_id of null. A Task is in one Project at most, and a Project is the only thing that contains Tasks.",
    input: writeInput({ id, project_id: id.nullable() }),
    offered: toEveryWriter,
  },
  make_project_from_task: {
    kind: "write",
    destructive: true,
    description:
      "Turn a Task that turns out to have parts into a Project, in one call: a Project is made, named after the Task unless a name is given, and the Task becomes its first Task, keeping its Origin Entry. A Task has no parts: add the others to the Project.",
    input: writeInput({ id, name: name.optional() }),
    offered: toEveryWriter,
  },
  create_project: {
    kind: "write",
    destructive: false,
    description:
      "Make a Project: work made of several Tasks. It has a name and, optionally, a Due Date written YYYY-MM-DD, which says nothing about its Tasks'. It has no description: say more in an Entry. Two Projects may share a name.",
    input: writeInput({ name, due_date: day.optional() }),
    offered: toEveryWriter,
  },
  rename_project: {
    kind: "write",
    destructive: true,
    description: "Change a Project's name.",
    input: writeInput({ id, name }),
    offered: toEveryWriter,
  },
  set_project_due_date: {
    kind: "write",
    destructive: true,
    description:
      "Set a Project's Due Date, a day written YYYY-MM-DD, or clear it with null. It says nothing about its Tasks' Due Dates. Resolve \"next Friday\" with get_settings first. An open Project is Overdue once its Due Date has passed.",
    input: writeInput({ id, due_date: day.nullable() }),
    offered: toEveryWriter,
  },
  finish_project: {
    kind: "write",
    destructive: true,
    description:
      "Declare a Project Finished. It is never Finished by its Tasks running out, only by this. The Tasks still open in it are Dropped. It is never refused.",
    input: writeInput({ id }),
    offered: toEveryWriter,
  },
  drop_project: {
    kind: "write",
    destructive: true,
    description:
      "Drop a Project: the person decided not to do it. It stays where it was; dropping is not deleting. The Tasks still open in it are Dropped. It is never refused.",
    input: writeInput({ id }),
    offered: toEveryWriter,
  },
  reopen_project: {
    kind: "write",
    destructive: true,
    description:
      "Reopen a Finished or Dropped Project, so it is open again. The Tasks dropped with it stay Dropped: reopen each one wanted.",
    input: writeInput({ id }),
    offered: toEveryWriter,
  },
  delete_project: {
    kind: "write",
    destructive: true,
    description:
      "Send a Project to the Trash, from which it can be restored for 30 days. Nothing goes with it: its Tasks stay, Finished ones among them, and show no Project, and each Task waiting on it stops waiting. To give up the work in it, drop the Project first. An Entry that References it shows the link as deleted until it is restored. It is never refused for what hangs off it.",
    input: writeInput({ id }),
    offered: toEveryWriter,
  },
  get_project: {
    kind: "read",
    description:
      "Get one Project by its id, with its Due Date, its state (open, perhaps Overdue, or the end declared and when) and its Tasks, each with its derived state.",
    input: z.strictObject({ id }),
    offered: toEveryCaller,
  },
  list_projects: {
    kind: "read",
    description:
      "List the Context's Projects, newest first, 50 to a page, each with its Tasks. Give a state to list only the open, Finished or Dropped ones, and `named` to list only those whose name holds it, whatever its case and accents.",
    input: z.strictObject({
      cursor,
      state: z.enum(["open", "finished", "dropped"]).optional(),
      named,
    }),
    offered: toEveryCaller,
  },
  create_person: {
    kind: "write",
    destructive: false,
    description:
      "Make a Person: someone the person deals with, so Entries can Mention them. A Person has a name and nothing else: say more in an Entry that Mentions them. Two Persons may share a name, and are never taken to be the same.",
    input: writeInput({ name: personName }),
    offered: toEveryWriter,
  },
  rename_person: {
    kind: "write",
    destructive: true,
    description: "Change a Person's name.",
    input: writeInput({ id, name: personName }),
    offered: toEveryWriter,
  },
  delete_person: {
    kind: "write",
    destructive: true,
    description:
      "Send a Person to the Trash, from which they can be restored for 30 days. Nothing goes with them: each open Task Delegated to them is taken back, and an Entry that Mentions them shows the Mention as deleted until they are restored. It is never refused for what hangs off them.",
    input: writeInput({ id }),
    offered: toEveryWriter,
  },
  get_person: {
    kind: "read",
    description:
      "Get one Person by their id, with the latest Entry that Mentions them, which tells two Persons with one name apart.",
    input: z.strictObject({ id }),
    offered: toEveryCaller,
  },
  list_persons: {
    kind: "read",
    description:
      "List the Context's Persons, newest first, 50 to a page, each with the latest Entry that Mentions them. Give `named` to list only those whose name holds it, whatever its case and accents.",
    input: z.strictObject({ cursor, named }),
    offered: toEveryCaller,
  },
  get_settings: {
    kind: "read",
    description:
      "Get this Context's settings: its name, its time zone, and today's date there. Today, and so whether a Task is Overdue or Deferred, is the current day in that time zone. Use them to resolve a day such as \"next Friday\" before giving it to a tool.",
    input: z.strictObject({}),
    offered: toEveryCaller,
  },
  set_time_zone: {
    kind: "write",
    destructive: true,
    description:
      "Change this Context's time zone, a zone of the IANA database such as Europe/Paris. It moves no date, since a Due Date and a Defer Date are days: only today shifts.",
    input: writeInput({ time_zone: timeZone }),
    offered: toHandOnly,
  },
  view_attention: {
    kind: "read",
    description:
      "What in this Context is open for the person to act on, derived by rule and the same for every caller, in five sections in this order. `due`: every open Task that is Overdue or due today, whatever else holds for it, and every open Project that is, oldest Due Date first. `newly_actionable`: actionable Tasks whose wait ended, that were taken back or whose Defer Date came in the last seven days, newest first, each with why and when it came up. `delegated`: every other Delegated Task that is neither Waiting nor Deferred, oldest delegation first. `projects`: every open Project by name, with its count of actionable Tasks, flagged with `no_open_task` when it needs a next Task or finishing. `loose`: every other actionable Task in no Project, oldest first. A Task appears once, in the first section it fits; a Project in `due` is still in `projects`. A Waiting or Deferred Task that is not due is not shown: reach it through its Project, its Entry or search.",
    input: z.strictObject({}),
    offered: toEveryCaller,
  },
  restore: {
    kind: "write",
    destructive: false,
    description:
      "Bring back from the Trash the item holding a record, given the id of any record in it: the record deleted and everything that went with it come back together, as they were. A Task whose Origin Entry is in the Trash brings that Entry back, with what went with it. Each link the delete took away comes back unless its other end has changed since: a Task moved to another Project stays there, one Delegated to someone else stays so, and a wait resumes only if the waiting Task is still open. References, Mentions and Follow-up links always come back.",
    input: writeInput({ id }),
    offered: { ...toEveryWriter, connection: "no" },
  },
  remove_for_good: {
    kind: "write",
    destructive: true,
    description:
      "Remove for good the item in the Trash holding a record, given the id of any record in it, before its 30 days are up: the record, everything deleted with it and all its Versions go, with every dormant link to it, and nothing of it is left. A Follow-up of a removed Entry becomes an ordinary Entry. Its summaries in the change log are blanked. It cannot be undone.",
    input: writeInput({ id }),
    offered: toHandOnly,
  },
  empty_trash: {
    kind: "write",
    destructive: true,
    description:
      "Remove everything in the Trash for good, as remove_for_good does for one item. It cannot be undone.",
    input: writeInput({}),
    offered: toHandOnly,
  },
  list_trash: {
    kind: "read",
    description:
      "List what is in the Trash, newest delete first, 50 to a page: each item is what one delete sent there, the record deleted and what went with it, with when it was deleted and when it will be removed for good, 30 days after. Nothing in the Trash is in any other read: restore an item to read or change it again.",
    input: z.strictObject({ cursor }),
    offered: toEveryCaller,
  },
  make_held_change: {
    kind: "write",
    destructive: true,
    description:
      "Make a Held Change, by the person's tap: the change the Agent asked for is made as it was shown, its words the Agent's, and the Held Change is gone. One no longer waiting, made, cancelled or lapsed, is not found.",
    input: writeInput({ id }),
    offered: toHandOnly,
  },
  cancel_held_change: {
    kind: "write",
    destructive: true,
    description:
      "Cancel a Held Change waiting for the person's tap: the Entry stays as it is. The Agent cancels one when the person tells it to. One no longer waiting, made, cancelled or lapsed, is not found.",
    input: writeInput({ id }),
    offered: { ...toHandOnly, agent: "yes" },
  },
  list_held_changes: {
    kind: "read",
    description:
      "List the Held Changes waiting for the person's tap, newest first, 50 to a page: each a change to or delete of an Entry the person wrote that the Agent asked for, with the Entry's words before and after and, for a delete, the Tasks that would go with it. One lapses the moment its Entry changes underneath it.",
    input: z.strictObject({ cursor }),
    offered: { ...toEveryCaller, connection: "no", read_only_connection: "no" },
  },
  list_changes: {
    kind: "read",
    description:
      "List what changed in this Context since a cursor, oldest first: each write's Effects, its caller and when it arrived. Without a cursor it starts from the oldest change kept. Keep the cursor it gives to ask again later. The log keeps 90 days: when `read_afresh` is true the cursor was older than that, so read what you hold afresh and ask from the new cursor.",
    input: z.strictObject({ cursor: z.string().min(1).optional() }),
    offered: toEveryCaller,
  },
} as const satisfies Record<string, ToolDefinition>;

export type ToolName = keyof typeof tools;

export const toolNames = Object.keys(tools) as ToolName[];

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(tools, name);
}

/** Whether a caller is offered a Context tool: metadata of the tool, never a prompt (4.2). */
export function isOffered(name: ToolName, caller: CallerKind): boolean {
  return tools[name].offered[caller] === "yes";
}

/** The Context tools a caller is offered, in the registry's order. */
export function offeredTo(caller: CallerKind): ToolName[] {
  return toolNames.filter((name) => isOffered(name, caller));
}

export type WriteName = {
  [N in ToolName]: (typeof tools)[N]["kind"] extends "write" ? N : never;
}[ToolName];

export function isWrite(name: string): name is WriteName {
  return isToolName(name) && tools[name].kind === "write";
}

export type ToolInput<N extends ToolName> = z.infer<(typeof tools)[N]["input"]>;

/** What each tool returns on success. */
export type ToolOutput = {
  record_entry: Written<Entry>;
  get_entry: Entry;
  list_entries: Page<Entry>;
  edit_entry: Written<Entry> | Held;
  restore_entry_version: Written<Entry> | Held;
  delete_entry: Written<TrashItem> | Held;
  list_entry_versions: Page<Version>;
  add_link: Written<Entry>;
  remove_link: Written<Entry>;
  mark_standing: Written<Entry>;
  unmark_standing: Written<Entry>;
  add_task: Written<Task>;
  finish_task: Written<Task>;
  drop_task: Written<Task>;
  reopen_task: Written<Task>;
  rename_task: Written<Task>;
  set_task_dates: Written<Task>;
  set_recurrence: Written<Task>;
  remove_recurrence: Written<Task>;
  delegate_task: Written<Task>;
  take_back_task: Written<Task>;
  wait_on: Written<Task>;
  stop_waiting: Written<Task>;
  delete_task: Written<TrashItem>;
  get_task: Task;
  list_tasks: Page<Task>;
  move_task: Written<Task>;
  make_project_from_task: Written<Project>;
  create_project: Written<Project>;
  rename_project: Written<Project>;
  set_project_due_date: Written<Project>;
  finish_project: Written<Project>;
  drop_project: Written<Project>;
  reopen_project: Written<Project>;
  delete_project: Written<TrashItem>;
  get_project: Project;
  list_projects: Page<Project>;
  create_person: Written<Person>;
  rename_person: Written<Person>;
  delete_person: Written<TrashItem>;
  get_person: Person;
  list_persons: Page<Person>;
  get_settings: Settings;
  set_time_zone: Written<Settings>;
  view_attention: Attention;
  restore: Written<TrashItem>;
  remove_for_good: Written<Removal>;
  empty_trash: Written<Removal>;
  list_trash: Page<TrashItem>;
  list_changes: ChangesPage;
  make_held_change: Written<HeldChange>;
  cancel_held_change: Written<HeldChange>;
  list_held_changes: Page<HeldChange>;
};

/** A tool's input checked against its schema, or the `invalid_input` saying what is wrong. */
export type Parsed<I> = { ok: true; input: I } | Extract<ToolResult<never>, { ok: false }>;

export function parseInput<I>(schema: z.ZodType, input: unknown): Parsed<I> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, input: parsed.data as I };
  const result = failure("invalid_input", z.prettifyError(parsed.error));
  return result as Extract<ToolResult<never>, { ok: false }>;
}

/** A tool's input schema as JSON Schema, as MCP lists it (section 7.3): what a caller may send. */
export function inputJsonSchema(name: ToolName): Record<string, unknown> {
  return z.toJSONSchema(tools[name].input, { io: "input" });
}

export function parseToolInput<N extends ToolName>(name: N, input: unknown): Parsed<ToolInput<N>> {
  return parseInput(tools[name].input, input);
}
