import { type Compared, tokens } from "./compare.ts";
import { type Anchor, liesWithin } from "./link.ts";

/**
 * Each anchor once the words have changed from `before` to `after`, in the order given: moved to
 * where the text it spans now is when the change kept that text whole, or null when the change
 * inserted into or deleted from its span, which leaves the link without its anchor (section 3.2).
 * The words are compared word by word, with each anchored span taken as one, so a change on both
 * sides of a span keeps it and a span's text is not split to match the words put around it. Within
 * a changed word what it shares at its start and end is kept, so typing straight after a name
 * keeps it. In a draft, typing into a picked name unpicks it.
 */
export function followEdit(
  before: string,
  after: string,
  anchors: readonly Anchor[],
): (Anchor | null)[] {
  const kept = keptStretches(before, after, anchors);
  return anchors.map((anchor) => {
    const stretch = kept.find(
      ({ was, length }) => was <= anchor.start && anchor.end <= was + length,
    );
    if (!stretch) return null;
    const moved = stretch.is - stretch.was;
    return { start: anchor.start + moved, end: anchor.end + moved };
  });
}

/** A stretch of the words a change kept: where it was before the change, where it is after. */
type Stretch = { was: number; is: number; length: number };

/** Past this many pieces gone and come, what lies between the shared start and end is changed whole. */
const MOST_CHANGED = 1_000;

/** The stretches a change kept, in order, each as long as it runs unbroken by the change. */
function keptStretches(before: string, after: string, anchors: readonly Anchor[]): Stretch[] {
  const spans = apart(anchors.filter((anchor) => liesWithin(before, anchor)));
  const texts = new Set(spans.map(({ start, end }) => before.slice(start, end)));
  const stretches: Stretch[] = [];
  let was = 0;
  let is = 0;
  const keep = (length: number) => {
    const last = stretches.at(-1);
    if (last && last.was + last.length === was && last.is + last.length === is) {
      last.length += length;
    } else if (length > 0) {
      stretches.push({ was, is, length });
    }
    was += length;
    is += length;
  };
  let gone = "";
  let come = "";
  const settle = () => {
    const head = sharedStart(gone, come);
    const tail = sharedEnd(gone.slice(head), come.slice(head));
    keep(head);
    was += gone.length - head - tail;
    is += come.length - head - tail;
    keep(tail);
    gone = "";
    come = "";
  };
  for (const step of steps(pieces(before, spans), pieces(after, occurrences(after, texts)))) {
    if (step.kind === "gone") gone += step.text;
    else if (step.kind === "come") come += step.text;
    else {
      settle();
      keep(step.text.length);
    }
  }
  settle();
  return stretches;
}

/** The spans that overlap no earlier one, in order. Where two start at one place, the longer. */
function apart(spans: readonly Anchor[]): Anchor[] {
  const sorted = [...spans].sort((one, other) => one.start - other.start || other.end - one.end);
  const kept: Anchor[] = [];
  for (const span of sorted) {
    if (span.start >= (kept.at(-1)?.end ?? 0)) kept.push(span);
  }
  return kept;
}

/** Every place in the words that holds one of these texts, as spans that overlap no earlier one. */
function occurrences(words: string, texts: ReadonlySet<string>): Anchor[] {
  const found: Anchor[] = [];
  for (const text of texts) {
    for (let at = words.indexOf(text); at >= 0; at = words.indexOf(text, at + 1)) {
      found.push({ start: at, end: at + text.length });
    }
  }
  return apart(found);
}

/** The words in pieces, each span one piece and the rest split into words, spaces and marks. */
function pieces(words: string, spans: readonly Anchor[]): string[] {
  const all: string[] = [];
  let at = 0;
  for (const { start, end } of spans) {
    all.push(...tokens(words.slice(at, start)), words.slice(start, end));
    at = end;
  }
  all.push(...tokens(words.slice(at)));
  return all;
}

