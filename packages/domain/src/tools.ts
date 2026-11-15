import { z } from "zod";
import type { CallerKind } from "./callers.ts";
import type { ChangesPage, Written } from "./effects.ts";
import type { Entry, Page } from "./entry.ts";
import { failure, type ToolResult } from "./results.ts";

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

/** The Context tools. The schemas live here; the tools run inside a Context's object. */
export const tools = {
  record_entry: {
    kind: "write",
    description: "Record an Entry in the Journal. The words are kept exactly as given.",
    input: writeInput({ words }),
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
