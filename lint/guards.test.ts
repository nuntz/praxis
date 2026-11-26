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
  // A time on the screen is shown in the zone it names, the Context's or the Device's.
  "apps/pwa/src/zones.ts": [
    "declare const zone: string;",
    "declare const at: Date;",
    "export const unnamed = [",
    '  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }),',
    "  new Intl.DateTimeFormat(undefined),",
    "  new Intl.DateTimeFormat(),",
    '  at.toLocaleDateString(undefined, { month: "short" }),',
    "  at.toLocaleTimeString(),",
    "];",
    "export const named = [",
    '  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: zone }),',
    "  new Intl.DateTimeFormat(undefined, {",
    '    timeStyle: "short",',
    "    timeZone: zone,",
    "  }),",
    "  at.toLocaleTimeString(undefined, { timeZone: zone }),",
    "  (3).toLocaleString(),",
    "];",
  ].join("\n"),
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
  // A field is set from an effect while it is left alone, never bound to its record's value,
  // which writes the record over what is typed each time it is read again.
  "apps/pwa/src/bound.tsx": [
    "declare const props: { name: string; task: Record<string, string | null> };",
    "declare const at: string;",
    "declare function Field(field: { value: string }): unknown;",
    "declare function shown(name: string): string;",
    "export const bound = [",
    '  <input type="text" value={props.name} />,',
    "  <textarea value={props.name} />,",
    '  <input type="date" value={props.task[at] ?? ""} />,',
    "];",
    "export const unbound = [",
    "  <Field value={props.name} />,",
    "  <select value={props.name} />,",
    "  <input readOnly value={shown(props.name)} />,",
    "];",
  ].join("\n"),
  // The Worker makes or names an object only in routing.ts, in the Deployment's jurisdiction.
  "apps/worker/src/made-elsewhere.ts": [
    "declare const env: Env;",
    "export const made = env.CONTEXT.newUniqueId();",
    'export const named = env.DEPLOYMENT.idFromName("deployment");',
    'export const found = env.CONTEXT.idFromString("0123");',
  ].join("\n"),
  "apps/worker/src/routing.ts": [
    "declare const env: Env;",
    'export const named = env.DEPLOYMENT.idFromName("deployment");',
  ].join("\n"),
  // A day's first instant is dayStart(), which alone may ask for its midnight: summer time can
  // skip midnight, so the instant asked for falls on the day before.
  "apps/worker/src/day-bounds.ts": [
    "declare function instantAt(day: string, time: string, zone: string): number;",
    'export const from = instantAt("2026-09-06", "00:00", "America/Santiago");',
    'export const brief = instantAt("2026-09-06", "07:00", "America/Santiago");',
  ].join("\n"),
  "packages/domain/src/day-start.ts": [
    "declare function instantAt(day: string, time: string, zone: string): number;",
    "export function dayStart(day: string, zone: string): number {",
    '  return instantAt(day, "00:00", zone);',
    "}",
    'export const elsewhere = instantAt("2026-09-06", "00:00", "UTC");',
  ].join("\n"),
  // A control is kept in view outside a column's scrolling body, never pinned over it: what
  // scrolls under it fails the accessibility check's target size.
  "apps/pwa/src/pinned.css": [
    ".a { position: sticky; top: 0; }",
    ".b { position: fixed; }",
    ".c { position: relative; }",
  ].join("\n"),
  // A test asserts what a call gives back: one that only did not throw may have skipped its input.
  "packages/domain/test/unthrown.test.ts": [
    'import { expect } from "bun:test";',
    "declare function render(words: string): string[];",
    'expect(() => render("> deep")).not.toThrow();',
    'expect(() => render("> deep")).not.toThrow(RangeError);',
    'expect(() => render("")).toThrow("no words");',
    'expect(render("> deep")).toContain("deep");',
  ].join("\n"),
  // A journey reads a value off the page or fails as missing, with no stand-in for it.
  "e2e/stood-in.spec.ts": [
    "declare const time: { getAttribute(name: string): Promise<string | null> };",
    "declare const box: { textContent(): Promise<string | null>; boundingBox(): Promise<{ x: number } | null> };",
    'export const at = (await time.getAttribute("datetime")) ?? "";',
    'export const words = (await box.textContent()) || "";',
    "export const x = ((await box.boundingBox()) ?? { x: 0 }).x;",
    'export const read = await time.getAttribute("datetime");',
    'export const label = read ?? "unread";',
  ].join("\n"),
  "e2e/unthrown.spec.ts": [
    'import { expect } from "@playwright/test";',
    "export const shown = expect(Promise.resolve()).resolves.not.toThrow();",
  ].join("\n"),
  // What the screen stores for a later load goes through stored.ts alone.
  "apps/pwa/src/stores-elsewhere.ts": [
    'export const kept = localStorage.getItem("praxis.other");',
    'export const opened = indexedDB.open("praxis");',
  ].join("\n"),
  "apps/pwa/src/stored.ts": 'export const kept = localStorage.getItem("praxis.unsent");',
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
const restrictedGlobal = "lint/style/noRestrictedGlobals";
const clockRead = "plugin";
const inexactLabel = "plugin";
const computedOn = "plugin";
const zoneUnnamed = "plugin";
const outsideJurisdiction = "plugin";
const midnightAsked = "plugin";
const pinned = "plugin";
const unthrown = "plugin";
const stoodIn = "plugin";
const boundField = "plugin";

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

  test("a time on the screen cannot be shown without naming its zone", () => {
    expect(rulesAt("apps/pwa/src/zones.ts")).toEqual(Array(5).fill(zoneUnnamed));
  });

  test("a field on the screen cannot be bound to its record's value, only a component's", () => {
    expect(rulesAt("apps/pwa/src/bound.tsx")).toEqual(Array(3).fill(boundField));
  });

  test("the Worker makes or names an object only in routing.ts, which finds it in the jurisdiction", () => {
    expect(rulesAt("apps/worker/src/made-elsewhere.ts")).toEqual([
      outsideJurisdiction,
      outsideJurisdiction,
    ]);
    expect(rulesAt("apps/worker/src/routing.ts")).toEqual([]);
  });

  test("a day's first instant comes from dayStart(), never from asking for its midnight", () => {
    expect(rulesAt("apps/worker/src/day-bounds.ts")).toEqual([midnightAsked]);
    expect(rulesAt("packages/domain/src/day-start.ts")).toEqual([midnightAsked]);
  });

  test("the screen pins no control over what scrolls", () => {
    expect(rulesAt("apps/pwa/src/pinned.css")).toEqual([pinned, pinned]);
  });

  test("a journey cannot stand a value in for one it could not read off the page", () => {
    expect(rulesAt("e2e/stood-in.spec.ts")).toEqual([stoodIn, stoodIn, stoodIn]);
  });

  test("a test cannot rest on a call not throwing, in a seam or domain test or a journey", () => {
    expect(rulesAt("packages/domain/test/unthrown.test.ts")).toEqual([unthrown, unthrown]);
    expect(rulesAt("e2e/unthrown.spec.ts")).toEqual([unthrown]);
  });

  test("the screen touches the browser's storage only in stored.ts", () => {
    expect(rulesAt("apps/pwa/src/stores-elsewhere.ts")).toEqual([
      restrictedGlobal,
      restrictedGlobal,
    ]);
    expect(rulesAt("apps/pwa/src/stored.ts")).toEqual([]);
  });

  test("the recommended rules are on", () => {
    expect(rulesAt("apps/pwa/src/recommended.ts")).toContain("lint/suspicious/noDebugger");
  });
});
