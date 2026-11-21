import MarkdownIt, { type StateBlock, type Token } from "markdown-it";
import type { Entry } from "./entry.ts";
import { inlineTaskTitle } from "./task.ts";

/**
 * An Entry's words as the screen shows them (section 8.4, ADR 0025): Markdown from a fixed set,
 * with CommonMark's syntax, and everything else as typed. The words are kept as typed and only
 * the screen reads this; the server never does. The screen draws it with elements of its own, so
 * nothing in the words ever becomes markup.
 */
export type MarkdownBlock =
  | { kind: "paragraph"; children: MarkdownInline[] }
  /** A heading is the size of the words around it; three levels are kept apart. */
  | { kind: "heading"; level: 1 | 2 | 3; children: MarkdownInline[] }
  | { kind: "code_block"; text: string }
  | { kind: "quote"; children: MarkdownBlock[] }
  /** Bulleted or numbered, each item its own blocks. A numbered list starts at the number typed. */
  | { kind: "list"; ordered: boolean; start: number; items: MarkdownBlock[][] }
  /** A header row and the rows under it, each a cell's words, and each column's alignment. */
  | { kind: "table"; align: Alignment[]; head: MarkdownInline[][]; rows: MarkdownInline[][][] }
  /**
   * Lines shown as typed, their spacing kept: an Inline Task's line and the marked lines after
   * it, a rule, and raw HTML on lines of its own.
   */
  | { kind: "typed"; text: string };

/**
 * How a table's column is aligned: as its delimiter row was typed, or right for a column typed
 * with none that holds only numbers, as the design system aligns them, or else null.
 */
export type Alignment = "left" | "center" | "right" | null;

/** What a block holds, within a line. */
export type MarkdownInline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "emphasis"; children: MarkdownInline[] }
  | { kind: "strong"; children: MarkdownInline[] }
  /** A link or a bare address, always to an `https` one. */
  | { kind: "link"; href: string; children: MarkdownInline[] }
  /** An image, always from an `https` address, with its description as plain words. */
  | { kind: "image"; src: string; description: string }
  /** The end of a line the person typed within a paragraph. */
  | { kind: "break" };

// Raw HTML is read only so that it is shown as typed, whole; a line within a paragraph stays a
// line, as the person typed it.
const parser = new MarkdownIt({ html: true, linkify: true, breaks: true });
// A link, by reference or not, an autolink, a bare address and an image take only an `https`
// address, and anything else is shown as typed. Only an address with its scheme is bare: `www.`
// and a mail address are words.
parser.validateLink = isHttps;
parser.linkify.set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false });
parser.disable("strikethrough");

// Every rule that ends a paragraph, a list or a quote, as a heading does.
const ENDS_A_BLOCK = ["paragraph", "reference", "blockquote", "list"];

/**
 * markdown-it's own block rule by its name, to wrap: its function and the rules it ends. Its list
 * of rules is its own, not its interface, so a release that renames one fails here, at once.
 */
function blockRule(name: string) {
  const rule = parser.block.ruler.__rules__.find((each) => each.name === name);
  if (!rule) throw new Error(`markdown-it has no block rule ${name}`);
  return { fn: rule.fn, alt: [...rule.alt] };
}

/** A block of lines shown as typed, from `start` up to but not including `end`. */
function pushTyped(state: StateBlock, start: number, end: number): void {
  const token = state.push("typed", "", 0);
  token.content = state.src.slice(state.bMarks[start], state.eMarks[end - 1]);
  token.map = [start, end];
  state.line = end;
}

// An Inline Task's line, and the marked lines after it, are shown as typed: the line the parser
// in `task.ts` makes a Task of, at the very start of a line of the words, so that one in a quote or
// indented in a list is a line of that like any other, as it makes no Task.
function startsInlineTask(state: StateBlock, line: number): boolean {
  const start = state.bMarks[line] ?? 0;
  if (start > 0 && state.src[start - 1] !== "\n") return false;
  return inlineTaskTitle(state.src.slice(start, state.eMarks[line])) !== null;
}
parser.block.ruler.before(
  "table",
  "inline_task",
  (state, start, end, silent) => {
    if (!startsInlineTask(state, start)) return false;
    if (silent) return true;
    let after = start + 1;
    while (after < end && startsInlineTask(state, after)) after++;
    pushTyped(state, start, after);
    return true;
  },
  { alt: ENDS_A_BLOCK },
);

