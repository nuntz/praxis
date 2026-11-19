import type { Author } from "./callers.ts";
import type { RunEnd, RunStart } from "./conversation.ts";
import type { Day } from "./day.ts";
import type { Accent } from "./deployment.ts";
import type { RecordKind } from "./effects.ts";
import { instantToIso, type Version } from "./entry.ts";
import type { Anchor, LinkTarget } from "./link.ts";
import type { RunFailure } from "./notice.ts";
import type { Recurrence, Weekday } from "./recurrence.ts";
import type { ClockTime } from "./settings.ts";
import type { End, WaitTarget } from "./task.ts";

/**
 * The Export (section 10.1, ADR 0018): the whole Deployment in a JSON format of Praxis's own, one
 * file for the Deployment and one per Context. `docs/export-format.md` documents it for whoever
 * reads a file outside Praxis; these types are the same format as the code holds it.
 *
 * The format is not the tables' (ADR 0019). A file is shaped as the domain is, so a restore can
 * read a file of any format version as old as format 1, bringing it forward as it reads.
 */

/** What every file of an Export is stamped with, so a file read alone says what it is. */
export const EXPORT_FORMAT = "praxis-export";

/**
 * The format version this code writes. A release that changes what a file holds or how makes
 * the next one, and the restore's ladder brings every earlier one forward (section 11).
 */
export const EXPORT_FORMAT_VERSION = 1;

/** The path of the Deployment's file within an Export. */
export const DEPLOYMENT_FILE = "deployment.json";

/** The path of a Context's file within an Export: its id, which is its object's. */
export function contextFilePath(id: string): string {
  return `contexts/${id}.json`;
}

/** What `make_export` returns: every file of one Export, the Deployment's first. */
export type Export = {
  format_version: typeof EXPORT_FORMAT_VERSION;
  /** When the person asked for it, as an ISO 8601 instant. */
  made_at: string;
  files: ExportFile[];
};

export type ExportFile = { path: string; content: DeploymentFile | ContextFile };

/** The stamp on every file, and the instant the Export was asked for. */
type Stamped = {
  format: typeof EXPORT_FORMAT;
  format_version: typeof EXPORT_FORMAT_VERSION;
  made_at: string;
};

/** The stamp every file of an Export asked for at `at` carries. */
export function exportStamp(at: number): Stamped {
  return {
    format: EXPORT_FORMAT,
    format_version: EXPORT_FORMAT_VERSION,
    made_at: instantToIso(at),
  };
}

/**
 * The Deployment's file: its Contexts as it lists them, the spend cap, what deleted Contexts spent,
 * and the Connections. Never a Device, a push subscription or a provider key.
 */
export type DeploymentFile = Stamped & {
  kind: "deployment";
  /** Every Context, retired or not, in the order they were made, with the path of its file. */
  contexts: ExportedContext[];
  /** The monthly cap in US dollars the person set, or null while they have set none. */
  spend_cap: number | null;
  /**
   * What Contexts since deleted spent in each calendar month (UTC), in US dollars, with no name
   * attached, so the month's count against the cap never goes down (section 10.4). A Context not
   * deleted is counted from its own Run records instead.
   */
  deleted_contexts_spend: MonthSpend[];
  /**
   * Every Connection ever made, in the order made. A restore brings each back ended: its name
   * stays as an Author, and the person makes the permission again at the new address.
   */
  connections: ExportedConnection[];
};

/** What was spent in one calendar month (YYYY-MM, UTC), in US dollars. */
export type MonthSpend = { month: string; dollars: number };

/** A Connection as the file holds it: not its standing, since a restore brings it back ended. */
export type ExportedConnection = { id: string; name: string; context_id: string };

export type ExportedContext = {
  id: string;
  name: string;
  accent: Accent;
  retired: boolean;
  // A Context's Notification switch (#68) joins the file, here or in its own file beside its time
  // zone, as section 10.1 lists it, once a Context has one.
  /** The path of its file within the Export. */
  file: string;
};

