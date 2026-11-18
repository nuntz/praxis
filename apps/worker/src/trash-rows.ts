import {
  type Day,
  dayIn,
  type Effect,
  instantToIso,
  type RecordKind,
  type RecordNamed,
  removedForGoodAt,
  summarizeWords,
  type Task,
  type TrashItem,
  type WaitTarget,
  type Written,
  waitKey,
  written,
} from "@praxis/domain";
import { readPerson } from "./person-rows.ts";
import { summaryColumnOf, tableOf, untrashed } from "./record-tables.ts";
import { timeZoneOf } from "./settings.ts";
import {
  insertTaskEvent,
  readTask,
  setTaskProject,
  type TaskRow,
  taskEffect,
  tasksFrom,
} from "./task-rows.ts";
import { waitPath } from "./wait-rows.ts";

/** A record as the Trash holds it: its kind and its id. */
export type RecordRef = { kind: RecordKind; id: string };

export type ItemRow = { seq: number; id: string; kind: RecordKind; record_id: string; at: number };

/** How a link from a Task not in the Trash to a record in the Trash was taken away, to bring it back. */
type DormantWhat = "project" | "delegation" | "wait";

/**
 * Open an item in the Trash for one delete at `at`: the record deleted, then what went with it,
 * each sent there. Returns the item's id. The records stay in their tables, out of every read.
 */
export function sendToTrash(
  sql: SqlStorage,
  deleted: RecordRef,
  wentWith: RecordRef[],
  at: number,
): string {
  const item = crypto.randomUUID();
  sql.exec(
    `INSERT INTO trash_items (id, kind, record_id, at) VALUES (?, ?, ?, ?)`,
    item,
    deleted.kind,
    deleted.id,
    at,
  );
  for (const record of [deleted, ...wentWith]) {
    sql.exec(
      `INSERT INTO trashed (kind, record_id, item) VALUES (?, ?, ?)`,
      record.kind,
      record.id,
      item,
    );
  }
  return item;
}

/**
 * Each open Task not in the Trash that waits on one of these records stops waiting on it, by
 * rule, and the wait is kept dormant in the item so a restore can bring it back. Returns the
 * Tasks changed, as they are now.
 */
export function stopWaitsOn(
  sql: SqlStorage,
  item: string,
  targets: WaitTarget[],
  at: number,
  today: Day,
): Task[] {
  const keys = new Set(targets.map(waitKey));
  const rows = sql
    .exec<TaskRow>(
      `SELECT * FROM untrashed_tasks WHERE id IN (
         SELECT task FROM task_events
         WHERE what = 'waited_on' AND on_id IN (SELECT value FROM json_each(?)))
       ORDER BY seq`,
      JSON.stringify(targets.map(({ id }) => id)),
    )
    .toArray();
  return tasksFrom(sql, rows, today).flatMap((task) => {
    if (task.state.is !== "open") return [];
    const ended = (task.state.waiting ?? []).filter(({ on }) => keys.has(waitKey(on)));
    if (ended.length === 0) return [];
    for (const { on } of ended) {
      const target = { kind: on.kind, id: on.id };
      insertTaskEvent(sql, task.id, { what: "stopped_waiting", at, on: target });
      keepDormant(sql, item, task.id, "wait", target);
    }
    return [readTask(sql, task.id, today) as Task];
  });
}

/**
 * Each Task not in the Trash in this Project leaves it, by rule, and shows no Project; its place
 * there is kept dormant in the item so a restore can bring it back. Returns the Tasks changed.
 */
export function leaveProject(sql: SqlStorage, item: string, project: string, today: Day): Task[] {
  const rows = sql
    .exec<TaskRow>(`SELECT * FROM untrashed_tasks WHERE project = ? ORDER BY seq`, project)
    .toArray();
  for (const row of rows) {
    setTaskProject(sql, row.id, null);
    keepDormant(sql, item, row.id, "project", { kind: "project", id: project });
  }
  return rows.map((row) => readTask(sql, row.id, today) as Task);
}

