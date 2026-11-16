import {
  type Anchor,
  anchorIn,
  type Effect,
  type Entry,
  failure,
  type Link,
  type LinkTarget,
  liesWithin,
  linkKind,
  type NewLink,
  type NewLinkTarget,
  summarizeWords,
  type ToolResult,
} from "@praxis/domain";
import { insertPerson, personEffect } from "./person-rows.ts";
import { insertProject, projectEffect } from "./project-rows.ts";

type LinkRow = {
  entry: string;
  to_kind: LinkTarget["kind"];
  to_id: string;
  anchor_start: number | null;
  anchor_end: number | null;
  anchor_text: string | null;
  /** The title or name of the record it names, read with it. */
  target_name: string;
};

/** An Entry's id and its words, against which its links' anchors are read. */
type EntryWords = Pick<Entry, "id" | "words">;

/** The table each kind of record a link names is kept in. */
const tableOf: Record<LinkTarget["kind"], string> = {
  task: "tasks",
  project: "projects",
  person: "persons",
};

/**
 * Whether a link can be added to an Entry with these words: its anchor lies within them, and the
 * record it names is in this Context. Checked before anything is written, since a failed call
 * changes nothing.
 */
export function checkLink(
  sql: SqlStorage,
  words: string,
  { to, anchor }: NewLink,
): ToolResult<null> {
  if (anchor && !liesWithin(words, anchor)) {
    return failure(
      "invalid_input",
      `An anchor is a span of the words, which end at ${words.length}.`,
    );
  }
  if (!isNew(to) && !found(sql, to)) {
    return failure("not_found", `No such ${to.kind} in this Context.`);
  }
  return { ok: true, value: null };
}

/**
 * The links that can be kept beside new words, which are never refused for a link (section
 * 4.8): one naming a record not in this Context is not kept, and an anchor past the words' end
 * is not, so its link is kept without one.
 */
export function keepableLinks(sql: SqlStorage, words: string, links: NewLink[]): NewLink[] {
  return links.flatMap(({ to, anchor }) => {
    if (!isNew(to) && !found(sql, to)) return [];
    return [{ to, anchor: anchor && liesWithin(words, anchor) ? anchor : undefined }];
  });
}

function found(sql: SqlStorage, to: LinkTarget): boolean {
  return sql.exec(`SELECT 1 FROM ${tableOf[to.kind]} WHERE id = ?`, to.id).toArray().length > 0;
}

/**
 * Keep links beside an Entry's words, each anchor with the text it spans, making first any new
 * Person or Project one names. Returns the Effects of the records made. Check them first.
 */
export function insertLinks(
  sql: SqlStorage,
  entry: EntryWords,
  links: NewLink[],
  at: number,
): Effect[] {
  const made: Effect[] = [];
  for (const { to, anchor } of links) {
    const target = isNew(to) ? makeTarget(sql, to, at) : to;
    if (isNew(to)) made.push(madeEffect(target, to.name));
    sql.exec(
      `INSERT INTO entry_links (entry, to_kind, to_id, anchor_start, anchor_end, anchor_text)
       VALUES (?, ?, ?, ?, ?, ?)`,
      entry.id,
      target.kind,
      target.id,
      anchor?.start ?? null,
      anchor?.end ?? null,
      anchor ? entry.words.slice(anchor.start, anchor.end) : null,
    );
  }
  return made;
}

/**
 * Remove the links from an Entry to a record: every one, or given an anchor only the one at that
 * span of its words now. Returns whether there was one.
 */
export function deleteLinks(
  sql: SqlStorage,
  entry: EntryWords,
  to: LinkTarget,
  anchor: Anchor | undefined,
): boolean {
  return (
    sql.exec(
      `DELETE FROM entry_links WHERE entry = ? AND to_kind = ? AND to_id = ?
         AND (? IS NULL OR (anchor_start = ? AND anchor_end = ? AND anchor_text = ?))`,
      entry.id,
      to.kind,
      to.id,
      anchor ? 1 : null,
      anchor?.start ?? null,
      anchor?.end ?? null,
      anchor ? entry.words.slice(anchor.start, anchor.end) : null,
    ).rowsWritten > 0
  );
}

/** The links of each of these Entries, in the order they were added, read against their words. */
export function linksOf(sql: SqlStorage, entries: EntryWords[]): Map<string, Link[]> {
  const words = new Map(entries.map((entry) => [entry.id, entry.words]));
  const rows = sql
    .exec<LinkRow>(
      `SELECT l.*, coalesce(t.title, p.name, pe.name) AS target_name
       FROM entry_links l
       LEFT JOIN tasks t ON l.to_kind = 'task' AND t.id = l.to_id
       LEFT JOIN projects p ON l.to_kind = 'project' AND p.id = l.to_id
       LEFT JOIN persons pe ON l.to_kind = 'person' AND pe.id = l.to_id
       WHERE l.entry IN (SELECT value FROM json_each(?))
       ORDER BY l.seq`,
      JSON.stringify([...words.keys()]),
    )
    .toArray();
  const links = new Map<string, Link[]>();
  for (const row of rows) {
    links.set(row.entry, [
      ...(links.get(row.entry) ?? []),
      toLink(row, words.get(row.entry) ?? ""),
    ]);
  }
  return links;
}

function toLink(row: LinkRow, words: string): Link {
  const to = { kind: row.to_kind, id: row.to_id };
  const kept =
    row.anchor_start === null || row.anchor_end === null || row.anchor_text === null
      ? null
      : { start: row.anchor_start, end: row.anchor_end, text: row.anchor_text };
  return {
    kind: linkKind(to),
    to: { ...to, summary: summarizeWords(row.target_name) },
    anchor: kept && anchorIn(words, kept),
  };
}

function isNew(to: LinkTarget | NewLinkTarget): to is NewLinkTarget {
  return to.kind === "new_person" || to.kind === "new_project";
}

function makeTarget(sql: SqlStorage, to: NewLinkTarget, at: number): LinkTarget {
  return to.kind === "new_person"
    ? { kind: "person", id: insertPerson(sql, { name: to.name, at }) }
    : { kind: "project", id: insertProject(sql, { name: to.name, dueDate: null, at }) };
}

function madeEffect(target: LinkTarget, name: string): Effect {
  const record = { id: target.id, name };
  return target.kind === "person" ? personEffect(record, "made") : projectEffect(record, "made");
}
