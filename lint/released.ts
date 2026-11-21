import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// What is never edited once released (ADR 0026: every push to master is a release), held to the
// hash of each file as it was released, kept in a `released.json` beside them: the upgrade steps
// (lint/steps.test.ts) and the shapes the screen stored for a later load (lint/stored.test.ts).
//
// Since an edit can change a file and its hash together, the hashes are held to the last
// release's too: `released.json` as it stood at RELEASED_AT, the commit before the push or
// the pull request's base in CI (.github/workflows/ci.yml), and origin/master here.

export const root = join(import.meta.dir, "..");

/** The text's hash, as `released.json` keeps it. */
export function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** What each problem says to do instead: for a released file edited, and for one dropped. */
export type Instead = { edited: string; dropped: string };

/** What is wrong with the files against the hashes released: one with no hash, changed, gone. */
export function hashProblems(
  files: Map<string, string>,
  released: Record<string, string>,
  instead: Instead,
): string[] {
  const problems: string[] = [];
  for (const [file, text] of files) {
    const hash = released[file];
    if (hash === undefined) {
      problems.push(`${file} has no hash in released.json: add ${hashOf(text)}`);
    } else if (hash !== hashOf(text)) {
      problems.push(`${file} was released and has changed since: ${instead.edited}`);
    }
  }
  for (const file of Object.keys(released)) {
    if (!files.has(file)) problems.push(`${file} was released and is gone: ${instead.dropped}`);
  }
  return problems;
}

/** What changed in `released.json` since the last release: a hash there may only be added to. */
export function releasedSince(
  before: Record<string, string>,
  now: Record<string, string>,
  instead: Instead,
): string[] {
  return Object.entries(before).flatMap(([file, hash]) => {
    if (now[file] === undefined) return [`${file} was released and its hash is gone`];
    if (now[file] !== hash) return [`${file} was released with another hash: ${instead.edited}`];
    return [];
  });
}

/** The `released.json` in a folder of the repo, as it is now. */
export function released(folder: string): Record<string, string> {
  return JSON.parse(readFileSync(join(root, folder, "released.json"), "utf8"));
}

/**
 * The `released.json` in a folder as the last release had it, or none when that release came
 * before it. A commit named in CI must be there, since the guard would pass on nothing; here, a
 * clone with no origin/master has no release to hold to.
 */
export function lastReleased(folder: string): Record<string, string> | undefined {
  const named = process.env.RELEASED_AT;
  // A push that makes the branch names no commit before it.
  if (named !== undefined && /^0+$/.test(named)) return undefined;
  const at = named ?? "origin/master";
  const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root });
  if (git("rev-parse", "--verify", "--quiet", `${at}^{commit}`).exitCode !== 0) {
    if (named !== undefined) throw new Error(`RELEASED_AT names ${at}, which was not fetched`);
    return undefined;
  }
  const path = `${at}:${folder}/released.json`;
  if (git("cat-file", "-e", path).exitCode !== 0) return undefined;
  return JSON.parse(git("show", path).stdout.toString());
}