// Words nested deeper than markdown-it reads are shown as typed: past `maxNesting` it skips
// every line left in the block, and words are never dropped. A list nests two levels at once, its
// items inside it, so the lines are taken two levels short of it, up to where the block ends.
parser.block.ruler.before("inline_task", "too_deep", (state, start, end, silent) => {
  if (state.level < parser.options.maxNesting - 2) return false;
  if (silent) return true;
  let after = start + 1;
  while (after < end && (state.isEmpty(after) || (state.sCount[after] ?? 0) >= state.blkIndent)) {
    after++;
  }
  while (after > start + 1 && state.isEmpty(after - 1)) after--;
  pushTyped(state, start, after);
  return true;
});

// A rule is shown as typed, where markdown-it would draw one.
const hr = blockRule("hr");
parser.block.ruler.at(
  "hr",
  (state, start, end, silent) => {
    if (!hr.fn(state, start, end, true)) return false;
    if (!silent) pushTyped(state, start, start + 1);
    return true;
  },
  { alt: hr.alt },
);

// A footnote's note is shown as typed, and is no link's definition: its label starts with `^`.
// markdown-it names a link's definition a reference, which is no Reference.
const linkDefinition = blockRule("reference");
parser.block.ruler.at(
  "reference",
  (state, start, end, silent) => {
    const at = (state.bMarks[start] ?? 0) + (state.tShift[start] ?? 0);
    if (state.src.startsWith("[^", at)) return false;
    return linkDefinition.fn(state, start, end, silent);
  },
  { alt: linkDefinition.alt },
);

/**
 * Whether an address is one a link takes: `https`, then a host. `https:host`, which a browser
 * reads as `https://host`, is not one, since it was not typed as one.
 */
function isHttps(address: string): boolean {
  return /^https:\/\/[^/?#\\]/i.test(address);
}

/**
 * How an image in words the screen shows loads (section 8.4, ADR 0025): by itself, on the
 * person's tap for that showing, or never, as in a Message from the Agent (section 8.5).
 */
export type ImageLoading = "by_itself" | "on_tap" | "never";

/**
 * How an Entry's images load. Showing one makes the person's browser call the address, which can
 * carry words out, so one loads by itself only in an Entry the person wrote by hand: its Author is
 * the person and it did not come through the Conversation, and the Agent's words have not been put
 * in it since. The last change to its words says which hand they are from: the person's edit makes
 * an Entry theirs and vouches for it, so its images then load by themselves, while a Held Change
 * the person tapped leaves them the Author with the Agent's words in it (section 5.3), which wait
 * for a tap. A Connection cannot change the person's words at all.
 */
export function imageLoadingIn(
  entry: Pick<Entry, "author" | "through_conversation" | "edited">,
): Exclude<ImageLoading, "never"> {
  if (entry.author.kind !== "person") return "on_tap";
  const byHand = entry.edited ? entry.edited.by.kind === "person" : !entry.through_conversation;
  return byHand ? "by_itself" : "on_tap";
}

/** The words as the screen shows them: the blocks of the fixed set, in the order typed. */
export function renderMarkdown(words: string): MarkdownBlock[] {
  return blocks(parser.parse(words, {}));
}

/** The blocks a run of block tokens makes. Each block's tokens, up to its close, are read whole. */
function blocks(tokens: Token[]): MarkdownBlock[] {
  const shown: MarkdownBlock[] = [];
  let at = 0;
  while (at < tokens.length) {
    const token = tokens[at] as Token;
    const close = closing(tokens, at);
    const inside = tokens.slice(at + 1, close);
    if (token.type === "paragraph_open") {
      shown.push({ kind: "paragraph", children: inlinesIn(inside) });
    } else if (token.type === "heading_open") {
      const level = Math.min(Number(token.tag.slice(1)), 3) as 1 | 2 | 3;
      shown.push({ kind: "heading", level, children: inlinesIn(inside) });
    } else if (token.type === "blockquote_open") {
      shown.push({ kind: "quote", children: blocks(inside) });
    } else if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
      shown.push({
        kind: "list",
        ordered: token.type === "ordered_list_open",
        start: Number(token.attrGet("start") ?? 1),
        items: itemsIn(inside),
      });
    } else if (token.type === "table_open") {
      shown.push(tableOf(inside));
    } else if (token.type === "fence" || token.type === "code_block") {
      shown.push({ kind: "code_block", text: token.content.replace(/\n$/, "") });
    } else if (token.type === "typed" || token.type === "html_block") {
      shown.push({ kind: "typed", text: token.content.replace(/\n$/, "") });
    }
    at = close + 1;
  }
  return shown;
}

