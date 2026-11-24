import {
  addDays,
  type Day,
  dayStart,
  type Excerpt,
  failure,
  hasWords,
  instantToIso,
  PAGE_SIZE,
  type Project,
  projectTasksCounted,
  type SearchHit,
  type SearchResults,
  type Span,
  success,
  summarizeWords,
  type Task,
  type ToolInput,
  type ToolResult,
  type WordsOnly,
} from "@praxis/domain";
import { type AuthorColumns, toAuthor } from "./author.ts";
import { listCursor, listPosition } from "./newest-first.ts";
import { readProjects } from "./project-rows.ts";
import { WORDS_INDEX } from "./tables.ts";
import { readTasks } from "./task-rows.ts";
import { NO_SUCH_PERSON } from "./tools/persons.ts";
import { NO_SUCH_PROJECT } from "./tools/projects.ts";

/**
 * Where a match starts and ends in the text SQLite cuts an excerpt from. Control characters, so
 * words as typed hold them only if pasted so, and then an excerpt marks a little more or less.
 */
const MATCH_START = "\u0002";
const MATCH_END = "\u0003";

/** A match as SQLite marks it, between `MATCH_START` and `MATCH_END`, the words it marks captured. */
const MARKED_MATCH = new RegExp(`${MATCH_START}([^${MATCH_END}]*)${MATCH_END}`, "gu");

/** The words an Entry's excerpt keeps around what matched, at most, whoever cuts it. */
const EXCERPT_WORDS = 16;

/** The words an Entry's excerpt keeps before the first place a longer word given matches. */
const WORDS_BEFORE = 4;

/**
 * The words given as SQLite's full-text query: each a term of letters and digits, as the index
 * splits words, and every one required. The last also matches the words it begins while nothing
 * follows it, as while it is still being typed. Nothing typed is read as the query language's own
 * syntax. Null when nothing typed is a word.
 */
export function wordsQuery(words: string): string | null {
  const given = wordsGiven(words);
  if (given.length === 0) return null;
  return given.map(({ term, begun }) => `"${term}"${begun ? "*" : ""}`).join(" ");
}

/**
 * A word given, as typed and as the index compares it (`fold`), and whether it also matches the
 * words it begins: the last, while nothing follows it.
 */
type WordGiven = { term: string; folded: string; begun: boolean };

/** The words given, in the order typed, as the index splits words. */
function wordsGiven(words: string): WordGiven[] {
  const terms = words.match(WORD) ?? [];
  const begun = new RegExp(`${WORD.source}$`, "u").test(words);
  return terms.map((term, at) => ({
    term,
    folded: fold(term),
    begun: begun && at === terms.length - 1,
  }));
}

/**
 * A word as the index splits them: a run of letters and digits, with their accents. This, `fold`
 * and `isShort` follow the index's tokenizer, `unicode61 remove_diacritics 2`, set where the index
 * is made (`createWordsIndex` in `steps/context-0001.ts`): a change to it changes these too.
 */
const WORD = /[\p{L}\p{N}\p{M}]+/gu;

/** A letter or a digit, as counted for a short word and looked for between two spans. */
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** The most letters and digits a short word given holds. */
const SHORT = 2;

/**
 * A word as the index compares it: its accents taken off, and in lower case. Close to the
 * tokenizer's own, which takes accents off Latin letters alone and lowercases a final Σ as σ, so
 * two words the index holds equal in another script may fold apart here.
 */
