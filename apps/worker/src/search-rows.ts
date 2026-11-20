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
  type WordsOnly,
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
 * What the meaning index answered for a search: the Entries nearest what was searched for, nearest
 * first, each alike enough to be found; or why it was left out, so the answer is from words alone.
 */
export type MeaningAnswer = { nearest: string[] } | { words_only: WordsOnly };

/** A search let in, before the meaning index is asked: where its page starts, and its query. */
export type SearchAsked = { offset: number; query: string | null };

/**
 * Check a search before anything outside is asked: its cursor is one the list gave, and the
 * Project or Person it is narrowed by is there. The query is null when nothing typed is a word.
 */
export function askSearch(sql: SqlStorage, input: ToolInput<"search">): ToolResult<SearchAsked> {
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
  return success({ offset, query: wordsQuery(input.words) });
}

/**
 * How far down its list a record may be and still lift its place in the one list: each list gives
 * a record 1 / (FUSED + its place), and the two are added, so a record found by words and by
 * meaning comes before one found by either alone at the same place. 60 is the usual choice.
 */
const FUSED = 60;

/** A record in one of the two ranked lists, by `kind:id`. */
type Ranked = { key: string; kind: SearchHit["kind"]; id: string; at: number; row: number | null };

/**
 * One page of what `search` finds (section 9.4), from words and from meaning in one ranked list.
 * By words: the records whose words, title or name hold every word given, best match first, and the
 * newest first among equals. By meaning: the Entries the meaning index found nearest, as narrowed.
 * Only the records not in the Trash are in the words index, and no earlier Version is; an Entry in
 * the Trash keeps its embedding, so the meaning index may name it, and it is left out here.
 */
export function search(
  sql: SqlStorage,
  input: ToolInput<"search">,
  zone: string,
  asked: SearchAsked,
  meaning: MeaningAnswer,
): SearchResults {
  const words_only = "words_only" in meaning ? meaning.words_only : null;
  const { offset, query } = asked;
  if (query === null) return { items: [], next_cursor: null, words_only };

  const narrowed = narrowing(input, zone);
  const byWords = wordsRanking(sql, query, narrowed);
  const byMeaning = "nearest" in meaning ? meaningRanking(sql, meaning.nearest, narrowed) : [];
  const fused = fuse(byWords, byMeaning);
  const page = fused.slice(offset, offset + PAGE_SIZE + 1);
  const rows = hitRows(sql, query, page.slice(0, PAGE_SIZE));

  return {
    items: page.slice(0, PAGE_SIZE).flatMap(({ key }) => {
      const row = rows.get(key);
      return row ? [hitOf(row)] : [];
    }),
    next_cursor: page.length > PAGE_SIZE ? listCursor("search", offset + PAGE_SIZE) : null,
    words_only,
  };
}

/** When a record was made, from whichever record table its row of the words index joins. */
const AT = `coalesce(e.at, t.at, p.at, pe.at)`;

/**
 * The narrowing a search asks for, as SQL over a record joined as `e`, `t`, `p` or `pe` by its
 * kind, the others null: by date range, Project, Person and Author, together or alone.
 */
