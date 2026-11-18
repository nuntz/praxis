import { type Effect, instantToIso, type Person, summarizeWords } from "@praxis/domain";

export type PersonRow = { seq: number; id: string; name: string; at: number };

/** Make a Person, and return their id. */
export function insertPerson(sql: SqlStorage, person: { name: string; at: number }): string {
  const id = crypto.randomUUID();
  sql.exec(`INSERT INTO persons (id, name, at) VALUES (?, ?, ?)`, id, person.name, person.at);
  return id;
}

/** A Person who exists in this Context. */
export function readPerson(sql: SqlStorage, id: string): Person | null {
  const rows = sql.exec<PersonRow>(`SELECT * FROM untrashed_persons WHERE id = ?`, id).toArray();
  return personsOf(sql, rows)[0] ?? null;
}

type MentionRow = { person: string; entry: string; at: number; words: string };

/** The Persons, each with the latest Entry that Mentions them, by which a picker tells them apart. */
export function personsOf(sql: SqlStorage, rows: PersonRow[]): Person[] {
  const latest = new Map<string, MentionRow>();
  const mentions = sql.exec<MentionRow>(
    `SELECT l.to_id AS person, e.id AS entry, e.at, e.words
     FROM entry_links l JOIN untrashed_entries e ON e.id = l.entry
     WHERE l.to_kind = 'person' AND l.to_id IN (SELECT value FROM json_each(?))
     ORDER BY e.at DESC, e.seq DESC`,
    JSON.stringify(rows.map((row) => row.id)),
  );
  for (const mention of mentions) {
    if (!latest.has(mention.person)) latest.set(mention.person, mention);
  }
  return rows.map((row) => {
    const mention = latest.get(row.id);
    return {
      id: row.id,
      name: row.name,
      at: instantToIso(row.at),
      latest_mention: mention
        ? {
            entry: mention.entry,
            at: instantToIso(mention.at),
            summary: summarizeWords(mention.words),
          }
        : null,
    };
  });
}

/** The Effect of a call on a Person, with their one-line summary. */
export function personEffect(person: Pick<Person, "id" | "name">, what: Effect["what"]): Effect {
  return { kind: "person", id: person.id, what, summary: summarizeWords(person.name), by: "call" };
}