function fold(word: string): string {
  return word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * An excerpt as SQLite marked it, on one line: each run of spaces and line breaks as one space,
 * and each match as a span of what is left, as the words given keep it (`keptSpans`).
 */
export function excerptOf(marked: string, given: WordGiven[]): Excerpt {
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
  return { text, matches: keptSpans(text, matches, given) };
}

/**
 * The spans an excerpt keeps (section 9.4). A span is a short word's when every word given that
 * matches it has two letters or digits or fewer. A run of spans is kept whole when it holds a span
 * that is not a short word's, so "log in" marks the phrase and not every "in". When every word
 * given is short, every span is kept.
 */
function keptSpans(text: string, spans: Span[], given: WordGiven[]): Span[] {
  if (given.every(isShort)) return spans;
  const shortWords = (span: Span) => {
    const words = foldedWords(text.slice(span.start, span.end));
    const matching = given.filter((wordGiven) =>
      words.some((word) => matchesWord(wordGiven, word)),
    );
    return matching.length > 0 && matching.every(isShort);
  };
  return runsOf(text, spans).flatMap((run) => (run.every(shortWords) ? [] : run));
}

/**
 * An Entry's excerpt cut around the first place a longer word given matches (section 9.4), from
 * its words with every match marked: as many words as an excerpt keeps, split at spaces and line
 * breaks, the few before that place first, and "…" at an end where the words go on. Null when no
 * word given is longer, or no match is a longer word's, and SQLite's own window stands.
 */
function cutAround(marked: string, given: WordGiven[]): string | null {
  const longer = given.filter((wordGiven) => !isShort(wordGiven));
  const words = spaced(marked);
  const at = words.findIndex((word) =>
    matchesIn(word).some((match) => longer.some((wordGiven) => matchesWord(wordGiven, match))),
  );
  if (at < 0) return null;
  return cutFrom(words, Math.max(0, Math.min(at - WORDS_BEFORE, words.length - EXCERPT_WORDS)));
}

/** Some text's words split at spaces and line breaks, as an excerpt cut in code counts them. */
function spaced(text: string): string[] {
  return text.trim().split(/\s+/u);
}

/** As many words as an excerpt keeps from `start`, marked "…" at an end where the words go on. */
function cutFrom(words: string[], start: number): string {
  const end = start + EXCERPT_WORDS;
  const kept = words.slice(start, end).join(" ");
  return `${start > 0 ? "…" : ""}${kept}${end < words.length ? "…" : ""}`;
}

/** The words SQLite marked as matches in some marked text, each as the index compares it. */
function matchesIn(marked: string): string[] {
  return [...marked.matchAll(MARKED_MATCH)].flatMap(([, match]) => foldedWords(match ?? ""));
}

/** Some text's words as the index splits and compares them. */
function foldedWords(text: string): string[] {
  return (text.match(WORD) ?? []).map(fold);
}

/** Whether a word given matches a word, as the index compares it: exactly, or the last begun. */
function matchesWord({ folded, begun }: WordGiven, word: string): boolean {
  return begun ? word.startsWith(folded) : word === folded;
}

/** Whether a word given is short: two letters or digits or fewer. */
function isShort({ term }: WordGiven): boolean {
  return [...term].filter((character) => LETTER_OR_DIGIT.test(character)).length <= SHORT;
}

/** The spans in runs, in order: spans with no letter or digit between them are one run. */
function runsOf(text: string, spans: Span[]): Span[][] {
  const runs: Span[][] = [];
  for (const span of spans) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    if (run && last && !LETTER_OR_DIGIT.test(text.slice(last.end, span.start))) run.push(span);
    else runs.push([span]);
  }
  return runs;
}

