import type { RecordKind } from "@praxis/domain";

/** The table each kind of record is kept in, in the Trash or not. */
export const tableOf: Record<RecordKind, string> = {
  entry: "entries",
  task: "tasks",
  project: "projects",
  person: "persons",
};

/** The view of each kind of record that are not in the Trash, which every read goes through. */
export const untrashedTableOf: Record<RecordKind, string> = {
  entry: "untrashed_entries",
  task: "untrashed_tasks",
  project: "untrashed_projects",
  person: "untrashed_persons",
};

/** The column a record's one-line summary is made from: an Entry's words, or a title or name. */
export const summaryColumnOf: Record<RecordKind, string> = {
  entry: "words",
  task: "title",
  project: "name",
  person: "name",
};

/** Whether a record is in this Context and not in the Trash. */
export function untrashed(sql: SqlStorage, record: { kind: RecordKind; id: string }): boolean {
  return (
    sql.exec(`SELECT 1 FROM ${untrashedTableOf[record.kind]} WHERE id = ?`, record.id).toArray()
      .length > 0
  );
}

/**
 * The records of one kind with these ids that are in this Context and not in the Trash, by id:
 * their rows read in one query, however many, and made into records by `read`.
 */
export function untrashedById<
  Row extends Record<string, SqlStorageValue>,
  Read extends { id: string },
>(
  sql: SqlStorage,
  kind: RecordKind,
  ids: string[],
  read: (rows: Row[]) => Read[],
): Map<string, Read> {
  const rows = sql
    .exec<Row>(
      `SELECT * FROM ${untrashedTableOf[kind]} WHERE id IN (SELECT value FROM json_each(?))`,
      JSON.stringify(ids),
    )
    .toArray();
  return new Map(read(rows).map((record) => [record.id, record]));
}
