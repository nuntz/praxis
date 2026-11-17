import {
  authorOf,
  type Caller,
  type Day,
  type Effect,
  type Entry,
  type EntryNamed,
  failure,
  HELD_FOR_A_CONNECTION,
  instantToIso,
  type Link,
  type NewLink,
  type NewTask,
  PAGE_SIZE,
  success,
  summarizeWords,
  type ToolResult,
  type Version,
  type Written,
  written,
} from "@praxis/domain";
import { type AuthorColumns, authorColumns, toAuthor } from "../author.ts";
import {
  checkLink,
  deleteLinks,
  followAnchors,
  insertLinks,
  keepableLinks,
  linksOf,
} from "../link-rows.ts";
import { newestFirst } from "../newest-first.ts";
import type { Handlers } from "../registry.ts";
import { insertTask, taskEffect, tasksOf } from "../task-rows.ts";

const NO_SUCH_ENTRY = "No such Entry in this Context.";

/** Said to a caller whose change to the words was made against a Version no longer current. */
const STALE =
  "The Entry's words have changed since the version this change was made against: read the Entry again.";

type EntryRow = AuthorColumns & {
  seq: number;
  id: string;
  words: string;
  at: number;
  through_conversation: number;
  follow_up_to: string | null;
};

type VersionRow = AuthorColumns & {
  seq: number;
  entry: string;
  version: number;
  words: string;
  at: number;
};

export const entryTools: Pick<
  Handlers,
  | "record_entry"
  | "get_entry"
  | "list_entries"
  | "edit_entry"
  | "restore_entry_version"
  | "list_entry_versions"
  | "add_link"
  | "remove_link"