function narrowing(
  input: ToolInput<"search">,
  zone: string,
): { where: string[]; bound: (string | number)[] } {
  const where: string[] = [];
  const bound: (string | number)[] = [];
  if (input.from !== undefined) {
    where.push(`${AT} >= ?`);
    bound.push(dayStart(input.from, zone));
  }
  if (input.to !== undefined) {
    where.push(`${AT} < ?`);
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
  return { where, bound };
}

/** Every record the words find, as narrowed, best match first and the newest among equals. */
function wordsRanking(
  sql: SqlStorage,
  query: string,
  { where, bound }: ReturnType<typeof narrowing>,
): Ranked[] {
  return sql
    .exec<{ row: number; kind: SearchHit["kind"]; id: string; at: number }>(
      `SELECT ${WORDS_INDEX}.rowid AS row, ${WORDS_INDEX}.kind AS kind,
         ${WORDS_INDEX}.record_id AS id, ${AT} AS at
       FROM ${WORDS_INDEX}
       LEFT JOIN entries e ON ${WORDS_INDEX}.kind = 'entry' AND e.id = ${WORDS_INDEX}.record_id
       LEFT JOIN tasks t ON ${WORDS_INDEX}.kind = 'task' AND t.id = ${WORDS_INDEX}.record_id
       LEFT JOIN projects p ON ${WORDS_INDEX}.kind = 'project' AND p.id = ${WORDS_INDEX}.record_id
       LEFT JOIN persons pe ON ${WORDS_INDEX}.kind = 'person' AND pe.id = ${WORDS_INDEX}.record_id
       WHERE ${[`${WORDS_INDEX} MATCH ?`, ...where].join(" AND ")}
       ORDER BY bm25(${WORDS_INDEX}), at DESC, ${WORDS_INDEX}.rowid DESC`,
      query,
      ...bound,
    )
    .toArray()
    .map(({ row, kind, id, at }) => ({ key: `${kind}:${id}`, kind, id, at, row }));
}

/**
 * The Entries the meaning index found, in its order, that are not in the Trash and are kept by
 * the narrowing. An Entry is joined as `e` alone, so what the narrowing asks of a Task, a Project
 * or a Person holds for none.
 */
function meaningRanking(
  sql: SqlStorage,
  nearest: string[],
  { where, bound }: ReturnType<typeof narrowing>,
): Ranked[] {
  if (nearest.length === 0) return [];
  const kept = new Map(
    sql
      .exec<{ id: string; at: number }>(
        `SELECT e.id AS id, e.at AS at
         FROM untrashed_entries e
         LEFT JOIN tasks t ON 0 LEFT JOIN projects p ON 0 LEFT JOIN persons pe ON 0
         WHERE ${[`e.id IN (${nearest.map(() => "?").join(", ")})`, ...where].join(" AND ")}`,
        ...nearest,
        ...bound,
      )
      .toArray()
      .map(({ id, at }) => [id, at]),
  );
  return nearest.flatMap((id) => {
    const at = kept.get(id);
    return at === undefined
      ? []
      : [{ key: `entry:${id}`, kind: "entry" as const, id, at, row: null }];
  });
}

/**
 * The two ranked lists as one: each record by the sum of what its place in each list gives it,
 * best first, and the newest first among equals. A list from words alone keeps its order.
 */
function fuse(byWords: Ranked[], byMeaning: Ranked[]): Ranked[] {
  const fused = new Map<string, Ranked & { score: number; order: number }>();
  for (const list of [byWords, byMeaning]) {
    list.forEach((ranked, place) => {
      const score = 1 / (FUSED + place + 1);
      const held = fused.get(ranked.key);
      if (held) {
        held.score += score;
        held.row ??= ranked.row;
      } else fused.set(ranked.key, { ...ranked, score, order: fused.size });
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score || b.at - a.at || a.order - b.order);
}

/**
 * The rows of the records on a page, by `kind:id`: one the words found with its excerpt cut
 * around what matched, and an Entry found by meaning alone with its first words.
 */
function hitRows(sql: SqlStorage, query: string, page: Ranked[]): Map<string, HitRow> {
  const rows = new Map<string, HitRow>();
  const matched = page.flatMap(({ row }) => (row === null ? [] : [row]));
  if (matched.length > 0) {
    for (const row of sql.exec<HitRow>(
      `SELECT ${WORDS_INDEX}.kind AS kind, ${WORDS_INDEX}.record_id AS id,
         CASE ${WORDS_INDEX}.kind
           WHEN 'entry' THEN snippet(${WORDS_INDEX}, 2, char(2), char(3), '…', ${EXCERPT_WORDS})
           ELSE highlight(${WORDS_INDEX}, 2, char(2), char(3))
         END AS excerpt,
         ${AT} AS at, ${WORDS_INDEX}.text AS text,
         coalesce(e.author_kind, t.author_kind) AS author_kind,
         coalesce(e.author_name, t.author_name) AS author_name,
         t.origin_entry AS origin_entry
       FROM ${WORDS_INDEX}
       LEFT JOIN entries e ON ${WORDS_INDEX}.kind = 'entry' AND e.id = ${WORDS_INDEX}.record_id
       LEFT JOIN tasks t ON ${WORDS_INDEX}.kind = 'task' AND t.id = ${WORDS_INDEX}.record_id
       LEFT JOIN projects p ON ${WORDS_INDEX}.kind = 'project' AND p.id = ${WORDS_INDEX}.record_id
       LEFT JOIN persons pe ON ${WORDS_INDEX}.kind = 'person' AND pe.id = ${WORDS_INDEX}.record_id
       WHERE ${WORDS_INDEX} MATCH ? AND ${WORDS_INDEX}.rowid IN (${matched.map(() => "?").join(", ")})`,
      query,
      ...matched,
    )) {
      rows.set(`${row.kind}:${row.id}`, row);
    }
  }
  const meant = page.flatMap(({ row, id }) => (row === null ? [id] : []));
  if (meant.length > 0) {
    for (const row of sql.exec<Omit<HitRow, "excerpt">>(
      `SELECT 'entry' AS kind, id, at, words AS text, author_kind, author_name,
         NULL AS origin_entry
       FROM entries WHERE id IN (${meant.map(() => "?").join(", ")})`,
      ...meant,
    )) {
      rows.set(`entry:${row.id}`, { ...row, excerpt: firstWords(row.text) });
    }
  }
  return rows;
}

/** An Entry's first words, as many as an excerpt keeps, marked as cut when it goes on. */
function firstWords(words: string): string {
  const all = words.trim().split(/\s+/u);
  const kept = all.slice(0, EXCERPT_WORDS).join(" ");
  return all.length > EXCERPT_WORDS ? `${kept}…` : kept;
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
