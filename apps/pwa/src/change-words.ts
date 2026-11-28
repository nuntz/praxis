import type {
  Caller,
  ConnectionCall,
  ConversationToolName,
  conversationTools,
  Effect,
  EffectKind,
  ErrorCode,
  RecordKind,
  ToolName,
  tools,
} from "@praxis/domain";

/**
 * What each kind of thing an Effect names is called, in the glossary's words: one, and several,
 * as a rule's Effects folded into one line count them.
 */
const KIND: Record<EffectKind, { one: string; several: string }> = {
  entry: { one: "Entry", several: "Entries" },
  task: { one: "Task", several: "Tasks" },
  project: { one: "Project", several: "Projects" },
  person: { one: "Person", several: "Persons" },
  context: { one: "Context", several: "Contexts" },
  held_change: { one: "Held Change", several: "Held Changes" },
  connection: { one: "Connection", several: "Connections" },
  device: { one: "Device", several: "Devices" },
  spend_cap: { one: "The spend cap", several: "spend caps" },
};

const RECORDS: ReadonlySet<EffectKind> = new Set<RecordKind>([
  "entry",
  "task",
  "project",
  "person",
]);

/**
 * What happened to what an Effect names, in the glossary's words (GLOSSARY.md, Effect): the change
 * log keeps only made, changed or deleted, so the tool of the change it is in says which. A record
 * deleted by a delete went to the Trash, and one deleted from the Trash is removed for good; a
 * Held Change made is left, and one deleted is made by the tap, cancelled, or lapsed by rule. A
 * rule's part is said, but for a lapse, which only a rule does. `count` is how many it says it of,
 * for a rule's Effects folded into one line.
 */
function happened(tool: string, effect: Effect, count: number): string {
  const byRule = effect.by === "rule" ? " by a rule" : "";
  if (effect.kind === "held_change") {
    if (effect.what === "made") return `left${byRule}`;
    if (effect.what === "deleted") {
      if (effect.by === "rule") return "lapsed";
      if (tool === "make_held_change") return "made by your tap";
      if (tool === "cancel_held_change") return "cancelled";
    }
  } else if (RECORDS.has(effect.kind)) {
    if (effect.what === "deleted") {
      if (tool.startsWith("delete_") || tool === "make_held_change") {
        return `sent to the Trash${byRule}`;
      }
      if (tool === "remove_for_good" || tool === "empty_trash") {
        return `removed for good${byRule}: ${count === 1 ? "its" : "their"} words are gone`;
      }
    }
    if (effect.what === "made" && tool === "restore") return `restored from the Trash${byRule}`;
    if (effect.what === "changed" && effect.kind === "entry" && tool === "restore_entry_version") {
      return `words restored to a Version${byRule}`;
    }
  }
  return `${effect.what}${byRule}`;
}

/** One Effect of a change made with this tool, as Changes says it: "Entry sent to the Trash". */
export function effectWords(tool: string, effect: Effect): string {
  return `${KIND[effect.kind].one} ${happened(tool, effect, 1)}`;
}

/**
 * A line of a change's Effects: one Effect, or a rule's Effects of one kind and what folded into
 * one, which opens in place to list each by its summary.
 */
export type EffectLine =
  | { kind: "one"; words: string; summary: string }
  | { kind: "folded"; words: string; summaries: string[] };

/**
 * A change's Effects as Changes lists them, in order: each the call made one line of its own, and
 * a rule's of one kind and what that follow one another folded into one, as the 30 Tasks deleting
 * an Entry sends with it to the Trash fold into "and 30 Tasks sent to the Trash by a rule". Only
 * those together fold, so each item emptied from the Trash keeps what went with it. A rule's that
 * has none like it beside it stays a line of its own.
 */
