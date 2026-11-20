import {
  type Accent,
  type Caller,
  type Connection,
  type ContextListing,
  connectionAddress,
  contextFilePath,
  DEPLOYMENT_FILE,
  type DeploymentToolInput,
  type DeploymentToolName,
  type DeploymentToolOutput,
  EXPORT_FORMAT_VERSION,
  type Export,
  type ExportedConnection,
  type ExportFile,
  effectOnConnection,
  effectOnContext,
  effectOnSpendCap,
  exportStamp,
  failure,
  instantToIso,
  refusal,
  success,
  type ToolResult,
  written,
} from "@praxis/domain";
import { countBackupsFrom } from "./backup-rows.ts";
import type { BackupToolName } from "./backups.ts";
import type { DeviceToolName } from "./devices.ts";
import type { PushSender } from "./push.ts";
import { newContextObject } from "./routing.ts";
import { capChosen, deletedContextsSpend, readCap, readSpend, writeCap } from "./spend-rows.ts";

/** What a Deployment tool is given to run. Like a Context tool, it never reads the real clock. */
export type DeploymentCall<N extends DeploymentToolName> = {
  caller: Caller;
  input: DeploymentToolInput<N>;
  arrivedAt: number;
  sql: SqlStorage;
  env: Env;
  /** The Deployment object's own id, which each Context it makes keeps, to ask it things. */
  deploymentId: string;
  /** How a Notification is sent, and the key a browser subscribes with. */
  push: PushSender;
};

export type DeploymentHandlers = {
  [N in DeploymentToolName]: (
    call: DeploymentCall<N>,
  ) => Promise<ToolResult<DeploymentToolOutput[N]>>;
};

type ContextRow = { id: string; name: string; accent: Accent; retired: number };

type ConnectionRow = {
  id: string;
  name: string;
  context_id: string;
  reading_only: number;
  ended: number;
};

