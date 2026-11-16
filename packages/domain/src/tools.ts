import { z } from "zod";
import type { CallerKind } from "./callers.ts";
import { day, timeZone } from "./day.ts";
import type { ChangesPage, Written } from "./effects.ts";
import type { Entry, Page } from "./entry.ts";
import type { Person } from "./person.ts";
import type { Project } from "./project.ts";
import { failure, type ToolResult } from "./results.ts";
import type { Settings } from "./settings.ts";
import type { Task } from "./task.ts";

/** Whether a caller is offered a tool (section 4.10). */
export type Offer = "yes" | "no";

type ToolDefinition = {
  kind: "read" | "write";
  description: string;
  input: z.ZodType;
  offered: Record<CallerKind, Offer>;
};

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

/** A write's input: its own fields and the key. */
function writeInput<S extends z.ZodRawShape>(shape: S) {
  return z.strictObject({ ...shape, key });
}

/** Days a caller's key for a write is remembered. */
export const KEY_DAYS = 30;

/** A key given at or before the instant this returns is forgotten by `at`. */
export function keysForgottenBy(at: number): number {
  return at - KEY_DAYS * 24 * 60 * 60 * 1000;
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

/** The Context tools. The schemas live here; the tools run inside a Context's object. */
export const tools = {
  record_entry: {
    kind: "write",
    description:
      "Record an Entry in the Journal. The words are kept exactly as given and never read for Tasks or links: each Task to make with the Entry is given in `tasks`, and has the Entry as its Origin Entry, and each link in `links`. A link to a Task or Project is a Reference and one to a Person a Mention; it may name a new Person or Project to make, and may be anchored to a span of the words. The words are never refused for a link: one naming a record not in this Context is not kept, and an anchor past the words' end is left off. Read the Entry returned for the links kept.",
    input: writeInput({
      words,
      tasks: z.array(z.strictObject({ title })).optional(),
      links: z.array(newLink).optional(),
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
    description: "List the Journal's Entries, newest first, 50 to a page.",
    input: z.strictObject({ cursor: z.string().min(1).optional() }),
    offered: toEveryCaller,
  },
  add_link: {
    kind: "write",
    description:
      "Link an Entry to a Task or Project (a Reference) or to a Person (a Mention), optionally anchored to a span of its words. The words never change, so this is never held. `to` may name a new Person or Project to make. Linking what the Entry already links, at that span or with none, changes nothing.",
    input: writeInput({ entry_id: id, to: newLinkTarget, anchor: anchor.optional() }),
    offered: toEveryWriter,
  },
  remove_link: {
    kind: "write",
    description:
      "Remove the links from an Entry to a Task, Project or Person: every one, or given an anchor only the one at that span. The words never change, so this is never held, and the record itself stays.",
    input: writeInput({ entry_id: id, to: linkTarget, anchor: anchor.optional() }),
    offered: toEveryWriter,
  },
  add_task: {
    kind: "write",
    description:
      "Make a Task on an Entry that exists, which becomes its Origin Entry. Every Task is made with an Entry named: there is no Task without one.",
    input: writeInput({ entry_id: z.string().min(1), title }),
    offered: toEveryWriter,
  },
  finish_task: {
    kind: "write",
    description:
      "Finish a Task: it was done. Finishing a Finished Task changes nothing, and a Dropped one is refused until it is reopened.",
    input: writeInput({ id: z.string().min(1) }),
    offered: toEveryWriter,
  },
  drop_task: {
    kind: "write",
    description:
      "Drop a Task: the person decided not to do it. It stays where it was; dropping is not deleting. Dropping a Dropped Task changes nothing, and a Finished one is refused until it is reopened.",
    input: writeInput({ id: z.string().min(1) }),
    offered: toEveryWriter,
  },
  reopen_task: {
    kind: "write",
    description:
      "Reopen a Finished or Dropped Task, so it is open again. Reopening an open Task changes nothing.",
    input: writeInput({ id: z.string().min(1) }),
    offered: toEveryWriter,
  },
  rename_task: {
    kind: "write",
    description: "Change a Task's title. A Task has a title and no body: say more in an Entry.",
    input: writeInput({ id: z.string().min(1), title }),
    offered: toEveryWriter,
  },
  set_task_dates: {
    kind: "write",
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
  delegate_task: {
    kind: "write",
    description:
      "Delegate a Task to a Person in this Context: they are doing it, and it is no longer actionable for the person, who still tracks it. Only this call delegates: a Mention never does. The Person has no access to Praxis and nothing is sent to them. Delegating to the Person it is Delegated to changes nothing; to another hands it on. A closed Task is refused until it is reopened. The delegation ends when the Task is finished, dropped or taken back.",
    input: writeInput({ id: z.string().min(1), person_id: z.string().min(1) }),
    offered: toEveryWriter,
  },
  take_back_task: {
    kind: "write",
    description:
      "Take back a Delegated Task: no Person is doing it any more, and it is the person's to act on again. Taking back a Task no one is doing changes nothing.",
    input: writeInput({ id: z.string().min(1) }),
    offered: toEveryWriter,
  },
  get_task: {
    kind: "read",
    description:
      "Get one Task by its id, with its dates, its derived state and the reason for it: the end it reached and when, or, while open, whether it is actionable, the day it is Deferred until and the day it became Overdue.",
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
    description:
      "Put a Task in a Project, move it to another, or take it out of any with a project_id of null. A Task is in one Project at most, and a Project is the only thing that contains Tasks.",
    input: writeInput({ id, project_id: id.nullable() }),
    offered: toEveryWriter,
  },
  make_project_from_task: {
    kind: "write",
    description:
      "Turn a Task that turns out to have parts into a Project, in one call: a Project is made, named after the Task unless a name is given, and the Task becomes its first Task, keeping its Origin Entry. A Task has no parts: add the others to the Project.",
    input: writeInput({ id, name: name.optional() }),
    offered: toEveryWriter,
  },
  create_project: {
    kind: "write",
    description:
      "Make a Project: work made of several Tasks. It has a name and, optionally, a Due Date written YYYY-MM-DD, which says nothing about its Tasks'. It has no description: say more in an Entry. Two Projects may share a name.",
    input: writeInput({ name, due_date: day.optional() }),
    offered: toEveryWriter,
  },
  rename_project: {
    kind: "write",
    description: "Change a Project's name.",
    input: writeInput({ id, name }),
    offered: toEveryWriter,
  },
  set_project_due_date: {
    kind: "write",
    description:
      "Set a Project's Due Date, a day written YYYY-MM-DD, or clear it with null. It says nothing about its Tasks' Due Dates. Resolve \"next Friday\" with get_settings first. An open Project is Overdue once its Due Date has passed.",
    input: writeInput({ id, due_date: day.nullable() }),
    offered: toEveryWriter,
  },
  finish_project: {
    kind: "write",
    description:
      "Declare a Project Finished. It is never Finished by its Tasks running out, only by this. The Tasks still open in it are Dropped. It is never refused.",
    input: writeInput({ id }),
    offered: toEveryWriter,
  },
  drop_project: {
    kind: "write",
    description:
      "Drop a Project: the person decided not to do it. It stays where it was; dropping is not deleting. The Tasks still open in it are Dropped. It is never refused.",
    input: writeInput({ id }),
    offered: toEveryWriter,
  },
  reopen_project: {
    kind: "write",
    description:
      "Reopen a Finished or Dropped Project, so it is open again. The Tasks dropped with it stay Dropped: reopen each one wanted.",
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
    description:
      "Make a Person: someone the person deals with, so Entries can Mention them. A Person has a name and nothing else: say more in an Entry that Mentions them. Two Persons may share a name, and are never taken to be the same.",
    input: writeInput({ name: personName }),
    offered: toEveryWriter,
  },
  rename_person: {
    kind: "write",
    description: "Change a Person's name.",
    input: writeInput({ id, name: personName }),
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
    description:
      "Change this Context's time zone, a zone of the IANA database such as Europe/Paris. It moves no date, since a Due Date and a Defer Date are days: only today shifts.",
    input: writeInput({ time_zone: timeZone }),
    offered: toHandOnly,
  },
  list_changes: {
    kind: "read",
    description:
      "List what changed in this Context since a cursor, oldest first: each write's Effects, its caller and when it arrived. Without a cursor it starts from the oldest change kept. Keep the cursor it gives to ask again later.",
    input: z.strictObject({ cursor: z.string().min(1).optional() }),
    offered: toEveryCaller,
  },
} as const satisfies Record<string, ToolDefinition>;

export type ToolName = keyof typeof tools;

export const toolNames = Object.keys(tools) as ToolName[];

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(tools, name);
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
  add_link: Written<Entry>;
  remove_link: Written<Entry>;
  add_task: Written<Task>;
  finish_task: Written<Task>;
  drop_task: Written<Task>;
  reopen_task: Written<Task>;
  rename_task: Written<Task>;
  set_task_dates: Written<Task>;
  delegate_task: Written<Task>;
  take_back_task: Written<Task>;
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
  get_project: Project;
  list_projects: Page<Project>;
  create_person: Written<Person>;
  rename_person: Written<Person>;
  get_person: Person;
  list_persons: Page<Person>;
  get_settings: Settings;
  set_time_zone: Written<Settings>;
  list_changes: ChangesPage;
};

export function parseToolInput<N extends ToolName>(
  name: N,
  input: unknown,
): { ok: true; input: ToolInput<N> } | Extract<ToolResult<never>, { ok: false }> {
  const parsed = tools[name].input.safeParse(input);
  if (parsed.success) return { ok: true, input: parsed.data as ToolInput<N> };
  const result = failure("invalid_input", z.prettifyError(parsed.error));
  return result as Extract<ToolResult<never>, { ok: false }>;
}
