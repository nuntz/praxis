import { describe, expect, test } from "bun:test";
import { type Anchor, followEdit } from "../src/index.ts";

// Following an anchor through a change to the words is one of the few places with direct tests
// (section 13): any edit to any words can move an anchor, too many for scenarios at the tool seam.
// Each property is held over many edits drawn from a seeded source, so a failure is the same on
// every run and names the words that broke it.

const RUNS = 2_000;

/** A seeded source of numbers in [0, 1) (mulberry32), so every run draws the same edits. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

type Draw = ReturnType<typeof seeded>;

const pick = <T>(draw: Draw, from: readonly T[]): T => from[Math.floor(draw() * from.length)] as T;
const count = (draw: Draw, most: number) => Math.floor(draw() * (most + 1));

/** Words as they were: each a word and a space, from a set of words an edit never brings. */
const WAS = ["Met", "the", "landlord", "today", "and", "a", "lease", "Ali"].map((w) => `${w} `);

/**
 * Words an edit brings: each a word and a dash, sharing nothing with the words as they were. One
 * is another Mention, whose `@` must not be taken for the anchored one's.
 */
const COME = ["zed", "qux", "vow", "@Bob"].map((w) => `${w}-`);

/** A run of the words as they were. */
const run = (draw: Draw) => Array.from({ length: count(draw, 6) }, () => pick(draw, WAS));

/** A run edited: some of its words taken away, and words brought in among the rest. */
function edited(draw: Draw, words: string[]): string[] {
  const after = words.filter(() => draw() > 0.3);
  for (let n = count(draw, 3); n > 0; n--) {
    after.splice(count(draw, after.length), 0, pick(draw, COME));
  }
  return after;
}

/** Where each anchored text is, in order, in words made of runs with that text between them. */
function spans(runs: string[][], text: string): { words: string; anchors: Anchor[] } {
  let words = "";
  const anchors: Anchor[] = [];
  runs.forEach((part, i) => {
    words += part.join("");
    if (i < runs.length - 1) {
      anchors.push({ start: words.length, end: words.length + text.length });
      words += text;
    }
  });
  return { words, anchors };
}

/** Runs of words edited, with "@Ali " anchored between them before and `typed` there after. */
function editAround(draw: Draw, parts: number, typed = "@Ali ") {
  const runs = Array.from({ length: parts }, () => run(draw));
  const before = spans(runs, "@Ali ");
  const after = spans(
    runs.map((words) => edited(draw, words)),
    typed,
  );
  return { before, after };
}

/** That the anchors in `before` follow the change to `after` as `expected`, naming the words. */
function follows(
  before: { words: string; anchors: Anchor[] },
  after: string,
  expected: (Anchor | null)[],
) {
  expect({
    before: before.words,
    after,
    followed: followEdit(before.words, after, before.anchors),
  }).toEqual({ before: before.words, after, followed: expected });
}

describe("an anchor followed through a change to the words", () => {
  test("is kept, moved to where its text now is, through any edit on both sides of it", () => {
    const draw = seeded(84);
    for (let i = 0; i < RUNS; i++) {
      const { before, after } = editAround(draw, 2);
      follows(before, after.words, after.anchors);
    }
  });

  test("keeps two equal spans apart, each moved to its own place", () => {
    const draw = seeded(85);
    for (let i = 0; i < RUNS; i++) {
      const { before, after } = editAround(draw, 3);
      follows(before, after.words, after.anchors);
    }
  });

  test("is lost when the edit puts anything inside its span, whatever else it changes", () => {
    const draw = seeded(86);
    for (let i = 0; i < RUNS; i++) {
      const inside = pick(draw, ["@", "@A", "@Al"]);
      const typed = `${inside}${pick(draw, COME)}${"@Ali ".slice(inside.length)}`;
      const { before, after } = editAround(draw, 2, typed);
      follows(before, after.words, [null]);
    }
  });

  test("never moves an anchor onto words that are not its own", () => {
    const draw = seeded(87);
    const pieces = ["a", "b", " ", "  ", "\n", ",", "@", "#", "Ali", "😀", "é"];
    const text = () => Array.from({ length: count(draw, 24) }, () => pick(draw, pieces)).join("");
    for (let i = 0; i < RUNS; i++) {
      const before = text();
      const after = draw() < 0.5 ? text() : `${pick(draw, pieces)}${before}${pick(draw, pieces)}`;
      const anchors = Array.from({ length: count(draw, 3) }, () => {
        const start = count(draw, before.length - 1);
        return { start, end: start + 1 + count(draw, before.length - start - 1) };
      }).filter((anchor) => anchor.end <= before.length);
      const followed = followEdit(before, after, anchors);
      anchors.forEach((anchor, n) => {
        const moved = followed[n];
        if (moved) {
          expect({ before, after, text: after.slice(moved.start, moved.end) }).toEqual({
            before,
            after,
            text: before.slice(anchor.start, anchor.end),
          });
        }
      });
    }
  });
});
