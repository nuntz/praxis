import { z } from "zod";
import type { Caller, CallerKind } from "./callers.ts";
import { timeZone } from "./day.ts";
import type { Written } from "./effects.ts";
import type { Spend, SpendCap } from "./spend.ts";
import { type Parsed, parseInput, writeInput } from "./tools.ts";

/** The fixed set of Context accents (section 8.11). A Context has one, and nothing else does. */
export const ACCENTS = ["blue", "rust", "teal", "plum", "moss", "slate"] as const;
export type Accent = (typeof ACCENTS)[number];

/**
 * A Context as the Deployment object lists it: its name and accent, and whether it is retired.
 * Nothing from its Journal, and not its time zone, which its own object keeps (section 4.11).
 */
export type ContextListing = {
  id: string;
  name: string;
  accent: Accent;
  /** A retired Context is hidden and keeps everything. The person can bring it back. */
  retired: boolean;
};

/**
 * A Connection, as the Deployment object keeps it (section 7.2): the person's standing permission
 * for an outside agent to work in one Context. Not a record. Its Context never changes.
 */
export type Connection = {
  /** Opaque, and in its address. It never names the Context. */
  id: string;
  /** The Author of what it makes, kept on that after it ends. */
  name: string;
  context_id: string;
  /** Limited to reading, it is offered only the reading tools. The one thing switched later. */
  reading_only: boolean;
  /**
   * Where an outside agent reaches it: a path under `/mcp` on the Deployment's own hostname,
   * which the person pastes into the client. It is not a secret: Access stands in front of it.
   */
  address: string;
  /** An ended Connection is refused on its next call, and is never brought back. */
  ended: boolean;
};

/** The path a Connection is reached at over MCP, holding its id and nothing else. */
export function connectionAddress(id: string): string {
  return `/mcp/${id}`;
}

/** A Context's name: one line, kept exactly as given. */
const contextName = z
  .string()
  .refine((value) => value.trim().length > 0, { message: "A Context needs a name." })
  .refine((value) => !/[\r\n]/.test(value), { message: "A Context's name is one line." });

const accent = z.enum(ACCENTS, {
  message: `An accent is one of ${ACCENTS.join(", ")}.`,
});

/** A Context's id, as `list_contexts` gives it, or a Connection's, as `list_connections` does. */
const id = z.string().min(1);

/** A Connection's name: one line, kept exactly as given. */
const connectionName = z
  .string()
  .refine((value) => value.trim().length > 0, { message: "A Connection needs a name." })
  .refine((value) => !/[\r\n]/.test(value), { message: "A Connection's name is one line." });

/** A spend cap in US dollars a month, more than nothing. */
const cap = z
  .number({ message: "A spend cap is an amount of US dollars." })
  .positive({ message: "A spend cap is more than nothing." });

/**
 * The Deployment tools (section 4.11). They run on the Deployment object and are offered to the
 * person's hand only, never to the Agent or a Connection in any form.
 */
export const deploymentTools = {
  list_contexts: {
    kind: "read",
    description:
      "List the Deployment's Contexts in the order they were made, each with its name, its accent and whether it is retired.",
    input: z.strictObject({}),
  },
  create_context: {
    kind: "write",
    description:
      "Make a Context with its name, its time zone (a zone of the IANA database, which the screen fills with its Device's) and its accent.",
    input: writeInput({ name: contextName, time_zone: timeZone, accent }),
  },
  rename_context: {
    kind: "write",
    description: "Change a Context's name. Renaming it to the name it has changes nothing.",
    input: writeInput({ id, name: contextName }),
  },
  set_context_accent: {
    kind: "write",
    description: "Change a Context's accent. Giving it the accent it has changes nothing.",
    input: writeInput({ id, accent }),
  },
  retire_context: {
    kind: "write",
    description:
      "Retire a Context: it is hidden and nothing in it is deleted. The last Context not retired cannot be retired, since there is always one. Retiring a retired Context changes nothing.",
    input: writeInput({ id }),
  },
  bring_back_context: {
    kind: "write",
    description:
      "Bring a retired Context back, as it was. Bringing back one that is not retired changes nothing.",
    input: writeInput({ id }),
  },
  list_connections: {
    kind: "read",
    description:
      "List the Connections not ended, in the order they were made, each with its name, its Context, whether it reads only and its address.",
    input: z.strictObject({}),
  },
  create_connection: {
    kind: "write",
    description:
      "Make a Connection for an outside agent to work in one Context, which never changes, limited to reading or not. It is given an address under /mcp to paste into the client.",
    input: writeInput({ name: connectionName, context_id: id, reading_only: z.boolean() }),
  },
  rename_connection: {
    kind: "write",
    description:
      "Change a Connection's name, which is the Author of what it makes from then on. Renaming it to the name it has changes nothing.",
    input: writeInput({ id, name: connectionName }),
  },
  set_connection_reading_only: {
    kind: "write",
    description:
      "Limit a Connection to reading, or lift the limit, from its next call on. Setting what it is already changes nothing.",
    input: writeInput({ id, reading_only: z.boolean() }),
  },
  end_connection: {
    kind: "write",
    description:
      "End a Connection: its next call is refused, and it is never brought back. Its name stays on what it made. Ending one already ended changes nothing.",
    input: writeInput({ id }),
  },
  get_spend: {
    kind: "read",
    description:
      "Read what the Deployment has spent this calendar month (UTC) on the model, in US dollars, against its monthly cap, and the standing Notice that gives: the cap nearly reached past 80% of it, or the cap reached, when no new Run starts.",
    input: z.strictObject({}),
  },
  set_spend_cap: {
    kind: "write",
    description:
      "Set the Deployment's monthly spend cap, in US dollars. It takes effect at once: raising it past what was spent lets Runs start again. Setting the cap it has changes nothing.",
    input: writeInput({ cap }),
  },
} as const;

export type DeploymentToolName = keyof typeof deploymentTools;

export const deploymentToolNames = Object.keys(deploymentTools) as DeploymentToolName[];

export function isDeploymentToolName(name: string): name is DeploymentToolName {
  return Object.hasOwn(deploymentTools, name);
}

/** Every Deployment tool is offered to the person's hand, and to no other caller. */
export function offeredDeploymentTool(caller: Caller | CallerKind): boolean {
  return (typeof caller === "string" ? caller : caller.kind) === "hand";
}

export type DeploymentToolInput<N extends DeploymentToolName> = z.infer<
  (typeof deploymentTools)[N]["input"]
>;

/** What each Deployment tool returns on success. */
export type DeploymentToolOutput = {
  list_contexts: { items: ContextListing[] };
  create_context: Written<ContextListing>;
  rename_context: Written<ContextListing>;
  set_context_accent: Written<ContextListing>;
  retire_context: Written<ContextListing>;
  bring_back_context: Written<ContextListing>;
  list_connections: { items: Connection[] };
  create_connection: Written<Connection>;
  rename_connection: Written<Connection>;
  set_connection_reading_only: Written<Connection>;
  end_connection: Written<Connection>;
  get_spend: Spend;
  set_spend_cap: Written<SpendCap>;
};

export function parseDeploymentToolInput<N extends DeploymentToolName>(
  name: N,
  input: unknown,
): Parsed<DeploymentToolInput<N>> {
  return parseInput(deploymentTools[name].input, input);
}

/** Whether a Deployment tool changes something, and so takes a key. */
export function isDeploymentWrite(name: DeploymentToolName): boolean {
  return deploymentTools[name].kind === "write";
}
