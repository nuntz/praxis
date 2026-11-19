import {
  type ContextFile,
  type ExportedEntry,
  type ExportedLink,
  type ExportedPerson,
  type ExportedProject,
  type ExportedRun,
  type ExportedTask,
  type ExportedTaskEvent,
  type ExportedTrashItem,
  exportStamp,
  instantToIso,
  type LinkTarget,
  type RecordKind,
  type Recurrence,
  type Version,
  type WaitTarget,
} from "@praxis/domain";
import { type AuthorColumns, toAuthor } from "./author.ts";
import type { RunRow } from "./run-rows.ts";

/**
 * This Context's file of an Export as at `at` (section 10.1): its settings, its Journal with what
 * is in the Trash, the Trash with each item's clock, and its Run records, in the format of
 * `docs/export-format.md`. It reads what it holds and changes nothing. Every record is read from
 * its own table, not its view, so what is in the Trash is in the file.
 */
export function contextFile(sql: SqlStorage, at: number): ContextFile {
  const settings = sql
    .exec<{ id: string; name: string; time_zone: string }>(
      `SELECT id, name, time_zone FROM context_settings`,
    )
    .one();
  return {
    ...exportStamp(at),
    kind: "context",
    context: settings,
    entries: entries(sql),
    tasks: tasks(sql),
    projects: projects(sql),
    persons: persons(sql),
    trash: trash(sql),
    runs: runs(sql),
  };
}

/** Group rows by a key, keeping each group in the order the rows came. */
function groupBy<R, T>(rows: R[], key: (row: R) => string, to: (row: R) => T): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(key(row));
    if (group) group.push(to(row));
    else groups.set(key(row), [to(row)]);
  }
  return groups;
}

type EntryRow = AuthorColumns & {
  id: string;
  words: string;
  at: number;
  through_conversation: number;
  follow_up_to: string | null;
  standing: number;
};

type LinkRow = {
  entry: string;
  to_kind: LinkTarget["kind"];
  to_id: string;
  anchor_start: number | null;
  anchor_end: number | null;
  anchor_text: string | null;
};

type VersionRow = AuthorColumns & { entry: string; version: number; words: string; at: number };

function entries(sql: SqlStorage): ExportedEntry[] {
  const links = groupBy(
    sql.exec<LinkRow>(`SELECT * FROM entry_links ORDER BY seq`).toArray(),
    (row) => row.entry,
    (row): ExportedLink => ({
      to: { kind: row.to_kind, id: row.to_id },
      // An anchor is kept whole or not at all, as link-rows.ts reads it.
      anchor:
        row.anchor_start === null || row.anchor_end === null || row.anchor_text === null
          ? null
          : { start: row.anchor_start, end: row.anchor_end, text: row.anchor_text },
    }),
  );
  const versions = groupBy(
    sql.exec<VersionRow>(`SELECT * FROM entry_versions ORDER BY entry, version`).toArray(),
    (row) => row.entry,
    (row): Version => ({
      version: row.version,
      words: row.words,
      changed: { by: toAuthor(row), at: instantToIso(row.at) },
    }),
  );
  return sql
    .exec<EntryRow>(
      `SELECT e.*, EXISTS (SELECT 1 FROM standing_marks m WHERE m.entry = e.id) AS standing
       FROM entries e ORDER BY seq`,
    )
    .toArray()
    .map((row) => ({
      id: row.id,
      words: row.words,
      at: instantToIso(row.at),
      author: toAuthor(row),
      through_conversation: row.through_conversation === 1,
      follow_up_to: row.follow_up_to,
      links: links.get(row.id) ?? [],
      standing: row.standing === 1,
      versions: versions.get(row.id) ?? [],
    }));
}

type TaskRow = AuthorColumns & {
  id: string;
  title: string;
  origin_entry: string;
  at: number;
  project: string | null;
  due_date: string | null;
  defer_date: string | null;
  recurrence: string | null;
};

type TaskEventRow = {
  task: string;
  what: ExportedTaskEvent["what"];
  at: number;
  person: string | null;
  on_kind: WaitTarget["kind"] | null;
  on_id: string | null;
};

function tasks(sql: SqlStorage): ExportedTask[] {
  const events = groupBy(
    sql.exec<TaskEventRow>(`SELECT * FROM task_events ORDER BY seq`).toArray(),
    (row) => row.task,
    taskEvent,
  );
  return sql
    .exec<TaskRow>(`SELECT * FROM tasks ORDER BY seq`)
    .toArray()
    .map((row) => ({
      id: row.id,
      title: row.title,
      origin_entry: row.origin_entry,
      at: instantToIso(row.at),
      author: toAuthor(row),
      project: row.project,
      due_date: row.due_date,
      defer_date: row.defer_date,
      recurrence: row.recurrence === null ? null : (JSON.parse(row.recurrence) as Recurrence),
      events: events.get(row.id) ?? [],
    }));
}

