import { describe, expect, test } from "bun:test";
import { compareWords, foldUnchanged } from "../src/index.ts";

// Comparing the words now with the words a tap brings, as a Version and a Held Change do, is one
// of the few places with direct tests (section 13): any two texts can be compared, too many for
// scenarios at the tool seam.

describe("the words now compared with the words a tap brings", () => {
  test("words that are the same are one stretch kept", () => {
    expect(compareWords("Called the landlord", "Called the landlord")).toEqual([
      { kind: "kept", text: "Called the landlord" },
    ]);
  });

  test("a word changed is the old one gone and the new one come, between what is kept", () => {
    expect(compareWords("Called the landlord today", "Called the agent today")).toEqual([
      { kind: "kept", text: "Called the " },
      { kind: "gone", text: "landlord" },
      { kind: "come", text: "agent" },
      { kind: "kept", text: " today" },
    ]);
  });

  test("words added and taken away in several places are each told apart", () => {
    expect(compareWords("Met Ali at noon", "Met Ali and Bea at one")).toEqual([
      { kind: "kept", text: "Met Ali " },
      { kind: "come", text: "and Bea " },
      { kind: "kept", text: "at " },
      { kind: "gone", text: "noon" },
      { kind: "come", text: "one" },
    ]);
  });

  test("a mark beside a word is told apart from it", () => {
    expect(compareWords("Called the landlord", "Called the landlord, twice.")).toEqual([
      { kind: "kept", text: "Called the landlord" },
      { kind: "come", text: ", twice." },
    ]);
  });

  test("a line break is kept as typed", () => {
    expect(compareWords("Lease\n[] Sign it", "Lease\n[] Sign it\n[] Send it")).toEqual([
      { kind: "kept", text: "Lease\n[] Sign it" },
      { kind: "come", text: "\n[] Send it" },
    ]);
  });

  test.each([
    ["nothing", "Something"],
    ["Something", "Nothing at all"],
    ["  spaced  out\r\n", "spaced out"],
    ["🙃 café [] x", "café 🙃 x []"],
    ["a b a b a b", "b a b a"],
  ])(
    "the words now %p and the words brought %p are both read back from the comparison",
    (now, brought) => {
      const compared = compareWords(now, brought);

      const read = (kind: "gone" | "come") =>
        compared
          .filter((part) => part.kind === "kept" || part.kind === kind)
          .map((part) => part.text)
          .join("");
      expect(read("gone")).toBe(now);
      expect(read("come")).toBe(brought);
      expect(compared.every((part) => part.text !== "")).toBe(true);
    },
  );
});

describe("an unchanged stretch of the comparison", () => {
  const lines = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => `Line ${from + i}\n`).join("");

  test("longer than three lines between two changes folds, keeping the lines the changes are on", () => {
    const now = `Rent is 900\n${lines(1, 12)}Paid by card`;
    const brought = `Rent is 950\n${lines(1, 12)}Paid by cash`;

    expect(foldUnchanged(compareWords(now, brought))).toEqual([
      { kind: "kept", text: "Rent is " },
      { kind: "gone", text: "900" },
      { kind: "come", text: "950" },
      { kind: "kept", text: "\n" },
      { kind: "folded", text: lines(1, 12), lines: 12 },
      { kind: "kept", text: "Paid by " },
      { kind: "gone", text: "card" },
      { kind: "come", text: "cash" },
    ]);
  });

  test("of three lines or fewer stays shown", () => {
    const now = `Rent is 900\n${lines(1, 3)}Paid by card`;
    const brought = `Rent is 950\n${lines(1, 3)}Paid by cash`;

    expect(foldUnchanged(compareWords(now, brought)).map((part) => part.kind)).toEqual([
      "kept",
      "gone",
      "come",
      "kept",
      "gone",
      "come",
    ]);
  });

  test("at the start or the end of the words folds whole lines up to the change", () => {
    const now = `${lines(1, 5)}Rent is 900\n${lines(6, 10)}`;
    const brought = `${lines(1, 5)}Rent is 950\n${lines(6, 10)}`;

    expect(foldUnchanged(compareWords(now, brought))).toEqual([
      { kind: "folded", text: lines(1, 5), lines: 5 },
      { kind: "kept", text: "Rent is " },
      { kind: "gone", text: "900" },
      { kind: "come", text: "950" },
      { kind: "kept", text: "\n" },
      { kind: "folded", text: lines(6, 10), lines: 5 },
    ]);
  });

  test.each([
    ["One line", "One line changed"],
    [`${"Line\n".repeat(9)}end`, `${"Line\n".repeat(9)}end, then more`],
    [`a\n${"b\n".repeat(7)}c`, `x\n${"b\n".repeat(7)}c`],
  ])("folded, the words %p and %p are still both read back", (now, brought) => {
    const shown = foldUnchanged(compareWords(now, brought));

    const read = (kind: "gone" | "come") =>
      shown
        .filter((part) => part.kind !== (kind === "gone" ? "come" : "gone"))
        .map((part) => part.text)
        .join("");
    expect(read("gone")).toBe(now);
    expect(read("come")).toBe(brought);
    expect(shown.every((part) => part.text !== "")).toBe(true);
  });
});
