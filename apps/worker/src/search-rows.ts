import {
  addDays,
  dayStart,
  type Excerpt,
  failure,
  instantToIso,
  PAGE_SIZE,
  type SearchHit,
  type SearchResults,
  type Span,
  success,
  summarizeWords,
  type ToolInput,
  type ToolResult,
} from "@praxis/domain";
import { type AuthorColumns, toAuthor } from "./author.ts";
import { listCursor, listPosition } from "./newest-first.ts";
import { WORDS_INDEX } from "./tables.ts";
import { NO_SUCH_PERSON } from "./tools/persons.ts";
import { NO_SUCH_PROJECT } from "./tools/projects.ts";

/**
 * Where a match starts and ends in the text SQLite cuts an excerpt from. Control characters, so
 * words as typed hold them only if pasted so, and then an excerpt marks a little more or less.
 */
const MATCH_START = "\u0002";
const MATCH_END = "\u0003";

/** The words an Entry's excerpt keeps around what matched, at most. */
const EXCERPT_WORDS = 16;

/**
 * The words given as SQLite's full-text query: each a term of letters and digits, as the index
 * splits words, and every one required. The last also matches the words it begins while nothing
 * follows it, as while it is still being typed. Nothing typed is read as the query language's own
 * syntax. Null when nothing typed is a word.
 */
export function wordsQuery(words: string): string | null {
  const terms = words.match(WORD);
  if (!terms) return null;
  const begun = new RegExp(`${WORD.source}$`, "u").test(words);
  return terms
    .map((term, at) => `"${term}"${begun && at === terms.length - 1 ? "*" : ""}`)
    .join(" ");
}

/** A word as the index splits them: a run of letters and digits, with their accents. */
const WORD = /[\p{L}\p{N}\p{M}]+/gu;

/**
 * An excerpt as SQLite marked it, on one line: each run of spaces and line breaks as one space,
 * and each match as a span of what is left.
 */
export function excerptOf(marked: string): Excerpt {
  let text = "";
  const matches: Span[] = [];
  let start: number | null = null;
  for (const character of marked.trim()) {
    if (character === MATCH_START) start = text.length;
    else if (character === MATCH_END) {
      if (start !== null && text.length > start) matches.push({ start, end: text.length });
      start = null;
    } else if (!/\s/u.test(character)) text += character;
    else if (!text.endsWith(" ")) text += " ";
  }
  return { text, matches };
}

type HitRow = AuthorColumns & {
  kind: SearchHit["kind"];
  id: string;
  excerpt: string;
  at: number;
  text: string;
  origin_entry: string | null;
};

/**
 * One page of what `search` finds (section 9.4): the records whose words, title or name hold
 * every word given, best match first, and the newest first among equals. Only the records not in
 * the Trash are in the words index, and no earlier Version is.
 */