export function effectLines(tool: string, effects: Effect[]): EffectLine[] {
  const runs: Effect[][] = [];
  for (const effect of effects) {
    const run = runs.at(-1);
    const joins =
      run !== undefined &&
      effect.by === "rule" &&
      run[0]?.by === "rule" &&
      foldKey(tool, run[0]) === foldKey(tool, effect);
    if (joins) run.push(effect);
    else runs.push([effect]);
  }
  return runs.map((run, index): EffectLine => {
    const [first] = run as [Effect, ...Effect[]];
    if (run.length === 1) {
      return { kind: "one", words: effectWords(tool, first), summary: first.summary };
    }
    const counted = `${run.length} ${KIND[first.kind].several} ${happened(tool, first, run.length)}`;
    return {
      kind: "folded",
      words: index === 0 ? counted : `and ${counted}`,
      summaries: run.map((each) => each.summary),
    };
  });
}

/** What a rule's Effects fold by: what they name the kind of, and what happened to it. */
const foldKey = (tool: string, effect: Effect) => `${effect.kind} ${happened(tool, effect, 1)}`;

/** A caller as Changes names them. */
export function callerName(caller: Caller): string {
  switch (caller.kind) {
    case "hand":
      return "You";
    case "agent":
      return "The Agent";
    case "clock":
      return "The clock";
    case "connection":
    case "read_only_connection":
      return caller.name;
  }
}

/**
 * Who made a change, as its line names them: its caller, and for the person's tap on a Held
 * Change, the Agent it was made for, since its Version and edited mark name the Agent (section
 * 4.7).
 */
export function changeCaller(caller: Caller, tool: string): string {
  const name = callerName(caller);
  return tool === "make_held_change" ? `${name}, for the Agent` : name;
}

/** The tools of a Context and of its Conversation that read. */
type ReadToolName =
  | { [N in ToolName]: (typeof tools)[N]["kind"] extends "read" ? N : never }[ToolName]
  | {
      [N in ConversationToolName]: (typeof conversationTools)[N]["kind"] extends "read" ? N : never;
    }[ConversationToolName];

/**
 * What each read did, in words, as a Connection's read in Changes says it. Every read tool has its
 * own, so a new one says what it does. A Connection is offered no Conversation tool, but one it
 * asks for anyway is kept with its refusal.
 */
const READ: Record<ReadToolName, string> = {
  get_entry: "Read an Entry",
  list_entries: "Listed Entries",
  list_entry_versions: "Listed an Entry's Versions",
  get_task: "Read a Task",
  list_tasks: "Listed Tasks",
  get_project: "Read a Project",
  list_projects: "Listed Projects",
  get_person: "Read a Person",
  list_persons: "Listed Persons",
  get_settings: "Read the Context's settings",
  view_attention: "Viewed Attention",
  view_ahead: "Viewed the weeks ahead",
  search: "Searched",
  list_trash: "Listed the Trash",
  list_held_changes: "Listed the Held Changes",
  list_notices: "Listed the Notices",
  list_runs: "Listed the Agent's Runs",
  get_run: "Read a Run",
  list_connection_calls: "Listed the Connections' calls",
  get_move_unit: "Read what a move would take",
  list_changes: "Listed the Changes",
  list_messages: "Read the Conversation",
};

/** Each answer other than ok, said as what happened to the request. */
const ANSWERED: Record<ErrorCode, string> = {
  not_found: "what it asked for is not there",
  invalid_input: "the request was malformed",
  not_offered: "that tool is not offered to it",
  held: "the change waits for your tap",
  stale: "it asked of a Version no longer current",
  refused: "the request was refused",
};

/**
 * One read by a Connection, as Changes says it: what it did, and how many records came back or
 * what it was answered, "Searched: 3 records".
 */
export function readWords(call: ConnectionCall): string {
  if (call.tool === null) return "Called a tool Praxis does not have";
  const did = Object.hasOwn(READ, call.tool)
    ? READ[call.tool as ReadToolName]
    : `Read with ${call.tool}`;
  const answered =
    call.result === "ok"
      ? `${call.records} ${call.records === 1 ? "record" : "records"}`
      : ANSWERED[call.result];
  return `${did}: ${answered}`;
}
