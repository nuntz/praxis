import {
  type Attention,
  type Author,
  type Entry,
  type Person,
  type Project,
  type Recurrence,
  type Task,
  weekdays,
} from "@praxis/domain";
import { z } from "zod";

// The records an Offline Copy holds, as stored.ts reads them back (section 8.8): each schema
// builds every field of the domain's type it stands for, and drops anything else, so what a later
// release reads is what this one shows. Each is held to its type, so a field the domain adds fails
// the typecheck here until it is read, and the stored shape changes with a fixture of its own
// (CODING_STANDARDS.md, Upgrades). Nothing here touches the browser's storage.

const text = z.string();
const instant = z.string();
const day = z.string();
const count = z.number();

const author = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("person") }),
  z.object({ kind: z.literal("agent") }),
  z.object({ kind: z.literal("connection"), name: text }),
]) satisfies z.ZodType<Author>;

const recurrence = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("days"), every: count, from: day }),
  z.object({ kind: z.literal("weeks"), every: count, on: z.array(z.enum(weekdays)), from: day }),
  z.object({
    kind: z.literal("months"),
    every: count,
    on: z.union([count, z.literal("last")]),
    from: day,
  }),
  z.object({ kind: z.literal("years"), every: count, from: day }),
  z.object({
    kind: z.literal("interval"),
    every: count,
    unit: z.enum(["days", "weeks", "months", "years"]),
  }),
]) satisfies z.ZodType<Recurrence>;

const end = z.enum(["finished", "dropped"]);

const waitedOn = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task"), id: text, title: text }),
  z.object({ kind: z.literal("project"), id: text, name: text }),
]);

const taskState = z.union([
  z.object({
    is: z.literal("open"),
    actionable: z.boolean(),
    waiting: z.array(z.object({ on: waitedOn, since: instant })).nullable(),
    delegated: z.object({ to: z.object({ id: text, name: text }), since: instant }).nullable(),
    deferred: z.object({ until: day }).nullable(),
    overdue: z.object({ since: day }).nullable(),
  }),
  z.object({ is: end, at: instant }),
]);

const task = z.object({
  id: text,
  title: text,
  origin_entry: text,
  at: instant,
  author,
  project: text.nullable(),
  due_date: day.nullable(),
  defer_date: day.nullable(),
  recurrence: recurrence.nullable(),
  state: taskState,
}) satisfies z.ZodType<Task>;

const project = z.object({
  id: text,
  name: text,
  at: instant,
  due_date: day.nullable(),
  state: z.union([
    z.object({ is: z.literal("open"), overdue: z.object({ since: day }).nullable() }),
    z.object({ is: end, at: instant }),
  ]),
  tasks: z.array(task),
}) satisfies z.ZodType<Project>;

const person = z.object({
  id: text,
  name: text,
  at: instant,
  latest_mention: z.object({ entry: text, at: instant, summary: text }).nullable(),
}) satisfies z.ZodType<Person>;

const entryNamed = z.object({
  id: text,
  summary: text,
  deleted: z.literal(true).exactOptional(),
});

const link = z.object({
  kind: z.enum(["reference", "mention"]),
  to: z.object({
    kind: z.enum(["task", "project", "person"]),
    id: text,
    summary: text,
    deleted: z.literal(true).exactOptional(),
  }),
  anchor: z.object({ start: count, end: count }).nullable(),
});

const entry = z.object({
  id: text,
  words: text,
  at: instant,
  author,
  through_conversation: z.boolean(),
  tasks: z.array(task),
  links: z.array(link),
  version: count,
  edited: z.object({ by: author, at: instant }).nullable(),
  follow_up_to: entryNamed.nullable(),
  follow_ups: z.array(entryNamed),
  standing: z.boolean(),
}) satisfies z.ZodType<Entry>;

const attention = z.object({
  due: z.array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("task"), task }),
      z.object({ kind: z.literal("project"), project }),
    ]),
  ),
  newly_actionable: z.array(
    z.object({
      task,
      came_up: z.union([
        z.object({ because: z.enum(["wait_ended", "taken_back"]), at: instant }),
        z.object({ because: z.literal("defer_date_came"), on: day }),
      ]),
    }),
  ),
  delegated: z.array(task),
  projects: z.array(z.object({ project, actionable_tasks: count, no_open_task: z.boolean() })),
  loose: z.array(task),
}) satisfies z.ZodType<Attention>;

/** What an Offline Copy holds of one Context that is not retired, as last fetched. */
export type ContextCopy = {
  /** The Context's id. */
  id: string;
  /** When this part was fetched, as an ISO 8601 instant: it is shown as last fetched then. */
  fetched_at: string;
  /** Its time zone, so today and the Entries' times are its own with no network. */
  time_zone: string;
  /** What `view_attention` gave. */
  attention: Attention;
  /** Every open Task, newest first. */
  tasks: Task[];
  /** Every open Project, newest first, each with its Tasks. */
  projects: Project[];
  /** Every Person, newest first. */
  persons: Person[];
  /** The Standing Entries, newest first. */
  standing: Entry[];
  /** The last 30 days of Entries and every older one this Device opened, newest first. */
  entries: Entry[];
  /** The older Entries this Device opened, by id, kept in the copy as long as they are there. */
  opened: string[];
};

/**
 * The Offline Copy this Device keeps (section 8.8, ADR 0020): a fixed set of each Context's
 * Journal, to read with no network, and never any Conversation text or image.
 */
export type OfflineCopy = {
  /** Each Context not retired, as last fetched, each part kept as it was: none until fetched. */
  contexts: ContextCopy[];
};

const contextCopy = z.object({
  id: text,
  fetched_at: instant,
  time_zone: text,
  attention,
  tasks: z.array(task),
  projects: z.array(project),
  persons: z.array(person),
  standing: z.array(entry),
  entries: z.array(entry),
  opened: z.array(text),
}) satisfies z.ZodType<ContextCopy>;

const offlineCopy = z.object({
  contexts: z.array(contextCopy),
}) satisfies z.ZodType<OfflineCopy>;

/** An Offline Copy as stored, or null for anything else: it is fetched again on the next contact. */
export function readOfflineCopy(stored: unknown): OfflineCopy | null {
  const read = offlineCopy.safeParse(stored);
  return read.success ? read.data : null;
}
