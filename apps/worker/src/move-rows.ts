import {
  type Caller,
  type Day,
  type Effect,
  type ExportedEntry,
  type ExportedTask,
  type ExportedTaskEvent,
  instantToIso,
  keysForgottenBy,
  type MoveKind,
  type MoveUnit,
  type MovingUnit,
  type RecordKind,
  type RecordNamed,
  summarizeWords,
  type Task,
} from "@praxis/domain";
import { authorColumns } from "./author.ts";
import { entries, projects, tasks } from "./context-file.ts";
import { lapseHeldChangesOn } from "./held-change-rows.ts";
import { untrashed } from "./record-tables.ts";
import { insertTaskEvent, readTask, type TaskRow, taskEffect, tasksFrom } from "./task-rows.ts";

/** The record a move is asked for: an Entry or a Project, each taking its whole unit. */
export type MoveSeed = { kind: MoveKind; id: string };

/**
 * A move as the Context it leaves holds it and the Deployment object carries it: its id, under
 * which the Context it goes to takes it once, the record asked for, and its unit as it goes.
 */
export type Move = { id: string; record: MoveSeed; unit: MovingUnit };

/** Who asked for a move and when it arrived, which both Contexts' change logs record. */
export type MovedBy = { caller: Caller; at: number };

/**
 * What the Context a unit leaves answered when it took the unit out, kept with the move so that,
 * asked again after its answer was lost, it answers the same.
 */
export type Begun = { record: RecordNamed; unit: RecordNamed[]; effects: Effect[] };

/** A unit's records by kind, each list in the order made. */
type UnitIds = { entries: string[]; tasks: string[]; projects: string[] };

/**
 * The unit of a record not in the Trash (section 3.9), or null when there is no such record. An
 * Entry's is the Entry, its Follow-ups and theirs in turn, and the Tasks that came from them; a
 * Project's is the Project, its Tasks, their Origin Entries, those Entries' Follow-ups and theirs
 * in turn, and any other Tasks those Entries made, and goes no further. A Task never leaves its
 * Origin Entry. Nothing in the Trash is in it.
 */
function unitIds(sql: SqlStorage, seed: MoveSeed): UnitIds | null {
  if (!untrashed(sql, seed)) return null;
  const from =
    seed.kind === "entry"
      ? [seed.id]
      : sql
          .exec<{ id: string }>(
            `SELECT DISTINCT origin_entry AS id FROM untrashed_tasks WHERE project = ?`,
            seed.id,
          )
          .toArray()
          .map((row) => row.id);
  const entries = sql
    .exec<{ id: string }>(
      `WITH RECURSIVE thread (id) AS (
         SELECT value FROM json_each(?)
         UNION
         SELECT e.id FROM untrashed_entries e JOIN thread t ON e.follow_up_to = t.id
       )
       SELECT id FROM untrashed_entries WHERE id IN (SELECT id FROM thread) ORDER BY seq`,
      JSON.stringify(from),
    )
    .toArray()
    .map((row) => row.id);
  const tasks = sql
    .exec<{ id: string }>(
      `SELECT id FROM untrashed_tasks WHERE origin_entry IN (SELECT value FROM json_each(?))
       ORDER BY seq`,
      JSON.stringify(entries),
    )
    .toArray()
    .map((row) => row.id);
  return { entries, tasks, projects: seed.kind === "project" ? [seed.id] : [] };
}

/** Each of these records named, in the order given. */
function named(sql: SqlStorage, records: { kind: RecordKind; id: string }[]): RecordNamed[] {
  const summaries = new Map(
    sql
      .exec<{ record: string; summary: string }>(
        `SELECT 'entry:' || id AS record, words AS summary FROM entries
           WHERE id IN (SELECT value FROM json_each(?1))
         UNION ALL SELECT 'task:' || id, title FROM tasks
           WHERE id IN (SELECT value FROM json_each(?1))
         UNION ALL SELECT 'project:' || id, name FROM projects
           WHERE id IN (SELECT value FROM json_each(?1))`,
        JSON.stringify(records.map(({ id }) => id)),
      )
      .toArray()
      .map((row) => [row.record, row.summary]),
  );
  return records.map((record) => ({
    ...record,
    summary: summarizeWords(summaries.get(`${record.kind}:${record.id}`) ?? ""),
  }));
}

