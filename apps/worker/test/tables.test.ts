import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { createTables } from "../src/tables.ts";

// A stand-in for the upgrade test of section 13 until the upgrade ladder (#76) replaces
// createTables with numbered steps: a Deployment is live, and its objects made before a column was
// added to one of their tables must gain it when they wake. It starts from a table of the older
// shape, so it is the one test outside the harness that writes the tables itself.

/** The columns of a table, in order. */
function columnsOf(sql: SqlStorage, table: string): string[] {
  return sql
    .exec<{ name: string }>(`SELECT name FROM pragma_table_info(?)`, table)
    .toArray()
    .map(({ name }) => name);
}

describe("createTables on a Context object made before a column was added", () => {
  test("gives the Run records the columns a Run made now writes", async () => {
    const stub = env.CONTEXT.get(env.CONTEXT.newUniqueId());

    const [fresh, upgraded] = await runInDurableObject(stub, (_, state) => {
      const sql = state.storage.sql;
      const fresh = columnsOf(sql, "runs");
      // The Run records as #66 left them, before #65 added why a Run failed and where a Run
      // trying a failed one again starts.
      sql.exec(`DROP TABLE run_changes`);
      sql.exec(`DROP TABLE runs`);
      sql.exec(`CREATE TABLE runs (
        seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, started_by TEXT NOT NULL, message TEXT,
        submission INTEGER, at INTEGER NOT NULL, model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0, ended TEXT)`);
      createTables(sql);
      createTables(sql);
      return [fresh, columnsOf(sql, "runs")];
    });

    expect(upgraded).toEqual(fresh);
  });
});
