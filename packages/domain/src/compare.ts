/**
 * One stretch of a Version compared against the current words (section 3.2): kept in both, gone
 * from the Version, or come in the current words.
 */
export type Compared = { kind: "kept" | "gone" | "come"; text: string };

/** Past this many pairs of words to weigh, what lies between the shared start and end is shown whole. */
const MOST_WEIGHED = 1_000_000;

/**
 * A Version compared against the current words, word by word, with the spaces, line breaks and
 * marks between kept as typed. Read in order, what is kept and gone is the Version, and what is kept
 * and come is the current words. It is shown as typed, never rendered.
 */
export function compareWords(version: string, current: string): Compared[] {
  const was = tokens(version);
  const is = tokens(current);
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