/** A unit's records in the order shown: the one asked for, then the Entries, then the Tasks. */
function inOrder(seed: MoveSeed | null, ids: UnitIds): { kind: RecordKind; id: string }[] {
  const all = [
    ...ids.projects.map((id) => ({ kind: "project" as const, id })),
    ...ids.entries.map((id) => ({ kind: "entry" as const, id })),
    ...ids.tasks.map((id) => ({ kind: "task" as const, id })),
  ];
  const asked = all.find((record) => record.kind === seed?.kind && record.id === seed.id);
  return asked ? [asked, ...all.filter((record) => record !== asked)] : all;
}

/** The Tasks in the Trash whose Origin Entry is among these Entries. */
function tasksInTheTrash(sql: SqlStorage, entries: string[]): RecordNamed[] {
  const ids = sql
    .exec<{ id: string }>(
      `SELECT t.id FROM tasks t JOIN trashed r ON r.kind = 'task' AND r.record_id = t.id
       WHERE t.origin_entry IN (SELECT value FROM json_each(?)) ORDER BY t.seq`,
      JSON.stringify(entries),
    )
    .toArray()
    .map((row) => ({ kind: "task" as const, id: row.id }));
  return named(sql, ids);
}

/** What moving a record would take, for the person to see, or null when there is no such record. */
export function moveUnit(sql: SqlStorage, seed: MoveSeed): MoveUnit | null {
  const ids = unitIds(sql, seed);
  if (ids === null) return null;
  const unit = named(sql, inOrder(seed, ids));
  return {
    record: unit[0] as RecordNamed,
    unit,
    in_the_trash: tasksInTheTrash(sql, ids.entries),
  };
}

/**
 * Take a unit out of this Context, as the move it goes in, at `at` (section 3.9). Whatever links
 * across the boundary is dropped, the words kept: from what stays, a Reference to what goes and a
 * wait on it, each record that stays changed by rule; from what goes, every Mention, a Reference
 * or wait or Follow-up link to what stays, a delegation, which is taken back, a place in a Project
 * that stays, and a Standing mark. A dormant link to it from what is in the Trash is dropped with
 * no Effect, and each Held Change on an Entry that goes lapses. Then the unit's rows go from every
 * table: it is in no view, and the move holds it until the other Context has taken it.
 *
 * Returns the unit as it goes, and the Effects here: each record in it deleted, with no summary,
 * the one asked for by the call and the rest by rule, then each record that stays and lost a
 * link, then each Held Change lapsed. The summaries the change log held of the unit's records
 * are blanked, as a removal for good blanks them: none of their words stays here.
 */
