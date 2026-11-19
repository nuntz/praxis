import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The guard of the Export's documented format (section 10.1, ADR 0018): every field a file of an
// Export can hold, as the types in packages/domain/src/export.ts give it, is named in
// docs/export-format.md, so a field added to the format is documented in the same change. It
// checks names only: what the doc says of each is for review.

const root = join(import.meta.dir, "..");
const types = "packages/domain/src/export.ts";
const doc = "docs/export-format.md";

/** What `make_export` returns around the files, which is no part of a file. */
const AROUND_THE_FILES = ["Export", "ExportFile"];

/** Each type declared in a source, by name, with its body and no comments. */
function typesIn(source: string): Map<string, string> {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const declared = new Map<string, string>();
  const starts = [...code.matchAll(/^(?:export )?type (\w+)\b[^=]*=/gm)];
  for (const start of starts) {
    // A body runs to the next line that starts at the left margin.
    const from = (start.index ?? 0) + start[0].length;
    const next = code.slice(from).search(/^\S/m);
    declared.set(start[1] ?? "", code.slice(from, next === -1 ? undefined : from + next));
  }
  return declared;
}

/** Each field of a file's types that the doc does not name in backticks, as `Type.field`. */
function undocumented(source: string, documented: string): string[] {
  return [...typesIn(source)]
    .filter(([name]) => !AROUND_THE_FILES.includes(name))
    .flatMap(([name, body]) =>
      [...new Set([...body.matchAll(/\b([a-z_]+)\??:/g)].map((match) => match[1] ?? ""))]
        .filter((field) => !documented.includes(`\`${field}\``))
        .map((field) => `${name}.${field}`),
    );
}

describe("the Export format guard", () => {
  test(`every field of a file in ${types} is named in ${doc}`, () => {
    const source = readFileSync(join(root, types), "utf8");
    const documented = readFileSync(join(root, doc), "utf8");
    expect(
      undocumented(source, documented),
      `Name each field in ${doc}, in backticks, where it says what the field holds`,
    ).toEqual([]);
  });

  test("names a field the doc leaves out, in a type of its own or inline, and passes over comments and what is around the files", () => {
    const source = `
/** A comment with words: that look like fields. */
export type ContextFile = {
  kind: "context";
  // shown: no field
  entries: { id: string; colour: string }[];
};
type Stamped = { format: string };
export type ExportFile = { path: string; content: ContextFile };
export type Export = { files: ExportFile[] };
`;
    const documented = "`kind`, `entries`, `id` and `format`";

    expect(undocumented(source, documented)).toEqual(["ContextFile.colour"]);
  });
});
