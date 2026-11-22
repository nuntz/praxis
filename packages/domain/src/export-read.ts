import { z } from "zod";
import { timeZone } from "./day.ts";
import { ACCENTS } from "./deployment.ts";
import {
  type ContextFile,
  contextFilePath,
  DEPLOYMENT_FILE,
  type DeploymentFile,
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  type ExportedContext,
} from "./export.ts";
import { FORMAT_STEPS } from "./format-steps/index.ts";
import { recurrenceStep, weekdays } from "./recurrence.ts";
import { failure, refusal, success, type ToolResult } from "./results.ts";
import { clockTime } from "./settings.ts";

/**
 * Reading an Export to restore it (section 10.2, ADR 0018): each file brought forward through the
 * format's own ladder to the version this code writes, checked against the format, and the
 * records caught moving between Contexts settled by id. The format's version is not the tables'
 * (ADR 0019), and its ladder reaches back to format 1 for good.
 */

/** A file of an Export as JSON reads it, before it is known to be one. */
type Unread = Record<string, unknown>;

if (FORMAT_STEPS.length !== EXPORT_FORMAT_VERSION - 1) {
  throw new Error("The Export's format ladder does not reach the format this code writes.");
}

const instant = z.iso.datetime({ precision: 3, message: "An instant is ISO 8601 in UTC." });
const day = z.iso.date();
const id = z.string().min(1);

const author = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("person") }),
  z.strictObject({ kind: z.literal("agent") }),
  z.strictObject({ kind: z.literal("connection"), name: z.string() }),
]);

const recordKind = z.enum(["entry", "task", "project", "person"]);
const record = z.strictObject({ kind: recordKind, id });
const waitTarget = z.strictObject({ kind: z.enum(["task", "project"]), id });

// As `set_recurrence` takes one, with the day a schedule counts from.
const every = recurrenceStep;
const recurrence = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("days"), every, from: day }),
  z.strictObject({
    kind: z.literal("weeks"),
    every,
    on: z.array(z.enum(weekdays)).min(1),
    from: day,
  }),
  z.strictObject({
    kind: z.literal("months"),
    every,
    on: z.union([z.int().min(1).max(31), z.literal("last")]),
    from: day,
  }),
  z.strictObject({ kind: z.literal("years"), every, from: day }),
  z.strictObject({
    kind: z.literal("interval"),
    every,
    unit: z.enum(["days", "weeks", "months", "years"]),
  }),
]);

const entry = z.strictObject({
  id,
  words: z.string(),
  at: instant,
  author,
  through_conversation: z.boolean(),
  follow_up_to: id.nullable(),
  links: z.array(
    z.strictObject({
      to: z.strictObject({ kind: z.enum(["task", "project", "person"]), id }),
      anchor: z
        .strictObject({ start: z.int().min(0), end: z.int().min(0), text: z.string() })
        .nullable(),
    }),
  ),
  standing: z.boolean(),
  versions: z.array(
    z.strictObject({
      version: z.int().min(0),
      words: z.string(),
      changed: z.strictObject({ by: author, at: instant }),
    }),
  ),
});

const task = z.strictObject({
  id,
  title: z.string(),
  origin_entry: id,
  at: instant,
  author,
  project: id.nullable(),
  due_date: day.nullable(),
  defer_date: day.nullable(),
  recurrence: recurrence.nullable(),
  events: z.array(
    z.discriminatedUnion("what", [
      z.strictObject({
        what: z.enum(["finished", "dropped", "reopened", "taken_back"]),
        at: instant,
      }),
      z.strictObject({ what: z.literal("delegated"), at: instant, person: id }),
      z.strictObject({
        what: z.enum(["waited_on", "stopped_waiting", "released"]),
        at: instant,
        on: waitTarget,
      }),
    ]),
  ),
});

const project = z.strictObject({
  id,
  name: z.string(),
  at: instant,
  due_date: day.nullable(),
  events: z.array(
    z.strictObject({ what: z.enum(["finished", "dropped", "reopened"]), at: instant }),
  ),
});

const stamp = {
  format: z.literal(EXPORT_FORMAT),
  format_version: z.literal(EXPORT_FORMAT_VERSION),
  made_at: instant,
};

