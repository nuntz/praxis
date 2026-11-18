import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// The guards that hold rules of the spec are Biome config. These tests lint known-bad files laid
// out at the paths those rules cover, with the repo's own biome.json, so a config change that
// turns a guard off (a migration, a path that no longer matches) goes red here.

const repo = join(import.meta.dir, "..");

const fixtures: Record<string, string> = {
  // The domain package imports nothing from Cloudflare or Bun.
  "packages/domain/src/imports.ts": [
    'import { DurableObject } from "cloudflare:workers";',
    'import { $ } from "bun";',
    "export const used = [DurableObject, $];",
  ].join("\n"),
  // No domain or tool code reads the real clock.
  "packages/domain/src/clock.ts": "export const now = Date.now();",
  "apps/worker/src/tools/clock.ts": [
    "export const a = Date.now();",
    "export const b = new Date();",
    "export const c = new Date;",
    "export const d = Date();",
    "export const e = performance.now();",
  ].join("\n"),
  "apps/worker/src/index.ts": "export const now = Date.now();",
  // The Worker reads the clock in this one file, and an instant held as a number is no read.
  "apps/worker/src/arrival.ts": "export const now = Date.now();",
  "apps/worker/src/instant.ts": "export const iso = new Date(0).toISOString();",
  // A seam test reaches a Context only through the harness, so the oracle sees every call.
  "apps/worker/test/around-the-oracle.test.ts": [
    'import { runInDurableObject } from "cloudflare:test";',
    'import { env } from "cloudflare:workers";',
    "export const used = [runInDurableObject, env];",
  ].join("\n"),
  "apps/worker/test/nested/around-the-oracle.test.ts": 'export { env } from "cloudflare:workers";',
  // The harness itself, and the two tests of the Worker's HTTP path, the screen's and MCP's, may.
  "apps/worker/test/oracle.ts": 'export { runInDurableObject } from "cloudflare:test";',
  "apps/worker/test/endpoint.test.ts": 'export { exports } from "cloudflare:workers";',
  "apps/worker/test/mcp.test.ts": 'export { env } from "cloudflare:workers";',
  // A journey finds a control by its exact label, since every journey shares one Deployment.
  "e2e/inexact.spec.ts": [
    "declare const form: { getByLabel(label: string, options?: { exact: boolean }): unknown };",
    'export const loose = form.getByLabel("Name");',
    'export const exact = form.getByLabel("Name", { exact: true });',
  ].join("\n"),
  // An effect follows a signal or a memo, so it runs when the value changes, not on every read.
  "apps/pwa/src/on-computed.ts": [
    "declare function on<T>(deps: () => T, fn: (value: T) => void): unknown;",
    "declare const spend: () => { notice: string } | null;",
    "declare const props: { contexts: string[] };",
    "declare const currentId: () => string;",
    "export const computed = [",
    '  on(() => spend()?.notice === "cap_reached", () => {}),',
    "  on(() => !spend(), () => {}),",
    "  on(() => (spend() ? 1 : 0), () => {}),",
    "  on(() => spend() && props.contexts, () => {}),",
    "];",
    "export const followed = [on(currentId, () => {}), on(() => props.contexts, () => {})];",
  ].join("\n"),
  // The recommended rules are on.
  "apps/pwa/src/recommended.ts": "export function f(a: number) {\n  debugger;\n  return a;\n}",
};

type Diagnostic = { category: string; location: { path: string } };

let workspace: string;
let diagnostics: Diagnostic[];

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "praxis-lint-guards-"));
  cpSync(join(repo, "biome.json"), join(workspace, "biome.json"));
  cpSync(join(repo, "lint"), join(workspace, "lint"), { recursive: true });
  for (const [path, source] of Object.entries(fixtures)) {
    mkdirSync(dirname(join(workspace, path)), { recursive: true });
    writeFileSync(join(workspace, path), `${source}\n`);
  }
  const biome = Bun.spawnSync(
    [join(repo, "node_modules/.bin/biome"), "lint", "--vcs-enabled=false", "--reporter=json", "."],
    { cwd: workspace },
  );
  diagnostics = JSON.parse(biome.stdout.toString()).diagnostics;
});

afterAll(() => rmSync(workspace, { recursive: true, force: true }));

function rulesAt(path: string): string[] {
  return diagnostics.filter((d) => d.location.path === path).map((d) => d.category);
}

const restrictedImport = "lint/style/noRestrictedImports";
const clockRead = "plugin";
const inexactLabel = "plugin";
const computedOn = "plugin";

describe("the lint guards", () => {
  test("the domain package cannot import Cloudflare or Bun", () => {
    expect(rulesAt("packages/domain/src/imports.ts")).toEqual([restrictedImport, restrictedImport]);
  });

  test("domain code cannot read the real clock", () => {
    expect(rulesAt("packages/domain/src/clock.ts")).toEqual([clockRead]);
  });

  test("tool code cannot read the real clock, in any of its forms", () => {
    expect(rulesAt("apps/worker/src/tools/clock.ts")).toEqual(Array(5).fill(clockRead));
  });

  test("the Worker's entry cannot read it either", () => {
    expect(rulesAt("apps/worker/src/index.ts")).toEqual([clockRead]);
  });

  test("the Worker reads it only in arrival.ts, and an instant from a number is no read", () => {
    expect(rulesAt("apps/worker/src/arrival.ts")).toEqual([]);
    expect(rulesAt("apps/worker/src/instant.ts")).toEqual([]);
  });

  test("a seam test cannot reach a Context object or its tables except through the harness", () => {
    expect(rulesAt("apps/worker/test/around-the-oracle.test.ts")).toEqual([
      restrictedImport,
      restrictedImport,
    ]);
    expect(rulesAt("apps/worker/test/nested/around-the-oracle.test.ts")).toEqual([
      restrictedImport,
    ]);
  });

  test("the harness and the Worker's HTTP tests can", () => {
    expect(rulesAt("apps/worker/test/oracle.ts")).toEqual([]);
    expect(rulesAt("apps/worker/test/endpoint.test.ts")).toEqual([]);
    expect(rulesAt("apps/worker/test/mcp.test.ts")).toEqual([]);
  });

  test("a journey cannot find a control by a label it only contains", () => {
    expect(rulesAt("e2e/inexact.spec.ts")).toEqual([inexactLabel]);
  });

  test("an effect cannot follow a value computed in on(), only a signal or a memo", () => {
    expect(rulesAt("apps/pwa/src/on-computed.ts")).toEqual(Array(4).fill(computedOn));
  });

  test("the recommended rules are on", () => {
    expect(rulesAt("apps/pwa/src/recommended.ts")).toContain("lint/suspicious/noDebugger");
  });
});
