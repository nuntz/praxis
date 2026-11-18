import { describe, expect, test } from "bun:test";
import { placeholdersIn, ticketsClosing } from "./tickets.ts";

// What counts as a placeholder naming a ticket. Whether the ticket is closed is asked of GitHub,
// in CI, by `bun run check:tickets`, or taken from `--closing` before a ticket is closed.

describe("the ticket placeholders", () => {
  test("are tickets named in line, block and JSX comments", () => {
    const source = [
      "// What the count is made of comes with Attention itself (#49).",
      "const count = () => 0; // until #51",
      "/**",
      " * Stands in for the screen until #12 and #13.",
      " */",
      "{/* shown once #7 lands */}",
    ].join("\n");

    expect(placeholdersIn("f.ts", source).map(({ line, ticket }) => [line, ticket])).toEqual([
      [1, 49],
      [2, 51],
      [4, 12],
      [4, 13],
      [6, 7],
    ]);
  });

  test("are not a hash in code, a colour or an address", () => {
    const source = [
      'const ink = "#1A1D23"; const red = "#000000";',
      "fetch(`https://example.test/issues/#12`);",
      "// a colour such as #FFF0CC, or an anchor like page#3",
    ].join("\n");

    expect(placeholdersIn("f.ts", source)).toEqual([]);
  });
});

describe("the tickets about to be closed", () => {
  test("are each one given after --closing, counted closed whatever GitHub says", () => {
    expect(ticketsClosing(["--closing", "52"])).toEqual([52]);
    expect(ticketsClosing(["--closing", "52", "--closing", "62"])).toEqual([52, 62]);
    expect(ticketsClosing([])).toEqual([]);
  });

  test("are refused when not a ticket's number", () => {
    expect(() => ticketsClosing(["--closing"])).toThrow(/--closing takes a ticket's number/);
    expect(() => ticketsClosing(["--closing", "#52"])).toThrow(/--closing takes/);
    expect(() => ticketsClosing(["--clsoing", "52"])).toThrow(/--clsoing/);
  });
});