/** A table from its tokens: the first row is the header, and gives each column's alignment. */
function tableOf(tokens: Token[]): MarkdownBlock {
  const rows: { align: Alignment; words: MarkdownInline[] }[][] = [];
  for (const [at, token] of tokens.entries()) {
    if (token.type === "tr_open") rows.push([]);
    else if (token.type === "th_open" || token.type === "td_open") {
      const align = /text-align:(left|center|right)/.exec(String(token.attrGet("style")))?.[1];
      const words = inlinesIn(tokens.slice(at + 1, closing(tokens, at)));
      rows.at(-1)?.push({ align: (align as Alignment | undefined) ?? null, words });
    }
  }
  const [head = [], ...body] = rows;
  return {
    kind: "table",
    align: head.map((cell, column) => {
      if (cell.align !== null) return cell.align;
      const filled = body.map((row) => row[column]?.words ?? []).filter((words) => words.length);
      return filled.length > 0 && filled.every(isNumber) ? "right" : null;
    }),
    head: head.map((cell) => cell.words),
    rows: body.map((row) => row.map((cell) => cell.words)),
  };
}

/** A number as a cell holds one: a sign, digits with their separators, and a percent. */
const NUMBER = /^[-+−]?\d(?:[\d.,'\u00a0\u202f ]*\d)?%?$/u;

/** Whether a cell's words are one number, and nothing else. */
function isNumber(words: MarkdownInline[]): boolean {
  const [only, ...more] = words;
  return more.length === 0 && only?.kind === "text" && NUMBER.test(only.text.trim());
}

/** A list's items, each the blocks it holds. */
function itemsIn(tokens: Token[]): MarkdownBlock[][] {
  const items: MarkdownBlock[][] = [];
  for (let at = 0; at < tokens.length; at++) {
    const close = closing(tokens, at);
    items.push(blocks(tokens.slice(at + 1, close)));
    at = close;
  }
  return items;
}

/** Where the token opened at `at` is closed: itself, when it opens nothing. */
function closing(tokens: Token[], at: number): number {
  if (tokens[at]?.nesting !== 1) return at;
  let depth = 0;
  for (let each = at; each < tokens.length; each++) {
    depth += tokens[each]?.nesting ?? 0;
    if (depth === 0) return each;
  }
  return tokens.length - 1;
}

/** What the one inline token among a block's tokens holds. */
function inlinesIn(tokens: Token[]): MarkdownInline[] {
  const inline = tokens.find((token) => token.type === "inline");
  return inline ? inlines(inline) : [];
}

/** What an inline token holds. Raw HTML within a line is words, and runs into the words around it. */
function inlines(token: Token): MarkdownInline[] {
  const stack: MarkdownInline[][] = [[]];
  const opened: Token[] = [];
  const into = (inline: MarkdownInline) => {
    const run = stack.at(-1);
    const last = run?.at(-1);
    if (inline.kind === "text" && last?.kind === "text") last.text += inline.text;
    else run?.push(inline);
  };
  for (const child of token.children ?? []) {
    if (child.type === "text" || child.type === "html_inline") {
      into({ kind: "text", text: child.content });
    } else if (child.type === "code_inline") into({ kind: "code", text: child.content });
    else if (child.type === "softbreak" || child.type === "hardbreak") into({ kind: "break" });
    else if (child.type === "image") {
      const src = String(child.attrGet("src"));
      into({ kind: "image", src, description: plainWords(child.children ?? []) });
    } else if (child.nesting === 1) {
      opened.push(child);
      stack.push([]);
    } else if (child.nesting === -1) {
      const open = opened.pop();
      const children = stack.pop() ?? [];
      if (open?.type === "em_open") into({ kind: "emphasis", children });
      else if (open?.type === "strong_open") into({ kind: "strong", children });
      else if (open?.type === "link_open") {
        into({ kind: "link", href: String(open.attrGet("href")), children });
      }
    }
  }
  return stack[0] ?? [];
}

/** The words of inline tokens with their Markdown set aside, as an image's description is. */
function plainWords(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if (token.type === "softbreak" || token.type === "hardbreak") return " ";
      if (token.type === "image") return plainWords(token.children ?? []);
      return token.content;
    })
    .join("");
}
