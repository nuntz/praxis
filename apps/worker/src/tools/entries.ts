import {
  type Author,
  authorOf,
  type Entry,
  failure,
  instantToIso,
  PAGE_SIZE,
  success,
} from "@praxis/domain";
import type { Handlers } from "../registry.ts";

type EntryRow = {
  seq: number;
  id: string;
  words: string;
  at: number;
  author_kind: Author["kind"];
  author_name: string | null;
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
      author.kind,
      author.kind === "connection" ? author.name : null,
      throughConversation ? 1 : 0,
    );
    return success({ record: readEntry(sql, id) as Entry });
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
      items: page.map(toEntry),
      next_cursor: rows.length > PAGE_SIZE && last ? encodeCursor(last) : null,
    });
  },
};

function readEntry(sql: SqlStorage, id: string): Entry | null {
  const row = sql.exec<EntryRow>(`SELECT * FROM entries WHERE id = ?`, id).toArray()[0];
  return row ? toEntry(row) : null;
}

function toEntry(row: EntryRow): Entry {
  return {
    id: row.id,
    words: row.words,
    at: instantToIso(row.at),
    author: toAuthor(row),
    through_conversation: row.through_conversation === 1,
  };
}

function toAuthor(row: EntryRow): Author {
  if (row.author_kind === "connection") return { kind: "connection", name: row.author_name ?? "" };
  return { kind: row.author_kind };
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
