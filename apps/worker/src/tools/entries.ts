import {
  authorOf,
  type Entry,
  failure,
  instantToIso,
  PAGE_SIZE,
  success,
  summarizeWords,
  written,
} from "@praxis/domain";
import { type AuthorColumns, authorColumns, toAuthor } from "../author.ts";
import type { Handlers } from "../registry.ts";
import { insertTask, taskEffect, tasksOf } from "../task-rows.ts";

type EntryRow = AuthorColumns & {
  seq: number;
  id: string;
  words: string;
  at: number;
  through_conversation: number;
};

export const entryTools: Pick<Handlers, "record_entry" | "get_entry" | "list_entries"> = {
  record_entry({ caller, input, arrivedAt, sql }) {
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
    const entry = readEntry(sql, id) as Entry;
    return success(
      written(entry, [
        { kind: "entry", id, what: "made", summary: summarizeWords(entry.words), by: "call" },
        ...entry.tasks.map((task) => taskEffect(task, "made")),
      ]),
    );
  },

  get_entry({ input, sql }) {
    const entry = readEntry(sql, input.id);
    return entry ? success(entry) : failure("not_found", "No such Entry in this Context.");
  },

  list_entries({ input, sql }) {
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
      items: withTasks(sql, page),
      next_cursor: rows.length > PAGE_SIZE && last ? encodeCursor(last) : null,
    });
  },
};

/** An Entry that exists in this Context, with its Tasks. */
function readEntry(sql: SqlStorage, id: string): Entry | null {
  const rows = sql.exec<EntryRow>(`SELECT * FROM entries WHERE id = ?`, id).toArray();
  return withTasks(sql, rows)[0] ?? null;
}

function withTasks(sql: SqlStorage, rows: EntryRow[]): Entry[] {
  const tasks = tasksOf(
    sql,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    words: row.words,
    at: instantToIso(row.at),
    author: toAuthor(row),
    through_conversation: row.through_conversation === 1,
    tasks: tasks.get(row.id) ?? [],
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
