import {
  authorOf,
  type Day,
  type Effect,
  type Entry,
  failure,
  instantToIso,
  type Link,
  type NewLink,
  PAGE_SIZE,
  success,
  summarizeWords,
  written,
} from "@praxis/domain";
import { type AuthorColumns, authorColumns, toAuthor } from "../author.ts";
import { checkLink, deleteLinks, insertLinks, keepableLinks, linksOf } from "../link-rows.ts";
import type { Handlers } from "../registry.ts";
import { insertTask, taskEffect, tasksOf } from "../task-rows.ts";

const NO_SUCH_ENTRY = "No such Entry in this Context.";

type EntryRow = AuthorColumns & {
  seq: number;
  id: string;
  words: string;
  at: number;
  through_conversation: number;
};

export const entryTools: Pick<
  Handlers,
  "record_entry" | "get_entry" | "list_entries" | "add_link" | "remove_link"
> = {
  record_entry({ caller, input, arrivedAt, today, sql }) {
    const links = keepableLinks(sql, input.words, input.links ?? []);
    const author = authorOf(caller);
    const id = crypto.randomUUID();
    // Only the Agent works from the Conversation: whatever it records came through it.
    const throughConversation = caller.kind === "agent";
    sql.exec(
      `INSERT INTO entries (id, words, at, author_kind, author_name, through_conversation)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      input.words,
      arrivedAt,
      ...authorColumns(author),
      throughConversation ? 1 : 0,
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
      items: withTasks(sql, page, today),
      next_cursor: rows.length > PAGE_SIZE && last ? encodeCursor(last) : null,
    });
  },
};

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
  return withTasks(sql, rows, today)[0] ?? null;
}

/** The Entries with their Tasks and links, each Task's state read as on `today`. */
function withTasks(sql: SqlStorage, rows: EntryRow[], today: Day): Entry[] {
  const tasks = tasksOf(
    sql,
    rows.map((row) => row.id),
    today,
  );
  const links = linksOf(sql, rows);
  return rows.map((row) => ({
    id: row.id,
    words: row.words,
    at: instantToIso(row.at),
    author: toAuthor(row),
    through_conversation: row.through_conversation === 1,
    tasks: tasks.get(row.id) ?? [],
    links: links.get(row.id) ?? [],
  }));
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
