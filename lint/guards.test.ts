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

  test("the recommended rules are on", () => {
    expect(rulesAt("apps/pwa/src/recommended.ts")).toContain("lint/suspicious/noDebugger");
  });
});
