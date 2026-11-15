import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { offering } from "../apps/worker/test/offering.ts";
import { toolNames } from "../packages/domain/src/index.ts";

// The guard of ADR 0015, in place of a line-coverage threshold: CI fails when a tool in the
// registry has no row in the offering table or no seam test naming it.

const seamTests = join(import.meta.dir, "../apps/worker/test");

const table = "apps/worker/test/offering.ts";

/** What is unguarded: a tool with no row or no seam test, or a row for no tool. */
function unguarded(tools: string[], rows: string[], testSources: string[]): string[] {
  const named = (tool: string) =>
    testSources.some((source) => new RegExp(`describe\\(\\s*["'\`]${tool}\\b`).test(source));
  return [
    ...tools
      .filter((tool) => !rows.includes(tool))
      .map((tool) => `${tool} has no row: add one to the offering table in ${table}`),
    ...tools
      .filter((tool) => !named(tool))
      .map(
        (tool) =>
          `${tool} has no seam test: name a describe block after it, describe("${tool}", …), in a *.test.ts under apps/worker/test`,
      ),
    ...rows
      .filter((row) => !tools.includes(row))
      .map((row) => `${row} is a row for no tool: remove it from ${table}`),
  ];
}

function readSeamTests(): string[] {
  return readdirSync(seamTests)
    .filter((file) => file.endsWith(".test.ts"))
    .map((file) => readFileSync(join(seamTests, file), "utf8"));
}

describe("the registry guard", () => {
  test("every tool has a row in the offering table and a seam test naming it", () => {
    expect(unguarded(toolNames, Object.keys(offering), readSeamTests())).toEqual([]);
  });

  test("fails a tool with no row, a tool with no seam test, and a row for no tool", () => {
    const sources = ['describe("get_entry", () => {});', 'describe("list_entries\'s cursor"'];

    expect(
      unguarded(["get_entry", "list_entries", "edit_entry"], ["get_entry", "gone"], sources),
    ).toEqual([
      expect.stringMatching(/^list_entries has no row: .*offering\.ts$/),
      expect.stringMatching(/^edit_entry has no row: /),
      expect.stringMatching(/^edit_entry has no seam test: .*describe\("edit_entry", …\)/),
      expect.stringMatching(/^gone is a row for no tool: remove it/),
    ]);
  });

  test("a tool named only in passing is not a seam test naming it", () => {
    const sources = ['test("calls get_entry", () => {});', 'describe("get_entry_versions")'];

    expect(unguarded(["get_entry"], ["get_entry"], sources)).toEqual([
      expect.stringMatching(/^get_entry has no seam test: /),
    ]);
  });
});
