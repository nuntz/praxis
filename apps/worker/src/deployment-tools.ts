import {
  type Accent,
  type Caller,
  type ContextListing,
  type DeploymentToolInput,
  type DeploymentToolName,
  type DeploymentToolOutput,
  effectOnContext,
  failure,
  refusal,
  success,
  type ToolResult,
  written,
} from "@praxis/domain";

/** What a Deployment tool is given to run. Like a Context tool, it never reads the real clock. */
export type DeploymentCall<N extends DeploymentToolName> = {
  caller: Caller;
  input: DeploymentToolInput<N>;
  arrivedAt: number;
  sql: SqlStorage;
  env: Env;
};

export type DeploymentHandlers = {
  [N in DeploymentToolName]: (
    call: DeploymentCall<N>,
  ) => Promise<ToolResult<DeploymentToolOutput[N]>>;
};

type ContextRow = { id: string; name: string; accent: Accent; retired: number };

export const deploymentHandlers: DeploymentHandlers = {
  async list_contexts({ sql }) {
    const rows = sql
      .exec<ContextRow>(`SELECT id, name, accent, retired FROM contexts ORDER BY seq`)
      .toArray();
    return success({ items: rows.map(toListing) });
  },

  async create_context({ input, sql, env }) {
    // The Context's object is made first, so the list never names one that is not there yet.
    const objectId = env.CONTEXT.newUniqueId();
    await env.CONTEXT.get(objectId).make({ name: input.name, time_zone: input.time_zone });
    const id = objectId.toString();
    sql.exec(
      `INSERT INTO contexts (id, name, accent, retired) VALUES (?, ?, ?, 0)`,
      id,
      input.name,
      input.accent,
    );
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
        { kind: "context", id: found.id, summary: found.name },
      ]);
    }
    return setRetired(sql, found, true);
  },

  async bring_back_context({ input, sql }) {
    const found = listing(sql, input.id);
    if (found === null) return noSuchContext();
    if (!found.retired) return success(written(found, []));
    return setRetired(sql, found, false);
  },
};

/** Whether the Context with this id was made and is not retired, so requests may reach it. */
export function isReachable(sql: SqlStorage, id: string): boolean {
  return sql.exec(`SELECT 1 FROM contexts WHERE id = ? AND retired = 0`, id).toArray().length > 0;
}

function setRetired(sql: SqlStorage, found: ContextListing, retired: boolean) {
  sql.exec(`UPDATE contexts SET retired = ? WHERE id = ?`, retired ? 1 : 0, found.id);
  const changed = { ...found, retired };
  return success(written(changed, [effectOnContext(changed, "changed")]));
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

function noSuchContext(): ToolResult<never> {
  return failure("not_found", "There is no such Context.");
}
