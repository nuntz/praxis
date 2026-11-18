import { describe, expect, test } from "bun:test";
import { followEdit, linkQueryAt, pickLink } from "../src/index.ts";

// What the person types to link something is one of the few places with direct tests
// (section 13): the words around a picker are too varied for scenarios at the tool seam.

/** The query at the end of what was typed. */
const at = (typed: string) => linkQueryAt(typed, typed.length);

describe("a picker", () => {
  test.each([
    ["@", { kind: "mention", start: 0, typed: "" }],
    ["@al", { kind: "mention", start: 0, typed: "al" }],
    ["Met @Ali K", { kind: "mention", start: 4, typed: "Ali K" }],
    ["Met (@ali", { kind: "mention", start: 5, typed: "ali" }],
    ["Lunch\n@b", { kind: "mention", start: 6, typed: "b" }],
    ["#k", { kind: "reference", start: 0, typed: "k" }],
    ["About #Move ho", { kind: "reference", start: 6, typed: "Move ho" }],
    ["Line\n#kitchen", { kind: "reference", start: 5, typed: "kitchen" }],
  ])("opens on %p", (typed, query) => {
    expect(at(typed)).toEqual(query as ReturnType<typeof at>);
  });

  test.each([
    ["no trigger", "Met Ali"],
    ["a # with nothing after it", "About #"],
    ["a heading", "# Kitchen"],
    ["a heading later in the Entry", "Notes\n# Kitchen"],
    ["an address", "ali@example"],
    ["a trigger inside a word", "C#m"],
    ["a space straight after the trigger", "@ ali"],
    ["a trigger on an earlier line", "@ali\nand then"],
    ["two spaces in a row", "@ali  and"],
    ["more than sixty characters", `@${"a".repeat(61)}`],
  ])("stays shut on %s", (_, typed) => {
    expect(at(typed)).toBeNull();
  });

  test("reads only up to the caret", () => {
    expect(linkQueryAt("Met @ali today", 8)).toEqual({ kind: "mention", start: 4, typed: "ali" });
  });
});

describe("a pick", () => {
  test("puts the name into the words with the @ kept, anchors the link to it, and leaves the caret after a space", () => {
    const words = "Met @al";
    const query = at(words);
    if (!query) throw new Error("No query");

    expect(pickLink(words, query, words.length, "Ali Khan")).toEqual({
      words: "Met @Ali Khan ",
      caret: 14,
      anchor: { start: 4, end: 13 },
    });
  });

  test("keeps what follows the caret, adding no space before a space or a mark", () => {
    for (const [after, words] of [
      [" today", "Met @Ali today"],
      [", then", "Met @Ali, then"],
    ] as const) {
      const typed = `Met @al${after}`;
      const query = linkQueryAt(typed, 7);
      if (!query) throw new Error("No query");

      expect(pickLink(typed, query, 7, "Ali")).toEqual({
        words,
        caret: 8,
        anchor: { start: 4, end: 8 },
      });
    }
  });

  test("of a Reference at the start of a line never makes a heading", () => {
    const words = "Notes\n#ki";
    const query = at(words);
    if (!query) throw new Error("No query");

    expect(pickLink(words, query, words.length, "  Kitchen").words).toBe("Notes\n#Kitchen ");
  });
});

describe("a pick followed through what is typed after it", () => {
  const anchor = { start: 4, end: 8 }; // "@Ali" in "Met @Ali today"
  const before = "Met @Ali today";

  test.each([
    ["typing after it", "Met @Ali today, again", anchor],
    ["typing straight after it", "Met @Alis today", anchor],
    ["typing before it", "I met @Ali today", { start: 6, end: 10 }],
    ["typing straight before it", "Met x@Ali today", { start: 5, end: 9 }],
    ["typing a mark straight before it", "Met @@Ali today", { start: 5, end: 9 }],
    ["deleting before it", "@Ali today", { start: 0, end: 4 }],
    ["changing text on both sides of it", "I met @Ali yesterday", { start: 6, end: 10 }],
  ])("keeps its span on %s", (_, after, followed) => {
    expect(followEdit(before, after, [anchor])[0]).toEqual(followed);
  });

  test.each([
    ["typing inside it", "Met @Alxi today"],
    ["deleting part of it", "Met @Al today"],
    ["deleting it", "Met  today"],
    ["replacing all the words", "Something else"],
  ])("is lost on %s", (_, after) => {
    expect(followEdit(before, after, [anchor])[0]).toBeNull();
  });
});