/**
 * Each open Task not in the Trash Delegated to this Person is taken back, by rule, and the
 * delegation is kept dormant in the item so a restore can bring it back. Returns the Tasks
 * changed.
 */
export function takeBackFrom(
  sql: SqlStorage,
  item: string,
  person: string,
  at: number,
  today: Day,
): Task[] {
  const rows = sql
    .exec<TaskRow>(
      `SELECT * FROM untrashed_tasks WHERE id IN (
         SELECT task FROM task_events WHERE what = 'delegated' AND person = ?)
       ORDER BY seq`,
      person,
    )
    .toArray();
  return tasksFrom(sql, rows, today).flatMap((task) => {
    if (task.state.is !== "open" || task.state.delegated?.to.id !== person) return [];
    insertTaskEvent(sql, task.id, { what: "taken_back", at });
    keepDormant(sql, item, task.id, "delegation", { kind: "person", id: person });
    return [readTask(sql, task.id, today) as Task];
  });
}

function keepDormant(
  sql: SqlStorage,
  item: string,
  task: string,
  what: DormantWhat,
  to: RecordRef,
): void {
  sql.exec(
    `INSERT INTO dormant_links (item, task, what, to_kind, to_id) VALUES (?, ?, ?, ?, ?)`,
    item,
    task,
    what,
    to.kind,
    to.id,
  );
}

/**
 * What a delete returns: the item it sent to the Trash, and its Effects. Each record sent there
 * is one, the one deleted by the call and what went with it by rule, and then each Task a rule
 * changed, once, as it is now.
 */
export function deleted(
  sql: SqlStorage,
  item: string,
  changedByRule: Task[],
  today: Day,
): Written<TrashItem> {
  const sent = readItem(sql, item) as TrashItem;
  const changed = new Set(changedByRule.map((task) => task.id));
  return written(sent, [
    { ...sent.record, what: "deleted", by: "call" },
    ...sent.went_with.map((each): Effect => ({ ...each, what: "deleted", by: "rule" })),
    ...[...changed].map((id) => taskEffect(readTask(sql, id, today) as Task, "changed", "rule")),
  ]);
}

/** An item in the Trash, by its id, or null when there is none. */
export function readItem(sql: SqlStorage, item: string): TrashItem | null {
  const row = sql.exec<ItemRow>(`SELECT * FROM trash_items WHERE id = ?`, item).toArray()[0];
  return row ? (itemsFrom(sql, [row])[0] ?? null) : null;
}

/** The items their rows hold, each with its records named. */
export function itemsFrom(sql: SqlStorage, rows: ItemRow[]): TrashItem[] {
  const records = Map.groupBy(
    sql
      .exec<{ item: string; kind: RecordKind; record_id: string; summary: string }>(
        `SELECT t.item, t.kind, t.record_id, coalesce(e.words, ta.title, p.name, pe.name) AS summary
         FROM trashed t
         LEFT JOIN entries e ON t.kind = 'entry' AND e.id = t.record_id
         LEFT JOIN tasks ta ON t.kind = 'task' AND ta.id = t.record_id
         LEFT JOIN projects p ON t.kind = 'project' AND p.id = t.record_id
         LEFT JOIN persons pe ON t.kind = 'person' AND pe.id = t.record_id
         WHERE t.item IN (SELECT value FROM json_each(?))
         ORDER BY t.seq`,
        JSON.stringify(rows.map((row) => row.id)),
      )
      .toArray(),
    (row) => row.item,
  );
  return rows.map((row) => {
    const named = (records.get(row.id) ?? []).map(
      (each): RecordNamed => ({
        kind: each.kind,
        id: each.record_id,
        summary: summarizeWords(each.summary),
      }),
    );
    const [record, ...wentWith] = named;
    return {
      record: record as RecordNamed,
      went_with: wentWith,
      deleted_at: instantToIso(row.at),
      removed_at: instantToIso(removedForGoodAt(row.at)),
    };
  });
}

