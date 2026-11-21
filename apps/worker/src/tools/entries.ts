import {
  type Author,
  authorOf,
  type Caller,
  type Day,
  type Effect,
  type Entry,
  type EntryNamed,
  failure,
  HELD_FOR_A_CONNECTION,
  type Held,
  instantToIso,
  type Link,
  type NewLink,
  type NewTask,
  PAGE_SIZE,
  standingSize,
  success,
  summarizeWords,
  type ToolResult,
  type Version,
  type Written,
  written,
} from "@praxis/domain";
import { type AuthorColumns, authorColumns, toAuthor } from "../author.ts";
import { leaveHeldChange } from "../held-change-rows.ts";
import {
  checkLink,
  deleteLinks,
  followAnchors,
  insertLinks,
  keepableLinks,
  linksOf,
} from "../link-rows.ts";
import { newestFirst } from "../newest-first.ts";
import { type Handlers, madeAt } from "../registry.ts";
import { pastTheCeiling } from "../standing-rows.ts";
import { insertTask, taskEffect, tasksOf } from "../task-rows.ts";

export const NO_SUCH_ENTRY = "No such Entry in this Context.";

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

/** The words of some text, as `drawnFrom` compares them: case, accents and punctuation aside. */
function wordsOf(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
}

/**
 * Whether an Entry's words are the person's own, drawn from what they said in the Message the
 * Agent's Run answers (section 3.2): every word of the Entry is theirs, in the order they said it,
 * though some they said, as filler, may be left out. A word added or moved makes it the Agent's.
 */
function drawnFrom(words: string, said: string): boolean {
  const kept = wordsOf(words);
  if (kept.length === 0) return false;
  const heard = wordsOf(said);
  let at = 0;
  for (const word of heard) {
    if (word === kept[at]) at++;
    if (at === kept.length) return true;
  }
  return false;
}

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
  | "mark_standing"
  | "unmark_standing"