/**
 * The fewest pieces gone and come that turn `was` into `is` (Myers' difference), with the rest
 * kept. Past `MOST_CHANGED` of them, what lies between the shared start and end is changed whole.
 */
function steps(was: readonly string[], is: readonly string[]): Compared[] {
  const head = sharedStart(was, is);
  const tail = sharedEnd(was.slice(head), is.slice(head));
  const kept = (pieces: readonly string[]): Compared[] =>
    pieces.length === 0 ? [] : [{ kind: "kept", text: pieces.join("") }];
  const middle = (one: readonly string[], other: readonly string[]): Compared[] =>
    fewest(one, other) ?? [
      { kind: "gone", text: one.join("") },
      { kind: "come", text: other.join("") },
    ];
  return [
    ...kept(was.slice(0, head)),
    ...middle(was.slice(head, was.length - tail), is.slice(head, is.length - tail)),
    ...kept(was.slice(was.length - tail)),
  ];
}

/** The fewest pieces gone and come between two runs, or null past `MOST_CHANGED` of them. */
function fewest(was: readonly string[], is: readonly string[]): Compared[] | null {
  // At diagonal k, a place in `was` less its place in `is`, furthest[k + most + 1] is how far
  // into `was` the path with fewest changes has reached. `trace` keeps it as it stood before
  // each further piece changed, for the diagonals the next step can come from.
  const most = Math.min(was.length + is.length, MOST_CHANGED);
  const furthest = new Int32Array(2 * most + 3);
  const reached = (k: number) => furthest[k + most + 1] ?? 0;
  const trace: Reached[] = [];
  for (let changed = 0; changed <= most; changed++) {
    const kept = furthest.slice(most - changed, most + changed + 3);
    trace.push((k) => kept[k + changed + 1] ?? 0);
    for (let k = -changed; k <= changed; k += 2) {
      let x = fromAbove(reached, k, changed) ? reached(k + 1) : reached(k - 1) + 1;
      let y = x - k;
      while (x < was.length && y < is.length && was[x] === is[y]) {
        x++;
        y++;
      }
      furthest[k + most + 1] = x;
      if (x >= was.length && y >= is.length) return walkBack(trace, was, is);
    }
  }
  return null;
}

/** How far into `was` the path with fewest changes on a diagonal had reached. */
type Reached = (k: number) => number;

/** Whether the path onto diagonal `k` comes from the one above it, with a piece come. */
function fromAbove(reached: Reached, k: number, changed: number): boolean {
  return k === -changed || (k !== changed && reached(k - 1) < reached(k + 1));
}

/** The steps of the path `fewest` found, read back from its end. */
function walkBack(
  trace: readonly Reached[],
  was: readonly string[],
  is: readonly string[],
): Compared[] {
  const back: Compared[] = [];
  let x = was.length;
  let y = is.length;
  const keptBack = () => {
    y--;
    back.push({ kind: "kept", text: was[--x] as string });
  };
  for (let changed = trace.length - 1; changed > 0; changed--) {
    const reached = trace[changed] as Reached;
    const k = x - y;
    const fromK = fromAbove(reached, k, changed) ? k + 1 : k - 1;
    const fromX = reached(fromK);
    const fromY = fromX - fromK;
    while (x > fromX && y > fromY) keptBack();
    if (fromK === k + 1) back.push({ kind: "come", text: is[--y] as string });
    else back.push({ kind: "gone", text: was[--x] as string });
  }
  while (x > 0) keptBack();
  return back.reverse();
}

/** How many items two runs share at their start. */
function sharedStart<T>(one: ArrayLike<T>, other: ArrayLike<T>): number {
  let length = 0;
  while (length < one.length && length < other.length && one[length] === other[length]) length++;
  return length;
}

/** How many items two runs share at their end. */
function sharedEnd<T>(one: ArrayLike<T>, other: ArrayLike<T>): number {
  let length = 0;
  while (
    length < one.length &&
    length < other.length &&
    one[one.length - 1 - length] === other[other.length - 1 - length]
  ) {
    length++;
  }
  return length;
}
