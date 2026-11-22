import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FORMAT_STEPS } from "../packages/domain/src/format-steps/index.ts";
import {
  hashOf,
  hashProblems,
  type Instead,
  lastReleased,
  released,
  releasedSince,
  root,
} from "./released.ts";

// The guard of the Export format's ladder (section 11, ADR 0018): a restore reads a file of any
// format back to format 1, for good, so a released step is never edited, dropped or squashed, as
// lint/steps.test.ts holds the tables' ladders. Each step is a file of its own in
// packages/domain/src/format-steps/, numbered by the format it reaches, and `released.json` there
// keeps the hash of each as it was released. CI fails when a step's text no longer has its hash,
// when one is gone, when the numbers leave a gap, or when a step imports anything.

const steps = "packages/domain/src/format-steps";

const INSTEAD: Instead = {
  edited: "a fix is a new format, with a step of its own",
  dropped: "no step is dropped",
};

/** A step's file name: the format it reaches. */
const STEP_FILE = /^format-(\d{4})\.ts$/;

/** What is wrong with the steps, given each step file's text and the hashes released. */
export function formatStepProblems(
  files: Map<string, string>,
  released: Record<string, string>,
): string[] {
  const problems: string[] = [];
  const numbers = [...files.keys()]
    .map((file) => Number(STEP_FILE.exec(file)?.[1]))
    .toSorted((a, b) => a - b);
  // Format 1 has no step: the first reaches format 2.
  numbers.forEach((number, place) => {
    if (number !== place + 2) problems.push(`The format ladder has no step to format ${place + 2}`);
  });
  problems.push(...hashProblems(files, released, INSTEAD));
  for (const [file, text] of files) {
    if (/^\s*import\s/m.test(text))
      problems.push(`${file} imports something: a step imports nothing`);
  }
  return problems;
}

/** Each step file in the repo, by name, with its text. */
function stepFiles(): Map<string, string> {
  return new Map(
    readdirSync(join(root, steps))
      .filter((file) => STEP_FILE.test(file))
      .map((file) => [file, readFileSync(join(root, steps, file), "utf8")]),
  );
}

describe("the Export format ladder's guard", () => {
  test("every step is as it was released, none gone, none imports anything", () => {
    expect(formatStepProblems(stepFiles(), released(steps))).toEqual([]);
  });

  test("every hash the last release had is still there, unchanged", () => {
    expect(releasedSince(lastReleased(steps) ?? {}, released(steps), INSTEAD)).toEqual([]);
  });

  test("the ladder runs its step files in order, and only them", async () => {
    const files = [...stepFiles().keys()].sort();
    const loaded = await Promise.all(
      files.map(async (file) => (await import(join(root, steps, file))).default),
    );
    expect(FORMAT_STEPS).toEqual(loaded);
  });

  test("fails a released step edited, dropped or out of order, and a step that imports", () => {
    const step = "export default function formatStep2(file) { return file; }\n";
    const files = new Map([["format-0002.ts", step]]);
    const hashes = { "format-0002.ts": hashOf(step) };
    expect(formatStepProblems(files, hashes)).toEqual([]);

    expect(formatStepProblems(new Map([["format-0002.ts", `${step} `]]), hashes)).toEqual([
      "format-0002.ts was released and has changed since: a fix is a new format, with a step of its own",
    ]);
    expect(formatStepProblems(new Map(), hashes)).toEqual([
      "format-0002.ts was released and is gone: no step is dropped",
    ]);
    expect(
      formatStepProblems(new Map([...files, ["format-0004.ts", step]]), {
        ...hashes,
        "format-0004.ts": hashOf(step),
      }),
    ).toEqual(["The format ladder has no step to format 3"]);
    const importing = `import { z } from "zod";\n${step}`;
    expect(
      formatStepProblems(new Map([["format-0002.ts", importing]]), {
        "format-0002.ts": hashOf(importing),
      }),
    ).toEqual(["format-0002.ts imports something: a step imports nothing"]);
    expect(formatStepProblems(files, {})).toEqual([
      `format-0002.ts has no hash in released.json: add ${hashOf(step)}`,
    ]);
  });
});