export function search(
  sql: SqlStorage,
  input: ToolInput<"search">,
  zone: string,
): ToolResult<SearchResults> {
  let offset = 0;
  if (input.cursor !== undefined) {
    const position = listPosition("search", input.cursor);
    if (position === null) return failure("invalid_input", "The cursor is not one this list gave.");
    offset = position;
  }
  if (input.project_id !== undefined && !exists(sql, "untrashed_projects", input.project_id)) {
    return failure("not_found", NO_SUCH_PROJECT);
  }
  if (input.person_id !== undefined && !exists(sql, "untrashed_persons", input.person_id)) {
    return failure("not_found", NO_SUCH_PERSON);
  }
  const query = wordsQuery(input.words);
  if (query === null) return success({ items: [], next_cursor: null });

  const at = `coalesce(e.at, t.at, p.at, pe.at)`;
  const where: string[] = [`${WORDS_INDEX} MATCH ?`];
  const bound: (string | number)[] = [query];
  if (input.from !== undefined) {
    where.push(`${at} >= ?`);
    bound.push(dayStart(input.from, zone));
  }
  if (input.to !== undefined) {
    where.push(`${at} < ?`);
    bound.push(dayStart(addDays(input.to, 1), zone));
  }
  if (input.project_id !== undefined) {
    where.push(`(
      t.project = ?
      OR EXISTS (SELECT 1 FROM entry_links l
        WHERE l.entry = e.id AND l.to_kind = 'project' AND l.to_id = ?)
      OR EXISTS (SELECT 1 FROM untrashed_tasks x WHERE x.origin_entry = e.id AND x.project = ?)
    )`);
    bound.push(input.project_id, input.project_id, input.project_id);
  }
  if (input.person_id !== undefined) {
    where.push(`(
      EXISTS (SELECT 1 FROM entry_links l
        WHERE l.entry = e.id AND l.to_kind = 'person' AND l.to_id = ?)
      OR EXISTS (SELECT 1 FROM task_events v
        WHERE v.task = t.id AND v.what = 'delegated' AND v.person = ?)
    )`);
    bound.push(input.person_id, input.person_id);
  }
  if (input.author !== undefined) {
    where.push(`coalesce(e.author_kind, t.author_kind) = ?`);
    bound.push(input.author.kind);
    if (input.author.kind === "connection" && input.author.name !== undefined) {
      where.push(`coalesce(e.author_name, t.author_name) = ?`);
      bound.push(input.author.name);
    }
  }

  const rows = sql
    .exec<HitRow>(
      `SELECT ${WORDS_INDEX}.kind AS kind, ${WORDS_INDEX}.record_id AS id,
         CASE ${WORDS_INDEX}.kind
           WHEN 'entry' THEN snippet(${WORDS_INDEX}, 2, char(2), char(3), '…', ${EXCERPT_WORDS})
           ELSE highlight(${WORDS_INDEX}, 2, char(2), char(3))
         END AS excerpt,
         ${at} AS at, ${WORDS_INDEX}.text AS text,
         coalesce(e.author_kind, t.author_kind) AS author_kind,
         coalesce(e.author_name, t.author_name) AS author_name,
         t.origin_entry AS origin_entry
       FROM ${WORDS_INDEX}
       LEFT JOIN entries e ON ${WORDS_INDEX}.kind = 'entry' AND e.id = ${WORDS_INDEX}.record_id
       LEFT JOIN tasks t ON ${WORDS_INDEX}.kind = 'task' AND t.id = ${WORDS_INDEX}.record_id
       LEFT JOIN projects p ON ${WORDS_INDEX}.kind = 'project' AND p.id = ${WORDS_INDEX}.record_id
       LEFT JOIN persons pe ON ${WORDS_INDEX}.kind = 'person' AND pe.id = ${WORDS_INDEX}.record_id
       WHERE ${where.join(" AND ")}
       ORDER BY bm25(${WORDS_INDEX}), at DESC, ${WORDS_INDEX}.rowid DESC
       LIMIT ? OFFSET ?`,
      ...bound,
      PAGE_SIZE + 1,
      offset,
    )
    .toArray();

  return success({
    items: rows.slice(0, PAGE_SIZE).map(hitOf),
    next_cursor: rows.length > PAGE_SIZE ? listCursor("search", offset + PAGE_SIZE) : null,
  });
}

function hitOf(row: HitRow): SearchHit {
  const found = { id: row.id, at: instantToIso(row.at), excerpt: excerptOf(row.excerpt) };
  switch (row.kind) {
    case "entry":
      return {
        kind: "entry",
        ...found,
        summary: summarizeWords(row.text),
        author: toAuthor(row),
      };
    case "task":
      return {
        kind: "task",
        ...found,
        summary: row.text,
        author: toAuthor(row),
        origin_entry: row.origin_entry as string,
      };
    case "project":
    case "person":
      return { kind: row.kind, ...found, summary: row.text };
  }
}

function exists(sql: SqlStorage, table: string, id: string): boolean {
  return sql.exec(`SELECT 1 FROM ${table} WHERE id = ?`, id).toArray().length > 0;
}