> = {
  record_entry({ caller, input, arrivedAt, today, sql, wordsAnswered }) {
    // An Unsent Entry belongs where it was made in the Journal, with its Tasks and links.
    const made = madeAt(input.made_at, arrivedAt);
    if (!made.ok) return made;
    const at = made.value;
    const links = keepableLinks(sql, input.words, input.links ?? []);
    // Like a link, a Follow-up naming no Entry here is not kept: the words are never refused. One
    // naming an Entry in the Trash is kept dormant, as a link is.
    const followUpTo =
      input.follow_up_to !== undefined && entryEvenIfTrashed(sql, input.follow_up_to)
        ? input.follow_up_to
        : null;
    // An Entry the Agent records of the person's words is theirs; one it composed is its own.
    const author =
      wordsAnswered !== null && drawnFrom(input.words, wordsAnswered)
        ? ({ kind: "person" } as const)
        : authorOf(caller);
    const id = crypto.randomUUID();
    // Only the Agent works from the Conversation: whatever it records came through it.
    const throughConversation = caller.kind === "agent";
    sql.exec(
      `INSERT INTO entries
         (id, words, at, author_kind, author_name, through_conversation, follow_up_to)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.words,
      at,
      ...authorColumns(author),
      throughConversation ? 1 : 0,
      followUpTo,
    );
    // The Tasks come as a list beside the words. The words are never read to find them.
    // A Task is its maker's, whoever's words its Entry holds.
    for (const { title } of input.tasks ?? []) {
      insertTask(sql, { title, originEntry: id, at, author: authorOf(caller) });
    }
    // So do the links, and the words are never read to find them either.
    const linked = insertLinks(sql, { id, words: input.words }, links, at);
    const entry = readEntry(sql, id, today) as Entry;
    return success(
      written(entry, [
        entryEffect(entry, "made"),
        ...entry.tasks.map((task) => taskEffect(task, "made")),
        ...linked,
      ]),
    );
  },

  edit_entry({ caller, input, arrivedAt, today, sql }) {
    const entry = readEntry(sql, input.id, today);
    if (!entry) return failure("not_found", NO_SUCH_ENTRY);
    return changeWords(
      { caller, arrivedAt, today, sql },
      "edit_entry",
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
      "restore_entry_version",
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

  mark_standing({ input, today, sql }) {
    const entry = readEntry(sql, input.id, today);
    if (!entry) return failure("not_found", NO_SUCH_ENTRY);
    if (entry.standing) return success(written(entry, []));
    const refused = pastTheCeiling(sql, entry);
    if (refused) return refused;
    // A mark is kept beside the words: they never change, so no Version is made and nothing is held.
    sql.exec(`INSERT INTO standing_marks (entry) VALUES (?)`, entry.id);
    const marked = readEntry(sql, entry.id, today) as Entry;
    return success(written(marked, [entryEffect(marked, "changed")]));
  },

  unmark_standing({ input, today, sql }) {
    const entry = readEntry(sql, input.id, today);
    if (!entry) return failure("not_found", NO_SUCH_ENTRY);
    if (!entry.standing) return success(written(entry, []));
    sql.exec(`DELETE FROM standing_marks WHERE entry = ?`, entry.id);
    const unmarked = readEntry(sql, entry.id, today) as Entry;
    return success(written(unmarked, [entryEffect(unmarked, "changed")]));
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
    // Narrowed to the Standing Entries, it is the list the person sees them in and a Connection
    // reads them by.
    const listed = input.standing ? "standing_entries" : "untrashed_entries";
    // Newest first. One more than a page is read to learn whether another page follows.
    const rows = (
      after
        ? sql.exec<EntryRow>(
            `SELECT * FROM ${listed} WHERE (at, seq) < (?, ?) ORDER BY at DESC, seq DESC LIMIT ?`,
            after.at,
            after.seq,
            PAGE_SIZE + 1,
          )
        : sql.exec<EntryRow>(
            `SELECT * FROM ${listed} ORDER BY at DESC, seq DESC LIMIT ?`,
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
 * the change, and making the Tasks given. The person's words are theirs alone to change: the
 * Agent's call leaves a Held Change for their tap, and a Connection's is refused. An Entry the
 * person edits becomes theirs.
 */
function changeWords(
  { caller, arrivedAt, today, sql }: WordsCall,
  tool: "edit_entry" | "restore_entry_version",
  entry: Entry,
  change: { version: number; words: string },
  tasks: NewTask[],
): ToolResult<Written<Entry> | Held> {
  const wordsChanged = change.words !== entry.words;
  // Asking for the words it has, with no Task to make, is asking for what is already so.
  if (!wordsChanged && tasks.length === 0) return success(written(entry, []));
  const held = wordsChanged && entry.author.kind === "person" && caller.kind !== "hand";
  if (held && caller.kind !== "agent") return failure("held", HELD_FOR_A_CONNECTION);
  // Checked before a Held Change is left, so none is left already lapsed, or bound to be refused.
  if (change.version !== entry.version) return failure("stale", STALE);
  const refused = wordsChanged ? pastTheCeilingWith(sql, entry, change.words) : null;
  if (refused) return refused;
  if (held) {
    return success(
      leaveHeldChange(sql, { tool, entry, words: change.words, newTasks: tasks, at: arrivedAt }),
    );
  }
  return success(
    putWords(sql, entry, change.words, tasks, {
      by: authorOf(caller),
      becomesTheirs: caller.kind === "hand",
      at: arrivedAt,
      today,
    }),
  );
}

/**
 * The refusal of new words for a Standing Entry that would take the Standing Entries past the
 * ceiling, or null. Only words that grow bring anything to it, so shorter ones are never refused,
 * and words of an Entry not standing are never held to it.
 */
export function pastTheCeilingWith(
  sql: SqlStorage,
  entry: Entry,
  words: string,
): ToolResult<never> | null {
  if (!entry.standing || standingSize(words) <= standingSize(entry.words)) return null;
  return pastTheCeiling(sql, { id: entry.id, words });
}

/**
 * Give an Entry new words and make the Tasks given with them, as a change by `by`: the words
 * before become a Version, and each anchor moves with the change. The Entry becomes the person's
 * when they made it with their own hand.
 */
export function putWords(
  sql: SqlStorage,
  entry: Entry,
  words: string,
  tasks: NewTask[],
  change: { by: Author; becomesTheirs: boolean; at: number; today: Day },
): Written<Entry> {
  const { by, at, today } = change;
  const wordsChanged = words !== entry.words;
  if (wordsChanged) {
    sql.exec(
      `INSERT INTO entry_versions (entry, version, words, at, author_kind, author_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      entry.id,
      entry.version,
      entry.words,
      at,
      ...authorColumns(by),
    );
    const author = change.becomesTheirs ? by : entry.author;
    sql.exec(
      `UPDATE entries SET words = ?, author_kind = ?, author_name = ? WHERE id = ?`,
      words,
      ...authorColumns(author),
      entry.id,
    );
    followAnchors(sql, entry.id, entry.words, words);
  }
  const made = tasks.map(({ title }) =>
    insertTask(sql, { title, originEntry: entry.id, at, author: by }),
  );
  const changed = readEntry(sql, entry.id, today) as Entry;
  return written(changed, [
    ...(wordsChanged ? [entryEffect(changed, "changed")] : []),
    ...changed.tasks.filter((task) => made.includes(task.id)).map((t) => taskEffect(t, "made")),
  ]);
}

/** Whether an Entry is in this Context and not in the Trash. */
function entryExists(sql: SqlStorage, id: string): boolean {
  return sql.exec(`SELECT 1 FROM untrashed_entries WHERE id = ?`, id).toArray().length > 0;
}

/** Whether an Entry is in this Context, in the Trash or not. */
function entryEvenIfTrashed(sql: SqlStorage, id: string): boolean {
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

/** An Entry that exists in this Context and is not in the Trash, with its Tasks and links. */
export function readEntry(sql: SqlStorage, id: string, today: Day): Entry | null {
  const rows = sql.exec<EntryRow>(`SELECT * FROM untrashed_entries WHERE id = ?`, id).toArray();
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
  const standing = standingOf(sql, ids);
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
      standing: standing.has(row.id),
    };
  });
}

