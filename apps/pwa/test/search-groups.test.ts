import { describe, expect, test } from "bun:test";
import type { SearchHit } from "@praxis/domain";
import { groupByKind } from "../src/search-groups.ts";

// How the screen groups what a search found (section 8.4), against answers of the test's own, since
// a journey cannot have the meaning index leave out one answer. Whether Close in meaning folds is
// the search journeys' to show.

const AT = "2026-11-20T09:00:00.000Z";

function entry(id: string, matched: boolean): SearchHit {
  return {
    kind: "entry",
    id,
    summary: id,
    at: AT,
    author: { kind: "person" },
    excerpt: { text: `Bought a lantern ${id}`, matches: matched ? [{ start: 9, end: 16 }] : [] },
  };
}

const person: SearchHit = {
  kind: "person",
  id: "ana",
  summary: "Ana Lantern",
  at: AT,
  excerpt: { text: "Ana Lantern", matches: [{ start: 4, end: 11 }] },
};

/** The tool's one list: an Entry found only by meaning ranked between two found by the words. */
const hits = [entry("first", true), entry("meant", false), person, entry("last", true)];

/** Each group as its title and the ids it holds, in order. */
const shapeOf = (groups: ReturnType<typeof groupByKind>) =>
  groups.map((group) => [group.title, group.hits.map((hit) => hit.id)]);

describe("what a search found, grouped by kind", () => {
  test("an Entry that holds none of the words goes under Close in meaning when meaning was asked", () => {
    expect(shapeOf(groupByKind({ hits, words: "lantern", wordsOnly: null }))).toEqual([
      ["Persons", ["ana"]],
      ["Entries", ["first", "last"]],
      ["Close in meaning", ["meant"]],
    ]);
  });

  test("an answer from words alone has no Close in meaning, each Entry kept in the tool's order", () => {
    for (const wordsOnly of ["missing", "stale", "unreachable", "cap_reached"] as const) {
      expect(shapeOf(groupByKind({ hits, words: "lantern", wordsOnly }))).toEqual([
        ["Persons", ["ana"]],
        ["Entries", ["first", "meant", "last"]],
      ]);
    }
  });

  test("a list with no words has no Close in meaning", () => {
    const listed = [entry("newest", false), entry("older", false)];
    expect(shapeOf(groupByKind({ hits: listed, words: " ", wordsOnly: null }))).toEqual([
      ["Entries", ["newest", "older"]],
    ]);
  });
});
