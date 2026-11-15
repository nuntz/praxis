import type { Author } from "@praxis/domain";

/** How an Author is kept in a record's row. */
export type AuthorColumns = { author_kind: Author["kind"]; author_name: string | null };

export function authorColumns(author: Author): [Author["kind"], string | null] {
  return [author.kind, author.kind === "connection" ? author.name : null];
}

export function toAuthor(row: AuthorColumns): Author {
  if (row.author_kind === "connection") return { kind: "connection", name: row.author_name ?? "" };
  return { kind: row.author_kind };
}
