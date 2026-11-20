import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

/**
 * What a run of the journeys left failed, read from its output folder (a local `test-results/<run>`
 * or a CI run's `playwright-traces` artifact): each failure grouped by journey and first error, with
 * the repeats it failed on, and on asking, the slow actions of one failure's trace
 * (docs/flaky-journeys.md).
 */

/** One failed journey, as its folder and its `error-context.md` tell it. */
export interface Failure {
  /** Where the journey is, `e2e/<file>.spec.ts:<line>:<column>`. */
  location: string;
  name: string;
  project: string;
  repeat: number;
  /** The first line of the error, its milliseconds kept. */
  error: string;
}

/** A failure from its folder's name and the `error-context.md` Playwright wrote in it. */
export function failureOf(folder: string, errorContext: string): Failure {
  const named = /-(desktop|phone|setup)(?:-repeat(\d+))?$/.exec(folder);
  const field = (label: string) =>
    new RegExp(`^- ${label}: (.*)$`, "m").exec(errorContext)?.[1]?.trim() ?? "?";
  const details = errorContext.split("# Error details")[1] ?? "";
  const error =
    details
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "" && !line.startsWith("```")) ?? "?";
  return {
    location: field("Location"),
    name: field("Name"),
    project: named?.[1] ?? "?",
    repeat: Number(named?.[2] ?? 0),
    error,
  };
}

/** Failures grouped by journey and first error, the largest group first. */
export function grouped(failures: Failure[]): { key: string; repeats: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const failure of failures) {
    const key = `${failure.location}  ${failure.error}`;
    const repeats = groups.get(key) ?? [];
    repeats.push(`${failure.project}:${failure.repeat}`);
    groups.set(key, repeats);
  }
  return [...groups]
    .map(([key, repeats]) => ({ key, repeats: repeats.sort() }))
    .sort((a, b) => b.repeats.length - a.repeats.length);
}

/** One action of a trace: when it started after the first, and how long it took, if it ended. */
export interface Step {
  at: number;
  took: number | null;
  title: string;
  target: string;
}

/**
 * The actions of a trace (its `*.trace` files' lines) that took at least `least` milliseconds or
 * never ended, in the order they started.
 */
export function slowSteps(traceLines: string[], least: number): Step[] {
  type Event = {
    type?: string;
    class?: string;
    callId?: string;
    startTime?: number;
    endTime?: number;
    title?: string;
    method?: string;
    params?: { selector?: string; url?: string };
  };
  const events = traceLines.flatMap((line): Event[] => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const ends = new Map(
    events.filter((e) => e.type === "after").map((e) => [e.callId, e.endTime ?? 0]),
  );
  // The runner's own record of an action or expect repeats the browser's, which names its target.
  const repeated = (e: Event) =>
    e.class === "Test" && (e.method === "pw:api" || e.method === "expect");
  const starts = events.filter(
    (e) => e.type === "before" && e.startTime !== undefined && !repeated(e),
  );
  const first = Math.min(...starts.map((e) => e.startTime ?? 0));
  return starts
    .map((e) => {
      const end = ends.get(e.callId);
      const start = e.startTime ?? 0;
      return {
        at: start - first,
        took: end === undefined ? null : end - start,
        title: e.title ?? e.method ?? "?",
        target: e.params?.selector ?? e.params?.url ?? "",
      };
    })
    .filter((step) => step.took === null || step.took >= least)
    .sort((a, b) => a.at - b.at);
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function printFailures(dir: string) {
  const failures = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "error-context.md")))
    .map((entry) =>
      failureOf(entry.name, readFileSync(join(dir, entry.name, "error-context.md"), "utf8")),
    );
  console.log(`${failures.length} failed in ${dir}`);
  for (const { key, repeats } of grouped(failures)) {
    console.log(`\n${String(repeats.length).padStart(4)}  ${key}\n      ${repeats.join(" ")}`);
  }
}

function unzip(...args: string[]): string {
  const out = spawnSync("unzip", args, { encoding: "utf8", maxBuffer: 1 << 30 });
  if (out.status !== 0) throw new Error(`unzip ${args.join(" ")} failed: ${out.stderr}`);
  return out.stdout;
}

function printSteps(folder: string, least: number) {
  const zip = join(folder, "trace.zip");
  // Each file is read on its own: one does not end on a newline, so the next would join its line.
  const lines = unzip("-Z1", zip)
    .split("\n")
    .filter((name) => name.endsWith(".trace"))
    .flatMap((name) => unzip("-p", zip, name).split("\n"));
  for (const step of slowSteps(lines, least)) {
    const took = step.took === null ? "never" : seconds(step.took);
    console.log(
      `${seconds(step.at).padStart(7)} ${took.padStart(7)}  ${step.title.slice(0, 40).padEnd(40)} ${step.target.slice(0, 100)}`,
    );
  }
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { steps: { type: "boolean" }, least: { type: "string", default: "800" } },
  });
  const [path] = positionals;
  if (!path) {
    console.error(
      "bun scripts/journey-failures.ts <run folder>\nbun scripts/journey-failures.ts --steps [--least <ms>] <failure folder>",
    );
    process.exit(2);
  }
  if (values.steps) printSteps(path, Number(values.least));
  else printFailures(path);
}
