import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The guard of the upgrade ladders (section 11, ADR 0019): a released step is never edited,
// dropped or squashed, since every object anywhere must climb the same ladder. Each step is a file
// of its own in apps/worker/src/steps/, numbered, and `released.json` there keeps the hash of each
// as it was released. CI fails when a step's text no longer has its hash, when one is gone, when
// the numbers leave a gap, or when a step imports anything, which could change what it does
// without its text changing. A new step goes in with its hash in the same change: every push to
// master is a release (ADR 0026), so a step that passes CI is released.
//
// Since an edit can change a step and its hash together, the hashes are held to the last release's
// too: `released.json` as it stood at STEPS_RELEASED_AT, the commit before the push or the pull
// request's base in CI (.github/workflows/ci.yml), and origin/master here.

const root = join(import.meta.dir, "..");
const steps = "apps/worker/src/steps";

/** A step's file name: its ladder and its number. */
const STEP_FILE = /^(context|deployment)-(\d{4})\.ts$/;

/** The text's hash, as `released.json` keeps it. */
export function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** What is wrong with the steps, given each step file's text and the hashes released. */
export function stepProblems(
  files: Map<string, string>,
  released: Record<string, string>,
): string[] {
  const problems: string[] = [];
  for (const ladder of ["context", "deployment"]) {
    const numbers = [...files.keys()]
      .map((file) => STEP_FILE.exec(file))
      .filter((match) => match?.[1] === ladder)
      .map((match) => Number(match?.[2]))
      .toSorted((a, b) => a - b);
    numbers.forEach((number, place) => {
      if (number !== place + 1) problems.push(`The ${ladder} ladder has no step ${place + 1}`);
    });
  }
  for (const [file, text] of files) {
    const hash = released[file];
    if (hash === undefined) {
      problems.push(`${file} has no hash in released.json: add ${hashOf(text)}`);
    } else if (hash !== hashOf(text)) {
      problems.push(`${file} was released and has changed since: a fix is a new step`);
    }
    if (/^\s*import\s/m.test(text))
      problems.push(`${file} imports something: a step imports nothing`);
  }
  for (const file of Object.keys(released)) {
    if (!files.has(file)) problems.push(`${file} was released and is gone: no step is dropped`);
  }
  return problems;
}

/** What changed in `released.json` since the last release: a hash there may only be added to. */
export function releasedSince(
  before: Record<string, string>,
  now: Record<string, string>,
): string[] {
  return Object.entries(before).flatMap(([file, hash]) => {
    if (now[file] === undefined) return [`${file} was released and its hash is gone`];
    if (now[file] !== hash) return [`${file} was released with another hash: a fix is a new step`];
    return [];
  });
}

/**
 * `released.json` as the last release had it, or none when that release came before the ladder.
 * A commit named in CI must be there, since the guard would pass on nothing; here, a clone with
 * no origin/master has no release to hold to.
 */
function lastReleased(): Record<string, string> | undefined {
  const named = process.env.STEPS_RELEASED_AT;
  // A push that makes the branch names no commit before it.
  if (named !== undefined && /^0+$/.test(named)) return undefined;
  const at = named ?? "origin/master";
  const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root });
  if (git("rev-parse", "--verify", "--quiet", `${at}^{commit}`).exitCode !== 0) {
    if (named !== undefined)
      throw new Error(`STEPS_RELEASED_AT names ${at}, which was not fetched`);
    return undefined;
  }
  const path = `${at}:${steps}/released.json`;
  if (git("cat-file", "-e", path).exitCode !== 0) return undefined;
  return JSON.parse(git("show", path).stdout.toString());
}

/** Each step file in the repo, by name, with its text. */
function stepFiles(): Map<string, string> {
  return new Map(
    readdirSync(join(root, steps))
      .filter((file) => STEP_FILE.test(file))
      .map((file) => [file, readFileSync(join(root, steps, file), "utf8")]),
  );
}

function released(): Record<string, string> {
  return JSON.parse(readFileSync(join(root, steps, "released.json"), "utf8"));
}

describe("the upgrade ladders' guard", () => {
  test("every step is as it was released, none gone, none imports anything", () => {
    expect(stepProblems(stepFiles(), released())).toEqual([]);
  });

  test("every hash the last release had is still there, unchanged", () => {
    expect(releasedSince(lastReleased() ?? {}, released())).toEqual([]);
  });

  test("fails a released hash changed or gone, and lets a new one in", () => {
    const before = { "context-0001.ts": "a" };
    expect(releasedSince(before, { "context-0001.ts": "a", "context-0002.ts": "b" })).toEqual([]);
    expect(releasedSince(before, { "context-0001.ts": "b" })).toEqual([
      "context-0001.ts was released with another hash: a fix is a new step",
    ]);
    expect(releasedSince(before, {})).toEqual([
      "context-0001.ts was released and its hash is gone",
    ]);
  });

  test("each ladder runs its step files in order, and only them", async () => {
    // Loaded by path: the steps are typed for workerd, which this package's types are not.
    const ladders = await import(join(root, steps, "index.ts"));
    for (const [ladder, given] of [
      ["context", ladders.CONTEXT_LADDER],
      ["deployment", ladders.DEPLOYMENT_LADDER],
    ] as const) {
      const files = [...stepFiles().keys()].filter((file) => file.startsWith(`${ladder}-`)).sort();
      const loaded = await Promise.all(
        files.map(async (file) => (await import(join(root, steps, file))).default),
      );
      expect(given).toEqual(loaded);
    }
  });

  test("fails a released step edited, dropped or out of order, and a step that imports", () => {
    const step = "export default function contextStep1(sql: SqlStorage): void {}\n";
    const files = new Map([["context-0001.ts", step]]);
    const hashes = { "context-0001.ts": hashOf(step) };
    expect(stepProblems(files, hashes)).toEqual([]);

    expect(stepProblems(new Map([["context-0001.ts", `${step} `]]), hashes)).toEqual([
      "context-0001.ts was released and has changed since: a fix is a new step",
    ]);
    expect(stepProblems(new Map(), hashes)).toEqual([
      "context-0001.ts was released and is gone: no step is dropped",
    ]);
    expect(
      stepProblems(new Map([...files, ["context-0003.ts", step]]), {
        ...hashes,
        "context-0003.ts": hashOf(step),
      }),
    ).toEqual(["The context ladder has no step 2"]);
    const importing = `import { MEANING_MODEL } from "../meaning.ts";\n${step}`;
    expect(
      stepProblems(new Map([["deployment-0001.ts", importing]]), {
        "deployment-0001.ts": hashOf(importing),
      }),
    ).toEqual(["deployment-0001.ts imports something: a step imports nothing"]);
    expect(stepProblems(new Map([["deployment-0001.ts", step]]), {})).toEqual([
      `deployment-0001.ts has no hash in released.json: add ${hashOf(step)}`,
    ]);
  });
});
