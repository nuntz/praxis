/**
 * One stretch of a comparison of words, read toward what a tap does (sections 3.2 and 4.7): kept
 * in both, gone from the words now, or come in the words the tap brings.
 */
export type Compared = { kind: "kept" | "gone" | "come"; text: string };

/**
 * A comparison as it is shown: each stretch, with the whole lines of an unchanged stretch longer
 * than `MOST_SHOWN_UNCHANGED` folded into one, which holds their text and how many they are.
 */
export type ComparedShown = Compared | { kind: "folded"; text: string; lines: number };

/** An unchanged stretch of more whole lines than this is folded. */
const MOST_SHOWN_UNCHANGED = 3;

/** Past this many pairs of words to weigh, what lies between the shared start and end is shown whole. */
const MOST_WEIGHED = 1_000_000;

/**
 * The words now compared with the words a tap brings, word by word, with the spaces, line breaks
 * and marks between kept as typed: for a Version, the current words with the Version's; for a Held
 * Change, the words before with those after. Read in order, what is kept and gone is the words
 * now, and what is kept and come is the words brought. It is shown as typed, never rendered.
 */
export function compareWords(now: string, brought: string): Compared[] {
  const was = tokens(now);
  const is = tokens(brought);
  let start = 0;
  while (start < was.length && start < is.length && was[start] === is[start]) start++;
  let end = 0;
  while (
    end < was.length - start &&
    end < is.length - start &&
    was[was.length - 1 - end] === is[is.length - 1 - end]
  ) {
    end++;
  }
  const parts: Compared[] = [];
  const add = (kind: Compared["kind"], text: string) => {
    if (text === "") return;
    const last = parts.at(-1);
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  add("kept", was.slice(0, start).join(""));
  for (const part of between(
    was.slice(start, was.length - end),
    is.slice(start, is.length - end),
  )) {
    add(part.kind, part.text);
  }
  add("kept", was.slice(was.length - end).join(""));
  return parts;
}

/**
 * Each word, each run of space and each other mark, in order, so that joined they are the text
 * again. A comma typed after a word leaves the word as it was.
 */
export function tokens(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{M}\p{N}_]+|[^\s\p{L}\p{M}\p{N}_]/gu) ?? [];
}

/**
 * What differs between two runs of words with no shared start or end: the longest run they share
 * is kept, and the rest is gone or come, the gone first where both are at one place.
 */
function between(was: string[], is: string[]): Compared[] {
  if (was.length * is.length > MOST_WEIGHED) {
    return [
      { kind: "gone", text: was.join("") },
      { kind: "come", text: is.join("") },
    ];
  }
  // shared[i][j] is the length of the longest run shared by was[i..] and is[j..].
  const width = is.length + 1;
  const shared = new Uint32Array((was.length + 1) * width);
  for (let i = was.length - 1; i >= 0; i--) {
    for (let j = is.length - 1; j >= 0; j--) {
      shared[i * width + j] =
        was[i] === is[j]
          ? (shared[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(shared[(i + 1) * width + j] ?? 0, shared[i * width + j + 1] ?? 0);
    }
  }
  const parts: Compared[] = [];
  let i = 0;
  let j = 0;
  while (i < was.length || j < is.length) {
    if (i < was.length && j < is.length && was[i] === is[j]) {
      parts.push({ kind: "kept", text: was[i++] as string });
      j++;
    } else if (
      j >= is.length ||
      (i < was.length && (shared[(i + 1) * width + j] ?? 0) >= (shared[i * width + j + 1] ?? 0))
    ) {
      parts.push({ kind: "gone", text: was[i++] as string });
    } else {
      parts.push({ kind: "come", text: is[j++] as string });
    }
  }
  return parts;
}

/**
 * Fold each unchanged stretch of more than three whole lines, so a change is found in long words.
 * What is folded is whole lines: the rest of the line a change before ends on, and the start of
 * the line a change after begins on, stay shown beside it.
 */
export function foldUnchanged(parts: Compared[]): ComparedShown[] {
  return parts.flatMap((part, at): ComparedShown[] => {
    if (part.kind !== "kept") return [part];
    const text = part.text;
    // After a change, the line it ends on stays; before one, the line it begins on.
    const start = at > 0 ? text.indexOf("\n") + 1 : 0;
    const end = at < parts.length - 1 ? text.lastIndexOf("\n") + 1 : text.length;
    if (start === 0 && at > 0) return [part];
    const whole = text.slice(start, end);
    const lines = linesIn(whole);
    if (lines <= MOST_SHOWN_UNCHANGED) return [part];
    const shown: ComparedShown[] = [];
    if (start > 0) shown.push({ kind: "kept", text: text.slice(0, start) });
    shown.push({ kind: "folded", text: whole, lines });
    if (end < text.length) shown.push({ kind: "kept", text: text.slice(end) });
    return shown;
  });
}

/** How many lines a run of whole lines holds: a break that ends it starts no line of its own. */
function linesIn(text: string): number {
  if (text === "") return 0;
  const breaks = text.match(/\n/g)?.length ?? 0;
  return text.endsWith("\n") ? breaks : breaks + 1;
}