export function takeOut(
  sql: SqlStorage,
  seed: MoveSeed,
  at: number,
  today: Day,
): { unit: MovingUnit; effects: Effect[] } | null {
  const ids = unitIds(sql, seed);
  if (ids === null) return null;
  const all = [...ids.entries, ...ids.tasks, ...ids.projects];
  const goes = new Set(all);
  const unitJson = JSON.stringify(all);
  // Nothing of what left is kept in this Context's words, so a record removed for good where it
  // went is gone from everything within 30 days (section 3.8).
  const gone = inOrder(seed, ids).map(
    (record, place): Effect => ({
      ...record,
      what: "deleted",
      summary: "",
      by: place === 0 ? "call" : "rule",
    }),
  );
  // Read as it goes before anything is dropped, so it holds what it links to inside it.
  const unit: MovingUnit = {
    entries: entries(sql, ids.entries).map((entry) => goingEntry(entry, goes)),
    tasks: tasks(sql, ids.tasks).map((task) => goingTask(sql, task, goes, at, today)),
    projects: projects(sql, ids.projects),
  };

  const referring = sql
    .exec<{ id: string; words: string }>(
      `SELECT id, words FROM untrashed_entries
       WHERE id NOT IN (SELECT value FROM json_each(?1))
         AND id IN (SELECT entry FROM entry_links WHERE to_id IN (SELECT value FROM json_each(?1)))
       ORDER BY seq`,
      unitJson,
    )
    .toArray()
    .map(
      (entry): Effect => ({
        kind: "entry",
        id: entry.id,
        what: "changed",
        summary: summarizeWords(entry.words),
        by: "rule",
      }),
    );
  const released = stopWaitsOnUnit(sql, goes, at, today).map((task) =>
    taskEffect(task, "changed", "rule"),
  );
  const lapsed = lapseHeldChangesOn(sql, ids.entries);

  sql.exec(`DELETE FROM entry_links WHERE to_id IN (SELECT value FROM json_each(?))`, unitJson);
  sql.exec(
    `UPDATE entries SET follow_up_to = NULL WHERE follow_up_to IN (SELECT value FROM json_each(?))`,
    unitJson,
  );
  sql.exec(
    `UPDATE tasks SET project = NULL WHERE project IN (SELECT value FROM json_each(?))`,
    unitJson,
  );
  sql.exec(`DELETE FROM dormant_links WHERE task IN (SELECT value FROM json_each(?))`, unitJson);
  sql.exec(
    `UPDATE changes SET summary = '' WHERE record_id IN (SELECT value FROM json_each(?))`,
    unitJson,
  );
  for (const [table, column] of [
    ["entry_links", "entry"],
    ["entry_versions", "entry"],
    ["standing_marks", "entry"],
    ["task_events", "task"],
    ["project_events", "project"],
    ["tasks", "id"],
    ["entries", "id"],
    ["projects", "id"],
  ] as const) {
    sql.exec(`DELETE FROM ${table} WHERE ${column} IN (SELECT value FROM json_each(?))`, unitJson);
  }
  return { unit, effects: [...gone, ...referring, ...released, ...lapsed] };
}

/** An Entry as it goes: links, a Follow-up link and a Standing mark that cross are dropped. */
function goingEntry(entry: ExportedEntry, goes: Set<string>): ExportedEntry {
  return {
    ...entry,
    follow_up_to:
      entry.follow_up_to !== null && goes.has(entry.follow_up_to) ? entry.follow_up_to : null,
    links: entry.links.filter((link) => link.to.kind !== "person" && goes.has(link.to.id)),
    standing: false,
  };
}

/**
 * A Task as it goes: a place in a Project that stays is dropped, and so is every delegation, its
 * Person staying; one it is Delegated in now is taken back at `at`, and each wait on what stays
 * stops then, so it arrives as one taken back or whose wait ended.
 */
function goingTask(
  sql: SqlStorage,
  task: ExportedTask,
  goes: Set<string>,
  at: number,
  today: Day,
): ExportedTask {
  const state = (readTask(sql, task.id, today) as Task).state;
  const when = instantToIso(at);
  const dropped: ExportedTaskEvent[] = [];
  if (state.is === "open") {
    if (state.delegated !== null) dropped.push({ what: "taken_back", at: when });
    for (const { on } of state.waiting ?? []) {
      if (!goes.has(on.id)) {
        dropped.push({ what: "stopped_waiting", at: when, on: { kind: on.kind, id: on.id } });
      }
    }
  }
  return {
    ...task,
    project: task.project !== null && goes.has(task.project) ? task.project : null,
    events: [...task.events.filter((event) => event.what !== "delegated"), ...dropped],
  };
}

/**
 * Each open Task that stays and waits on something that goes stops waiting on it, by rule.
 * Returns the Tasks changed, as they are now.
 */