/** The Deployment tools but the Device tools and the Backup's, which are in their own files. */
export const deploymentHandlers: Omit<DeploymentHandlers, DeviceToolName | BackupToolName> = {
  async list_contexts({ sql }) {
    return success({ items: everyContext(sql) });
  },

  async create_context({ input, arrivedAt, sql, env, deploymentId }) {
    // The Context's object is made first, so the list never names one that is not there yet.
    const object = newContextObject(env);
    await object.stub.make(
      { name: input.name, time_zone: input.time_zone },
      deploymentId,
      arrivedAt,
    );
    const id = object.id.toString();
    sql.exec(
      `INSERT INTO contexts (id, name, accent, retired) VALUES (?, ?, ?, 0)`,
      id,
      input.name,
      input.accent,
    );
    // A Deployment holding a Context has something to back up from now on (section 10.3).
    countBackupsFrom(sql, arrivedAt);
    const made: ContextListing = { id, name: input.name, accent: input.accent, retired: false };
    return success(written(made, [effectOnContext(made, "made")]));
  },

  async rename_context({ caller, input, arrivedAt, sql, env }) {
    const found = listing(sql, input.id);
    if (found === null) return noSuchContext();
    if (found.name === input.name) return success(written(found, []));
    // The Context's own object keeps its name too, for its settings and the summary of an Effect
    // on it, so the rename is in its change log for whoever reads that Context.
    await env.CONTEXT.get(env.CONTEXT.idFromString(found.id)).rename(input.name, {
      caller,
      at: arrivedAt,
    });
    sql.exec(`UPDATE contexts SET name = ? WHERE id = ?`, input.name, found.id);
    const renamed = { ...found, name: input.name };
    return success(written(renamed, [effectOnContext(renamed, "changed")]));
  },

  async set_context_accent({ input, sql }) {
    const found = listing(sql, input.id);
    if (found === null) return noSuchContext();
    if (found.accent === input.accent) return success(written(found, []));
    sql.exec(`UPDATE contexts SET accent = ? WHERE id = ?`, input.accent, found.id);
    const changed = { ...found, accent: input.accent };
    return success(written(changed, [effectOnContext(changed, "changed")]));
  },

  async retire_context({ input, sql }) {
    const found = listing(sql, input.id);
    if (found === null) return noSuchContext();
    if (found.retired) return success(written(found, []));
    const others = sql
      .exec(`SELECT 1 FROM contexts WHERE retired = 0 AND id != ? LIMIT 1`, found.id)
      .toArray();
    if (others.length === 0) {
      return refusal("There is always one Context not retired, and this is the last.", [
        contextInTheWay(found),
      ]);
    }
    const retired = setRetired(sql, found, true);
    // Retiring a Context ends its Connections, by rule, and bringing it back does not restore them.
    const ended = endConnectionsTo(sql, found.id);
    return success(written(retired, [effectOnContext(retired, "changed"), ...ended]));
  },

  async bring_back_context({ input, sql }) {
    const found = listing(sql, input.id);
    if (found === null) return noSuchContext();
    if (!found.retired) return success(written(found, []));
    const back = setRetired(sql, found, false);
    return success(written(back, [effectOnContext(back, "changed")]));
  },

  async delete_context({ input, sql, env }) {
    const found = listing(sql, input.id);
    if (found === null) return noSuchContext();
    const inTheWay = [contextInTheWay(found)];
    if (!found.retired) {
      return refusal("Only a retired Context can be deleted: retire it first.", inTheWay);
    }
    if (input.name !== found.name) {
      return refusal(
        "The name typed is not this Context's: type it as it is listed to delete it.",
        inTheWay,
      );
    }
    // Its object goes first, so the list never leaves out a Context whose storage is still there:
    // one refused or failed is still listed, retired, and can be deleted again.
    const deleted = await env.CONTEXT.get(env.CONTEXT.idFromString(found.id)).deleteForGood();
    if (!deleted.ok) return deleted;
    const connections = connectionsByRule(
      sql.exec<ConnectionByRule>(
        `DELETE FROM connections WHERE context_id = ? RETURNING seq, id, name`,
        found.id,
      ),
      "deleted",
    );
    // Its rows of spend stay, keyed by an id no Context is listed by, so the month's count never
    // goes down and an Export gives them with no name attached (section 5.7).
    sql.exec(`DELETE FROM contexts WHERE id = ?`, found.id);
    return success(written(null, [effectOnContext(found, "deleted"), ...connections]));
  },

  async list_connections({ sql }) {
    const rows = sql
      .exec<ConnectionRow>(
        `SELECT id, name, context_id, reading_only, ended FROM connections
         WHERE ended = 0 ORDER BY seq`,
      )
      .toArray();
    return success({ items: rows.map(toConnection) });
  },

  async create_connection({ input, sql }) {
    if (!isReachable(sql, input.context_id)) return noSuchContext();
    const id = opaqueId();
    sql.exec(
      `INSERT INTO connections (id, name, context_id, reading_only, ended) VALUES (?, ?, ?, ?, 0)`,
      id,
      input.name,
      input.context_id,
      input.reading_only ? 1 : 0,
    );
    const made: Connection = {
      id,
      name: input.name,
      context_id: input.context_id,
      reading_only: input.reading_only,
      address: connectionAddress(id),
      ended: false,
    };
    return success(written(made, [effectOnConnection(made, "made")]));
  },

  async rename_connection({ input, sql }) {
    const found = connectionNotEnded(sql, input.id);
    if (found === null) return noSuchConnection();
    if (found.name === input.name) return success(written(found, []));
    sql.exec(`UPDATE connections SET name = ? WHERE id = ?`, input.name, found.id);
    const renamed = { ...found, name: input.name };
    return success(written(renamed, [effectOnConnection(renamed, "changed")]));
  },

  async set_connection_reading_only({ input, sql }) {
    const found = connectionNotEnded(sql, input.id);
    if (found === null) return noSuchConnection();
    if (found.reading_only === input.reading_only) return success(written(found, []));
    sql.exec(
      `UPDATE connections SET reading_only = ? WHERE id = ?`,
      input.reading_only ? 1 : 0,
      found.id,
    );
    const switched = { ...found, reading_only: input.reading_only };
    return success(written(switched, [effectOnConnection(switched, "changed")]));
  },

  async end_connection({ input, sql }) {
    const found = connection(sql, input.id);
    if (found === null) return noSuchConnection();
    if (found.ended) return success(written(found, []));
    sql.exec(`UPDATE connections SET ended = 1 WHERE id = ?`, found.id);
    const ended = { ...found, ended: true };
    return success(written(ended, [effectOnConnection(ended, "changed")]));
  },

  async get_spend({ sql, arrivedAt }) {
    return success(readSpend(sql, arrivedAt));
  },

  async set_spend_cap({ input, sql }) {
    if (readCap(sql) === input.cap) return success(written({ cap: input.cap }, []));
    writeCap(sql, input.cap);
    return success(written({ cap: input.cap }, [effectOnSpendCap(input.cap)]));
  },

  async make_export({ sql, env, arrivedAt }) {
    return success(await exportOf(sql, env, arrivedAt));
  },
};

/**
 * The whole Deployment's Export as at `at`: an Export the person makes, or the daily Backup. Every
 * Context is in it, retired ones too, since it is always the whole Deployment (section 10.1).
 */
