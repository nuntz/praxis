import { runInDurableObject } from "cloudflare:test";
import { RUNTIME_TABLES } from "../src/agent.ts";
import { wakeAgain } from "./seam.ts";

// An object's SQLite as a fixture keeps it (section 13, ADR 0019): what each table, index, view
// and trigger was made with, in the order SQLite made them, and every table's rows by rowid. The
// upgrade test lays a fixture saved by an earlier release into an object and wakes it under the
// current code. Nothing else writes an object's tables.

/** A value as a dump keeps it: a blob as base64, since JSON holds none. */
type Value = null | number | string | { blob: string };

/** A row of a table, its rowid beside its columns. */
type Row = Record<string, Value>;

/** An object's SQLite, as a fixture keeps it. */
export type Dump = {
  /** What each table, index, view and trigger was made with, as SQLite holds it, in order. */
  made: { type: string; name: string; sql: string }[];
  /** Each table's rows in rowid order, each with its rowid as `rowid`. */
  rows: Record<string, Row[]>;
  /** Where each AUTOINCREMENT table's numbering stands. */
  sequence: { name: string; seq: number }[];
};

/** The tables SQLite keeps an FTS5 index in, made with it: a dump makes the index, not them. */
const FTS5_SHADOWS = ["data", "idx", "content", "docsize", "config"];

/** An object's own made things, leaving out SQLite's, the platform's, and the FTS5 shadow tables. */
function madeIn(sql: SqlStorage): Dump["made"] {
  const made = sql
    .exec<{ type: string; name: string; sql: string }>(
      `SELECT type, name, sql FROM sqlite_master
       WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
       ORDER BY rowid`,
    )
    .toArray();
  const shadows = new Set(
    made
      .filter((item) => /^CREATE VIRTUAL TABLE/i.test(item.sql))
      .flatMap(({ name }) => FTS5_SHADOWS.map((shadow) => `${name}_${shadow}`)),
  );
  return made.filter(({ name }) => !shadows.has(name));
}

function toValue(value: SqlStorageValue): Value {
  if (value instanceof ArrayBuffer) {
    return { blob: btoa(String.fromCharCode(...new Uint8Array(value))) };
  }
  return value;
}

function fromValue(value: Value): SqlStorageValue {
  if (value !== null && typeof value === "object") {
    return Uint8Array.from(atob(value.blob), (char) => char.charCodeAt(0)).buffer;
  }
  return value;
}

/** An object's SQLite as it stands. */
export function dumpObject(stub: DurableObjectStub): Promise<Dump> {
  return runInDurableObject(stub, (_, state) => {
    const sql = state.storage.sql;
    const made = madeIn(sql);
    const rows: Dump["rows"] = {};
    for (const { name } of made.filter(({ type }) => type === "table")) {
      rows[name] = sql
        .exec(`SELECT rowid AS rowid, * FROM "${name}" ORDER BY rowid`)
        .toArray()
        .map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, toValue(v)])));
    }
    // SQLite makes its table of numbering with the first AUTOINCREMENT table, if any.
    const numbered =
      sql.exec(`SELECT 1 FROM sqlite_master WHERE name = 'sqlite_sequence'`).toArray().length > 0;
    const sequence = numbered
      ? sql
          .exec<{ name: string; seq: number }>(
            `SELECT name, seq FROM sqlite_sequence ORDER BY name`,
          )
          .toArray()
      : [];
    return { made, rows, sequence };
  });
}

/**
 * Lay a dump into an object in place of all it holds, then wake it again, so it climbs its ladder
 * from where the dump stands under the release the test names (test/upgrade-faults.ts). Tables are
 * made and filled first, with foreign keys checked at the end, then their indexes, views and
 * triggers, so a trigger fires for no row laid in.
 */
export async function layDump(stub: DurableObjectStub, dump: Dump): Promise<void> {
  await runInDurableObject(stub, async (_, state) => {
    await state.storage.deleteAll();
    const sql = state.storage.sql;
    state.storage.transactionSync(() => {
      sql.exec(`PRAGMA defer_foreign_keys = ON`);
      for (const item of dump.made.filter(({ type }) => type === "table")) sql.exec(item.sql);
      for (const [table, rows] of Object.entries(dump.rows)) {
        for (const row of rows) {
          const columns = Object.keys(row);
          sql.exec(
            `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(", ")})
             VALUES (${columns.map(() => "?").join(", ")})`,
            ...Object.values(row).map(fromValue),
          );
        }
      }
      for (const { name, seq } of dump.sequence) {
        sql.exec(`DELETE FROM sqlite_sequence WHERE name = ?`, name);
        sql.exec(`INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)`, name, seq);
      }
      for (const item of dump.made.filter(({ type }) => type !== "table")) sql.exec(item.sql);
    });
  });
  await wakeAgain(stub);
}

/** A column, an index, a view or a trigger, as the shape of a table compares it. */
type Shaped = Record<string, unknown>;

/**
 * The shape of an object's tables (section 13): each table's columns in order, each index's
 * columns, and each view and trigger as made. The runtime's tables are not on the ladder and are
 * left out, as are SQLite's and the platform's.
 */
export function shapeOf(stub: DurableObjectStub): Promise<Record<string, Shaped[]>> {
  return runInDurableObject(stub, (_, state) => {
    const sql = state.storage.sql;
    const items = sql
      .exec<{ type: string; name: string; tbl_name: string; sql: string | null }>(
        `SELECT type, name, tbl_name, sql FROM sqlite_master
         WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE ?
         ORDER BY type, name`,
        `${RUNTIME_TABLES}%`,
      )
      .toArray();
    const shape: Record<string, Shaped[]> = {};
    for (const { type, name, tbl_name, sql: made } of items) {
      const key = `${type} ${name}`;
      if (type === "table") {
        shape[key] = sql
          .exec(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_xinfo(?)`, name)
          .toArray();
      } else if (type === "index") {
        shape[key] = [
          { table: tbl_name, unique: /UNIQUE/i.test(made ?? "") || made === null },
          ...sql.exec(`SELECT name, "desc", coll FROM pragma_index_xinfo(?)`, name).toArray(),
        ];
      } else {
        shape[key] = [{ table: tbl_name, sql: made }];
      }
    }
    return shape;
  });
}