const contextFile = z.strictObject({
  ...stamp,
  kind: z.literal("context"),
  context: z.strictObject({
    id,
    name: z.string(),
    time_zone: timeZone,
    brief_time: clockTime.nullable(),
    review_day: z.enum(weekdays),
    review_time: clockTime.nullable(),
    notifications: z.boolean(),
  }),
  entries: z.array(entry),
  tasks: z.array(task),
  projects: z.array(project),
  persons: z.array(z.strictObject({ id, name: z.string(), at: instant })),
  trash: z.array(
    z.strictObject({
      deleted: record,
      went_with: z.array(record),
      at: instant,
      dormant_links: z.array(
        z.strictObject({ task: id, what: z.enum(["project", "delegation", "wait"]), to: record }),
      ),
    }),
  ),
  runs: z.array(
    z.strictObject({
      id,
      started_by: z.enum(["message", "brief", "review"]),
      at: instant,
      model: z.string(),
      tokens: z.strictObject({
        input: z.int().min(0),
        output: z.int().min(0),
        cache_read: z.int().min(0),
        cache_write: z.int().min(0),
      }),
      cost: z.number().min(0),
      ended: z.enum(["answered", "cut_short", "failed", "cap_reached"]).nullable(),
      failure: z.enum(["model_unavailable", "key_refused"]).nullable(),
    }),
  ),
  moving: z.array(
    z.strictObject({
      id,
      to: id,
      at: instant,
      entries: z.array(entry),
      tasks: z.array(task),
      projects: z.array(project),
    }),
  ),
}) satisfies z.ZodType<ContextFile, unknown>;

const deploymentFile = z.strictObject({
  ...stamp,
  kind: z.literal("deployment"),
  contexts: z.array(
    z.strictObject({
      id,
      name: z.string().refine((name) => name.trim().length > 0 && !/[\r\n]/.test(name), {
        message: "A Context's name is one line.",
      }),
      accent: z.enum(ACCENTS),
      retired: z.boolean(),
      file: z.string(),
    }),
  ),
  spend_cap: z.number().positive().nullable(),
  deleted_contexts_spend: z.array(
    z.strictObject({ month: z.string().regex(/^\d{4}-\d{2}$/), dollars: z.number().min(0) }),
  ),
  connections: z.array(z.strictObject({ id, name: z.string(), context_id: id })),
}) satisfies z.ZodType<DeploymentFile, unknown>;

/**
 * An Export read to be restored: the Deployment's file, and each Context's beside its listing,
 * in the order listed. A Context's `moving` holds only the units that stay in it, since the
 * Context they were moving to does not hold them: its restore puts them back among its records.
 */
export type ExportRead = {
  deployment: DeploymentFile;
  contexts: { listed: ExportedContext; file: ContextFile }[];
};

/**
 * Read an Export's files, each its path and its text, to be restored. A file of an older format
 * is brought forward as it is read, however old; a file of a newer one is refused, since only a
 * newer release can read it. One that is not the format, or does not hold together, is invalid.
 */
export function readExport(files: { path: string; text: string }[]): ToolResult<ExportRead> {
  const byPath = new Map(files.map((file) => [file.path, file.text]));
  const deployment = readFile(byPath, DEPLOYMENT_FILE, deploymentFile);
  if (!deployment.ok) return deployment;
  const contexts: ExportRead["contexts"] = [];
  for (const listed of deployment.value.contexts) {
    if (listed.file !== contextFilePath(listed.id)) {
      return invalid(`${DEPLOYMENT_FILE} lists the Context ${listed.id} at ${listed.file}.`);
    }
    const file = readFile(byPath, listed.file, contextFile);
    if (!file.ok) return file;
    if (file.value.context.id !== listed.id) {
      return invalid(`${listed.file} is not the file of the Context ${listed.id}.`);
    }
    contexts.push({ listed, file: file.value });
  }
  const unlisted = [...byPath.keys()].filter(
    (path) => path !== DEPLOYMENT_FILE && !contexts.some(({ listed }) => listed.file === path),
  );
  if (unlisted.length > 0) {
    return invalid(
      `${unlisted.join(", ")} is in the Export, and ${DEPLOYMENT_FILE} lists no such file.`,
    );
  }
  const ids = new Set(contexts.map(({ listed }) => listed.id));
  if (ids.size !== contexts.length) return invalid(`${DEPLOYMENT_FILE} lists a Context twice.`);
  const connections = new Set(deployment.value.connections.map(({ id }) => id));
  if (connections.size !== deployment.value.connections.length) {
    return invalid(`${DEPLOYMENT_FILE} lists a Connection twice.`);
  }
  const astray = deployment.value.connections.find(({ context_id }) => !ids.has(context_id));
  if (astray) {
    return invalid(
      `The Connection ${astray.name} is to a Context ${DEPLOYMENT_FILE} does not list.`,
    );
  }
  const settled = settleMoves(contexts);
  const twice = recordInTwoContexts(settled);
  if (twice !== null) return invalid(`The record ${twice} is in two Contexts' files.`);
  return success({ deployment: deployment.value, contexts: settled });
}

