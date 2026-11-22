import type { Ahead } from "./ahead.ts";
import type { Attention } from "./attention.ts";
import type { Caller } from "./callers.ts";
import { conversationTools, isConversationToolName } from "./conversation.ts";
import { daysBefore } from "./day.ts";
import type { ErrorCode } from "./results.ts";
import { isToolName, type ToolName, type ToolOutput, tools } from "./tools.ts";

/**
 * One call a Connection made, as its record keeps it (sections 7.3 and 10.5): the tool, the time,
 * the result code and how many records came back, and never the text of what it sent or was
 * given. Reads are kept as writes are, so the person sees what an outside agent read.
 */
export type ConnectionCall = {
  /** When the call arrived, as an ISO 8601 instant. */
  at: string;
  /** The Connection, by its id, and by the name it had and whether it read only when it called. */
  caller: ConnectionCaller;
  /**
   * The tool it called, or null for a name that is no tool of Praxis's, which is kept as none,
   * since it is text the Connection sent.
   */
  tool: string | null;
  /** Whether the tool reads or writes, or null for a name that is no tool. */
  kind: "read" | "write" | null;
  /** `ok`, or the code of the error it was answered with (section 4.3). */
  result: "ok" | ErrorCode;
  /**
   * How many records came back: the Entries, Tasks, Projects and Persons in the answer, each once.
   * None for an error.
   */
  records: number;
};

/** A caller that is a Connection, reading only or not. */
export type ConnectionCaller = Extract<Caller, { kind: "connection" | "read_only_connection" }>;

/** Whether a caller is an outside agent through a Connection. */
export function isConnection(caller: Caller): caller is ConnectionCaller {
  return caller.kind === "connection" || caller.kind === "read_only_connection";
}

/**
 * Whether a tool of a Context, a Context tool or a Conversation tool, reads or writes, or null for
 * a name that is no such tool, which the record keeps as none.
 */
export function toolKind(name: string): "read" | "write" | null {
  if (isToolName(name)) return tools[name].kind;
  if (isConversationToolName(name)) return conversationTools[name].kind;
  return null;
}

/** Days the record of a Connection's calls is kept. */
export const CONNECTION_CALL_DAYS = 90;

/** A Connection's call that arrived at or before the instant this returns is pruned by `at`. */
export function connectionCallsPrunedBy(at: number): number {
  return daysBefore(at, CONNECTION_CALL_DAYS);
}

/** Its items, for a list of records or of what each holds one, as a search hit or a Trash item. */
const listed = (output: { items: unknown[] }) => output.items.length;

/** One record, for a read of one or a write, which returns the record it changed. */
const one = () => 1;

/**
 * No record: what came back is something else, as a Context's settings, a Version, a change, a
 * Held Change, a Run record or a Notice are.
 */
const none = () => 0;

/** The records Attention lists, each once: a Project in Due is in Projects too. */
function attentionRecords(attention: Attention): number {
  return new Set([
    ...attention.due.map((item) => (item.kind === "task" ? item.task.id : item.project.id)),
    ...attention.newly_actionable.map(({ task }) => task.id),
    ...attention.delegated.map((task) => task.id),
    ...attention.projects.map(({ project }) => project.id),
    ...attention.loose.map((task) => task.id),
  ]).size;
}

/**
 * The records the weeks ahead list, each once: a Task with both its dates ahead is listed twice,
 * and a future Occurrence is no record, since it does not exist until made (section 3.5).
 */
function aheadRecords(ahead: Ahead): number {
  return new Set(
    ahead.items.flatMap((item) =>
      item.kind === "task" ? [item.task.id] : item.kind === "project" ? [item.project.id] : [],
    ),
  ).size;
}

/**
 * How many records each Context tool gives back on success, for the record of a Connection's
 * calls: the Entries, Tasks, Projects and Persons in it, each once. Every tool has its own line,
 * so a new one says what it counts.
 */
const RECORDS_RETURNED: { [N in ToolName]: (output: ToolOutput[N]) => number } = {
  record_entry: one,
  get_entry: one,
  list_entries: listed,
  edit_entry: (output) => ("held" in output ? 0 : 1),
  restore_entry_version: (output) => ("held" in output ? 0 : 1),
  delete_entry: (output) => ("held" in output ? 0 : 1),
  list_entry_versions: none,
  add_link: one,
  remove_link: one,
  mark_standing: one,
  unmark_standing: one,
  add_task: one,
  finish_task: one,
  drop_task: one,
  reopen_task: one,
  rename_task: one,
  set_task_dates: one,
  set_recurrence: one,
  remove_recurrence: one,
  delegate_task: one,
  take_back_task: one,
  wait_on: one,
  stop_waiting: one,
  delete_task: one,
  get_task: one,
  list_tasks: listed,
  move_task: one,
  make_project_from_task: one,
  create_project: one,
  rename_project: one,
  set_project_due_date: one,
  finish_project: one,
  drop_project: one,
  reopen_project: one,
  delete_project: one,
  get_project: one,
  list_projects: listed,
  create_person: one,
  rename_person: one,
  delete_person: one,
  get_person: one,
  list_persons: listed,
  get_settings: none,
  set_time_zone: none,
  set_brief_time: none,
  set_review_time: none,
  set_notifications: none,
  view_attention: attentionRecords,
  view_ahead: aheadRecords,
  search: listed,
  rebuild_search_index: none,
  clear_conversation: none,
  restore: one,
  remove_for_good: none,
  empty_trash: none,
  list_trash: listed,
  list_changes: none,
  make_held_change: none,
  cancel_held_change: none,
  list_held_changes: none,
  list_notices: none,
  list_runs: none,
  get_run: none,
  list_connection_calls: none,
  get_move_unit: (unit) => unit.unit.length,
};

/** How many records a successful call to this Context tool gave back. */
export function recordsReturned<N extends ToolName>(tool: N, output: ToolOutput[N]): number {
  return RECORDS_RETURNED[tool](output);
}
