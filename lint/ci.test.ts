import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// `bun run ci` and the GitHub workflow each list the checks CI runs, one for a local run and one
// for a push. This holds the two to the same checks, so a check added to one runs in both.

const repo = join(import.meta.dir, "..");

/** What the workflow runs to set up, which a local run already has. */
const SETUP = [/^bun install\b/, /^bunx playwright install\b/];

/** A check by what it runs: a script's name, or a tool's, whatever its flags. */
function checkOf(command: string): string {
  const script = /^bun run (\S+)/.exec(command);
  if (script?.[1]) return script[1];
  return command.replace(/^bunx /, "").split(/\s+/)[0] ?? command;
}

/** The checks the `ci` script runs, in order. */
function localChecks(packageJson: string): string[] {
  const ci: string = JSON.parse(packageJson).scripts.ci;
  return ci.split("&&").map((command) => checkOf(command.trim()));
}

/** The checks the workflow's steps run, in order, leaving out its setup. */
function workflowChecks(workflow: string): string[] {
  return [...workflow.matchAll(/^\s*(?:- )?run: (.+)$/gm)]
    .map((match) => (match[1] ?? "").trim())
    .filter((command) => !SETUP.some((setup) => setup.test(command)))
    .map(checkOf);
}

/** What one runs and the other does not. */
function drift(local: string[], workflow: string[]): string[] {
  return [
    ...local
      .filter((check) => !workflow.includes(check))
      .map((check) => `${check} runs in bun run ci but in no step of .github/workflows/ci.yml`),
    ...workflow
      .filter((check) => !local.includes(check))
      .map((check) => `${check} runs in .github/workflows/ci.yml but not in bun run ci`),
  ];
}

describe("the CI guard", () => {
  test("bun run ci and the workflow run the same checks", () => {
    const local = localChecks(readFileSync(join(repo, "package.json"), "utf8"));
    const workflow = workflowChecks(readFileSync(join(repo, ".github/workflows/ci.yml"), "utf8"));

    expect(drift(local, workflow)).toEqual([]);
  });

  test("fails a check in one and not the other, whatever its flags, and leaves the setup out", () => {
    const local = localChecks(
      JSON.stringify({
        scripts: { ci: "biome ci --colors=off . && bun run typecheck && bun run test:pwa" },
      }),
    );
    const workflow = workflowChecks(
      [
        "      - run: bun install --frozen-lockfile",
        "      - name: Biome",
        "        run: bunx biome ci .",
        "      - run: bun run typecheck",
        "      - run: bunx playwright install --with-deps chromium",
        "        run: bun run check:tickets",
      ].join("\n"),
    );

    expect(drift(local, workflow)).toEqual([
      expect.stringMatching(/^test:pwa runs in bun run ci but in no step/),
      expect.stringMatching(/^check:tickets runs in .*ci\.yml but not in bun run ci$/),
    ]);
  });
});