type HitRow = AuthorColumns & {
  kind: SearchHit["kind"];
  id: string;
  excerpt: string;
  /** An Entry's words, every match marked, when the words found it: its excerpt is cut from them. */
  marked?: string | null;
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
  return success({ offset, query: wordsQuery(input.words ?? "") });
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
 * the Trash keeps its embedding, so the meaning index may name it, and it is left out here. A Task
 * and a Project found say where they stand as read on `today`, in the Context's time zone.
 */
export function search(
  sql: SqlStorage,
  input: ToolInput<"search">,
  zone: string,
  asked: SearchAsked,
  meaning: MeaningAnswer,
  today: Day,
): SearchResults {
  const words_only = "words_only" in meaning ? meaning.words_only : null;
  const { offset, query } = asked;
  if (!hasWords(input)) return listing(sql, input, zone, offset, today);
  if (query === null) return { items: [], next_cursor: null, words_only };

  const narrowed = narrowing(input, zone);
  const byWords = wordsRanking(sql, query, narrowed);
  const byMeaning = "nearest" in meaning ? meaningRanking(sql, meaning.nearest, narrowed) : [];
  const fused = fuse(byWords, byMeaning);
  const page = fused.slice(offset, offset + PAGE_SIZE + 1);
  const shown = page.slice(0, PAGE_SIZE);
  const rows = hitRows(sql, query, shown);
  const read = shown.flatMap(({ key }) => rows.get(key) ?? []);
  return pageOf(sql, read, {
    more: page.length > PAGE_SIZE,
    offset,
    today,
    words_only,
    given: wordsGiven(input.words ?? ""),
  });
}

/**
 * One page of what a search with no words lists (section 9.4): every Entry and Task its narrowing
 * holds, newest first, each with its first words as the excerpt and nothing matched. Only a range
 * of days, a Project, a Person or an Author lets a search go without words, and none lists a
 * Project or a Person. Read from the words index, which holds every record not in the Trash, so the
 * newest first among equals is the same as for words.
 */
function listing(
  sql: SqlStorage,
  input: ToolInput<"search">,
  zone: string,
  offset: number,
  today: Day,
): SearchResults {
  const { where, bound } = narrowing(input, zone, LISTED_AT);
  const page = sql
    .exec<Omit<HitRow, "excerpt">>(
      `SELECT ${WORDS_INDEX}.kind AS kind, ${WORDS_INDEX}.record_id AS id, ${LISTED_AT} AS at,
         ${WORDS_INDEX}.text AS text,
         coalesce(e.author_kind, t.author_kind) AS author_kind,
         coalesce(e.author_name, t.author_name) AS author_name,
         t.origin_entry AS origin_entry
       FROM ${WORDS_INDEX}
       LEFT JOIN entries e ON ${WORDS_INDEX}.kind = 'entry' AND e.id = ${WORDS_INDEX}.record_id
       LEFT JOIN tasks t ON ${WORDS_INDEX}.kind = 'task' AND t.id = ${WORDS_INDEX}.record_id
       WHERE ${[`${WORDS_INDEX}.kind IN ('entry', 'task')`, ...where].join(" AND ")}
       ORDER BY at DESC, ${WORDS_INDEX}.rowid DESC
       LIMIT ? OFFSET ?`,
      ...bound,
      PAGE_SIZE + 1,
      offset,
    )
    .toArray();
  const read = page
    .slice(0, PAGE_SIZE)
    .map((row) => ({ ...row, excerpt: row.kind === "entry" ? firstWords(row.text) : row.text }));
  return pageOf(sql, read, {
    more: page.length > PAGE_SIZE,
    offset,
    today,
    words_only: null,
    given: [],
  });
}

/**
 * A page of hits from the rows read for it, in their order, each Task and Project saying where it
 * stands as read on `today`, each excerpt marked as the words given keep it, and a cursor to the
 * next while more follow.
 */
function pageOf(
  sql: SqlStorage,
  rows: HitRow[],
  page: {
    more: boolean;
    offset: number;
    today: Day;
    words_only: WordsOnly | null;
    given: WordGiven[];
  },
): SearchResults {
  const standing = standingOf(sql, rows, page.today);
  return {
    items: rows.flatMap((row) => hitOf(row, standing, page.given) ?? []),
    next_cursor: page.more ? listCursor("search", page.offset + PAGE_SIZE) : null,
    words_only: page.words_only,
  };
}

/** When a record was made, from whichever record table its row of the words index joins. */
const AT = `coalesce(e.at, t.at, p.at, pe.at)`;

/** When an Entry or a Task was made, the only kinds a search with no words lists. */
const LISTED_AT = `coalesce(e.at, t.at)`;

/**
 * The narrowing a search asks for, as SQL over a record joined as `e`, `t`, `p` or `pe` by its
 * kind, the others null: by date range, Project, Person and Author, together or alone. The range
 * is of `made`, when the record was made, as the tables the query joins tell it.
 */
function narrowing(
  input: ToolInput<"search">,
  zone: string,
  made = AT,
): { where: string[]; bound: (string | number)[] } {
  const where: string[] = [];
  const bound: (string | number)[] = [];
  if (input.from !== undefined) {
    where.push(`${made} >= ?`);
    bound.push(dayStart(input.from, zone));
  }
  if (input.to !== undefined) {
    where.push(`${made} < ?`);
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
         CASE ${WORDS_INDEX}.kind
           WHEN 'entry' THEN highlight(${WORDS_INDEX}, 2, char(2), char(3))
         END AS marked,
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
  return cutFrom(spaced(words), 0);
}

/** The Tasks and Projects on a page as reads give them, by id, so each hit says where it stands. */
type Standing = { tasks: Map<string, Task>; projects: Map<string, Project> };

function standingOf(sql: SqlStorage, page: Pick<Ranked, "kind" | "id">[], today: Day): Standing {
  const ids = (kind: SearchHit["kind"]) =>
    page.flatMap((ranked) => (ranked.kind === kind ? [ranked.id] : []));
  return {
    tasks: readTasks(sql, ids("task"), today),
    projects: readProjects(sql, ids("project"), today),
  };
}

/**
 * A hit from its row, its excerpt marked as the words given keep it, or null for a Task or Project
 * no longer there to say where it stands.
 */
function hitOf(row: HitRow, standing: Standing, given: WordGiven[]): SearchHit | null {
  const cut = (row.marked ? cutAround(row.marked, given) : null) ?? row.excerpt;
  const found = { id: row.id, at: instantToIso(row.at), excerpt: excerptOf(cut, given) };
  switch (row.kind) {
    case "entry":
      return {
        kind: "entry",
        ...found,
        summary: summarizeWords(row.text),
        author: toAuthor(row),
      };
    case "task": {
      const task = standing.tasks.get(row.id);
      if (!task) return null;
      return {
        kind: "task",
        ...found,
        summary: row.text,
        author: toAuthor(row),
        origin_entry: row.origin_entry as string,
        due_date: task.due_date,
        defer_date: task.defer_date,
        recurrence: task.recurrence,
        state: task.state,
      };
    }
    case "project": {
      const project = standing.projects.get(row.id);
      if (!project) return null;
      return {
        kind: "project",
        ...found,
        summary: row.text,
        due_date: project.due_date,
        state: project.state,
        ...projectTasksCounted(project),
      };
    }
    case "person":
      return { kind: row.kind, ...found, summary: row.text };
  }
}

function exists(sql: SqlStorage, table: string, id: string): boolean {
  return sql.exec(`SELECT 1 FROM ${table} WHERE id = ?`, id).toArray().length > 0;
}