/** A file of the Export read, brought forward to the format this code writes, and checked. */
function readFile<T>(
  files: Map<string, string>,
  path: string,
  schema: z.ZodType<T, unknown>,
): ToolResult<T> {
  const text = files.get(path);
  if (text === undefined) return invalid(`The Export has no ${path}.`);
  let read: unknown;
  try {
    read = JSON.parse(text);
  } catch {
    return invalid(`${path} is not JSON.`);
  }
  const forward = broughtForward(read, path);
  if (!forward.ok) return forward;
  const parsed = schema.safeParse(forward.value);
  if (!parsed.success)
    return invalid(`${path} is not as the format has it: ${z.prettifyError(parsed.error)}`);
  return success(parsed.data);
}

/** A file of any format version up to this code's, brought forward to it step by step. */
function broughtForward(read: unknown, path: string): ToolResult<Unread> {
  if (typeof read !== "object" || read === null || Array.isArray(read)) {
    return invalid(`${path} is not a file of an Export.`);
  }
  let file = read as Unread;
  const version = file.format_version;
  if (
    file.format !== EXPORT_FORMAT ||
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    return invalid(`${path} is not a file of a Praxis Export.`);
  }
  if (version > EXPORT_FORMAT_VERSION) {
    return refusal(
      `${path} is of format ${version}, which a newer release of Praxis wrote, and this one reads up to format ${EXPORT_FORMAT_VERSION}: deploy the newer release, then restore it.`,
      [],
    );
  }
  for (let at = version; at < EXPORT_FORMAT_VERSION; at += 1) {
    const step = FORMAT_STEPS[at - 1] as (file: Unread) => Unread;
    file = { ...step(file), format_version: at + 1 };
  }
  return success(file);
}

/**
 * Settle each unit caught moving between Contexts (ADR 0018), since each Context's object wrote
 * its own file at its own instant. A unit marked as moving out of a Context leaves that file when
 * another Context holds its records among the rest, since that one took it, or when the Context it
 * was moving to holds them on their way out again, to be settled there in turn. Found nowhere else,
 * it stays where it was leaving.
 */
function settleMoves(contexts: ExportRead["contexts"]): ExportRead["contexts"] {
  const idsOf = (holding: {
    entries: { id: string }[];
    tasks: { id: string }[];
    projects: { id: string }[];
  }) => [...holding.entries, ...holding.tasks, ...holding.projects].map(({ id }) => id);
  const kept = new Map(contexts.map(({ listed, file }) => [listed.id, new Set(idsOf(file))]));
  const goingOn = new Map(
    contexts.map(({ listed, file }) => [listed.id, new Set(file.moving.flatMap(idsOf))]),
  );
  return contexts.map(({ listed, file }) => ({
    listed,
    file: {
      ...file,
      moving: file.moving.filter((move) => {
        const taken = (id: string) =>
          [...kept].some(([context, ids]) => context !== listed.id && ids.has(id)) ||
          (move.to !== listed.id && (goingOn.get(move.to)?.has(id) ?? false));
        return !idsOf(move).some(taken);
      }),
    },
  }));
}

/** A record found in two Contexts' files once the moves are settled, as `kind:id`, or null. */
function recordInTwoContexts(contexts: ExportRead["contexts"]): string | null {
  const seen = new Set<string>();
  for (const { file } of contexts) {
    const records = [
      ...file.persons.map(({ id }) => `person:${id}`),
      ...[file, ...file.moving].flatMap((holding) => [
        ...holding.entries.map(({ id }) => `entry:${id}`),
        ...holding.tasks.map(({ id }) => `task:${id}`),
        ...holding.projects.map(({ id }) => `project:${id}`),
      ]),
    ];
    for (const one of new Set(records)) {
      if (seen.has(one)) return one;
      seen.add(one);
    }
  }
  return null;
}

function invalid(message: string): ToolResult<never> {
  return failure("invalid_input", `This is not an Export Praxis can restore: ${message}`);
}