/** The id of the item in the Trash holding this record, or null when it is not in the Trash. */
export function itemHolding(sql: SqlStorage, record: string): string | null {
  return (
    sql.exec<{ item: string }>(`SELECT item FROM trashed WHERE record_id = ?`, record).toArray()[0]
      ?.item ?? null
  );
}

/** An item is gone from the Trash, with the dormant links it kept: its records are back, or gone. */
function takeOutOfTrash(sql: SqlStorage, item: string): void {
  sql.exec(`DELETE FROM dormant_links WHERE item = ?`, item);
  sql.exec(`DELETE FROM trashed WHERE item = ?`, item);
  sql.exec(`DELETE FROM trash_items WHERE id = ?`, item);
}

/** The records in an item, the one deleted first. */
function recordsIn(sql: SqlStorage, item: string): RecordRef[] {
  return sql
    .exec<{ kind: RecordKind; record_id: string }>(
      `SELECT kind, record_id FROM trashed WHERE item = ? ORDER BY seq`,
      item,
    )
    .toArray()
    .map((row) => ({ kind: row.kind, id: row.record_id }));
}

/**
 * Bring back from the Trash the item holding this record, at `at`, and with it the item holding
 * the Origin Entry of any Task in it: a Task is never back without its Origin Entry. Each
 * dormant link a delete took from a Task comes back unless its other end has changed since (section
 * 3.8). Returns the item as it was, and the Effects: each record back, the one asked for's item
 * by the call and the rest by rule, then each Task a link came back to.
 */
export function restoreItem(
  sql: SqlStorage,
  item: string,
  at: number,
  today: Day,
): { item: TrashItem; effects: Effect[] } {
  const asked = readItem(sql, item) as TrashItem;
  const items = [item, ...originItems(sql, item)];
  const back = items.flatMap((each) => recordsIn(sql, each));
  const links = items.flatMap((each) => dormantIn(sql, each));
  for (const each of items) takeOutOfTrash(sql, each);
  const relinked = links.flatMap((link) => {
    // A link whose Task is in the Trash itself waits there with it, to come back when it does.
    const taskItem = itemHolding(sql, link.task);
    if (taskItem) {
      keepDormant(sql, taskItem, link.task, link.what, link.to);
      return [];
    }
    return bringBack(sql, link, at, today) ? [link.task] : [];
  });
  // A Task back from the Trash holds no link to what is in it now, or a wait on what has closed.
  for (const record of back) {
    if (record.kind === "task") settle(sql, record.id, at, today);
  }
  const inAsked = [asked.record, ...asked.went_with];
  const backIds = new Set(back.map((record) => record.id));
  return {
    item: asked,
    effects: [
      ...inAsked.map(
        (record, index): Effect => ({ ...record, what: "made", by: index === 0 ? "call" : "rule" }),
      ),
      ...back
        .slice(inAsked.length)
        .map((record): Effect => ({ ...nameOf(sql, record), what: "made", by: "rule" })),
      ...[...new Set(relinked)]
        .filter((task) => !backIds.has(task))
        .map((task) => taskEffect(readTask(sql, task, today) as Task, "changed", "rule")),
    ],
  };
}

/**
 * The items holding the Origin Entry of a Task in this item, when that Entry is in the Trash on
 * its own item: they come back with it.
 */
function originItems(sql: SqlStorage, item: string): string[] {
  return sql
    .exec<{ item: string }>(
      `SELECT DISTINCT o.item FROM trashed t
       JOIN tasks ta ON t.kind = 'task' AND ta.id = t.record_id
       JOIN trashed o ON o.kind = 'entry' AND o.record_id = ta.origin_entry
       WHERE t.item = ? AND o.item != ?`,
      item,
      item,
    )
    .toArray()
    .map((row) => row.item);
}

