import { z } from "zod";
import type { Caller, CallerKind } from "./callers.ts";
import type { RunTranscript } from "./conversation.ts";
import { timeZone } from "./day.ts";
import { type Device, pushSubscription } from "./device.ts";
import type { Written } from "./effects.ts";
import type { Export, LastBackup } from "./export.ts";
import type { Moved } from "./move.ts";
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

/**
 * What `restore_export` brought back (section 10.2): each Context as the Deployment now lists it,
 * under its new id, and each Connection, ended.
 */
export type Restored = { contexts: ContextListing[]; connections: Connection[] };

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

/** A Device's id, as its browser keeps it. */
const deviceId = z.string().min(1).max(100);

/** A Device's name: one line, kept exactly as given. */
const deviceName = z
  .string()
  .refine((value) => value.trim().length > 0, { message: "A Device needs a name." })
  .refine((value) => !/[\r\n]/.test(value), { message: "A Device's name is one line." });

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
  delete_context: {
    kind: "write",
    description:
      "Delete a retired Context for good, given its name as the person typed it: everything in it goes, with its Run records, its part of the meaning index and its Connections, and there is no Trash and no way back. Its spend stays in the month's count, with no name attached. A Context not retired is refused, as is a name that is not its own, and so is one where a Run is going or one holding a record on its way out to another Context.",
    input: writeInput({ id, name: z.string() }),
  },
  move_record: {
    kind: "write",
    description:
      "Move an Entry or a Project, with its whole unit, from one Context to another, keeping every id, Version, Recurrence and Author. Give `unit` as the ids get_move_unit gave in the Context moved from, which the person saw: when what would move is no longer that, the move is refused, and so it is while a Task from an Entry that would move is in the Trash. What links across the boundary is dropped, the words kept: Mentions, References, waits and delegations, a place in a Project that stays, a Follow-up link to an Entry that stays, and a Standing mark. Nothing is made in the Context moved to and nothing there is matched by name. A move into a Context whose object does not answer, as one stuck on an upgrade, is refused with nothing moved.",
    input: writeInput({
      from: id,
      to: id,
      record: z.strictObject({ kind: z.enum(["entry", "project"]), id }),
      unit: z.array(id).min(1),
    }),
  },
  list_connections: {
    kind: "read",
    description:
      "List the Connections not ended, in the order they were made, each with its name, its Context, whether it reads only and its address. Give `ended: true` to list the ended ones too, in their place, each marked ended, since an ended Connection's name stays on what it made.",
    input: z.strictObject({ ended: z.boolean().optional() }),
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
  list_devices: {
    kind: "read",
    description:
      "List the Devices Praxis keeps a record of, those with Notifications or an Offline Copy switched on, in the order they were first switched on, each with its name and when it was last seen, and the public key a browser subscribes to Notifications with: null when the Deployment has none.",
    input: z.strictObject({}),
  },
  rename_device: {
    kind: "write",
    description: "Change a Device's name. Renaming it to the name it has changes nothing.",
    input: writeInput({ id: deviceId, name: deviceName }),
  },
  set_device_notifications: {
    kind: "write",
    description:
      "Switch Notifications on or off for a Device, by the id its browser keeps. Switched on, it is listed, with the push subscription its browser gave and named from its browser and system by the user agent, and is sent a Notification when the Agent leaves a Brief or a Review in a Context whose switch is on. Switched off with nothing else on there, it leaves the list. Giving it what it has changes nothing.",
    input: writeInput({
      id: deviceId,
      on: z.boolean(),
      subscription: pushSubscription.optional(),
      user_agent: z.string().optional(),
    }).refine((input) => !input.on || (input.subscription && input.user_agent !== undefined), {
      message: "Switching Notifications on takes the browser's push subscription and user agent.",
    }),
  },
  set_device_offline_copy: {
    kind: "write",
    description:
      "Switch the Offline Copy on or off for a Device, by the id its browser keeps: a fixed set of each Context's Journal that the Device keeps to read with no network. Switched on, it is listed, named from its browser and system by the user agent. Switched off, the Device clears its copy on its next contact, and with nothing else on there it leaves the list. Giving it what it has changes nothing.",
    input: writeInput({
      id: deviceId,
      on: z.boolean(),
      user_agent: z.string().optional(),
    }).refine((input) => !input.on || input.user_agent !== undefined, {
      message: "Switching the Offline Copy on takes the browser's user agent.",
    }),
  },
  remove_device: {
    kind: "write",
    description:
      "Remove a Device, from any Device: everything switched on there is switched off, and it leaves the list, so it clears its Offline Copy on its next contact. It is not signed out, since the sign-in is Access's.",
    input: writeInput({ id: deviceId }),
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
  make_export: {
    kind: "read",
    description:
      "Make an Export: the whole Deployment as files in Praxis's own JSON format, stamped with its format version, one for the Deployment and one per Context, retired ones too. It holds each Context's Journal with its Versions, the Trash with each item's clock and the Run records; never a Conversation, the change log, the record of a Connection's calls, a Device or a provider key. There is no Export of one Context.",
    input: z.strictObject({}),
  },
  restore_export: {
    kind: "write",
    description:
      "Restore an Export, or a Backup, during setup: the whole Deployment it holds comes back into this one, which must hold nothing yet, every record under its id. Give `file` as the zip's bytes in base64. Each Context comes back with its Journal, its Versions, its Trash and its Run records, under a new id, since its object is new; each Connection comes back ended, its name staying as an Author. What has been in the Trash 30 days since its delete is removed for good as it comes back. A file of an older format is brought forward as it is read, and one of a newer format is refused. There is no merge, and no restoring one Context.",
    input: writeInput({
      file: z.string().min(1, { message: "An Export's file is its zip, in base64." }),
    }),
  },
  get_last_backup: {
    kind: "read",
    description:
      "Read when the last daily Backup was made, or null while none has been. A Backup is the Export's file, made by the system once a day and kept 30 days.",
    input: z.strictObject({}),
  },
  save_run_transcript: {
    kind: "read",
    description:
      "Save a Run Transcript: a file of one Run, for debugging, holding the prompt and the tools it was offered, the Message it answered as the model was shown it, each answer of the model with its calls, and each call's result. It is the only way a Conversation's text leaves Praxis, and is not an Export. A Run still going, one never started and one whose Conversation was cleared have none.",
    input: z.strictObject({ context_id: id, run_id: id }),
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
  /** Null: the Context is gone. */
  delete_context: Written<null>;
  move_record: Written<Moved>;
  list_connections: { items: Connection[] };
  create_connection: Written<Connection>;
  rename_connection: Written<Connection>;
  set_connection_reading_only: Written<Connection>;
  end_connection: Written<Connection>;
  list_devices: { items: Device[]; push_key: string | null };
  rename_device: Written<Device>;
  /** The Device as it now is, or null once it has left the list. */
  set_device_notifications: Written<Device | null>;
  /** The Device as it now is, or null once it has left the list. */
  set_device_offline_copy: Written<Device | null>;
  /** Null: the Device has left the list. */
  remove_device: Written<null>;
  get_spend: Spend;
  set_spend_cap: Written<SpendCap>;
  make_export: Export;
  restore_export: Written<Restored>;
  get_last_backup: LastBackup;
  save_run_transcript: RunTranscript;
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
