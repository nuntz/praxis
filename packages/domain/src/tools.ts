import { z } from "zod";
import type { CallerKind } from "./callers.ts";
import type { ChangesPage, Written } from "./effects.ts";
import type { Entry, Page } from "./entry.ts";
import { failure, type ToolResult } from "./results.ts";
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

/** The Context tools. The schemas live here; the tools run inside a Context's object. */
export const tools = {
  record_entry: {
    kind: "write",
    description:
      "Record an Entry in the Journal. The words are kept exactly as given and never read for Tasks: each Task to make with the Entry is given in `tasks`, and has the Entry as its Origin Entry.",
    input: writeInput({ words, tasks: z.array(z.strictObject({ title })).optional() }),
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
  get_task: {
    kind: "read",
    description: "Get one Task by its id, with its derived state and the reason for it.",
    input: z.strictObject({ id: z.string().min(1) }),
    offered: toEveryCaller,
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
  add_task: Written<Task>;
  finish_task: Written<Task>;
  drop_task: Written<Task>;
  reopen_task: Written<Task>;
  rename_task: Written<Task>;
  get_task: Task;
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