/** A record as an Effect names it, from its row, in the Trash or not. */
function nameOf(sql: SqlStorage, record: RecordRef): RecordNamed {
  const row = sql
    .exec<{ summary: string }>(
      `SELECT ${summaryColumnOf[record.kind]} AS summary FROM ${tableOf[record.kind]} WHERE id = ?`,
      record.id,
    )
    .one();
  return { ...record, summary: summarizeWords(row.summary) };
}

type DormantLink = { task: string; what: DormantWhat; to: RecordRef };

function dormantIn(sql: SqlStorage, item: string): DormantLink[] {
  return sql
    .exec<{ task: string; what: DormantWhat; to_kind: RecordKind; to_id: string }>(
      `SELECT task, what, to_kind, to_id FROM dormant_links WHERE item = ? ORDER BY seq`,
      item,
    )
    .toArray()
    .map((row) => ({ task: row.task, what: row.what, to: { kind: row.to_kind, id: row.to_id } }));
}

/**
 * A dormant link comes back to its Task unless its other end has changed since: a Task moved to
 * another Project stays there, one Delegated to someone else or closed stays so, and a wait
 * resumes only while the Task is open, and never to close a cycle. Returns whether it came back.
 */
function bringBack(sql: SqlStorage, link: DormantLink, at: number, today: Day): boolean {
  const task = readTask(sql, link.task, today);
  if (!task) return false;
  if (link.what === "project") {
    if (task.project !== null) return false;
    setTaskProject(sql, task.id, link.to.id);
    return true;
  }
  if (task.state.is !== "open") return false;
  if (link.what === "delegation") {
    const person = readPerson(sql, link.to.id);
    if (task.state.delegated !== null || !person) return false;
    insertTaskEvent(sql, task.id, {
      what: "delegated",
      at,
      to: { id: person.id, name: person.name },
    });
    return true;
  }
  const on = link.to as WaitTarget;
  if ((task.state.waiting ?? []).some((wait) => waitKey(wait.on) === waitKey(on))) return false;
  if (on.kind === "task" && waitPath(sql, on.id, task.id, today) !== null) return false;
  const waitedOn = nameOf(sql, on);
  insertTaskEvent(sql, task.id, {
    what: "waited_on",
    at,
    on:
      on.kind === "task"
        ? { kind: "task", id: on.id, title: waitedOn.summary }
        : { kind: "project", id: on.id, name: waitedOn.summary },
  });
  return true;
}

/**
 * A Task back from the Trash holds no link to a record that is in the Trash now, or gone: each is
 * taken away as a delete of that record would have, and kept dormant in its item. A wait on what
 * reached an end while it was away is released.
 */
function settle(sql: SqlStorage, id: string, at: number, today: Day): void {
  const task = readTask(sql, id, today) as Task;
  if (task.project !== null && !untrashed(sql, { kind: "project", id: task.project })) {
    setTaskProject(sql, task.id, null);
    const item = itemHolding(sql, task.project);
    if (item) keepDormant(sql, item, task.id, "project", { kind: "project", id: task.project });
  }
  if (task.state.is !== "open") return;
  const delegated = task.state.delegated;
  if (delegated && !untrashed(sql, { kind: "person", id: delegated.to.id })) {
    insertTaskEvent(sql, task.id, { what: "taken_back", at });
    const item = itemHolding(sql, delegated.to.id);
    if (item)
      keepDormant(sql, item, task.id, "delegation", { kind: "person", id: delegated.to.id });
  }
  for (const { on } of task.state.waiting ?? []) {
    const target = { kind: on.kind, id: on.id };
    if (!untrashed(sql, target)) {
      insertTaskEvent(sql, task.id, { what: "stopped_waiting", at, on: target });
      const item = itemHolding(sql, on.id);
      if (item) keepDormant(sql, item, task.id, "wait", target);
    } else if (closed(sql, target, today)) {
      insertTaskEvent(sql, task.id, { what: "released", at, on: target });
    }
  }
}