/**
 * A Context's file: its settings, its Journal with every record in the Trash too, the Trash with
 * each item's clock, and its Run records. Never the Conversation, the change log or the record of
 * a Connection's calls. Instants are ISO 8601, days YYYY-MM-DD.
 */
export type ContextFile = Stamped & {
  kind: "context";
  /** Its settings: when its Brief and Review come, in its time zone, each time null while off. */
  context: {
    id: string;
    name: string;
    time_zone: string;
    brief_time: ClockTime | null;
    review_day: Weekday;
    review_time: ClockTime | null;
  };
  /** In the order made, as are the lists after it. */
  entries: ExportedEntry[];
  tasks: ExportedTask[];
  projects: ExportedProject[];
  persons: ExportedPerson[];
  trash: ExportedTrashItem[];
  runs: ExportedRun[];
};

/** An Entry: its plain words exactly as typed, and its links as data beside them (ADR 0008). */
export type ExportedEntry = {
  id: string;
  words: string;
  at: string;
  author: Author;
  through_conversation: boolean;
  /** The id of the one earlier Entry it is a Follow-up to, or null. */
  follow_up_to: string | null;
  /** Its References and Mentions, in the order added. */
  links: ExportedLink[];
  /** Whether it carries a Standing mark. */
  standing: boolean;
  /** Every earlier state of its words, oldest first. Its version is how many there are. */
  versions: Version[];
};

/**
 * A Reference or Mention: what it names, and the span it was anchored to with the text that span
 * held, which the anchor follows through a change to the words. A span gone from the words is
 * kept as it was, and reads as no anchor.
 */
export type ExportedLink = { to: LinkTarget; anchor: (Anchor & { text: string }) | null };

/** A Task, with every event that happened to it, oldest first. Its state is derived from them. */
export type ExportedTask = {
  id: string;
  title: string;
  origin_entry: string;
  at: string;
  author: Author;
  project: string | null;
  due_date: Day | null;
  defer_date: Day | null;
  recurrence: Recurrence | null;
  events: ExportedTaskEvent[];
};

export type ExportedTaskEvent =
  | { what: End | "reopened" | "taken_back"; at: string }
  | { what: "delegated"; at: string; person: string }
  | { what: "waited_on" | "stopped_waiting" | "released"; at: string; on: WaitTarget };

/** A Project, with what was declared of it, oldest first. Its state is derived from that. */
export type ExportedProject = {
  id: string;
  name: string;
  at: string;
  due_date: Day | null;
  events: { what: End | "reopened"; at: string }[];
};

export type ExportedPerson = { id: string; name: string; at: string };

/** A record as the Trash and the file name it: its kind and id. */
export type ExportedRecord = { kind: RecordKind; id: string };

/**
 * What one delete sent to the Trash: the record deleted, what went with it, and the delete's
 * instant, which its clock counts from across a restore. Its records are in their own lists.
 */
export type ExportedTrashItem = {
  deleted: ExportedRecord;
  went_with: ExportedRecord[];
  at: string;
  /**
   * The links from Tasks not in the Trash to a record in this item, which the delete took away and
   * a restore brings back: a Task's place in a Project, its delegation, or a wait.
   */
  dormant_links: { task: string; what: "project" | "delegation" | "wait"; to: ExportedRecord }[];
};

/**
 * A Run record (section 5.8): what started it, when, the model, tokens, cost and how it ended. It
 * holds no words, and nothing of the Conversation or the change log, which the file does not hold.
 */
export type ExportedRun = {
  id: string;
  started_by: RunStart;
  at: string;
  model: string;
  tokens: { input: number; output: number; cache_read: number; cache_write: number };
  /** In US dollars, by the price table shipped with the code that ran it. */
  cost: number;
  /** How it ended, or null for one still going when the file was made. */
  ended: RunEnd | null;
  failure: RunFailure | null;
};
