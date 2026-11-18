import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deploymentOffering,
  deploymentRunsWith,
  offering,
  runsWith,
} from "../apps/worker/test/offering.ts";
import { type RegistryName, registries } from "../packages/domain/src/index.ts";

// The guard of ADR 0015, in place of a line-coverage threshold: CI fails when a tool in the
// registry has no row in the offering table, no input the offering test runs it with, or no seam
// test naming it. The Deployment tools have a table of their own, held to the same guard. The
// Conversation tools are rows of the Context tools' table, like any other tool (section 4.12).
// Every registry the domain package lists is guarded, and one with no table here fails the
// typecheck.

/**
 * The offering table each registry's tools are held to, kept by hand, and the inputs the offering
 * test runs each with.
 */
const tables = {
  context: { rows: offering, inputs: { name: "runsWith", of: runsWith } },
  conversation: { rows: offering, inputs: { name: "runsWith", of: runsWith } },
  deployment: {
    rows: deploymentOffering,
    inputs: { name: "deploymentRunsWith", of: deploymentRunsWith },
  },
} satisfies Record<RegistryName, { rows: object; inputs: { name: string; of: object } }>;

/** Each table, with every tool of the registries held to it. */
const guarded = [...new Set(Object.values(tables).map(({ rows }) => rows))].map((rows) => {
  const names = (Object.keys(tables) as RegistryName[]).filter(
    (name) => tables[name].rows === rows,
  );
  return {
    rows: Object.keys(rows),
    tools: names.flatMap((name) => Object.keys(registries[name])),
    inputs: (({ name, of }) => ({ name, tools: Object.keys(of) }))(
      tables[names[0] as RegistryName].inputs,
    ),
  };
});

const seamTests = join(import.meta.dir, "../apps/worker/test");

const table = "apps/worker/test/offering.ts";

/** Whether a seam test names the tool in a describe block of its own. */
function named(tool: string, testSources: string[]): boolean {
  return testSources.some((source) => new RegExp(`describe\\(\\s*["'\`]${tool}\\b`).test(source));
}

/**
 * What is unguarded: a tool with no row, no input to run it with or no seam test, or a row for no
 * tool. Inputs are checked only when given.
 */
function unguarded(
  tools: string[],
  rows: string[],
  testSources: string[],
  inputs?: { name: string; tools: string[] },
): string[] {
  return [
    ...tools
      .filter((tool) => !rows.includes(tool))
      .map((tool) => `${tool} has no row: add one to the offering table in ${table}`),
    ...tools
      .filter((tool) => inputs !== undefined && !inputs.tools.includes(tool))
      .map((tool) => `${tool} has no input it runs with: add one to ${inputs?.name} in ${table}`),
    ...tools
      .filter((tool) => !named(tool, testSources))
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
  test("every tool, in every registry, has a row in its offering table, an input it runs with and a seam test naming it", () => {
    const sources = readSeamTests();
    expect(
      guarded.flatMap(({ tools, rows, inputs }) => unguarded(tools, rows, sources, inputs)),
    ).toEqual([]);
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

  test("fails a tool with no input the offering test runs it with", () => {
    const sources = ['describe("get_entry", () => {});', 'describe("list_entries", () => {});'];

    expect(
      unguarded(["get_entry", "list_entries"], ["get_entry", "list_entries"], sources, {
        name: "runsWith",
        tools: ["get_entry"],
      }),
    ).toEqual([
      expect.stringMatching(/^list_entries has no input it runs with: add one to runsWith in /),
    ]);
  });

  test("a tool named only in passing is not a seam test naming it", () => {
    const sources = ['test("calls get_entry", () => {});', 'describe("get_entry_versions")'];

    expect(unguarded(["get_entry"], ["get_entry"], sources)).toEqual([
      expect.stringMatching(/^get_entry has no seam test: /),
    ]);
  });
});
