import { describe, expect, test } from "bun:test";
import { compareWords } from "../src/index.ts";

// Comparing a Version against the current words is one of the few places with direct tests
// (section 13): any two texts can be compared, too many for scenarios at the tool seam.

describe("a Version compared against the current words", () => {
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
    "the Version %p and the words %p are both read back from the comparison",
    (version, current) => {
      const compared = compareWords(version, current);

      const read = (kind: "gone" | "come") =>
        compared
          .filter((part) => part.kind === "kept" || part.kind === kind)
          .map((part) => part.text)
          .join("");
      expect(read("gone")).toBe(version);
      expect(read("come")).toBe(current);
      expect(compared.every((part) => part.text !== "")).toBe(true);
    },
  );
});