/** Which of these Entries are Standing Entries. */
function standingOf(sql: SqlStorage, ids: string[]): Set<string> {
  const rows = sql
    .exec<{ entry: string }>(
      `SELECT entry FROM standing_marks WHERE entry IN (SELECT value FROM json_each(?))`,
      JSON.stringify(ids),
    )
    .toArray();
  return new Set(rows.map((row) => row.entry));
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

/** Each of these Entries as another names it, by id, marked while it is in the Trash. */
function entriesNamed(sql: SqlStorage, ids: string[]): Map<string, EntryNamed> {
  const rows = sql
    .exec<{ id: string; words: string; in_trash: number }>(
      `SELECT id, words,
         EXISTS (SELECT 1 FROM trashed WHERE kind = 'entry' AND record_id = id) AS in_trash
       FROM entries WHERE id IN (SELECT value FROM json_each(?))`,
      JSON.stringify(ids),
    )
    .toArray();
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        summary: summarizeWords(row.words),
        ...(row.in_trash === 1 ? { deleted: true as const } : {}),
      },
    ]),
  );
}

/** The Follow-ups to each of these Entries, in the order they were made. */
function followUpsOf(sql: SqlStorage, ids: string[]): Map<string, EntryNamed[]> {
  const rows = sql
    .exec<{ id: string; words: string; follow_up_to: string }>(
      `SELECT id, words, follow_up_to FROM untrashed_entries
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