> = {
  record_entry({ caller, input, arrivedAt, today, sql }) {
    const links = keepableLinks(sql, input.words, input.links ?? []);
    // Like a link, a Follow-up naming no Entry here is not kept: the words are never refused.
    const followUpTo =
      input.follow_up_to !== undefined && entryExists(sql, input.follow_up_to)
        ? input.follow_up_to
        : null;
    const author = authorOf(caller);
    const id = crypto.randomUUID();
    // Only the Agent works from the Conversation: whatever it records came through it.
    const throughConversation = caller.kind === "agent";
    sql.exec(
      `INSERT INTO entries
         (id, words, at, author_kind, author_name, through_conversation, follow_up_to)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.words,
      arrivedAt,
      ...authorColumns(author),
      throughConversation ? 1 : 0,
      followUpTo,
    );
    // The Tasks come as a list beside the words. The words are never read to find them.
    for (const { title } of input.tasks ?? []) {
      insertTask(sql, { title, originEntry: id, at: arrivedAt, author });
    }
    // So do the links, and the words are never read to find them either.
    const made = insertLinks(sql, { id, words: input.words }, links, arrivedAt);
    const entry = readEntry(sql, id, today) as Entry;
    return success(
      written(entry, [
        entryEffect(entry, "made"),
        ...entry.tasks.map((task) => taskEffect(task, "made")),
        ...made,
      ]),
    );
  },

  edit_entry({ caller, input, arrivedAt, today, sql }) {
    const entry = readEntry(sql, input.id, today);
    if (!entry) return failure("not_found", NO_SUCH_ENTRY);
    return changeWords(
      { caller, arrivedAt, today, sql },
      entry,
      { version: input.version, words: input.words },
      input.tasks ?? [],
    );
  },

  restore_entry_version({ caller, input, arrivedAt, today, sql }) {
    const entry = readEntry(sql, input.id, today);
    if (!entry) return failure("not_found", NO_SUCH_ENTRY);
    const restored = sql
      .exec<{ words: string }>(
        `SELECT words FROM entry_versions WHERE entry = ? AND version = ?`,
        entry.id,
        input.restore,
      )
      .toArray()[0];
    if (!restored) return failure("not_found", "No such Version of this Entry.");
    // Restored words make no Task, whatever markers they hold: the words are never read for one.
    return changeWords(
      { caller, arrivedAt, today, sql },
      entry,
      { version: input.version, words: restored.words },
      [],
    );
  },

  list_entry_versions({ input, sql }) {
    if (!entryExists(sql, input.id)) return failure("not_found", NO_SUCH_ENTRY);
    // An Entry's Versions arrive in the order they are numbered, so newest first is by arrival,
    // and a cursor is one Entry's own.
    const page = newestFirst(`entry_versions:${input.id}`, input.cursor, (before) =>
      sql.exec<VersionRow>(
        `SELECT * FROM entry_versions WHERE entry = ? AND seq < ? ORDER BY seq DESC`,
        input.id,
        before,
      ),
    );
    if (!page.ok) return page;
    return success({
      items: page.value.rows.map(toVersion),
      next_cursor: page.value.next_cursor,
    });
  },

  add_link({ input, arrivedAt, today, sql }) {
    const entry = readEntry(sql, input.entry_id, today);
    if (!entry) return failure("not_found", NO_SUCH_ENTRY);
    const link = { to: input.to, anchor: input.anchor };
    const checked = checkLink(sql, entry.words, link);
    if (!checked.ok) return checked;
    if (alreadyLinks(entry.links, link)) return success(written(entry, []));
    // A link is kept beside the words: they never change, so no Version is made and nothing is held.
    const made = insertLinks(sql, entry, [link], arrivedAt);
    const linked = readEntry(sql, entry.id, today) as Entry;
    return success(written(linked, [entryEffect(linked, "changed"), ...made]));
  },

  remove_link({ input, today, sql }) {
    const entry = readEntry(sql, input.entry_id, today);
    if (!entry) return failure("not_found", NO_SUCH_ENTRY);
    if (!deleteLinks(sql, entry, input.to, input.anchor)) return success(written(entry, []));
    const unlinked = readEntry(sql, entry.id, today) as Entry;
    return success(written(unlinked, [entryEffect(unlinked, "changed")]));
  },

  get_entry({ input, today, sql }) {
    const entry = readEntry(sql, input.id, today);
    return entry ? success(entry) : failure("not_found", NO_SUCH_ENTRY);
  },

  list_entries({ input, today, sql }) {
    let after: Position | null = null;
    if (input.cursor !== undefined) {
      after = decodeCursor(input.cursor);
      if (!after) return failure("invalid_input", "The cursor is not one this list gave.");
    }
    // Newest first. One more than a page is read to learn whether another page follows.
    const rows = (
      after
        ? sql.exec<EntryRow>(
            `SELECT * FROM entries WHERE (at, seq) < (?, ?) ORDER BY at DESC, seq DESC LIMIT ?`,
            after.at,
            after.seq,
            PAGE_SIZE + 1,
          )
        : sql.exec<EntryRow>(
            `SELECT * FROM entries ORDER BY at DESC, seq DESC LIMIT ?`,
            PAGE_SIZE + 1,
          )
    ).toArray();
    const page = rows.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return success({
      items: readEntries(sql, page, today),
      next_cursor: rows.length > PAGE_SIZE && last ? encodeCursor(last) : null,
    });
  },
};

/** What a change to an Entry's words is given to run. */
type WordsCall = { caller: Caller; arrivedAt: number; today: Day; sql: SqlStorage };

/**
 * Change an Entry's words, as `edit_entry` and `restore_entry_version` both do: against the
 * version it was made against, keeping the words before as a Version, moving each anchor with
 * the change, and making the Tasks given. The person's words are theirs alone to change, and an
 * Entry the person edits becomes theirs.
 */
function changeWords(
  { caller, arrivedAt, today, sql }: WordsCall,
  entry: Entry,
  change: { version: number; words: string },
  tasks: NewTask[],
): ToolResult<Written<Entry>> {
  const wordsChanged = change.words !== entry.words;
  // Asking for the words it has, with no Task to make, is asking for what is already so.
  if (!wordsChanged && tasks.length === 0) return success(written(entry, []));
  // The Agent's call leaves a Held Change for the person's tap with #62. Until then it is refused.
  if (wordsChanged && entry.author.kind === "person" && caller.kind !== "hand") {
    return failure("held", HELD_FOR_A_CONNECTION);
  }
  if (change.version !== entry.version) return failure("stale", STALE);
  const by = authorOf(caller);
  if (wordsChanged) {
    sql.exec(
      `INSERT INTO entry_versions (entry, version, words, at, author_kind, author_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      entry.id,
      entry.version,
      entry.words,
      arrivedAt,
      ...authorColumns(by),
    );
    const author = caller.kind === "hand" ? by : entry.author;
    sql.exec(
      `UPDATE entries SET words = ?, author_kind = ?, author_name = ? WHERE id = ?`,
      change.words,
      ...authorColumns(author),
      entry.id,
    );
    followAnchors(sql, entry.id, entry.words, change.words);
  }
  const made = tasks.map(({ title }) =>
    insertTask(sql, { title, originEntry: entry.id, at: arrivedAt, author: by }),
  );
  const changed = readEntry(sql, entry.id, today) as Entry;
  return success(
    written(changed, [
      ...(wordsChanged ? [entryEffect(changed, "changed")] : []),
      ...changed.tasks.filter((task) => made.includes(task.id)).map((t) => taskEffect(t, "made")),
    ]),
  );
}

function entryExists(sql: SqlStorage, id: string): boolean {
  return sql.exec(`SELECT 1 FROM entries WHERE id = ?`, id).toArray().length > 0;
}

function toVersion(row: VersionRow): Version {
  return {
    version: row.version,
    words: row.words,
    changed: { by: toAuthor(row), at: instantToIso(row.at) },
  };
}

/**
 * Whether an Entry already links what a new link names: at that span, or at all when it has no
 * anchor. A new record is never already linked.
 */
function alreadyLinks(links: Link[], { to, anchor }: NewLink): boolean {
  if (!("id" in to)) return false;
  return links.some(
    (each) =>
      each.to.kind === to.kind &&
      each.to.id === to.id &&
      (anchor === undefined ||
        (each.anchor?.start === anchor.start && each.anchor?.end === anchor.end)),
  );
}

/** The Effect of a call on an Entry, with its one-line summary. */
function entryEffect(entry: Entry, what: Effect["what"]): Effect {
  return { kind: "entry", id: entry.id, what, summary: summarizeWords(entry.words), by: "call" };
}

/** An Entry that exists in this Context, with its Tasks and links. */
function readEntry(sql: SqlStorage, id: string, today: Day): Entry | null {
  const rows = sql.exec<EntryRow>(`SELECT * FROM entries WHERE id = ?`, id).toArray();
  return readEntries(sql, rows, today)[0] ?? null;
}

/**
 * The Entries their rows hold, each with its Tasks, links, last change to its words and
 * Follow-ups, each Task's state read as on `today`.
 */
function readEntries(sql: SqlStorage, rows: EntryRow[], today: Day): Entry[] {
  const ids = rows.map((row) => row.id);
  const tasks = tasksOf(sql, ids, today);
  const links = linksOf(sql, rows);
  const edits = lastEdits(sql, ids);
  const followed = entriesNamed(
    sql,
    rows.flatMap((row) => (row.follow_up_to === null ? [] : [row.follow_up_to])),
  );
  const followUps = followUpsOf(sql, ids);
  return rows.map((row) => {
    const edit = edits.get(row.id);
    return {
      id: row.id,
      words: row.words,
      at: instantToIso(row.at),
      author: toAuthor(row),
      through_conversation: row.through_conversation === 1,
      tasks: tasks.get(row.id) ?? [],
      links: links.get(row.id) ?? [],
      version: edit ? edit.version + 1 : 0,
      edited: edit ? { by: toAuthor(edit), at: instantToIso(edit.at) } : null,
      follow_up_to: (row.follow_up_to !== null && followed.get(row.follow_up_to)) || null,
      follow_ups: followUps.get(row.id) ?? [],
    };
  });
}

/** The latest Version of each of these Entries that has one: the last change to its words. */
function lastEdits(sql: SqlStorage, ids: string[]): Map<string, VersionRow> {
  const rows = sql
    .exec<VersionRow>(
      `SELECT v.* FROM entry_versions v
       WHERE v.entry IN (SELECT value FROM json_each(?))
         AND v.version = (SELECT max(version) FROM entry_versions WHERE entry = v.entry)`,
      JSON.stringify(ids),
    )
    .toArray();
  return new Map(rows.map((row) => [row.entry, row]));
}

/** Each of these Entries as another names it, by id. */
function entriesNamed(sql: SqlStorage, ids: string[]): Map<string, EntryNamed> {
  const rows = sql
    .exec<{ id: string; words: string }>(
      `SELECT id, words FROM entries WHERE id IN (SELECT value FROM json_each(?))`,
      JSON.stringify(ids),
    )
    .toArray();
  return new Map(rows.map((row) => [row.id, { id: row.id, summary: summarizeWords(row.words) }]));
}

/** The Follow-ups to each of these Entries, in the order they were made. */
function followUpsOf(sql: SqlStorage, ids: string[]): Map<string, EntryNamed[]> {
  const rows = sql
    .exec<{ id: string; words: string; follow_up_to: string }>(
      `SELECT id, words, follow_up_to FROM entries
       WHERE follow_up_to IN (SELECT value FROM json_each(?))
       ORDER BY at, seq`,
      JSON.stringify(ids),
    )
    .toArray();
  const followUps = new Map<string, EntryNamed[]>();
  for (const row of rows) {
    const named = { id: row.id, summary: summarizeWords(row.words) };
    followUps.set(row.follow_up_to, [...(followUps.get(row.follow_up_to) ?? []), named]);
  }
  return followUps;
}

/** Where a page ended: the last Entry's time and its order of arrival. */
type Position = { at: number; seq: number };

function encodeCursor({ at, seq }: Position): string {
  return btoa(JSON.stringify([at, seq]));
}

function decodeCursor(cursor: string): Position | null {
  try {
    const value: unknown = JSON.parse(atob(cursor));
    if (Array.isArray(value) && value.length === 2 && value.every((n) => Number.isSafeInteger(n))) {
      return { at: value[0], seq: value[1] };
    }
  } catch {
    // Not base64 or not JSON: not a cursor this list gave.
  }
  return null;
}
