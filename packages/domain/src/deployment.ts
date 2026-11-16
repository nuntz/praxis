import { z } from "zod";
import type { Caller, CallerKind } from "./callers.ts";
import { timeZone } from "./day.ts";
import type { Written } from "./effects.ts";
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

/** A Context's name: one line, kept exactly as given. */
const contextName = z
  .string()
  .refine((value) => value.trim().length > 0, { message: "A Context needs a name." })
  .refine((value) => !/[\r\n]/.test(value), { message: "A Context's name is one line." });

const accent = z.enum(ACCENTS, {
  message: `An accent is one of ${ACCENTS.join(", ")}.`,
});

/** A Context's id, as `list_contexts` gives it. */
const id = z.string().min(1);

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