export async function exportOf(sql: SqlStorage, env: Env, at: number): Promise<Export> {
  const contexts = everyContext(sql).map((listed) => ({
    ...listed,
    file: contextFilePath(listed.id),
  }));
  const deployment: ExportFile = {
    path: DEPLOYMENT_FILE,
    content: {
      ...exportStamp(at),
      kind: "deployment",
      contexts,
      spend_cap: capChosen(sql),
      deleted_contexts_spend: deletedContextsSpend(sql),
      connections: sql
        .exec<ExportedConnection>(`SELECT id, name, context_id FROM connections ORDER BY seq`)
        .toArray(),
    },
  };
  // Each Context's object writes its own file. This object carries them and reads none (ADR 0006).
  const files = await Promise.all(
    contexts.map(async ({ id, file }): Promise<ExportFile> => {
      const object = env.CONTEXT.get(env.CONTEXT.idFromString(id));
      return { path: file, content: await object.exportFile(at) };
    }),
  );
  return {
    format_version: EXPORT_FORMAT_VERSION,
    made_at: instantToIso(at),
    files: [deployment, ...files],
  };
}

/**
 * The Connection with this id, while it may be called: not ended, and its Context not retired.
 * Null for an ended Connection and for an id there never was alike (section 7.2).
 */
export function callableConnection(sql: SqlStorage, id: string): Connection | null {
  const found = connectionNotEnded(sql, id);
  return found && isReachable(sql, found.context_id) ? found : null;
}

/**
 * End every Connection to a Context, in the order they were made, each an Effect of the rule that
 * ends them with it.
 */
function endConnectionsTo(sql: SqlStorage, contextId: string) {
  return connectionsByRule(
    sql.exec<ConnectionByRule>(
      `UPDATE connections SET ended = 1 WHERE context_id = ? AND ended = 0 RETURNING seq, id, name`,
      contextId,
    ),
    "changed",
  );
}

/** A Connection as a statement changing it by rule returns it. */
type ConnectionByRule = { seq: number; id: string; name: string };

/**
 * The Connections a rule changed or deleted with their Context, as the rows its statement
 * returned, each an Effect of that rule, in the order they were made.
 */
function connectionsByRule(rows: Iterable<ConnectionByRule>, what: "changed" | "deleted") {
  return [...rows]
    .toSorted((a, b) => a.seq - b.seq)
    .map((row) => effectOnConnection(row, what, "rule"));
}

function connection(sql: SqlStorage, id: string): Connection | null {
  const row = sql
    .exec<ConnectionRow>(
      `SELECT id, name, context_id, reading_only, ended FROM connections WHERE id = ?`,
      id,
    )
    .toArray()[0];
  return row ? toConnection(row) : null;
}

/** The Connection with this id unless it has ended, when nothing more can change it. */
function connectionNotEnded(sql: SqlStorage, id: string): Connection | null {
  const found = connection(sql, id);
  return found && !found.ended ? found : null;
}

function toConnection(row: ConnectionRow): Connection {
  return {
    id: row.id,
    name: row.name,
    context_id: row.context_id,
    reading_only: row.reading_only === 1,
    address: connectionAddress(row.id),
    ended: row.ended === 1,
  };
}

/** 128 random bits, base64url: an id nobody can guess or read anything from. */
function opaqueId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function noSuchConnection(): ToolResult<never> {
  return failure("not_found", "There is no such Connection, or it has ended.");
}

/** Whether the Context with this id was made and is not retired, so requests may reach it. */
export function isReachable(sql: SqlStorage, id: string): boolean {
  return sql.exec(`SELECT 1 FROM contexts WHERE id = ? AND retired = 0`, id).toArray().length > 0;
}

/** The names of the Contexts not retired, other than the one with this id, in the order made. */
export function otherContextNames(sql: SqlStorage, id: string): string[] {
  return sql
    .exec<{ name: string }>(
      `SELECT name FROM contexts WHERE retired = 0 AND id != ? ORDER BY seq`,
      id,
    )
    .toArray()
    .map((row) => row.name);
}

function setRetired(sql: SqlStorage, found: ContextListing, retired: boolean): ContextListing {
  sql.exec(`UPDATE contexts SET retired = ? WHERE id = ?`, retired ? 1 : 0, found.id);
  return { ...found, retired };
}

/** Every Context, retired or not, in the order they were made. */
function everyContext(sql: SqlStorage): ContextListing[] {
  return sql
    .exec<ContextRow>(`SELECT id, name, accent, retired FROM contexts ORDER BY seq`)
    .toArray()
    .map(toListing);
}

function listing(sql: SqlStorage, id: string): ContextListing | null {
  const row = sql
    .exec<ContextRow>(`SELECT id, name, accent, retired FROM contexts WHERE id = ?`, id)
    .toArray()[0];
  return row ? toListing(row) : null;
}

function toListing(row: ContextRow): ContextListing {
  return { id: row.id, name: row.name, accent: row.accent, retired: row.retired === 1 };
}

/** A Context named as what stands in the way of a refused call. */
function contextInTheWay(context: ContextListing) {
  return { kind: "context" as const, id: context.id, summary: context.name };
}

function noSuchContext(): ToolResult<never> {
  return failure("not_found", "There is no such Context.");
}