/** Whether a Task or Project not in the Trash has reached an end. */
function closed(sql: SqlStorage, target: WaitTarget, today: Day): boolean {
  if (target.kind === "task") return readTask(sql, target.id, today)?.state.is !== "open";
  const last = sql
    .exec<{ what: string }>(
      `SELECT what FROM project_events WHERE project = ? ORDER BY seq DESC LIMIT 1`,
      target.id,
    )
    .toArray()[0];
  return last !== undefined && last.what !== "reopened";
}

/**
 * Remove for good each item 30 days old by `at`, as the Context's alarm does. It is no call, so
 * it goes in no change log, and a reader learns of it by reading; the summaries of what it removes
 * are blanked in the log all the same.
 */
export function expireTrash(sql: SqlStorage, at: number): void {
  const due = sql
    .exec<{ id: string }>(
      `SELECT id FROM trash_items WHERE at <= ? ORDER BY seq`,
      at - removedForGoodAt(0),
    )
    .toArray()
    .map((row) => row.id);
  if (due.length > 0) removeForGood(sql, due, dayIn(at, timeZoneOf(sql)));
}

/** When the oldest item in the Trash is due to be removed for good, or null when it is empty. */
export function nextExpiry(sql: SqlStorage): number | null {
  const { at } = sql.exec<{ at: number | null }>(`SELECT min(at) AS at FROM trash_items`).one();
  return at === null ? null : removedForGoodAt(at);
}

/** Every item in the Trash, oldest first. */
export function everyItem(sql: SqlStorage): string[] {
  return sql
    .exec<{ id: string }>(`SELECT id FROM trash_items ORDER BY seq`)
    .toArray()
    .map((row) => row.id);
}

/**
 * Each column that references a record, and how `removeForGood` clears it, since foreign keys are
 * enforced and a reference left behind fails the removal. Kept by hand: the oracle fails on a
 * column referencing a record that is not here, so a new one is cleared below before it is listed.
 */
export const REFERENCES_CLEARED = {
  "entries.follow_up_to": "set to null: a Follow-up of a removed Entry becomes an ordinary Entry",
  "entry_versions.entry": "removed with the Entry",
  "standing_marks.entry": "removed with the Entry",
  "entry_links.entry": "removed with the Entry",
  "tasks.origin_entry": "an Entry's Tasks are removed with it, deleted on their own or not",
  "tasks.project": "set to null: a Task that left a removed Project has none",
  "task_events.task": "removed with the Task",
  "task_events.person": "a delegation to a removed Person is removed",
  "project_events.project": "removed with the Project",
  "dormant_links.task": "removed with the Task",
  "held_changes.entry": "removed with the Entry, though one lapses as its Entry goes to the Trash",
} as const;

/**
 * Remove these items from the Trash for good (section 3.8), and with them the item of any Task
 * deleted on its own whose Origin Entry is among them, since no Task is left without one. It
 * takes each record, everything deleted with it, all its Versions and every dormant link to it,
 * and leaves no marker: a Follow-up of a removed Entry becomes an ordinary Entry, a Task that left
 * a removed Project simply has no Project, and the record's summaries in the change log are
 * blanked. Returns how many items went, and the Effects: each record removed, with no summary,
 * the first of each item asked for by the call and the rest by rule; then each record not in the
 * Trash that lost a link.
 */
