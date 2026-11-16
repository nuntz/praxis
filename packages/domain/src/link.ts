/**
 * A span of an Entry's words, from `start` up to but not including `end`, counted as JavaScript
 * counts a string: in UTF-16 code units, as a text field's caret is.
 */
export type Anchor = { start: number; end: number };

/** What a link names: a Task or Project for a Reference, a Person for a Mention. */
export type LinkTarget = { kind: "task" | "project" | "person"; id: string };

/** A new Person or Project for a link to name, made in the same call (section 4.8). */
export type NewLinkTarget = { kind: "new_person" | "new_project"; name: string };

/** A link as a write takes it: what it names, and the span of the words it is anchored to. */
export type NewLink = { to: LinkTarget | NewLinkTarget; anchor?: Anchor | undefined };

/**
 * A Reference or a Mention as every read returns it, kept beside the Entry's words (ADR 0008):
 * what it names, with that record's one-line summary, and its anchor, or null when it has none
 * or its span is gone.
 */
export type Link = {
  kind: "reference" | "mention";
  to: LinkTarget & { summary: string };
  anchor: Anchor | null;
};

/** A Mention names a Person; a Reference names a Task or a Project. */
export function linkKind(to: LinkTarget): Link["kind"] {
  return to.kind === "person" ? "mention" : "reference";
}

/** Whether a span lies within these words. */
export function liesWithin(words: string, anchor: Anchor): boolean {
  return anchor.end <= words.length;
}

/**
 * A link's anchor as it reads against the words now. It is kept with the text it spanned when it
 * was made, and while the words still hold that text there it is the anchor; once they do not,
 * its span is gone and the link stays on the Entry without one (section 3.2).
 */
export function anchorIn(words: string, kept: Anchor & { text: string }): Anchor | null {
  return words.slice(kept.start, kept.end) === kept.text
    ? { start: kept.start, end: kept.end }
    : null;
}

/**
 * What the person is typing to link something, when the caret is in it: `@` opens a picker of
 * the Context's Persons and `#` one of its Tasks and Projects (section 3.2). `start` is where the
 * `@` or `#` is, and `typed` what follows it up to the caret.
 */
export type LinkQuery = { kind: Link["kind"]; start: number; typed: string };

/** The longest name a picker looks for. Past it, what is typed is taken to be prose. */
const LONGEST_TYPED = 60;

/** What may come straight before an `@` or `#` that opens a picker: nothing, a space, or an opening mark. */
const OPENS_BEFORE = /[\s([{"'“‘]/u;

/**
 * The picker open at the caret, if any. The `@` or `#` starts its line or follows a space or an
 * opening mark, so an address or `C#` opens nothing. What follows it is on one line, starts with
 * no space and holds no two in a row, so `# Heading` opens nothing, and `#` opens only once a
 * character follows it. The parser never looks a name up: only a pick makes a link.
 */
export function linkQueryAt(words: string, caret: number): LinkQuery | null {
  const lineStart =
    Math.max(words.lastIndexOf("\n", caret - 1), words.lastIndexOf("\r", caret - 1)) + 1;
  const line = words.slice(lineStart, caret);
  const start = lineStart + Math.max(line.lastIndexOf("@"), line.lastIndexOf("#"));
  if (start < lineStart) return null;
  const before = words[start - 1];
  if (before !== undefined && !OPENS_BEFORE.test(before)) return null;
  const typed = words.slice(start + 1, caret);
  const kind = words[start] === "@" ? "mention" : "reference";
  if (/^\s|\s\s/u.test(typed) || typed.length > LONGEST_TYPED) return null;
  if (kind === "reference" && typed === "") return null;
  return { kind, start, typed };
}

/** The words after a pick, where the caret goes, and the span the link is anchored to. */
export type Picked = { words: string; caret: number; anchor: Anchor };

/**
 * Pick a record in an open picker: what was typed gives way to its name, with the `@` or `#`
 * kept, and the link is anchored to that. A space follows unless a space or a mark already
 * does. A picked Reference never has a space after its `#`, so it never makes a heading.
 */
export function pickLink(words: string, query: LinkQuery, caret: number, name: string): Picked {
  const text = `${query.kind === "mention" ? "@" : "#"}${name.trimStart()}`;
  const after = words.slice(caret);
  const space = /^[\s\p{P}]/u.test(after) ? "" : " ";
  const end = query.start + text.length;
  return {
    words: `${words.slice(0, query.start)}${text}${space}${after}`,
    caret: end + space.length,
    anchor: { start: query.start, end },
  };
}

/**
 * A picked link's anchor once the words have changed from `before` to `after` by one edit, as a
 * text field changes with each thing typed. It moves with what is typed before it and stays
 * through what is typed after it. An edit that touches its span loses it: in a draft, typing into
 * a picked name unpicks it.
 */
export function followAnchor(before: string, after: string, anchor: Anchor): Anchor | null {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }
  if (anchor.end <= prefix) return anchor;
  if (anchor.start >= before.length - suffix) {
    const moved = after.length - before.length;
    return { start: anchor.start + moved, end: anchor.end + moved };
  }
  return null;
}

/**
 * Whether a name holds what was typed, whatever its case and accents: how a list is narrowed for
 * a picker. It is never how a link is made, since two records can share a name.
 */
export function nameHolds(name: string, typed: string): boolean {
  return folded(name).includes(folded(typed));
}

/** Text with its case and accents set aside and its spaces run together. */
function folded(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}
