import {
  type Connection,
  type ContextListing,
  connectionAddress,
  type Effect,
  effectOnConnection,
  effectOnContext,
  effectOnSpendCap,
  failure,
  monthOf,
  readExport,
  refusal,
  success,
  written,
} from "@praxis/domain";
import { countBackupsFrom } from "./backup-rows.ts";
import { type DeploymentHandlers, keepConnection, listContext } from "./deployment-tools.ts";
import { type ContextStub, newContextObject } from "./routing.ts";
import { takeSpendReport, writeCap } from "./spend-rows.ts";
import { fromBase64, unzip } from "./unzip.ts";

export type RestoreToolName = "restore_export";

/**
 * Whom the monthly spend of Contexts deleted before the Export was made is kept under: no Context
 * is listed by it, so an Export gives it with no name attached, as it was given.
 */
const DELETED_BEFORE = "deleted before the restore";

/**
 * Restoring an Export or a Backup (section 10.2, ADR 0018): whole, into a Deployment that holds
 * nothing yet, by the person's hand during setup. No merge, and no restoring one Context.
 */
export const restoreHandlers: Pick<DeploymentHandlers, RestoreToolName> = {
  async restore_export({ input, sql, env, arrivedAt, deploymentId }) {
    if (holdsAnything(sql)) {
      return refusal(
        "An Export is restored only into a Deployment that holds nothing yet, and this one holds something already: restore it into a new Deployment, during setup.",
        [],
      );
    }
    const bytes = fromBase64(input.file);
    if (bytes === null) return failure("invalid_input", "An Export's file is its zip, in base64.");
    const files = await unzip(bytes);
    if (!files.ok) return files;
    const read = readExport(files.value);
    if (!read.ok) return read;
    const { deployment, contexts } = read.value;

    // Each Context's object is made first, so the list never names one that is not there; its id
    // is the new object's, since only the platform mints one. One that cannot be made undoes the
    // rest, so a restore that fails leaves the Deployment holding nothing, to be tried again.
    const made: { listed: ContextListing; was: string; stub: ContextStub; spent: number }[] = [];
    for (const { listed, file } of contexts) {
      const object = newContextObject(env);
      const answer = await object.stub
        .makeFromExport(file, { name: listed.name, deployment: deploymentId, at: arrivedAt })
        .catch(() =>
          refusal(
            `${listed.name} did not answer as it was restored, so nothing was restored: try again in a while.`,
            [],
          ),
        );
      if (!answer.ok) {
        await undo([...made.map(({ stub }) => stub), object.stub]);
        return answer;
      }
      made.push({
        listed: {
          id: object.id.toString(),
          name: listed.name,
          accent: listed.accent,
          retired: listed.retired,
        },
        was: listed.id,
        stub: object.stub,
        spent: answer.value.spent,
      });
    }

    const ids = new Map(made.map(({ was, listed }) => [was, listed.id]));
    for (const { listed, spent } of made) {
      listContext(sql, listed);
      takeSpendReport(sql, { context: listed.id, month: monthOf(arrivedAt), spent });
    }
    // Each comes back ended: the permission is made again at the new Deployment's address. Its
    // Context is listed, since the file was refused otherwise.
    const connections: Connection[] = deployment.connections.map((connection) => ({
      id: connection.id,
      name: connection.name,
      context_id: ids.get(connection.context_id) as string,
      reading_only: false,
      address: connectionAddress(connection.id),
      ended: true,
    }));
    for (const connection of connections) keepConnection(sql, connection);
    for (const { month, dollars } of deployment.deleted_contexts_spend) {
      takeSpendReport(sql, { context: DELETED_BEFORE, month, spent: dollars });
    }
    const effects: Effect[] = [
      ...made.map(({ listed }) => effectOnContext(listed, "made")),
      ...connections.map((connection) => effectOnConnection(connection, "made")),
    ];
    if (deployment.spend_cap !== null) {
      writeCap(sql, deployment.spend_cap);
      effects.push(effectOnSpendCap(deployment.spend_cap));
    }
    // A Deployment holding a Context has something to back up from now on (section 10.3).
    if (made.length > 0) countBackupsFrom(sql, arrivedAt);
    return success(written({ contexts: made.map(({ listed }) => listed), connections }, effects));
  },
};

/**
 * Whether the Deployment holds anything a restore would have to merge with: a Context, retired or
 * not, a Connection, a cap the person set, or spend counted. A Device is not in an Export, so one
 * the screen listed during setup stands in the way of nothing.
 */
function holdsAnything(sql: SqlStorage): boolean {
  return (
    sql
      .exec(
        `SELECT 1 FROM contexts UNION ALL SELECT 1 FROM connections
         UNION ALL SELECT 1 FROM spend_cap UNION ALL SELECT 1 FROM spend LIMIT 1`,
      )
      .toArray().length > 0
  );
}

/** Delete for good the objects a restore made before one failed, so none is left unlisted. */
async function undo(objects: ContextStub[]): Promise<void> {
  for (const object of objects) {
    try {
      await object.deleteForGood();
    } catch {
      // Unlisted, it is reached by nothing, and holds what the person still has in the file.
      console.error(JSON.stringify({ restore: "object_left" }));
    }
  }
}