function taskEvent(row: TaskEventRow): ExportedTaskEvent {
  const at = instantToIso(row.at);
  switch (row.what) {
    case "delegated":
      return { what: row.what, at, person: kept(row.person, row) };
    case "waited_on":
    case "stopped_waiting":
    case "released":
      return { what: row.what, at, on: { kind: kept(row.on_kind, row), id: kept(row.on_id, row) } };
    default:
      return { what: row.what, at };
  }
}

/**
 * A column a Task event of its kind always has. One missing is a fault in what the object holds,
 * which fails the Export rather than writing a file with something made up in its place.
 */
function kept<T>(value: T | null, row: TaskEventRow): T {
  if (value === null) throw new Error(`A Task's ${row.what} event lacks what it names.`);
  return value;
}

type ProjectRow = { id: string; name: string; at: number; due_date: string | null };

type ProjectEventRow = {
  project: string;
  what: ExportedProject["events"][number]["what"];
  at: number;
};

function projects(sql: SqlStorage): ExportedProject[] {
  const events = groupBy(
    sql.exec<ProjectEventRow>(`SELECT * FROM project_events ORDER BY seq`).toArray(),
    (row) => row.project,
    (row) => ({ what: row.what, at: instantToIso(row.at) }),
  );
  return sql
    .exec<ProjectRow>(`SELECT id, name, at, due_date FROM projects ORDER BY seq`)
    .toArray()
    .map((row) => ({
      id: row.id,
      name: row.name,
      at: instantToIso(row.at),
      due_date: row.due_date,
      events: events.get(row.id) ?? [],
    }));
}

function persons(sql: SqlStorage): ExportedPerson[] {
  return sql
    .exec<{ id: string; name: string; at: number }>(`SELECT id, name, at FROM persons ORDER BY seq`)
    .toArray()
    .map((row) => ({ id: row.id, name: row.name, at: instantToIso(row.at) }));
}

type TrashedRow = { item: string; kind: RecordKind; record_id: string };

type DormantRow = {
  item: string;
  task: string;
  what: ExportedTrashItem["dormant_links"][number]["what"];
  to_kind: RecordKind;
  to_id: string;
};

/**
 * Each item in the Trash, in the order deleted: the record deleted, what went with it in the order
 * it was made, and the delete's instant, which its clock counts from.
 */
function trash(sql: SqlStorage): ExportedTrashItem[] {
  const trashed = groupBy(
    sql.exec<TrashedRow>(`SELECT item, kind, record_id FROM trashed ORDER BY seq`).toArray(),
    (row) => row.item,
    (row) => ({ kind: row.kind, id: row.record_id }),
  );
  const dormant = groupBy(
    sql.exec<DormantRow>(`SELECT * FROM dormant_links ORDER BY seq`).toArray(),
    (row) => row.item,
    (row) => ({ task: row.task, what: row.what, to: { kind: row.to_kind, id: row.to_id } }),
  );
  return sql
    .exec<{ id: string; kind: RecordKind; record_id: string; at: number }>(
      `SELECT id, kind, record_id, at FROM trash_items ORDER BY seq`,
    )
    .toArray()
    .map((item) => ({
      deleted: { kind: item.kind, id: item.record_id },
      went_with: (trashed.get(item.id) ?? []).filter(
        (record) => !(record.kind === item.kind && record.id === item.record_id),
      ),
      at: instantToIso(item.at),
      dormant_links: dormant.get(item.id) ?? [],
    }));
}

/**
 * Each Run record, in the order started, with none of the runtime's handles on the Conversation
 * and not the changes it made, which the change log numbers and the file does not hold.
 */
function runs(sql: SqlStorage): ExportedRun[] {
  return sql
    .exec<RunRow>(`SELECT * FROM runs ORDER BY seq`)
    .toArray()
    .map((row) => ({
      id: row.id,
      started_by: row.started_by,
      at: instantToIso(row.at),
      model: row.model,
      tokens: {
        input: row.input_tokens,
        output: row.output_tokens,
        cache_read: row.cache_read_tokens,
        cache_write: row.cache_write_tokens,
      },
      cost: row.cost,
      ended: row.ended,
      failure: row.failure,
    }));
}