function stopWaitsOnUnit(sql: SqlStorage, goes: Set<string>, at: number, today: Day): Task[] {
  const rows = sql
    .exec<TaskRow>(
      `SELECT * FROM untrashed_tasks
       WHERE id NOT IN (SELECT value FROM json_each(?1))
         AND id IN (SELECT task FROM task_events
                    WHERE what = 'waited_on' AND on_id IN (SELECT value FROM json_each(?1)))
       ORDER BY seq`,
      JSON.stringify([...goes]),
    )
    .toArray();
  return tasksFrom(sql, rows, today).flatMap((task) => {
    if (task.state.is !== "open") return [];
    const ended = (task.state.waiting ?? []).filter(({ on }) => goes.has(on.id));
    if (ended.length === 0) return [];
    for (const { on } of ended) {
      insertTaskEvent(sql, task.id, {
        what: "stopped_waiting",
        at,
        on: { kind: on.kind, id: on.id },
      });
    }
    return [readTask(sql, task.id, today) as Task];
  });
}

/**
 * Put a unit into this Context's tables as it came, every id, Version, event, Recurrence and Author
 * kept, and nothing made or matched beside it. Returns each record made, the one asked for by the
 * call and the rest by rule, in the order a unit is shown: the one asked for first, then the
 * Entries, then the Tasks. With no record asked for, as when a unit comes back to the Context it
 * left, each is made by rule.
 */
