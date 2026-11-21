import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Behaviour is tested at the tool seam, and SPEC section 13 names the few things that have direct
// tests besides; ADR 0015 names the domain package's again. This holds every direct test file to
// a row here giving the words section 13 names it by, and those words to being in each place
// that names them, so a new direct test changes the spec and the ADR with it.

const repo = join(import.meta.dir, "..");

/** Where a directory's direct tests are named: a file, and how the line naming them starts. */
type NamedAt = { file: string; line: string };

const SPEC = "SPEC.md";
const ADR =
  "docs/adr/0015-behaviour-is-tested-at-the-tool-seam-and-one-oracle-checks-every-writes-effects.md";

/** Each directory of direct tests: where they are named, and each file by the words naming it. */
const directTests: Record<string, { namedAt: NamedAt[]; files: Record<string, string> }> = {
  "packages/domain/test": {
    namedAt: [
      { file: SPEC, line: "- `bun test` for the pure domain package." },
      { file: ADR, line: "- The pure domain package keeps direct tests only" },
    ],
    files: {
      "task-state.test.ts": "a Task's derived state and its reason",
      "recurrence.test.ts": "Recurrence dates",
      "tools.test.ts": "the shapes an Entry's words can take on the way in",
      "inline-task.test.ts": "parsing an Inline Task",
      "typed-link.test.ts": "what the person types to link something",
      "follow-edit.test.ts": "following an anchor through a change to the words",
      "compare-words.test.ts": "comparing a Version against the current words",
      "markdown.test.ts": "what the Markdown renderer lets through",
    },
  },
  "apps/pwa/test": {
    namedAt: [{ file: SPEC, line: "- `bun test` for the PWA" }],
    files: {
      "tokens.test.ts": "every text pairing the design system names is at least 4.5:1",
      "live.test.ts": "the screen's end of the live channel",
    },
  },
};

/** What is unnamed: a test with no row, a row for no test, or words missing from a line. */
function unnamed(
  directory: string,
  tests: string[],
  rows: Record<string, string>,
  lines: { at: NamedAt; text: string | undefined }[],
): string[] {
  const table = "lint/direct-tests.test.ts";
  return [
    ...tests
      .filter((file) => !(file in rows))
      .map(
        (file) =>
          `${directory}/${file} is a direct test no row names: test it at the tool seam, or add a row to ${table} and its words to SPEC section 13 and ADR 0015`,
      ),
    ...Object.keys(rows)
      .filter((file) => !tests.includes(file))
      .map((file) => `${directory}/${file} is a row in ${table} for no test: remove it`),
    ...lines.flatMap(({ at, text }) => {
      if (text === undefined) return [`${at.file} has no line starting "${at.line}"`];
      return Object.entries(rows)
        .filter(([, words]) => !text.includes(words))
        .map(([file, words]) => `${at.file} does not name ${file}: "${words}"`);
    }),
  ];
}

function lineOf(at: NamedAt): string | undefined {
  return readFileSync(join(repo, at.file), "utf8")
    .split("\n")
    .find((line) => line.startsWith(at.line));
}

describe("the direct-test guard", () => {
  for (const [directory, { namedAt, files }] of Object.entries(directTests)) {
    test(`every direct test in ${directory} is named by SPEC section 13 and each place naming it`, () => {
      const tests = readdirSync(join(repo, directory)).filter((file) => file.endsWith(".test.ts"));
      const lines = namedAt.map((at) => ({ at, text: lineOf(at) }));

      expect(unnamed(directory, tests, files, lines)).toEqual([]);
    });
  }

  test("fails a test with no row, a row for no test, and words a line leaves out", () => {
    const spec = { file: "SPEC.md", line: "- Direct tests" };
    const adr = { file: "ADR.md", line: "- Also" };

    expect(
      unnamed(
        "test",
        ["kept.test.ts", "new.test.ts"],
        { "kept.test.ts": "kept words", "gone.test.ts": "gone words" },
        [
          { at: spec, text: "- Direct tests: kept words, gone words" },
          { at: adr, text: "- Also: gone words" },
          { at: { file: "OTHER.md", line: "- Missing" }, text: undefined },
        ],
      ),
    ).toEqual([
      expect.stringMatching(/^test\/new\.test\.ts is a direct test no row names: /),
      expect.stringMatching(/^test\/gone\.test\.ts is a row .* for no test/),
      'ADR.md does not name kept.test.ts: "kept words"',
      'OTHER.md has no line starting "- Missing"',
    ]);
  });
});
