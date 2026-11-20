import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { createTables, WORDS_INDEX } from "../src/tables.ts";

// A stand-in for the upgrade test of section 13 until the upgrade ladder (#76) replaces
// createTables with numbered steps: a Deployment is live, and its objects made before a column was
// added to one of their tables, or before the words index or the meaning index, must gain it when
// they wake. It starts from a table of the older
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
      // The Run records before they said why a Run failed and where a Run trying a failed one
      // again starts.
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

describe("createTables on a Context object made before the words index", () => {
  test("fills it from the records not in the Trash, once, and keeps it from then on", async () => {
    const stub = env.CONTEXT.get(env.CONTEXT.newUniqueId());

    const indexed = await runInDurableObject(stub, (_, state) => {
      const sql = state.storage.sql;
      // The object as it was before: no words index, and nothing keeping one.
      for (const { name } of sql
        .exec<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'trigger'`)
        .toArray()) {
        sql.exec(`DROP TRIGGER ${name}`);
      }
      sql.exec(`DROP TABLE ${WORDS_INDEX}`);
      sql.exec(`INSERT INTO entries (id, words, at, author_kind, through_conversation)
        VALUES ('e1', 'Before the index', 0, 'person', 0)`);
      sql.exec(`INSERT INTO tasks (id, title, origin_entry, at, author_kind)
        VALUES ('t1', 'A Task from before', 'e1', 0, 'person')`);
      sql.exec(`INSERT INTO projects (id, name, at) VALUES ('p1', 'A Project from before', 0)`);
      sql.exec(`INSERT INTO persons (id, name, at) VALUES ('s1', 'Someone from before', 0)`);
      sql.exec(`INSERT INTO persons (id, name, at) VALUES ('s2', 'Someone in the Trash', 0)`);
      sql.exec(
        `INSERT INTO trash_items (id, kind, record_id, at) VALUES ('i1', 'person', 's2', 0)`,
      );
      sql.exec(`INSERT INTO trashed (kind, record_id, item) VALUES ('person', 's2', 'i1')`);

      createTables(sql);
      createTables(sql);
      sql.exec(`INSERT INTO persons (id, name, at) VALUES ('s3', 'Someone after', 0)`);
      return sql
        .exec<{ record: string }>(
          `SELECT kind || ':' || record_id || ' ' || text AS record FROM ${WORDS_INDEX}
           WHERE ${WORDS_INDEX} MATCH 'before OR after' ORDER BY record`,
        )
        .toArray()
        .map(({ record }) => record);
    });

    expect(indexed).toEqual([
      "entry:e1 Before the index",
      "person:s1 Someone from before",
      "person:s3 Someone after",
      "project:p1 A Project from before",
      "task:t1 A Task from before",
    ]);
  });
});

describe("createTables on a Context object made before the meaning index", () => {
  test("queues its whole Journal, so search answers from words, saying so, until it is built", async () => {
    const stub = env.CONTEXT.get(env.CONTEXT.newUniqueId());

    const queued = await runInDurableObject(stub, (_, state) => {
      const sql = state.storage.sql;
      // The object as it was before: nothing of the meaning index, and nothing keeping it.
      for (const name of ["meaning_entry_made", "meaning_entry_changed", "meaning_entry_removed"]) {
        sql.exec(`DROP TRIGGER ${name}`);
      }
      for (const table of ["meaning_queue", "meaning_index", "meaning_spend"]) {
        sql.exec(`DROP TABLE ${table}`);
      }
      sql.exec(`INSERT INTO entries (id, words, at, author_kind, through_conversation)
        VALUES ('e1', 'Before the meaning index', 0, 'person', 0)`);

      createTables(sql);
      createTables(sql);
      return {
        queue: sql.exec(`SELECT entry, what FROM meaning_queue`).toArray(),
        built: sql.exec(`SELECT built FROM meaning_index`).one().built,
      };
    });

    expect(queued).toEqual({ queue: [{ entry: "e1", what: "embed" }], built: 0 });
  });
});