export function removeForGood(
  sql: SqlStorage,
  asked: string[],
  today: Day,
): { items: number; effects: Effect[] } {
  const items = [...asked, ...new Set(asked.flatMap((item) => orphanedItems(sql, item, asked)))];
  const removed = items.flatMap((item, index) =>
    recordsIn(sql, item).map(
      (record, at): Effect => ({
        ...record,
        what: "deleted",
        summary: "",
        by: at === 0 && index < asked.length ? "call" : "rule",
      }),
    ),
  );
  const ids = JSON.stringify(removed.map(({ id }) => id));
  const lost = lostLinks(sql, ids, today);
  // Every link to them goes, from records in the Trash or not, then what they hold of their own.
  sql.exec(`DELETE FROM entry_links WHERE to_id IN (SELECT value FROM json_each(?))`, ids);
  sql.exec(
    `UPDATE entries SET follow_up_to = NULL WHERE follow_up_to IN (SELECT value FROM json_each(?))`,
    ids,
  );
  sql.exec(
    `UPDATE tasks SET project = NULL WHERE project IN (SELECT value FROM json_each(?))`,
    ids,
  );
  sql.exec(
    `DELETE FROM task_events WHERE what = 'delegated' AND person IN (SELECT value FROM json_each(?))`,
    ids,
  );
  sql.exec(`DELETE FROM dormant_links WHERE task IN (SELECT value FROM json_each(?))`, ids);
  for (const item of items) takeOutOfTrash(sql, item);
  for (const [table, column] of [
    ["entry_links", "entry"],
    ["entry_versions", "entry"],
    ["standing_marks", "entry"],
    ["held_changes", "entry"],
    ["task_events", "task"],
    ["project_events", "project"],
    ["tasks", "id"],
    ["entries", "id"],
    ["projects", "id"],
    ["persons", "id"],
  ] as const) {
    sql.exec(`DELETE FROM ${table} WHERE ${column} IN (SELECT value FROM json_each(?))`, ids);
  }
  // The log still says what kind of record was made, changed and deleted, and by whom, but not in
  // what words.
  sql.exec(
    `UPDATE changes SET summary = '' WHERE record_id IN (SELECT value FROM json_each(?))`,
    ids,
  );
  return { items: items.length, effects: [...removed, ...lost] };
}

/** The items of Tasks deleted on their own whose Origin Entry is in this item. */
function orphanedItems(sql: SqlStorage, item: string, asked: string[]): string[] {
  return sql
    .exec<{ item: string }>(
      `SELECT DISTINCT t.item FROM trashed t
       JOIN tasks ta ON t.kind = 'task' AND ta.id = t.record_id
       JOIN trashed o ON o.kind = 'entry' AND o.record_id = ta.origin_entry AND o.item = ?
       WHERE t.item NOT IN (SELECT value FROM json_each(?))`,
      item,
      JSON.stringify(asked),
    )
    .toArray()
    .map((row) => row.item);
}

/**
 * Each record not in the Trash that loses a link when these records go for good, by rule: an
 * Entry with a dormant Reference, Mention or Follow-up link to one, and a Task once Delegated to a
 * Person among them.
 */
function lostLinks(sql: SqlStorage, ids: string, today: Day): Effect[] {
  const entries = sql
    .exec<{ id: string; words: string }>(
      `SELECT id, words FROM untrashed_entries
       WHERE id IN (SELECT entry FROM entry_links WHERE to_id IN (SELECT value FROM json_each(?)))
          OR follow_up_to IN (SELECT value FROM json_each(?))
       ORDER BY seq`,
      ids,
      ids,
    )
    .toArray();
  const tasks = sql
    .exec<TaskRow>(
      `SELECT * FROM untrashed_tasks WHERE id IN (
         SELECT task FROM task_events
         WHERE what = 'delegated' AND person IN (SELECT value FROM json_each(?)))
       ORDER BY seq`,
      ids,
    )
    .toArray();
  return [
    ...entries.map(
      (entry): Effect => ({
        kind: "entry",
        id: entry.id,
        what: "changed",
        summary: summarizeWords(entry.words),
        by: "rule",
      }),
    ),
    ...tasksFrom(sql, tasks, today).map((task) => taskEffect(task, "changed", "rule")),
  ];
}