export function putIn(sql: SqlStorage, seed: MoveSeed | null, unit: MovingUnit): Effect[] {
  for (const project of unit.projects) {
    sql.exec(
      `INSERT INTO projects (id, name, at, due_date) VALUES (?, ?, ?, ?)`,
      project.id,
      project.name,
      Date.parse(project.at),
      project.due_date,
    );
    for (const event of project.events) {
      sql.exec(
        `INSERT INTO project_events (project, what, at) VALUES (?, ?, ?)`,
        project.id,
        event.what,
        Date.parse(event.at),
      );
    }
  }
  // A Follow-up link is set once every Entry it can name is in.
  for (const entry of unit.entries) {
    sql.exec(
      `INSERT INTO entries (id, words, at, author_kind, author_name, through_conversation)
       VALUES (?, ?, ?, ?, ?, ?)`,
      entry.id,
      entry.words,
      Date.parse(entry.at),
      ...authorColumns(entry.author),
      entry.through_conversation ? 1 : 0,
    );
    for (const version of entry.versions) {
      sql.exec(
        `INSERT INTO entry_versions (entry, version, words, at, author_kind, author_name)
         VALUES (?, ?, ?, ?, ?, ?)`,
        entry.id,
        version.version,
        version.words,
        Date.parse(version.changed.at),
        ...authorColumns(version.changed.by),
      );
    }
    for (const link of entry.links) {
      sql.exec(
        `INSERT INTO entry_links (entry, to_kind, to_id, anchor_start, anchor_end, anchor_text)
         VALUES (?, ?, ?, ?, ?, ?)`,
        entry.id,
        link.to.kind,
        link.to.id,
        link.anchor?.start ?? null,
        link.anchor?.end ?? null,
        link.anchor?.text ?? null,
      );
    }
  }
  for (const entry of unit.entries) {
    if (entry.follow_up_to !== null) {
      sql.exec(`UPDATE entries SET follow_up_to = ? WHERE id = ?`, entry.follow_up_to, entry.id);
    }
  }
  for (const task of unit.tasks) {
    sql.exec(
      `INSERT INTO tasks
         (id, title, origin_entry, at, author_kind, author_name, project, due_date, defer_date,
          recurrence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      task.id,
      task.title,
      task.origin_entry,
      Date.parse(task.at),
      ...authorColumns(task.author),
      task.project,
      task.due_date,
      task.defer_date,
      task.recurrence === null ? null : JSON.stringify(task.recurrence),
    );
    for (const event of task.events) {
      sql.exec(
        `INSERT INTO task_events (task, what, at, person, on_kind, on_id) VALUES (?, ?, ?, ?, ?, ?)`,
        task.id,
        event.what,
        Date.parse(event.at),
        "person" in event ? event.person : null,
        "on" in event ? event.on.kind : null,
        "on" in event ? event.on.id : null,
      );
    }
  }
  const ids: UnitIds = {
    entries: unit.entries.map(({ id }) => id),
    tasks: unit.tasks.map(({ id }) => id),
    projects: unit.projects.map(({ id }) => id),
  };
  return named(sql, inOrder(seed, ids)).map(
    (record): Effect => ({
      ...record,
      what: "made",
      by: seed !== null && record.kind === seed.kind && record.id === seed.id ? "call" : "rule",
    }),
  );
}

type MoveOutRow = { id: string; to_context: string; at: number; caller: string; move: string };

/** A move this Context holds on its way out, with where it goes, who asked and what it answered. */
export type MoveOut = { move: Move; to: string; by: MovedBy; begun: Begun };

/**
 * Hold a unit on its way out until the Context it goes to has said it took it, with what taking
 * it out answered.
 */
export function holdMove(
  sql: SqlStorage,
  out: { move: Move; to: string; by: MovedBy; begun: Begun },
): void {
  const { move, to, by, begun } = out;
  const { id, ...rest } = move;
  const held = { ...rest, begun };
  sql.exec(
    `INSERT INTO moves_out (id, to_context, at, caller, move) VALUES (?, ?, ?, ?, ?)`,
    id,
    to,
    by.at,
    JSON.stringify(by.caller),
    JSON.stringify(held),
  );
}

/** Each move this Context holds on its way out, in the order asked for. */
export function movesOut(sql: SqlStorage): MoveOut[] {
  return sql
    .exec<MoveOutRow>(`SELECT * FROM moves_out ORDER BY seq`)
    .toArray()
    .map((row) => {
      const { begun, ...move } = JSON.parse(row.move) as Omit<Move, "id"> & { begun: Begun };
      return {
        move: { id: row.id, ...move },
        to: row.to_context,
        by: { caller: JSON.parse(row.caller) as Caller, at: row.at },
        begun,
      };
    });
}

/** The move this Context holds on its way out for this record, asked for before, if any. */
export function moveHolding(sql: SqlStorage, seed: MoveSeed): MoveOut | null {
  return (
    movesOut(sql).find(
      ({ move }) => move.record.kind === seed.kind && move.record.id === seed.id,
    ) ?? null
  );
}

/** A move is done with here: the other Context took it, or this one took it back. */
export function letGo(sql: SqlStorage, move: string): void {
  sql.exec(`DELETE FROM moves_out WHERE id = ?`, move);
}

/**
 * The Effects of taking a unit under this move, when this Context already took it: as noted, or,
 * once the note is forgotten, none, when a record of the unit is here already, since it came with
 * that move.
 */
export function takenAlready(sql: SqlStorage, move: Move): Effect[] | null {
  const row = sql
    .exec<{ effects: string }>(`SELECT effects FROM moves_in WHERE id = ?`, move.id)
    .toArray()[0];
  if (row) return JSON.parse(row.effects) as Effect[];
  const here = sql
    .exec(
      `SELECT 1 FROM entries WHERE id IN (SELECT value FROM json_each(?1))
       UNION ALL SELECT 1 FROM projects WHERE id IN (SELECT value FROM json_each(?1))`,
      JSON.stringify([...move.unit.entries, ...move.unit.projects].map(({ id }) => id)),
    )
    .toArray();
  return here.length > 0 ? [] : null;
}

/** Note that this Context took a unit under this move id at `at`, with the Effects it had. */
export function noteTaken(sql: SqlStorage, move: string, effects: Effect[], at: number): void {
  sql.exec(
    `INSERT INTO moves_in (id, effects, at) VALUES (?, ?, ?)`,
    move,
    JSON.stringify(effects),
    at,
  );
}

/**
 * Forget the moves taken 30 days or more before `at`, as keys are forgotten: their Effects hold
 * the records' summaries, and a move is asked again within minutes, not weeks.
 */
export function forgetMovesTaken(sql: SqlStorage, at: number): void {
  sql.exec(`DELETE FROM moves_in WHERE at <= ?`, keysForgottenBy(at));
}
